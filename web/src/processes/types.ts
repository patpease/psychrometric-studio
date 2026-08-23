/**
 * The process model contract.
 *
 * Ported structurally from bh-psych's `Equipment.apply(entering, upstream_m,
 * pressure, units) -> StageResult`. That shape survives the rewrite because it
 * is right: a stage is a pure function from an entering state and a set of
 * parameters to a leaving state plus a duty summary, with nothing hidden in
 * instance state between calls.
 */
import type { MoistAirState } from '../psych/state.js';
import type { CoilConstruction } from './coil.js';
import type { UnitSystem } from '../psych/units.js';
import type { CouplingRole, StageType } from '../types/project.js';

/**
 * How a duty divides between temperature change and moisture change.
 *
 * Sign convention throughout: **positive into the airstream**. A cooling coil
 * therefore reports negative total and sensible duty.
 */
export interface DutySplit {
  /** Total duty, MBH (IP) | kW (SI). */
  readonly total: number;
  /** The part that changed dry-bulb temperature at constant humidity ratio. */
  readonly sensible: number;
  /** The remainder, which changed humidity ratio. */
  readonly latent: number;
  /**
   * Sensible heat ratio, `sensible / total`. `NaN` when total duty is zero —
   * an undefined ratio is reported as undefined rather than as 1.
   */
  readonly shr: number;
}

export const ZERO_DUTY: DutySplit = { total: 0, sensible: 0, latent: 0, shr: Number.NaN };

/** A state worth showing on the chart that is not the stage's leaving state. */
export interface AuxiliaryState {
  readonly label: string;
  readonly state: MoistAirState;
}

/** Everything a stage produces. */
export interface StageResult {
  /** The leaving air condition. */
  readonly state: MoistAirState;
  /** Dry-air mass flow through the stage, lb/h (IP) | kg/s (SI). */
  readonly massFlow: number;
  /** Volumetric airflow at the *entering* condition, CFM | L/s. */
  readonly airflow: number;
  readonly duty: DutySplit;
  /** Moisture added to the air, lb/h | kg/h. Negative when condensing. */
  readonly moistureRate: number;
  /** A short sentence about what the stage did, shown beside the result. */
  readonly note?: string;
  /**
   * Conditions the engine had to adjust, or results that deserve a second look.
   * Carried through to the UI rather than swallowed.
   */
  readonly warnings: readonly string[];
  /** Extra states to plot — the second stream of a mixing box, for instance. */
  readonly auxiliary?: readonly AuxiliaryState[];
  /**
   * Apparatus dew point and bypass factor, for stages that have them.
   *
   * Present on cooling coils. Its `adp` is null when the process line never
   * reaches saturation, with `problem` saying so.
   */
  readonly coil?: CoilConstruction;
}

/** What a process model is given. */
export interface ProcessContext {
  /** The leaving state of the previous stage. `null` for the first stage. */
  readonly entering: MoistAirState | null;
  /** Mass flow arriving from upstream, or `null` for the first stage. */
  readonly upstreamMassFlow: number | null;
  readonly pressure: number;
  readonly units: UnitSystem;
  /** Volumetric airflow declared on this stage, if any. */
  readonly airflow?: number | undefined;
  /** Terminal states of coupled airstreams, keyed by the coupling's role. */
  readonly couplings: Partial<Record<CouplingRole, MoistAirState>>;
  /**
   * Full results of coupled stages, where the coupling names a specific stage.
   *
   * A state alone is not always enough. The reheat leg of a wrap-around coil
   * has to know how much heat the pre-cool leg removed, which is a property of
   * the *process*, not of either end state — recovering it from the leaving
   * state would mean guessing at the entering one.
   */
  readonly couplingResults: Partial<Record<CouplingRole, StageResult>>;
  /** Mass flow of coupled airstreams, for effectiveness with unequal flows. */
  readonly couplingMassFlow: Partial<Record<CouplingRole, number>>;
}

/**
 * A process model.
 *
 * `parseParams` exists so that malformed or missing parameters fail with a
 * message naming the stage and the field, rather than surfacing later as a
 * `NaN` that propagates silently down the chain.
 */
export interface ProcessModel<Params> {
  readonly type: StageType;
  /** Human-readable name, used in the UI and in error messages. */
  readonly displayName: string;
  /** True if the stage begins an airstream and takes no entering condition. */
  readonly isSource?: boolean;
  readonly parseParams: (raw: unknown, units: UnitSystem) => Params;
  readonly apply: (context: ProcessContext, params: Params) => StageResult;
}

/** Raised when a stage cannot be solved. Carries enough to point at the cause. */
export class ProcessError extends Error {
  constructor(
    message: string,
    readonly stageType: StageType,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

/** Read a required finite number from raw parameters. */
export function requireNumber(
  raw: unknown,
  field: string,
  stageType: StageType,
  options: { min?: number; max?: number } = {},
): number {
  const record = (raw ?? {}) as Record<string, unknown>;
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProcessError(`${stageType}: "${field}" is required and must be a number.`, stageType, field);
  }
  if (options.min !== undefined && value < options.min) {
    throw new ProcessError(
      `${stageType}: "${field}" must be at least ${options.min}, got ${value}.`,
      stageType,
      field,
    );
  }
  if (options.max !== undefined && value > options.max) {
    throw new ProcessError(
      `${stageType}: "${field}" must be at most ${options.max}, got ${value}.`,
      stageType,
      field,
    );
  }
  return value;
}

/** Read an optional finite number, returning `undefined` when absent. */
export function optionalNumber(raw: unknown, field: string): number | undefined {
  const record = (raw ?? {}) as Record<string, unknown>;
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Read an optional boolean. */
export function optionalBoolean(raw: unknown, field: string): boolean | undefined {
  const record = (raw ?? {}) as Record<string, unknown>;
  const value = record[field];
  return typeof value === 'boolean' ? value : undefined;
}
