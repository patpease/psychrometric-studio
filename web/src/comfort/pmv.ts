/**
 * PMV and PPD, per ASHRAE Standard 55.
 *
 * PsychroLib does not do comfort — it is strictly moist-air properties — so
 * this is the one place the application reaches for a second library.
 * `jsthermalcomfort` is the JavaScript port of `pythermalcomfort`, by the same
 * author as the CBE Thermal Comfort Tool, and is validated against the same
 * reference tables.
 *
 * ## Two decisions worth knowing
 *
 * **Everything is evaluated in SI, whatever the app's unit system.** The
 * library does offer an IP path, but it converts air speed through feet per
 * second, and 20 fpm arrives as 0.10058 m/s — a hair above the 0.1 m/s
 * threshold where ASHRAE Appendix H starts trying to compute a cooling effect.
 * The solver then cannot converge on an effect that is essentially zero, logs a
 * warning, and falls back to zero. Converting at our own boundary sidesteps
 * that entirely, and PMV is defined in SI anyway.
 *
 * **`round_output` must be off.** It defaults to true and quantises PMV to two
 * decimal places, which turns the comfort-boundary bisection into a staircase
 * and stalls it. Full precision is required for the polygon.
 */
import { pmv_ppd_ashrae } from 'jsthermalcomfort';
import { fahrenheitToCelsius, celsiusToFahrenheit, type UnitSystem } from '../psych/units.js';

/** Comfort inputs, in the application's own unit system. */
export interface ComfortInputs {
  /** Dry-bulb temperature, °F (IP) | °C (SI). */
  readonly tdb: number;
  /**
   * Mean radiant temperature minus dry bulb, in the same degrees.
   * Zero means the radiant environment tracks the air.
   */
  readonly mrtOffset: number;
  /** Relative humidity, 0–1. */
  readonly rh: number;
  /** Air speed, **always m/s** regardless of unit system. */
  readonly airSpeed: number;
  /** Metabolic rate, met. */
  readonly met: number;
  /** Clothing insulation, clo. */
  readonly clo: number;
}

export interface ComfortResult {
  readonly pmv: number;
  readonly ppd: number;
  /** True when |PMV| ≤ 0.5, the ASHRAE 55 comfort criterion. */
  readonly comfortable: boolean;
  /** Applicability problems. Empty when every input is inside the standard. */
  readonly limits: readonly string[];
}

/**
 * ASHRAE 55 applicability limits for the PMV method.
 *
 * These are enforced and reported rather than silently applied. A tool that
 * quietly extrapolates outside a standard's stated range is worse than one that
 * refuses, because the number looks just as authoritative either way.
 */
export const PMV_LIMITS = {
  met: { min: 1.0, max: 2.0 },
  clo: { min: 0, max: 1.5 },
  /** Above this, the still-air method does not apply and Appendix H does. */
  stillAirSpeed: 0.2,
  tdbCelsius: { min: 10, max: 40 },
} as const;

/**
 * The air speed above which ASHRAE Appendix H computes a cooling effect.
 * Below it, elevated air speed has no credit.
 */
export const COOLING_EFFECT_THRESHOLD = 0.1;

/**
 * Filter one specific, known-benign warning out of the console.
 *
 * `cooling_effect` logs when its solver cannot converge, which happens for air
 * speeds fractionally above 0.1 m/s where the effect is essentially zero. The
 * library's fallback — treat it as zero — is correct; the noise is not, because
 * a comfort polygon runs a hundred solves per boundary and a slider drag would
 * emit thousands of identical lines.
 *
 * Only that exact message is dropped. Anything else the library has to say
 * still reaches the console.
 */
function withoutCoolingEffectNoise<T>(run: () => T): T {
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].startsWith('Assuming cooling effect = 0')) return;
    original(...(args as []));
  };
  try {
    return run();
  } finally {
    console.warn = original;
  }
}

/** Check inputs against the standard's stated range. */
function applicability(inputs: ComfortInputs, tdbCelsius: number): string[] {
  const limits: string[] = [];

  if (inputs.met < PMV_LIMITS.met.min || inputs.met > PMV_LIMITS.met.max) {
    limits.push(
      `Metabolic rate ${inputs.met.toFixed(1)} met is outside the ` +
        `${PMV_LIMITS.met.min}–${PMV_LIMITS.met.max} met range ASHRAE 55 gives for the PMV method.`,
    );
  }
  if (inputs.clo < PMV_LIMITS.clo.min || inputs.clo > PMV_LIMITS.clo.max) {
    limits.push(
      `Clothing ${inputs.clo.toFixed(2)} clo is outside the ` +
        `${PMV_LIMITS.clo.min}–${PMV_LIMITS.clo.max} clo range ASHRAE 55 gives for the PMV method.`,
    );
  }
  if (tdbCelsius < PMV_LIMITS.tdbCelsius.min || tdbCelsius > PMV_LIMITS.tdbCelsius.max) {
    limits.push(
      `Air temperature is outside the ${PMV_LIMITS.tdbCelsius.min}–${PMV_LIMITS.tdbCelsius.max} °C ` +
        'range over which the PMV model is defined.',
    );
  }
  return limits;
}

/** Convert a temperature in the app's units to °C. */
export function toCelsius(value: number, units: UnitSystem): number {
  return units === 'IP' ? fahrenheitToCelsius(value) : value;
}

/** Convert °C back to the app's units. */
export function fromCelsius(celsius: number, units: UnitSystem): number {
  return units === 'IP' ? celsiusToFahrenheit(celsius) : celsius;
}

/**
 * Evaluate PMV and PPD.
 *
 * Elevated air speed is handled by the standard's own Appendix H route: the
 * ASHRAE variant computes a SET-based cooling effect and applies it before
 * evaluating PMV, which is why raising air speed moves the result toward
 * neutral rather than leaving it unchanged.
 */
export function evaluateComfort(inputs: ComfortInputs, units: UnitSystem): ComfortResult {
  const tdbCelsius = toCelsius(inputs.tdb, units);
  // The offset is a temperature *difference*, so it scales without the 32° term.
  const offsetCelsius = units === 'IP' ? (inputs.mrtOffset * 5) / 9 : inputs.mrtOffset;
  const trCelsius = tdbCelsius + offsetCelsius;

  const { pmv, ppd } = withoutCoolingEffectNoise(() =>
    pmv_ppd_ashrae(
      tdbCelsius,
      trCelsius,
      inputs.airSpeed,
      inputs.rh * 100,
      inputs.met,
      inputs.clo,
      0,
      { units: 'SI', limit_inputs: false, round_output: false },
    ),
  );

  return {
    pmv,
    ppd,
    comfortable: Number.isFinite(pmv) && Math.abs(pmv) <= 0.5,
    limits: applicability(inputs, tdbCelsius),
  };
}

/**
 * PMV at a dry-bulb temperature given in **°C**, for the boundary solver.
 *
 * Kept separate from {@link evaluateComfort} so the polygon sweep does not pay
 * for unit conversion and applicability checks on every one of its several
 * hundred evaluations.
 */
export function pmvAtCelsius(
  tdbCelsius: number,
  trOffsetCelsius: number,
  rh: number,
  airSpeed: number,
  met: number,
  clo: number,
): number {
  return pmv_ppd_ashrae(
    tdbCelsius,
    tdbCelsius + trOffsetCelsius,
    airSpeed,
    rh * 100,
    met,
    clo,
    0,
    { units: 'SI', limit_inputs: false, round_output: false },
  ).pmv;
}

/** Run a sweep with the benign cooling-effect warning suppressed. */
export function duringSweep<T>(run: () => T): T {
  return withoutCoolingEffectNoise(run);
}
