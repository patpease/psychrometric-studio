/**
 * Chart line families.
 *
 * Every family is "humidity ratio as a function of dry-bulb temperature along a
 * constant something", so they all share one tracer. The tracer's real work is
 * **clipping**: a psychrometric chart's domain is bounded above by the
 * saturation curve, and a constant-enthalpy or constant-wet-bulb line that runs
 * past it has left physical space entirely.
 *
 * Clipping is done by locating the crossing precisely rather than by dropping
 * samples. Dropping samples leaves lines that stop short of the saturation
 * curve by up to one sample interval — a visible, and wrong, white gap that
 * gets worse as the user zooms in.
 */
import { lib } from '../psych/psychrolib.js';
import { humidityRatioFromEnthalpy, humidityRatioFromVolume } from '../psych/inverse.js';
import { bisect } from '../psych/numeric.js';
import type { UnitSystem } from '../psych/units.js';
import type { ChartDomain, DataPoint } from './scales.js';

export type FamilyKey =
  | 'saturation'
  | 'relativeHumidity'
  | 'wetBulb'
  | 'enthalpy'
  | 'specificVolume'
  | 'dewPoint';

/** One drawn line: a contiguous run of points in psychrometric space. */
export interface ChartLine {
  readonly family: FamilyKey;
  /** The constant value this line represents, in canonical units. */
  readonly value: number;
  /** Text for the line label, already formatted for display. */
  readonly label: string;
  readonly points: readonly DataPoint[];
}

/** How finely each family is sampled across the domain. */
const SAMPLES = 160;

/**
 * Trace one line of a family across the domain, clipped to physical space.
 *
 * `wAt` returns the humidity ratio along the line at a dry-bulb temperature,
 * and may return values that are negative or above saturation — that is how the
 * tracer learns where the line leaves the domain.
 *
 * A line may leave and re-enter the domain, so the result is a list of
 * segments, not a single polyline.
 */
export function traceLine(
  wAt: (tdb: number) => number,
  domain: ChartDomain,
  pressure: number,
  units: UnitSystem,
  options: { tdbMin?: number; tdbMax?: number; samples?: number } = {},
): DataPoint[][] {
  const psy = lib(units);
  const from = Math.max(domain.tdbMin, options.tdbMin ?? domain.tdbMin);
  const to = Math.min(domain.tdbMax, options.tdbMax ?? domain.tdbMax);
  if (!(to > from)) return [];

  const sampleCount = options.samples ?? SAMPLES;
  const step = (to - from) / sampleCount;

  /**
   * Signed distance from the nearest domain boundary. Non-negative inside the
   * drawable region. Combining all four constraints into one scalar lets a
   * single bisection find any crossing, whichever boundary it is.
   */
  const margin = (tdb: number): number => {
    const w = wAt(tdb);
    if (!Number.isFinite(w)) return Number.NEGATIVE_INFINITY;
    const wSat = psy.GetSatHumRatio(tdb, pressure);
    return Math.min(w - domain.wMin, domain.wMax - w, wSat - w);
  };

  const point = (tdb: number): DataPoint => ({ tdb, w: wAt(tdb) });

  const segments: DataPoint[][] = [];
  let current: DataPoint[] = [];
  let previousTdb = from;
  let previousInside = margin(from) >= 0;

  if (previousInside) current.push(point(from));

  for (let i = 1; i <= sampleCount; i += 1) {
    const tdb = i === sampleCount ? to : from + i * step;
    const inside = margin(tdb) >= 0;

    if (inside !== previousInside) {
      // Refine the crossing so the line meets the boundary exactly.
      let crossing: number;
      try {
        crossing = bisect(margin, previousTdb, tdb, { tolerance: Math.abs(step) * 1e-6 });
      } catch {
        // No detectable sign change (the margin function can be discontinuous
        // where wAt itself is undefined). Fall back to the sample boundary
        // rather than dropping the whole segment.
        crossing = inside ? tdb : previousTdb;
      }

      if (inside) {
        current = [point(crossing)];
      } else {
        current.push(point(crossing));
        if (current.length > 1) segments.push(current);
        current = [];
      }
    }

    if (inside) current.push(point(tdb));

    previousTdb = tdb;
    previousInside = inside;
  }

  if (current.length > 1) segments.push(current);
  return segments;
}

/* -------------------------------------------------------------------------- *
 * The families
 * -------------------------------------------------------------------------- */

/**
 * The saturation curve — the chart's upper boundary and its defining feature.
 *
 * Traced directly rather than through `traceLine`, because it *is* the
 * constraint the tracer clips against; clipping it to itself is degenerate.
 */
export function saturationCurve(
  domain: ChartDomain,
  pressure: number,
  units: UnitSystem,
  samples = SAMPLES * 2,
): ChartLine {
  const psy = lib(units);
  const points: DataPoint[] = [];
  const step = (domain.tdbMax - domain.tdbMin) / samples;

  for (let i = 0; i <= samples; i += 1) {
    const tdb = domain.tdbMin + i * step;
    const w = psy.GetSatHumRatio(tdb, pressure);
    if (w > domain.wMax) {
      // The curve exits the top of the chart. Find exactly where, so the curve
      // meets the frame rather than stopping at the last sample below it.
      if (points.length > 0) {
        const previous = points[points.length - 1]!;
        try {
          const exit = bisect(
            (t) => domain.wMax - psy.GetSatHumRatio(t, pressure),
            previous.tdb,
            tdb,
            { tolerance: Math.abs(step) * 1e-6 },
          );
          points.push({ tdb: exit, w: domain.wMax });
        } catch {
          points.push({ tdb, w: domain.wMax });
        }
      }
      break;
    }
    if (w >= domain.wMin) points.push({ tdb, w });
  }

  return { family: 'saturation', value: 1, label: '100%', points };
}

export function relativeHumidityLine(
  rh: number,
  domain: ChartDomain,
  pressure: number,
  units: UnitSystem,
): ChartLine[] {
  const psy = lib(units);
  return traceLine((tdb) => psy.GetHumRatioFromRelHum(tdb, rh, pressure), domain, pressure, units).map(
    (points) => ({
      family: 'relativeHumidity' as const,
      value: rh,
      label: `${Math.round(rh * 100)}%`,
      points,
    }),
  );
}

export function wetBulbLine(
  twb: number,
  domain: ChartDomain,
  pressure: number,
  units: UnitSystem,
  format: (value: number) => string,
): ChartLine[] {
  const psy = lib(units);
  // A constant-wet-bulb line begins on the saturation curve at Tdb = Twb and
  // runs to the right; it has no meaning to the left of that.
  return traceLine(
    (tdb) => psy.GetHumRatioFromTWetBulb(tdb, twb, pressure),
    domain,
    pressure,
    units,
    { tdbMin: twb },
  ).map((points) => ({
    family: 'wetBulb' as const,
    value: twb,
    label: format(twb),
    points,
  }));
}

export function enthalpyLine(
  h: number,
  domain: ChartDomain,
  pressure: number,
  units: UnitSystem,
  format: (value: number) => string,
): ChartLine[] {
  return traceLine((tdb) => humidityRatioFromEnthalpy(h, tdb, units), domain, pressure, units).map(
    (points) => ({
      family: 'enthalpy' as const,
      value: h,
      label: format(h),
      points,
    }),
  );
}

export function specificVolumeLine(
  v: number,
  domain: ChartDomain,
  pressure: number,
  units: UnitSystem,
  format: (value: number) => string,
): ChartLine[] {
  return traceLine(
    (tdb) => humidityRatioFromVolume(v, tdb, pressure, units),
    domain,
    pressure,
    units,
  ).map((points) => ({
    family: 'specificVolume' as const,
    value: v,
    label: format(v),
    points,
  }));
}

/**
 * Constant dew point.
 *
 * Dew point maps one-to-one to humidity ratio at a fixed pressure, so these are
 * horizontal lines — drawn and labelled in dew-point terms because that is how
 * an engineer reads them, but geometrically identical to constant-W lines.
 */
export function dewPointLine(
  tdp: number,
  domain: ChartDomain,
  pressure: number,
  units: UnitSystem,
  format: (value: number) => string,
): ChartLine[] {
  const psy = lib(units);
  const w = psy.GetHumRatioFromTDewPoint(tdp, pressure);
  if (w < domain.wMin || w > domain.wMax) return [];

  // The line exists only where the air is not supersaturated — that is, from
  // the saturation curve rightward.
  const start = Math.max(domain.tdbMin, tdp);
  if (start >= domain.tdbMax) return [];

  return [
    {
      family: 'dewPoint',
      value: tdp,
      label: format(tdp),
      points: [
        { tdb: start, w },
        { tdb: domain.tdbMax, w },
      ],
    },
  ];
}

/* -------------------------------------------------------------------------- *
 * Default tick values, matching the printed ASHRAE charts
 * -------------------------------------------------------------------------- */

export interface FamilyTicks {
  relativeHumidity: number[];
  wetBulb: number[];
  /** Canonical enthalpy: Btu/lb (IP) | J/kg (SI). */
  enthalpy: number[];
  specificVolume: number[];
  dewPoint: number[];
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  // Accumulating `from + i * step` avoids the drift of repeated addition.
  const count = Math.round((to - from) / step);
  for (let i = 0; i <= count; i += 1) out.push(from + i * step);
  return out;
}

export function defaultTicks(units: UnitSystem): FamilyTicks {
  if (units === 'IP') {
    return {
      relativeHumidity: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
      // These ranges cover the default view and a little beyond it. They were
      // sized for a chart starting at 32 °F; a chart that now starts at 5 °F
      // needs them extended, or the cold third of it is empty of everything but
      // relative humidity — which looks like a rendering fault rather than a
      // choice. Lines outside the view are clipped away, so an over-generous
      // range costs a few discarded traces and nothing else.
      wetBulb: range(0, 90, 5),
      enthalpy: range(0, 60, 5), // Btu/lb
      specificVolume: range(11.5, 15.5, 0.5), // ft³/lb
      dewPoint: range(0, 85, 5),
    };
  }
  return {
    relativeHumidity: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    wetBulb: range(-15, 40, 5),
    // Canonical SI enthalpy is J/kg; these are −20–120 kJ/kg at 10 kJ/kg spacing.
    enthalpy: range(-20, 120, 10).map((kJ) => kJ * 1000),
    specificVolume: range(0.72, 0.96, 0.02), // m³/kg
    dewPoint: range(-15, 30, 5),
  };
}
