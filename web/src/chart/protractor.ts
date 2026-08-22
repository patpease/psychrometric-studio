/**
 * The sensible heat ratio protractor.
 *
 * On a psychrometric chart, the *direction* of a process line encodes how the
 * load splits between sensible and latent. The protractor is the key to that:
 * a fan of rays, each labelled with an SHR, that a designer transfers onto the
 * chart to draw a room or coil load line.
 *
 * ## Deriving the ray direction
 *
 * Moist air enthalpy is `h = cp·T + W·(hg + cpv·T)`, so along any process:
 *
 *     Δh = cp·ΔT + hg·ΔW          (taking hg at the reference temperature)
 *
 * The sensible part is the term at constant humidity ratio, `cp·ΔT`, and the
 * latent part is `hg·ΔW`. With `SHR = Δh_sensible / Δh_total`:
 *
 *     SHR = cp·ΔT / (cp·ΔT + hg·ΔW)
 *
 * Rearranged for the slope of the line in chart space:
 *
 *     dW/dT = cp·(1 − SHR) / (hg·SHR)
 *
 * The two limits are the sanity check: **SHR = 1** gives `dW/dT = 0`, a
 * horizontal line — pure sensible heating or cooling, no moisture exchange.
 * **SHR = 0** gives an infinite slope, a vertical line — pure latent, no
 * temperature change. Both match the chart as drawn.
 */
import type { UnitSystem } from '../psych/units.js';

/**
 * Reference constants for the protractor, in each system's *display* enthalpy
 * units (Btu/lb, kJ/kg). Only their ratio matters, so working in kJ/kg rather
 * than the canonical J/kg is safe here and keeps the numbers legible.
 *
 * These are the same coefficients PsychroLib uses in `GetMoistAirEnthalpy`.
 */
const CONSTANTS: Record<UnitSystem, { cp: number; hg: number }> = {
  IP: { cp: 0.24, hg: 1061 }, // Btu/lb·°F, Btu/lb
  SI: { cp: 1.006, hg: 2501 }, // kJ/kg·K, kJ/kg
};

/** SHR values labelled on the protractor. */
export const DEFAULT_SHR_VALUES = [
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1,
] as const;

export interface ProtractorRay {
  readonly shr: number;
  readonly label: string;
  /**
   * Slope in chart data space: change in humidity ratio per degree of dry bulb.
   * `Infinity` for SHR = 0, which is a vertical line.
   */
  readonly slope: number;
  /** Unit direction vector in *pixel* space, for drawing. */
  readonly direction: { readonly dx: number; readonly dy: number };
}

/**
 * Slope of a process line in data space (dW/dTdb) for a given sensible heat
 * ratio. Returns `Infinity` for SHR = 0 (a vertical, pure-latent line).
 */
export function slopeForShr(shr: number, units: UnitSystem): number {
  if (shr <= 0) return Number.POSITIVE_INFINITY;
  const { cp, hg } = CONSTANTS[units];
  return (cp * (1 - shr)) / (hg * shr);
}

/**
 * The sensible heat ratio implied by a process between two states.
 *
 * Used to label a drawn process line, and in Phase 2 to check that a supply
 * condition actually sits on the room load line.
 */
export function shrForSlope(deltaTdb: number, deltaW: number, units: UnitSystem): number {
  const { cp, hg } = CONSTANTS[units];
  const sensible = cp * deltaTdb;
  const total = sensible + hg * deltaW;
  if (total === 0) return Number.NaN;
  return sensible / total;
}

/**
 * Build the protractor rays.
 *
 * The rays are returned with pixel-space directions because the protractor is
 * drawn at a fixed size in a corner of the chart, not scaled with the domain —
 * so the conversion from data slope to screen angle depends on the current
 * scales and belongs here rather than in the renderer.
 *
 * `pixelsPerDegree` and `pixelsPerW` come from the active scales.
 */
export function protractorRays(
  units: UnitSystem,
  pixelsPerDegree: number,
  pixelsPerW: number,
  values: readonly number[] = DEFAULT_SHR_VALUES,
): ProtractorRay[] {
  return values.map((shr) => {
    const slope = slopeForShr(shr, units);

    // Direction in data space, then scaled into pixels. y is negated because
    // humidity ratio increases upward while pixel y increases downward.
    let dx: number;
    let dy: number;

    if (!Number.isFinite(slope)) {
      dx = 0;
      dy = -1;
    } else {
      dx = pixelsPerDegree;
      dy = -slope * pixelsPerW;
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
    }

    return {
      shr,
      label: shr === 0 || shr === 1 ? shr.toFixed(0) : shr.toFixed(2).replace(/0$/, ''),
      slope,
      direction: { dx, dy },
    };
  });
}
