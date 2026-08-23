/**
 * Apparatus dew point and bypass factor.
 *
 * A real cooling coil does not bring all the air to the coil surface. The
 * classic model treats it as if a fraction of the air were cooled all the way
 * to saturation at the **apparatus dew point** while the rest bypassed the coil
 * untouched. Mixing those two streams gives the actual leaving condition, and
 * the fraction that bypassed is the **bypass factor**.
 *
 * Geometrically: the ADP is where the process line, extended past the leaving
 * state, meets the saturation curve.
 *
 * ## The degenerate case matters
 *
 * **The process line does not always reach saturation.** A coil asked for a
 * very low sensible heat ratio produces a line steeper than the saturation
 * curve, which never meets it — there is no apparatus dew point, and no bypass
 * factor either. Naive implementations return whatever their solver last
 * guessed, which looks like a number and is not one. This module returns an
 * explicit "no ADP exists" with a reason, which is the whole point of the
 * Phase 4 gate.
 */
import { lib } from '../psych/psychrolib.js';
import { bisect, ConvergenceError } from '../psych/numeric.js';
import { fromTdbW, type MoistAirState } from '../psych/state.js';
import type { UnitSystem } from '../psych/units.js';

export interface CoilConstruction {
  /** Apparatus dew point temperature, or null when the line never saturates. */
  readonly adp: number | null;
  /** The saturated state at the ADP, for plotting the construction line. */
  readonly adpState: MoistAirState | null;
  /**
   * Bypass factor: the fraction of air that behaves as though it never touched
   * the coil. Null when there is no ADP.
   */
  readonly bypassFactor: number | null;
  /** Contact factor, `1 − bypassFactor`. */
  readonly contactFactor: number | null;
  /** Why there is no ADP, when there isn't one. */
  readonly problem?: string;
}

/** How far below the leaving temperature to search for the ADP. */
const SEARCH_FLOOR = { IP: -40, SI: -40 } as const;

/**
 * Solve the coil construction for a process between two states.
 *
 * The ADP satisfies two conditions at once: it lies on the saturation curve,
 * and it is collinear with the entering and leaving states. Writing the second
 * as a line through the entering state with the process slope,
 *
 *     W(T) = W₁ − m · (T₁ − T)        where m = (W₁ − W₂) / (T₁ − T₂)
 *
 * the ADP is the root of
 *
 *     g(T) = W_sat(T) − W(T)
 *
 * `g` is positive at the leaving temperature — the leaving state is at or below
 * saturation — and, when an ADP exists, turns negative just below it.
 *
 * **It cannot be bisected over the whole range in one go.** Extended far enough
 * the line runs to negative humidity ratio, where `g` turns positive again, so
 * the bracket ends up with the same sign at both ends and a naive bisection
 * concludes there is no root at all — for an entirely ordinary coil. The scan
 * therefore walks *down* from the leaving temperature and takes the **first**
 * sign change it meets, which is the physical apparatus dew point; the second
 * crossing is an artefact of extrapolating the line past where it means
 * anything.
 */
export function solveCoil(
  entering: MoistAirState,
  leaving: MoistAirState,
  pressure: number,
  units: UnitSystem,
): CoilConstruction {
  const psy = lib(units);
  const none = (problem: string): CoilConstruction => ({
    adp: null,
    adpState: null,
    bypassFactor: null,
    contactFactor: null,
    problem,
  });

  const deltaT = entering.tdb - leaving.tdb;
  if (Math.abs(deltaT) < 1e-9) {
    return none(
      'The air leaves at the temperature it entered, so there is no process ' +
        'line to extend and no apparatus dew point.',
    );
  }
  if (deltaT < 0) {
    return none('The air leaves warmer than it entered — this is not a cooling process.');
  }

  const slope = (entering.w - leaving.w) / deltaT;
  const lineW = (tdb: number): number => entering.w - slope * (entering.tdb - tdb);
  const g = (tdb: number): number => psy.GetSatHumRatio(tdb, pressure) - lineW(tdb);

  const floor = SEARCH_FLOOR[units];
  const step = units === 'IP' ? 0.25 : 0.15;

  // Walk down from the leaving temperature to the first sign change.
  let upper = leaving.tdb;
  let gUpper = g(upper);
  let bracket: [number, number] | null = null;

  for (let lower = upper - step; lower >= floor; lower -= step) {
    const gLower = g(lower);
    if (gUpper === 0) {
      bracket = [lower, upper];
      break;
    }
    if (gLower === 0 || gLower * gUpper < 0) {
      bracket = [lower, upper];
      break;
    }
    upper = lower;
    gUpper = gLower;
  }

  if (!bracket) {
    return none(
      'The process line never reaches the saturation curve, so this coil has no ' +
        'apparatus dew point. The air is being asked to give up moisture faster ' +
        'than the temperature drop allows — no real coil delivers a sensible heat ' +
        'ratio that low from this entering condition.',
    );
  }

  let adp: number;
  try {
    adp = bisect(g, bracket[0], bracket[1], { tolerance: 1e-7 });
  } catch (error) {
    if (error instanceof ConvergenceError) {
      return none(
        'The apparatus dew point could not be located on the saturation curve ' +
          'for this process.',
      );
    }
    throw error;
  }

  const adpState = fromTdbW(adp, psy.GetSatHumRatio(adp, pressure), pressure, units);

  // Measured along temperature. The same ratio along humidity ratio is
  // identical — both are linear in the line's parameter, so they agree to
  // machine precision.
  //
  // **Enthalpy is not.** `h = cp·T + W·(hg + cpv·T)` carries a T·W cross term,
  // so h varies bilinearly along a straight line in (T, W) and its ratio comes
  // out about 0.3% different. Textbooks treat the three as interchangeable
  // because that difference is immaterial; it is not zero, and a test asserting
  // exact agreement on enthalpy would be asserting something untrue.
  const bypassFactor = (leaving.tdb - adp) / (entering.tdb - adp);

  return {
    adp,
    adpState,
    bypassFactor,
    contactFactor: 1 - bypassFactor,
  };
}

/**
 * Leaving state from an apparatus dew point and a bypass factor.
 *
 * The inverse construction: given the coil surface condition and how much air
 * bypasses it, what comes off the coil? This is how a coil is selected from
 * manufacturer data rather than from a duty.
 *
 *     x₂ = x_adp + BF · (x₁ − x_adp)        for both T and W
 */
export function leavingFromAdp(
  entering: MoistAirState,
  adp: number,
  bypassFactor: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  const psy = lib(units);
  const adpW = psy.GetSatHumRatio(adp, pressure);

  return fromTdbW(
    adp + bypassFactor * (entering.tdb - adp),
    adpW + bypassFactor * (entering.w - adpW),
    pressure,
    units,
  );
}
