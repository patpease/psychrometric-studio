/**
 * The shape of the educational content.
 *
 * Ported from bh-psych's `education.py`, whose schema — `title`, `kind`,
 * `moves`, `text`, `check` — survives the rewrite because it is already the
 * right decomposition. Two fields are promoted from prose to behaviour:
 *
 * - **`moves`** declared which properties rise, fall, or hold. Here they are
 *   compared against what the solver actually produced, so the panel can say
 *   "W constant — as it must be" or "W fell by 0.0021 lb/lb".
 * - **`check`** was the sanity check a senior engineer would make. Where the
 *   check can be evaluated, `rule` evaluates it against the solved stage and
 *   the advice appears on the stage itself. That is what separates a chart that
 *   draws what it is told from one that reviews what it was told.
 *
 * A `rule` is optional and deliberately so. "Use coincident design conditions,
 * not peak dry-bulb with peak wet-bulb" is excellent advice that no amount of
 * code can verify from the number typed in. Advice that cannot be checked stays
 * prose rather than being bent into a rule that fires on the wrong thing.
 */
import type { MoistAirState } from '../psych/state.js';
import type { StageResult } from '../processes/types.js';
import type { UnitSystem } from '../psych/units.js';
import type { Stage } from '../types/project.js';

/** The properties a process can move, named as they are on the chart. */
export type MoveProperty = 'tdb' | 'w' | 'h' | 'rh' | 'twb' | 'tdp' | 'v' | 'slope';

export type MoveDirection =
  | 'up'
  | 'down'
  | 'constant'
  | 'input'
  | 'conditional'
  | 'set-by-load'
  | 'between';

export interface Move {
  readonly property: MoveProperty;
  readonly direction: MoveDirection;
  /** Shown where the direction alone understates it — "down, if the surface
   *  is below the entering dew point", for instance. */
  readonly qualifier?: string;
}

/** What a live check is given. */
export interface CheckContext {
  readonly stage: Stage;
  readonly result: StageResult;
  /** The entering state, or `null` for a source stage. */
  readonly entering: MoistAirState | null;
  /** Dry-air mass flow arriving from upstream, or `null` for a source stage. */
  readonly enteringMassFlow: number | null;
  readonly units: UnitSystem;
}

/**
 * A live evaluation of the `check` text.
 *
 * Returns `null` when the design passes. A returned string is **advice, not an
 * error** — it names a condition worth a second look, and the user is free to
 * be right and the rule wrong. The wording should read that way.
 */
export type CheckRule = (context: CheckContext) => string | null;

export interface EducationEntry {
  /** Stable key: a stage type, or a concept id. */
  readonly id: string;
  readonly title: string;
  /** Thermodynamic classification — "Adiabatic mixing", "Sensible heating". */
  readonly kind: string;
  /** Icon file name; see `icons/map.ts`. */
  readonly icon: string;
  readonly moves: readonly Move[];
  /** What physically happens. Two or three sentences, no more. */
  readonly text: string;
  /** The check a senior engineer would make, as prose. Always present. */
  readonly check: string;
  /** The same check, evaluated, where evaluating it is possible. */
  readonly rule?: CheckRule;
  /** Design values worth knowing, as label/value pairs. */
  readonly typical?: readonly { readonly label: string; readonly value: string }[];
  /** Related concept ids, rendered as links within the panel. */
  readonly seeAlso?: readonly string[];
}

/**
 * What a property actually did across a stage.
 *
 * `direction` is derived from the solved states, not from the declared `moves`,
 * so a mismatch between the two is visible rather than hidden — and a mismatch
 * is exactly the interesting case.
 */
export interface ObservedMove {
  readonly property: MoveProperty;
  readonly direction: 'up' | 'down' | 'constant';
  readonly from: number;
  readonly to: number;
  readonly delta: number;
}
