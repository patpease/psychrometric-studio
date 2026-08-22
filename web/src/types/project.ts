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
  clothing?: number[];
  airSpeed?: number;
  meanRadiantTemperatureOffset?: number;
  /**
   * Reserved for the SET elevated-air-speed cooling effect. Zero in v1.
   * @see PLAN.md §6.4
   */
  temperatureOffset?: number;
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  meta?: ProjectMeta;
  units: UnitSystem;
  atmosphere: AtmosphereSpec;
  airstreams: Airstream[];
  chart?: ChartSettings;
  comfort?: ComfortSettings;
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
