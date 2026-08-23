/**
 * The ASHRAE 55 comfort zone, as a polygon on the psychrometric chart.
 *
 * ## The algorithm
 *
 * For fixed clothing, metabolic rate, air speed, and radiant offset:
 *
 *  1. Sweep relative humidity from 0 to 100%.
 *  2. At each humidity, find the dry-bulb temperature where **PMV = −0.5**
 *     (the cool boundary) and where **PMV = +0.5** (the warm boundary).
 *  3. Convert each boundary point to a humidity ratio for plotting.
 *  4. Clip the top at **W = 0.012 kg/kg**, the ASHRAE 55-2023 upper humidity
 *     limit. **55-2023 sets no lower humidity limit** — earlier editions did,
 *     and drawing one would be wrong.
 *  5. Close the polygon: up the cool edge, across the humidity cap, down the
 *     warm edge, and along the bottom at W = 0.
 *
 * PMV rises monotonically with dry-bulb temperature, which is what makes step 2
 * safe to bisect. That is asserted in the tests rather than assumed.
 *
 * ## Why the axis stays dry-bulb
 *
 * The CBE tool switches its x-axis to operative temperature when the radiant
 * temperature differs from the air temperature. This chart cannot: every other
 * family on it — relative humidity, wet bulb, enthalpy, specific volume — is
 * defined against **dry bulb**, and re-labelling the axis would silently
 * invalidate all of them. So the radiant offset is carried as a parameter of
 * the comfort calculation, and the axis stays what the rest of the chart needs
 * it to be.
 */
import { lib } from '../psych/psychrolib.js';
import { bisect, ConvergenceError } from '../psych/numeric.js';
import type { UnitSystem } from '../psych/units.js';
import type { DataPoint } from '../chart/scales.js';
import { duringSweep, fromCelsius, pmvAtCelsius } from './pmv.js';

/**
 * ASHRAE 55-2023 upper humidity limit, kg water per kg dry air.
 *
 * The standard caps humidity ratio rather than relative humidity, which is why
 * the top of the zone is a horizontal line on this chart rather than a curve.
 */
export const HUMIDITY_LIMIT = 0.012;

/** The PMV magnitude that bounds the comfort zone. */
export const PMV_BOUND = 0.5;

export interface PolygonInputs {
  readonly clo: number;
  readonly met: number;
  /** Air speed in m/s, always. */
  readonly airSpeed: number;
  /** Mean radiant temperature minus dry bulb, in the app's degrees. */
  readonly mrtOffset: number;
  readonly pressure: number;
  readonly units: UnitSystem;
  /**
   * Horizontal shift applied to the finished polygon, in the app's degrees.
   *
   * Reserved. The elevated-air-speed cooling effect is **already** handled
   * inside the PMV evaluation by ASHRAE Appendix H, so this is not needed for
   * that — it exists for a future correction that genuinely translates the
   * zone. Defaults to zero and normally stays there.
   */
  readonly temperatureOffset?: number;
}

export interface ComfortZone {
  readonly clo: number;
  readonly label: string;
  /** Closed polygon in psychrometric space, ready to fill. */
  readonly points: readonly DataPoint[];
  /** Reasons the zone could not be built, if it is empty. */
  readonly problems: readonly string[];
}

/** Humidity steps across the sweep. Two per cent is smooth at any zoom. */
const RH_STEPS = 50;

/** Bisection bracket, °C. Comfortable air is nowhere near these ends. */
const TDB_BRACKET_C: readonly [number, number] = [5, 45];

/**
 * Dry-bulb temperature (°C) at which PMV equals `target`, or null when no such
 * temperature exists inside the bracket.
 */
function solveBoundary(
  target: number,
  rh: number,
  inputs: PolygonInputs,
  mrtOffsetCelsius: number,
): number | null {
  const residual = (tdbCelsius: number): number =>
    pmvAtCelsius(tdbCelsius, mrtOffsetCelsius, rh, inputs.airSpeed, inputs.met, inputs.clo) - target;

  try {
    return bisect(residual, TDB_BRACKET_C[0], TDB_BRACKET_C[1], { tolerance: 1e-6 });
  } catch (error) {
    // No sign change means the whole bracket is on one side of the target —
    // the zone simply does not exist at this humidity for these inputs, which
    // is a legitimate answer rather than a failure.
    if (error instanceof ConvergenceError) return null;
    throw error;
  }
}

/**
 * Build one comfort zone.
 *
 * Returns an empty polygon with an explanation rather than throwing: a slider
 * dragged to an extreme should show nothing and say why, not break the chart.
 */
export function comfortZone(inputs: PolygonInputs, label: string): ComfortZone {
  const psy = lib(inputs.units);
  const mrtOffsetCelsius =
    inputs.units === 'IP' ? (inputs.mrtOffset * 5) / 9 : inputs.mrtOffset;
  const shift = inputs.temperatureOffset ?? 0;

  const cool: DataPoint[] = [];
  const warm: DataPoint[] = [];
  const problems: string[] = [];

  duringSweep(() => {
    for (let step = 0; step <= RH_STEPS; step += 1) {
      const rh = step / RH_STEPS;

      const coolC = solveBoundary(-PMV_BOUND, rh, inputs, mrtOffsetCelsius);
      const warmC = solveBoundary(PMV_BOUND, rh, inputs, mrtOffsetCelsius);
      if (coolC === null || warmC === null) continue;

      const coolT = fromCelsius(coolC, inputs.units) + shift;
      const warmT = fromCelsius(warmC, inputs.units) + shift;

      // Humidity ratio is evaluated at each boundary's own temperature: the two
      // edges sit at different temperatures, so the same relative humidity is a
      // different humidity ratio on each.
      const coolW = psy.GetHumRatioFromRelHum(coolT, rh, inputs.pressure);
      const warmW = psy.GetHumRatioFromRelHum(warmT, rh, inputs.pressure);

      cool.push({ tdb: coolT, w: coolW });
      warm.push({ tdb: warmT, w: warmW });
    }
  });

  if (cool.length < 2 || warm.length < 2) {
    problems.push(
      'No comfort zone exists for these conditions — no air temperature in the ' +
        'habitable range satisfies ASHRAE 55 at this clothing, activity, and air speed.',
    );
    return { clo: inputs.clo, label, points: [], problems };
  }

  /**
   * Clip an edge at the humidity cap, interpolating the exact crossing so the
   * zone meets the limit line rather than stopping at the last sample below it.
   */
  const clip = (edge: DataPoint[]): DataPoint[] => {
    const out: DataPoint[] = [];
    for (const [index, point] of edge.entries()) {
      if (point.w <= HUMIDITY_LIMIT) {
        out.push(point);
        continue;
      }
      const previous = edge[index - 1];
      if (previous) {
        const span = point.w - previous.w;
        const fraction = span === 0 ? 0 : (HUMIDITY_LIMIT - previous.w) / span;
        out.push({
          tdb: previous.tdb + (point.tdb - previous.tdb) * fraction,
          w: HUMIDITY_LIMIT,
        });
      }
      break;
    }
    return out;
  };

  const coolEdge = clip(cool);
  const warmEdge = clip(warm);

  if (coolEdge.length < 2 || warmEdge.length < 2) {
    problems.push('The comfort zone lies entirely above the ASHRAE 55 humidity limit.');
    return { clo: inputs.clo, label, points: [], problems };
  }

  // Up the cool edge, across the humidity cap, back down the warm edge. The
  // bottom edge closes itself, both boundaries starting at W = 0.
  const points = [...coolEdge, ...[...warmEdge].reverse()];

  return { clo: inputs.clo, label, points, problems };
}

/** Clothing levels drawn by default: a winter zone and a summer zone. */
export const DEFAULT_CLOTHING = [
  { clo: 1.0, label: 'Winter · 1.0 clo' },
  { clo: 0.5, label: 'Summer · 0.5 clo' },
] as const;

/** Build every configured zone. */
export function comfortZones(
  inputs: Omit<PolygonInputs, 'clo'>,
  clothing: readonly { clo: number; label: string }[] = DEFAULT_CLOTHING,
): ComfortZone[] {
  return clothing.map(({ clo, label }) => comfortZone({ ...inputs, clo }, label));
}
