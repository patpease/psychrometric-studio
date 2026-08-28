/**
 * Project file types.
 *
 * These mirror `shared/schema/project.schema.json`. The schema is authoritative
 * — it is what validates files on load, including files written by older or
 * newer versions of the app — and `tests/project-schema.test.ts` asserts that
 * these types and that schema agree.
 */
import type { StateInput } from '../psych/state.js';
import type { UnitSystem } from '../psych/units.js';

export const SCHEMA_VERSION = 2 as const;

export type StageType =
  | 'source'
  | 'mixing'
  | 'cooling'
  | 'heating'
  | 'humidifier-steam'
  | 'humidifier-adiabatic'
  | 'fan'
  | 'room'
  | 'recovery-runaround'
  | 'recovery-wraparound-precool'
  | 'recovery-wraparound-reheat'
  | 'recovery-wheel-sensible'
  | 'recovery-wheel-enthalpy'
  | 'recovery-plate'
  | 'evaporative-direct'
  | 'evaporative-indirect'
  | 'desiccant';

export type AirstreamRole =
  | 'supply'
  | 'return'
  | 'outdoor'
  | 'exhaust'
  | 'secondary'
  | 'other';

/**
 * How a stage reaches outside its own airstream.
 *
 * - `second-stream`   — mixing box: the other stream being mixed in
 * - `exchange-stream` — recovery device: the stream heat/moisture is exchanged with
 * - `secondary-stream`— indirect evaporative: the scavenger stream
 * - `paired-leg`      — wrap-around coil: the other leg of the same passive circuit
 */
export type CouplingRole =
  | 'second-stream'
  | 'exchange-stream'
  | 'secondary-stream'
  | 'paired-leg';

export interface Coupling {
  role: CouplingRole;
  airstreamId: string;
  /** Defaults to the referenced airstream's terminal state when omitted. */
  stageId?: string;
}

export interface Stage {
  id: string;
  type: StageType;
  name?: string;
  /** CFM (IP) | L/s (SI). Omit to inherit upstream mass flow. */
  airflow?: number;
  /** Validated by the process model, not the schema. */
  params?: Record<string, unknown>;
  couplings?: Coupling[];
  notes?: string;
}

export interface Airstream {
  id: string;
  name: string;
  role?: AirstreamRole;
  stages: Stage[];
}

export type AtmosphereSpec =
  | { basis: 'standard' }
  | { basis: 'altitude'; altitude: number }
  | { basis: 'explicit'; pressure: number };

export interface ProjectMeta {
  name?: string;
  projectNumber?: string;
  client?: string;
  engineer?: string;
  notes?: string;
  created?: string;
  modified?: string;
  createdWith?: {
    application?: string;
    version?: string;
    libraryVersion?: string;
  };
}

export interface ChartSettings {
  tdbRange?: [number, number];
  /** Both ends of the humidity axis, canonical. The view pans as well as zooms. */
  humidityRatioRange?: [number, number];
  /** @deprecated Superseded by `humidityRatioRange`; still read. */
  maxHumidityRatio?: number;
  projection?: 'rectangular' | 'oblique';
  families?: {
    relativeHumidity?: boolean;
    wetBulb?: boolean;
    enthalpy?: boolean;
    specificVolume?: boolean;
    dewPoint?: boolean;
    protractor?: boolean;
  };
}

export interface ComfortSettings {
  model?: 'pmv' | 'adaptive';
  metabolicRate?: number;
  clothingWinter?: number;
  clothingSummer?: number;
  /** @deprecated Superseded by the two named levels; still read as [winter, summer]. */
  clothing?: number[];
  airSpeed?: number;
  meanRadiantTemperatureOffset?: number;
  /** Indoor operative temperature for the adaptive model, in project units. */
  adaptiveIndoor?: number;
  /** Prevailing mean outdoor temperature, in project units. */
  adaptivePrevailing?: number;
  /**
   * Reserved for the SET elevated-air-speed cooling effect. Zero in v1.
   * @see PLAN.md §6.4
   */
  temperatureOffset?: number;
}

/**
 * Which weather file was used.
 *
 * The EPW itself is not stored — see the schema for why. What is stored is
 * enough to name the station, so that opening a project can say "this used
 * Denver Intl AP" rather than silently starting with no weather at all.
 *
 * This is project-level rather than per-system: both operating cases read the
 * same year of weather. What differs between them is which hours they look at,
 * which is `WeatherView` below.
 */
export interface WeatherStation {
  city?: string;
  state?: string;
  country?: string;
  wmo?: string;
  /** Site elevation in the project's units at the time of saving. */
  elevation?: number;
}

export interface WeatherSource {
  station?: WeatherStation;
}

/**
 * Which hours of the weather file an operating case looks at.
 *
 * Per-system, because that is the whole point: a heating case wants November
 * to March and a cooling case wants May to September, and having to re-pick the
 * filter on every flip would make the second system a chore rather than a view.
 */
export interface WeatherView {
  mode?: 'off' | 'scatter' | 'density';
  months?: number[];
  hours?: number[];
  presetIndex?: number;
}

/**
 * The v1 shape, where station and filter were one object.
 *
 * Read by `MIGRATIONS[1]`, which splits it, and written by nothing.
 * @deprecated Superseded by `WeatherSource` on the project and `WeatherView`
 * on each system.
 */
export type WeatherSettings = WeatherSource & WeatherView;

/**
 * What a system is for.
 *
 * A project normally holds a cooling case and a heating case, but the pairing
 * is a convention rather than a rule — a lab with two distinct summer modes is
 * a real thing — so `other` exists and the label is the user's to write. The
 * role is what picks the default label and icon; nothing calculates from it.
 */
export type SystemRole = 'cooling' | 'heating' | 'other';

/**
 * One complete operating case: the equipment chain and how it is viewed.
 *
 * This sits **above** airstreams rather than beside them, and the distinction
 * matters. An airstream is a parallel duct within one system — supply, return,
 * exhaust — and stage couplings resolve across them by id to build mixing boxes
 * and recovery loops. A system is an alternative operating state of the whole
 * assembly. Putting heating in the airstream array would have made a coupling
 * that names "return" ambiguous the moment both cases had one.
 */
export interface SystemDefinition {
  id: string;
  role: SystemRole;
  /** The name its author gave it. Absent means "call it by its position". */
  label?: string;
  /** Notes about this case specifically; project-wide notes live in `meta`. */
  notes?: string;
  airstreams: Airstream[];
  /** Chart zoom, pan, and line families. Per-system: the cases sit in
   *  different regions of the chart and should not fight over one view. */
  chart?: ChartSettings;
  weather?: WeatherView;
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  meta?: ProjectMeta;
  units: UnitSystem;
  atmosphere: AtmosphereSpec;
  /** At least one. Two is the ordinary case; the format does not cap it. */
  systems: SystemDefinition[];
  /** Which system was on screen. Clamped on read rather than trusted. */
  activeSystem?: number;
  /** Shared across systems: one site, one set of occupants, one weather file. */
  comfort?: ComfortSettings;
  weather?: WeatherSource;
}

export type { StateInput };

/**
 * What to call a system the user has not named.
 *
 * Positional rather than derived from the role, and therefore resolved where it
 * is displayed rather than stored on the system. Storing "System Mode 2" would
 * be a fact that goes stale the moment the systems are reordered — the name
 * would follow the case rather than the position it actually occupies.
 */
export function defaultSystemLabel(index: number): string {
  return `System Mode ${index + 1}`;
}

/** The name to show for a system: what its author wrote, or its position. */
export function systemLabel(system: { label?: string | undefined }, index: number): string {
  const written = system.label?.trim();
  return written !== undefined && written.length > 0 ? written : defaultSystemLabel(index);
}

/** An empty project, used for a new session and as a test fixture baseline. */
export function emptyProject(units: UnitSystem = 'IP'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    units,
    atmosphere: { basis: 'standard' },
    systems: [
      {
        id: 'cooling',
        role: 'cooling',
        airstreams: [{ id: 'supply', name: 'Supply air', role: 'supply', stages: [] }],
      },
    ],
    activeSystem: 0,
  };
}
