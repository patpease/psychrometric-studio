/**
 * The ASHRAE 55 adaptive comfort model.
 *
 *     t_comfort = 0.31 · t_pma,out + 17.8      (°C)
 *
 * with acceptability bands of ±2.5 K for 90% and ±3.5 K for 80%.
 *
 * ## This model is the most frequently misapplied part of Standard 55
 *
 * It applies **only** to naturally conditioned spaces where occupants control
 * operable openings, are free to adapt their clothing, and are near sedentary.
 * It is not a general-purpose alternative to PMV, and it is not valid in a
 * mechanically cooled building. So the applicability conditions are enforced
 * and displayed rather than left in a footnote — a tool that returns a
 * comfortable-looking number for an air-conditioned office has actively misled
 * its user.
 *
 * Humidity and the personal factors do not appear, because adaptation is taken
 * to absorb them. That is also why this is drawn as its own chart rather than
 * as an overlay on the psychrometric chart: there is no humidity axis to put it
 * on.
 */
import { adaptive_ashrae } from 'jsthermalcomfort';
import type { UnitSystem } from '../psych/units.js';
import { fromCelsius, toCelsius } from './pmv.js';

/** Prevailing mean outdoor temperature range over which the model is defined. */
export const ADAPTIVE_LIMITS = {
  prevailingCelsius: { min: 10, max: 33.5 },
  met: { max: 1.3 },
} as const;

export interface AdaptiveInputs {
  /** Indoor operative temperature, in the app's units. */
  readonly indoor: number;
  /** Prevailing mean outdoor temperature, in the app's units. */
  readonly prevailing: number;
  /** Air speed, m/s. */
  readonly airSpeed: number;
}

export interface AdaptiveResult {
  /** Neutral comfort temperature, app units. Null when out of range. */
  readonly comfort: number | null;
  readonly band80: readonly [number, number] | null;
  readonly band90: readonly [number, number] | null;
  readonly acceptable80: boolean;
  readonly acceptable90: boolean;
  /** Applicability problems, always worth showing. */
  readonly limits: readonly string[];
}

export function evaluateAdaptive(inputs: AdaptiveInputs, units: UnitSystem): AdaptiveResult {
  const indoorC = toCelsius(inputs.indoor, units);
  const prevailingC = toCelsius(inputs.prevailing, units);

  const limits: string[] = [];
  const { min, max } = ADAPTIVE_LIMITS.prevailingCelsius;
  if (prevailingC < min || prevailingC > max) {
    limits.push(
      `The prevailing mean outdoor temperature is outside the ${min}–${max} °C range ` +
        'over which the adaptive model is defined. ASHRAE 55 gives no adaptive ' +
        'criterion beyond it.',
    );
  }

  const result = adaptive_ashrae(indoorC, indoorC, prevailingC, inputs.airSpeed);

  /**
   * Out-of-range results come back as **NaN**, not null.
   *
   * `JSON.stringify(NaN)` prints `null`, so inspecting the library's output as
   * JSON makes it look like it returns null — it does not. A `value === null`
   * guard never matches, and the NaN flows through to the interface as
   * "NaN °F". Testing for finiteness is the only check that holds.
   */
  const convert = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? fromCelsius(value, units) : null;

  const low80 = convert(result.tmp_cmf_80_low);
  const up80 = convert(result.tmp_cmf_80_up);
  const low90 = convert(result.tmp_cmf_90_low);
  const up90 = convert(result.tmp_cmf_90_up);

  return {
    comfort: convert(result.tmp_cmf),
    band80: low80 !== null && up80 !== null ? [low80, up80] : null,
    band90: low90 !== null && up90 !== null ? [low90, up90] : null,
    acceptable80: result.acceptability_80,
    acceptable90: result.acceptability_90,
    limits,
  };
}

/** One point of the adaptive chart: a comfort band at an outdoor temperature. */
export interface AdaptiveBandPoint {
  readonly prevailing: number;
  readonly comfort: number;
  readonly low80: number;
  readonly up80: number;
  readonly low90: number;
  readonly up90: number;
}

/**
 * The adaptive comfort bands across the model's valid outdoor range, for
 * plotting. Sampled at the ends only — the relation is linear, so two points
 * define it and intermediate samples would imply a precision the model does not
 * claim.
 */
export function adaptiveBands(units: UnitSystem): AdaptiveBandPoint[] {
  const { min, max } = ADAPTIVE_LIMITS.prevailingCelsius;
  return [min, max].map((prevailingC) => {
    const result = adaptive_ashrae(25, 25, prevailingC, 0.1);
    // The endpoints are inside the valid range by construction, so these are
    // finite; anything else would be a change in the model's stated domain.
    return {
      prevailing: fromCelsius(prevailingC, units),
      comfort: fromCelsius(result.tmp_cmf, units),
      low80: fromCelsius(result.tmp_cmf_80_low, units),
      up80: fromCelsius(result.tmp_cmf_80_up, units),
      low90: fromCelsius(result.tmp_cmf_90_low, units),
      up90: fromCelsius(result.tmp_cmf_90_up, units),
    };
  });
}

/**
 * Prevailing mean outdoor temperature as an exponentially weighted running
 * mean of daily mean outdoor temperatures, most recent first.
 *
 *     t_pma = (1 − α) · (t₋₁ + α·t₋₂ + α²·t₋₃ + …)
 *
 * ASHRAE 55 permits either a simple arithmetic mean over the previous 7 to 30
 * days or this weighted form; the weighted form is preferred because it lets
 * recent weather dominate, which is what occupants actually adapt to.
 *
 * Supplied here for Phase 5, when EPW import can feed it real daily means.
 */
export function runningMeanOutdoor(dailyMeans: readonly number[], alpha = 0.8): number {
  if (dailyMeans.length === 0) return Number.NaN;

  let weighted = 0;
  let weights = 0;
  for (const [index, mean] of dailyMeans.entries()) {
    const weight = alpha ** index;
    weighted += weight * mean;
    weights += weight;
  }
  return weighted / weights;
}
