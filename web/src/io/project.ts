/**
 * Turning a working session into a file, and back.
 *
 * The project format stores what the user **declared**, never what the solver
 * worked out. A file records that the coil leaves at 54 °F and 93% RH, not that
 * it therefore removes 75.5 MBH — so reopening the same project at a different
 * site pressure re-solves rather than carrying yesterday's answers forward under
 * today's assumptions. This is the single most important property of the format
 * and everything below follows from it.
 *
 * ## The migration path
 *
 * `migrate` exists with no migrations in it. That is deliberate rather than
 * lazy: the moment the format changes, there has to be somewhere obvious for
 * the upgrade to live, and a registry added under pressure after the first
 * breaking change is a registry designed around one special case. The shape is
 * here from the start, tested with a synthetic step, and currently a no-op.
 *
 * ## Superseded fields
 *
 * Two fields were replaced during Phase 7 — `maxHumidityRatio` by
 * `humidityRatioRange`, and the positional `clothing` array by two named
 * levels. Both are still *read*, because a file that opened yesterday should
 * open today. Neither is written.
 */
import type { ChartDomain } from '../chart/scales.js';
import type { FamilyKey } from '../chart/families.js';
import { DEFAULT_VISIBILITY } from '../chart/theme.js';
import { defaultDomain } from '../chart/scales.js';
import type { UnitSystem } from '../psych/units.js';
import { pressureFromDisplay, pressureToDisplay } from '../psych/units.js';
import {
  SCHEMA_VERSION,
  type AtmosphereSpec,
  type Project,
  type ProjectMeta,
  type Stage,
  type WeatherSettings,
} from '../types/project.js';
import type { ComfortSettingsState } from '../ui/ComfortPanel.js';
import { defaultComfortSettings } from '../ui/ComfortPanel.js';
import { APP_VERSION, BRAND } from '../config/branding.js';
import { CALCULATION_BASIS } from '../psych/psychrolib.js';
import { validateProject, type ValidationResult } from './validate.js';

/** How the site pressure is being specified in the UI. */
export type PressureMode = 'sea-level' | 'altitude' | 'explicit';

/**
 * Exactly the part of a session that survives being saved.
 *
 * Named as its own type so that the App and the file format are coupled through
 * one declaration rather than through a pair of functions that drift. Anything
 * absent from here — the selected stage, the hover readout, walkthrough
 * progress — is session state, and reopening a project deliberately starts it
 * fresh.
 */
export interface SessionState {
  units: UnitSystem;
  domain: ChartDomain;
  pressureMode: PressureMode;
  /** Site elevation in display units; meaningful when the mode is 'altitude'. */
  altitude: number;
  /** The explicit-pressure field as typed, in display units (psia | kPa). */
  explicitPressure: string;
  stages: Stage[];
  visibility: Record<FamilyKey, boolean>;
  showProtractor: boolean;
  comfort: ComfortSettingsState;
  weather: WeatherSettings | null;
  meta: ProjectMeta;
}

/* -------------------------------------------------------------------------- *
 * Site pressure
 * -------------------------------------------------------------------------- */

export function atmosphereSpecFrom(session: SessionState): AtmosphereSpec {
  switch (session.pressureMode) {
    case 'altitude':
      return { basis: 'altitude', altitude: session.altitude };
    case 'explicit': {
      const typed = Number.parseFloat(session.explicitPressure);
      // An unparseable entry is not an explicit pressure. Writing it as one
      // would produce a file that fails its own validator.
      if (!Number.isFinite(typed) || typed <= 0) return { basis: 'standard' };
      return { basis: 'explicit', pressure: pressureFromDisplay(typed, session.units) };
    }
    default:
      return { basis: 'standard' };
  }
}

export function pressureFieldsFrom(
  spec: AtmosphereSpec,
  units: UnitSystem,
): { pressureMode: PressureMode; altitude: number; explicitPressure: string } {
  switch (spec.basis) {
    case 'altitude':
      return { pressureMode: 'altitude', altitude: spec.altitude, explicitPressure: '' };
    case 'explicit':
      return {
        pressureMode: 'explicit',
        altitude: 0,
        explicitPressure: String(Number(pressureToDisplay(spec.pressure, units).toFixed(3))),
      };
    default:
      return { pressureMode: 'sea-level', altitude: 0, explicitPressure: '' };
  }
}

/* -------------------------------------------------------------------------- *
 * Session → file
 * -------------------------------------------------------------------------- */

export function toProject(session: SessionState, now: Date = new Date()): Project {
  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ...session.meta,
      created: session.meta.created ?? now.toISOString(),
      modified: now.toISOString(),
      // Stamped for traceability and never read back for behaviour. A file that
      // cannot be traced to the release that produced it is a liability.
      createdWith: {
        application: `${BRAND.appName} — ${BRAND.organisation}`,
        version: APP_VERSION,
        libraryVersion: `${CALCULATION_BASIS.library} ${CALCULATION_BASIS.version}`,
      },
    },
    units: session.units,
    atmosphere: atmosphereSpecFrom(session),
    airstreams: [
      { id: 'supply', name: 'Supply air', role: 'supply', stages: session.stages },
    ],
    chart: {
      tdbRange: [session.domain.tdbMin, session.domain.tdbMax],
      humidityRatioRange: [session.domain.wMin, session.domain.wMax],
      projection: 'rectangular',
      families: {
        relativeHumidity: session.visibility.relativeHumidity,
        wetBulb: session.visibility.wetBulb,
        enthalpy: session.visibility.enthalpy,
        specificVolume: session.visibility.specificVolume,
        dewPoint: session.visibility.dewPoint,
        protractor: session.showProtractor,
      },
    },
    comfort: {
      metabolicRate: session.comfort.met,
      clothingWinter: session.comfort.clothing[0],
      clothingSummer: session.comfort.clothing[1],
      airSpeed: session.comfort.airSpeed,
      meanRadiantTemperatureOffset: session.comfort.mrtOffset,
      adaptiveIndoor: session.comfort.adaptiveIndoor,
      adaptivePrevailing: session.comfort.adaptivePrevailing,
    },
  };

  // 'off' is the *absence* of an overlay, and the schema says so by leaving the
  // key out. Writing `model: undefined` would be the same thing after
  // JSON.stringify but would not survive a structural comparison in a test, so
  // the key is only ever added when there is a model to name. The comfort
  // inputs themselves are written either way: turning the overlay off should
  // not throw away the clothing levels you set.
  if (session.comfort.model !== 'off') project.comfort!.model = session.comfort.model;
  if (session.weather) project.weather = session.weather;

  return project;
}

/* -------------------------------------------------------------------------- *
 * File → session
 * -------------------------------------------------------------------------- */

/**
 * Read a project into session state, filling anything absent with the default.
 *
 * A file is allowed to be sparse: `chart` and `comfort` are optional, and a
 * hand-written project with nothing but airstreams should open. Every read here
 * therefore falls back rather than failing, and the *structural* checks that
 * genuinely must pass live in the validator, which runs first.
 */
export function fromProject(project: Project): SessionState {
  const units = project.units;
  const fallbackDomain = defaultDomain(units);
  const chart = project.chart ?? {};
  const comfort = project.comfort ?? {};
  const defaults = defaultComfortSettings(units);

  const [tdbMin, tdbMax] = chart.tdbRange ?? [fallbackDomain.tdbMin, fallbackDomain.tdbMax];
  const [wMin, wMax] = chart.humidityRatioRange ??
    // The superseded form named only the top of the axis.
    (chart.maxHumidityRatio !== undefined
      ? [0, chart.maxHumidityRatio]
      : [fallbackDomain.wMin, fallbackDomain.wMax]);

  const families = chart.families ?? {};
  const visibility: Record<FamilyKey, boolean> = {
    // Saturation is not optional — it is the boundary of the region the chart
    // describes, not a family you can turn off — so it is not in the file.
    saturation: true,
    relativeHumidity: families.relativeHumidity ?? DEFAULT_VISIBILITY.relativeHumidity,
    wetBulb: families.wetBulb ?? DEFAULT_VISIBILITY.wetBulb,
    enthalpy: families.enthalpy ?? DEFAULT_VISIBILITY.enthalpy,
    specificVolume: families.specificVolume ?? DEFAULT_VISIBILITY.specificVolume,
    dewPoint: families.dewPoint ?? DEFAULT_VISIBILITY.dewPoint,
  };

  const clothing: [number, number] = [
    comfort.clothingWinter ?? comfort.clothing?.[0] ?? defaults.clothing[0],
    comfort.clothingSummer ?? comfort.clothing?.[1] ?? defaults.clothing[1],
  ];

  return {
    units,
    domain: { tdbMin: tdbMin!, tdbMax: tdbMax!, wMin: wMin!, wMax: wMax! },
    ...pressureFieldsFrom(project.atmosphere, units),
    // Only the supply stream is editable in this build. A multi-airstream file
    // is valid and its other streams are preserved on the project object; the
    // editor simply does not show them yet.
    stages: project.airstreams[0]?.stages ?? [],
    visibility,
    showProtractor: families.protractor ?? false,
    comfort: {
      model: comfort.model ?? 'off',
      met: comfort.metabolicRate ?? defaults.met,
      airSpeed: comfort.airSpeed ?? defaults.airSpeed,
      mrtOffset: comfort.meanRadiantTemperatureOffset ?? defaults.mrtOffset,
      clothing,
      adaptiveIndoor: comfort.adaptiveIndoor ?? defaults.adaptiveIndoor,
      adaptivePrevailing: comfort.adaptivePrevailing ?? defaults.adaptivePrevailing,
    },
    weather: project.weather ?? null,
    meta: project.meta ?? {},
  };
}

/* -------------------------------------------------------------------------- *
 * Migration
 * -------------------------------------------------------------------------- */

/** Upgrades one version to the next. Registered by the version it reads. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations, keyed by the version they upgrade **from**.
 *
 * Empty today. When version 2 arrives, `MIGRATIONS[1]` turns a v1 object into a
 * v2 object and `migrate` chains automatically — including across several
 * versions at once, which is the case that gets forgotten when this is written
 * later.
 */
export const MIGRATIONS: Record<number, Migration> = {};

export interface MigrationResult {
  readonly raw: unknown;
  /** Versions stepped through, for the "this file was upgraded" notice. */
  readonly applied: readonly number[];
}

export function migrate(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { raw, applied: [] };
  }

  let current = raw as Record<string, unknown>;
  const applied: number[] = [];

  // Guarded against a migration that fails to advance the version, which would
  // otherwise spin forever on a file nobody can reproduce.
  for (let guard = 0; guard < 64; guard += 1) {
    const version = current['schemaVersion'];
    if (typeof version !== 'number' || version >= SCHEMA_VERSION) break;
    const step = MIGRATIONS[version];
    if (!step) break;
    const next = step(current);
    if (next['schemaVersion'] === version) {
      throw new Error(`Migration from version ${version} did not advance the version.`);
    }
    current = next;
    applied.push(version);
  }

  return { raw: current, applied };
}

/* -------------------------------------------------------------------------- *
 * Reading a file
 * -------------------------------------------------------------------------- */

export interface LoadResult extends ValidationResult {
  /** Versions the file was upgraded through on the way in. */
  readonly migrated: readonly number[];
}

/** Parse, migrate, and validate the text of a project file. Never throws. */
export function readProject(text: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      project: null,
      migrated: [],
      problems: [
        `This file is not valid JSON — ${error instanceof Error ? error.message : 'it could not be parsed'}.`,
      ],
    };
  }

  let migrated: MigrationResult;
  try {
    migrated = migrate(parsed);
  } catch (error) {
    return {
      project: null,
      migrated: [],
      problems: [error instanceof Error ? error.message : 'This file could not be upgraded.'],
    };
  }

  return { ...validateProject(migrated.raw), migrated: migrated.applied };
}

/** Serialise a project for download. Indented: these files get read by people. */
export function writeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/** A filename that sorts usefully and does not collide. */
export function projectFilename(meta: ProjectMeta, extension: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  const base = (meta.name ?? 'psychrometric-study')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'psychrometric-study'}-${stamp}.${extension}`;
}
