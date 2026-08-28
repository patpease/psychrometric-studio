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
  systemLabel,
  type AtmosphereSpec,
  type Project,
  type ProjectMeta,
  type Stage,
  type SystemDefinition,
  type SystemRole,
  type WeatherStation,
  type WeatherView,
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
  pressureMode: PressureMode;
  /** Site elevation in display units; meaningful when the mode is 'altitude'. */
  altitude: number;
  /** The explicit-pressure field as typed, in display units (psia | kPa). */
  explicitPressure: string;
  /** Operating cases. Never empty; `activeSystem` always indexes one of them. */
  systems: SessionSystem[];
  activeSystem: number;
  comfort: ComfortSettingsState;
  /** Which weather file is loaded. Shared: every system reads the same year. */
  station: WeatherStation | null;
  meta: ProjectMeta;
}

/**
 * One operating case, as the session holds it.
 *
 * The session resolves what the file leaves optional. A label is a plain string
 * here rather than `string | undefined`, because the interface has to render
 * something either way, and defaulting at each read site is exactly how two
 * places end up disagreeing about what an unnamed heating case is called.
 */
export interface SessionSystem {
  id: string;
  role: SystemRole;
  /** The user's own name for this case. Empty means it goes by its position. */
  label: string;
  notes: string;
  stages: Stage[];
  domain: ChartDomain;
  visibility: Record<FamilyKey, boolean>;
  showProtractor: boolean;
  /** Which hours of the shared weather file this case looks at. */
  weather: WeatherView;
}

/** A system with nothing in it, named from its role. */
export function blankSystem(
  role: SystemRole,
  units: UnitSystem,
  stages: Stage[] = [],
): SessionSystem {
  return {
    id: role,
    role,
    label: '',
    notes: '',
    stages,
    domain: defaultDomain(units),
    visibility: { ...DEFAULT_VISIBILITY },
    showProtractor: false,
    weather: { mode: 'off', months: [], hours: [], presetIndex: 0 },
  };
}

/** The system currently on screen. Clamped, so a bad index cannot crash a read. */
export function activeSystemOf(session: SessionState): SessionSystem {
  const index = Math.min(Math.max(session.activeSystem, 0), session.systems.length - 1);
  return session.systems[index]!;
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
    systems: session.systems.map((system) => systemToFile(system, session.station !== null)),
    activeSystem: session.activeSystem,
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
  if (session.station) project.weather = { station: session.station };

  return project;
}

/**
 * One system, as it is written to a file.
 *
 * A label is written only when its author wrote one. A file that spells out the
 * positional default pins today's wording forever, and would go stale the
 * moment the systems were reordered; leaving it out lets the name follow the
 * position, while a renamed system keeps the name it was given.
 */
function systemToFile(system: SessionSystem, hasWeatherFile: boolean): SystemDefinition {
  const file: SystemDefinition = {
    id: system.id,
    role: system.role,
    airstreams: [
      { id: 'supply', name: 'Supply air', role: 'supply', stages: system.stages },
    ],
    chart: {
      tdbRange: [system.domain.tdbMin, system.domain.tdbMax],
      humidityRatioRange: [system.domain.wMin, system.domain.wMax],
      projection: 'rectangular',
      families: {
        relativeHumidity: system.visibility.relativeHumidity,
        wetBulb: system.visibility.wetBulb,
        enthalpy: system.visibility.enthalpy,
        specificVolume: system.visibility.specificVolume,
        dewPoint: system.visibility.dewPoint,
        protractor: system.showProtractor,
      },
    },
  };

  if (system.label.trim().length > 0) file.label = system.label.trim();
  if (system.notes.trim().length > 0) file.notes = system.notes;
  // An hour filter with no file to filter is not a setting anyone chose; it is
  // whatever the controls happened to default to. Writing it would make an
  // untouched project look configured.
  if (hasWeatherFile) file.weather = { ...system.weather };

  return file;
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
  const comfort = project.comfort ?? {};
  const defaults = defaultComfortSettings(units);

  const clothing: [number, number] = [
    comfort.clothingWinter ?? comfort.clothing?.[0] ?? defaults.clothing[0],
    comfort.clothingSummer ?? comfort.clothing?.[1] ?? defaults.clothing[1],
  ];

  // The validator guarantees at least one system, but `fromProject` is also
  // reachable from tests and from hand-built objects, so a project with none
  // opens as a new one rather than as a session with nothing to show.
  const systems =
    project.systems.length > 0
      ? project.systems.map((system) => systemFromFile(system, units))
      : [blankSystem('cooling', units)];

  return {
    units,
    ...pressureFieldsFrom(project.atmosphere, units),
    systems,
    // Clamped rather than trusted: a hand-edited file can name a system that
    // is not there, and an out-of-range index would read as undefined at every
    // site that reaches for the active case.
    activeSystem: Math.min(Math.max(project.activeSystem ?? 0, 0), systems.length - 1),
    comfort: {
      model: comfort.model ?? 'off',
      met: comfort.metabolicRate ?? defaults.met,
      airSpeed: comfort.airSpeed ?? defaults.airSpeed,
      mrtOffset: comfort.meanRadiantTemperatureOffset ?? defaults.mrtOffset,
      clothing,
      adaptiveIndoor: comfort.adaptiveIndoor ?? defaults.adaptiveIndoor,
      adaptivePrevailing: comfort.adaptivePrevailing ?? defaults.adaptivePrevailing,
    },
    station: project.weather?.station ?? null,
    meta: project.meta ?? {},
  };
}

/** One system, read back with every optional field resolved to a value. */
function systemFromFile(system: SystemDefinition, units: UnitSystem): SessionSystem {
  const fallbackDomain = defaultDomain(units);
  const chart = system.chart ?? {};

  const [tdbMin, tdbMax] = chart.tdbRange ?? [fallbackDomain.tdbMin, fallbackDomain.tdbMax];
  const [wMin, wMax] = chart.humidityRatioRange ??
    // The superseded form named only the top of the axis.
    (chart.maxHumidityRatio !== undefined
      ? [0, chart.maxHumidityRatio]
      : [fallbackDomain.wMin, fallbackDomain.wMax]);

  const families = chart.families ?? {};
  const view = system.weather ?? {};

  return {
    id: system.id,
    role: system.role,
    label: system.label ?? '',
    notes: system.notes ?? '',
    // Only the supply stream is editable in this build. A multi-airstream
    // system is valid and its other streams are preserved on the project
    // object; the editor simply does not show them yet.
    stages: system.airstreams[0]?.stages ?? [],
    domain: { tdbMin: tdbMin!, tdbMax: tdbMax!, wMin: wMin!, wMax: wMax! },
    visibility: {
      // Saturation is not optional — it is the boundary of the region the chart
      // describes, not a family you can turn off — so it is not in the file.
      saturation: true,
      relativeHumidity: families.relativeHumidity ?? DEFAULT_VISIBILITY.relativeHumidity,
      wetBulb: families.wetBulb ?? DEFAULT_VISIBILITY.wetBulb,
      enthalpy: families.enthalpy ?? DEFAULT_VISIBILITY.enthalpy,
      specificVolume: families.specificVolume ?? DEFAULT_VISIBILITY.specificVolume,
      dewPoint: families.dewPoint ?? DEFAULT_VISIBILITY.dewPoint,
    },
    showProtractor: families.protractor ?? false,
    weather: {
      mode: view.mode ?? 'off',
      months: [...(view.months ?? [])],
      hours: [...(view.hours ?? [])],
      presetIndex: view.presetIndex ?? 0,
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Migration
 * -------------------------------------------------------------------------- */

/** Upgrades one version to the next. Registered by the version it reads. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Version 1 to 2: a project gains operating cases.
 *
 * Everything a v1 file said about the system was said once, at the top level,
 * because there was only ever one system. That whole description — the
 * airstreams, the chart view, and the hour filter — becomes the cooling case,
 * and the file gains a second one only when the user builds it.
 *
 * The one thing that is not simply moved is `weather`. In v1 it carried the
 * station *and* the hour filter in one object; in v2 those live at different
 * levels, because every case reads the same file but looks at different hours.
 * So it is split rather than relocated, and a v1 file with no weather at all
 * produces neither half.
 */
const migrateV1ToV2: Migration = (raw) => {
  const { airstreams, chart, weather, ...rest } = raw;
  const source = isRecord(weather) ? weather : {};
  const { station, ...view } = source;

  const cooling: Record<string, unknown> = {
    id: 'cooling',
    role: 'cooling',
    // A v1 file cannot have been a multi-airstream project in practice — the
    // editor only ever wrote one — but the format allowed it, so carry
    // whatever is there rather than reaching for [0].
    airstreams: Array.isArray(airstreams) ? airstreams : [],
  };
  if (isRecord(chart)) cooling['chart'] = chart;
  if (Object.keys(view).length > 0) cooling['weather'] = view;

  const upgraded: Record<string, unknown> = {
    ...rest,
    schemaVersion: 2,
    systems: [cooling],
    activeSystem: 0,
  };
  if (isRecord(station)) upgraded['weather'] = { station };

  return upgraded;
};

/**
 * Migrations, keyed by the version they upgrade **from**.
 *
 * `migrate` chains these automatically, including across several versions at
 * once — the case that gets forgotten when a registry is written later, under
 * the pressure of a format change that has already shipped.
 */
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
/** Lower-case, hyphenated, and safe on every filesystem people actually use. */
function slug(text: string, limit: number): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit);
}

export interface FilenameOptions {
  /**
   * Names the operating case, for exports that hold only one of them.
   *
   * A project file carries every case and must not be qualified — it would
   * claim to be half of itself. A chart, a CSV, or a report is a picture of one
   * case, and two of them in a downloads folder are indistinguishable without
   * this.
   */
  qualifier?: string | undefined;
  now?: Date | undefined;
}

export function projectFilename(
  meta: ProjectMeta,
  extension: string,
  options: FilenameOptions | Date = {},
): string {
  // The third argument used to be the date. Accepting it keeps older callers
  // and their tests honest rather than silently reading a Date as options.
  const { qualifier, now = new Date() } =
    options instanceof Date ? { qualifier: undefined, now: options } : options;

  const stamp = now.toISOString().slice(0, 10);
  const base = slug(meta.name ?? 'psychrometric-study', 60) || 'psychrometric-study';
  const which = qualifier ? slug(qualifier, 40) : '';

  return [base, which, stamp].filter(Boolean).join('-') + '.' + extension;
}
