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

export const SCHEMA_VERSION = 1 as const;

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
 * How the weather overlay was set up.
 *
 * The EPW itself is not stored — see the schema for why. What is stored is
 * enough to name the station, so that opening a project can say "this used
 * Denver Intl AP" rather than silently starting with no weather at all.
 */
export interface WeatherSettings {
  station?: {
    city?: string;
    state?: string;
    country?: string;
    wmo?: string;
    /** Site elevation in the project's units at the time of saving. */
    elevation?: number;
  };
  mode?: 'off' | 'scatter' | 'density';
  months?: number[];
  hours?: number[];
  presetIndex?: number;
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  meta?: ProjectMeta;
  units: UnitSystem;
  atmosphere: AtmosphereSpec;
  airstreams: Airstream[];
  chart?: ChartSettings;
  comfort?: ComfortSettings;
  weather?: WeatherSettings;
}

export type { StateInput };

/** An empty project, used for a new session and as a test fixture baseline. */
export function emptyProject(units: UnitSystem = 'IP'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    units,
    atmosphere: { basis: 'standard' },
    airstreams: [{ id: 'supply', name: 'Supply air', role: 'supply', stages: [] }],
  };
}
