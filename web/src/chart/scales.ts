/**
 * Chart coordinate system.
 *
 * The chart plots dry-bulb temperature on x and humidity ratio on y. Both are
 * linear, so the projection is an affine map — but every projection call takes
 * *both* coordinates rather than one, which is what allows an oblique
 * projection to be added later without touching a single call site.
 *
 * Zoom and pan are expressed as changes to the **domain**, not as a transform
 * layered on top of it. That keeps one source of truth for "what part of the
 * chart am I looking at", which the line families need anyway in order to
 * re-tessellate at the new scale.
 */
import type { UnitSystem } from '../psych/units.js';
import { DEFAULTS } from '../psych/units.js';

/** The region of psychrometric space currently displayed. */
export interface ChartDomain {
  readonly tdbMin: number;
  readonly tdbMax: number;
  /** Humidity ratio, canonical lb/lb | kg/kg. */
  readonly wMin: number;
  readonly wMax: number;
}

export interface ChartMargin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** A point in psychrometric space. */
export interface DataPoint {
  readonly tdb: number;
  readonly w: number;
}

/** A point in pixel space. */
export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Projections the chart can draw in.
 *
 * `rectangular` is the convention used by essentially all psychrometric
 * software — PsychPlotter, the CBE tool, and this one. The printed ASHRAE chart
 * is drawn in oblique coordinates, where the enthalpy axis is skewed and
 * dry-bulb lines are not quite vertical. Supporting that faithfully is a larger
 * job than a shear transform (it changes which lines are straight), so it is
 * **deliberately deferred** rather than approximated. The type exists so the
 * decision surfaces in code review rather than being forgotten.
 */
export type ChartProjection = 'rectangular';

export interface ChartScales {
  readonly domain: ChartDomain;
  readonly margin: ChartMargin;
  readonly width: number;
  readonly height: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
  readonly projection: ChartProjection;

  /** Psychrometric space → pixel space. */
  project(tdb: number, w: number): PixelPoint;
  /** Pixel space → psychrometric space. */
  invert(x: number, y: number): DataPoint;
  /** True if the point lies inside the plotted domain. */
  contains(tdb: number, w: number): boolean;
  /** True if the pixel lies inside the plot area (excluding margins). */
  containsPixel(x: number, y: number): boolean;
}

/**
 * Plot margins.
 *
 * `right` carries the humidity-ratio axis — ticks, their labels, and the
 * rotated axis title — and `bottom` carries dry bulb the same way. They are
 * equal so the two axes read as a matched pair; the right was noticeably wider
 * for no reason other than that it had never been measured against the bottom.
 */
export const DEFAULT_MARGIN: ChartMargin = { top: 24, right: 56, bottom: 56, left: 24 };

/**
 * The default view for a unit system.
 *
 * IP is the specified pair: 5–110 °F, and 0–170 gr/lb of moisture. Going below
 * freezing is what makes the chart usable for winter work — heating, preheat,
 * and frost on a recovery device all live to the left of 32 °F, and a chart
 * that starts there cannot show them.
 *
 * The humidity ceiling is expressed here in canonical lb/lb. 170 gr/lb is the
 * number on the axis; dividing by 7000 is the only place that conversion is
 * written by hand rather than going through `humidityRatioToDisplay`, and it is
 * pinned by a test.
 *
 * SI is set to the nearest round equivalent — −15 to 45 °C and 24 g/kg — rather
 * than left where it was, so switching unit systems reframes the chart without
 * also moving the window.
 */
export function defaultDomain(units: UnitSystem): ChartDomain {
  return units === 'IP'
    ? { tdbMin: 5, tdbMax: 110, wMin: 0, wMax: 170 / 7000 }
    : { tdbMin: -15, tdbMax: 45, wMin: 0, wMax: 0.024 };
}

/** The widest view the user may zoom out to, per unit system. */
export function domainLimits(units: UnitSystem): ChartDomain {
  const [tdbMin, tdbMax] = DEFAULTS[units].tdbRange;
  return { tdbMin, tdbMax, wMin: 0, wMax: 0.05 };
}

export function createScales(
  domain: ChartDomain,
  width: number,
  height: number,
  margin: ChartMargin = DEFAULT_MARGIN,
  projection: ChartProjection = 'rectangular',
): ChartScales {
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);

  const tdbSpan = domain.tdbMax - domain.tdbMin;
  const wSpan = domain.wMax - domain.wMin;

  return {
    domain,
    margin,
    width,
    height,
    plotWidth,
    plotHeight,
    projection,

    project(tdb: number, w: number): PixelPoint {
      return {
        x: margin.left + ((tdb - domain.tdbMin) / tdbSpan) * plotWidth,
        // Humidity ratio increases upward, so y is inverted.
        y: margin.top + plotHeight - ((w - domain.wMin) / wSpan) * plotHeight,
      };
    },

    invert(x: number, y: number): DataPoint {
      return {
        tdb: domain.tdbMin + ((x - margin.left) / plotWidth) * tdbSpan,
        w: domain.wMin + ((margin.top + plotHeight - y) / plotHeight) * wSpan,
      };
    },

    contains(tdb: number, w: number): boolean {
      return (
        tdb >= domain.tdbMin && tdb <= domain.tdbMax && w >= domain.wMin && w <= domain.wMax
      );
    },

    containsPixel(x: number, y: number): boolean {
      return (
        x >= margin.left &&
        x <= margin.left + plotWidth &&
        y >= margin.top &&
        y <= margin.top + plotHeight
      );
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Domain manipulation — zoom and pan
 * -------------------------------------------------------------------------- */

function clampDomain(domain: ChartDomain, limits: ChartDomain): ChartDomain {
  let { tdbMin, tdbMax, wMin, wMax } = domain;

  // Preserve the width of the view while pushing it back inside the limits,
  // so that panning against an edge slides rather than squashes.
  const tdbSpan = Math.min(tdbMax - tdbMin, limits.tdbMax - limits.tdbMin);
  const wSpan = Math.min(wMax - wMin, limits.wMax - limits.wMin);

  if (tdbMin < limits.tdbMin) tdbMin = limits.tdbMin;
  if (tdbMin + tdbSpan > limits.tdbMax) tdbMin = limits.tdbMax - tdbSpan;
  tdbMax = tdbMin + tdbSpan;

  if (wMin < limits.wMin) wMin = limits.wMin;
  if (wMin + wSpan > limits.wMax) wMin = limits.wMax - wSpan;
  wMax = wMin + wSpan;

  return { tdbMin, tdbMax, wMin, wMax };
}

/** Smallest view allowed, as a fraction of the full limits. */
const MIN_ZOOM_FRACTION = 0.02;

/**
 * Zoom about a fixed point in psychrometric space, so the condition under the
 * cursor stays under the cursor.
 *
 * `factor` below 1 zooms in.
 */
export function zoomDomain(
  domain: ChartDomain,
  factor: number,
  focus: DataPoint,
  limits: ChartDomain,
): ChartDomain {
  const tdbSpan = domain.tdbMax - domain.tdbMin;
  const wSpan = domain.wMax - domain.wMin;

  const minTdbSpan = (limits.tdbMax - limits.tdbMin) * MIN_ZOOM_FRACTION;
  const minWSpan = (limits.wMax - limits.wMin) * MIN_ZOOM_FRACTION;

  const newTdbSpan = Math.max(minTdbSpan, tdbSpan * factor);
  const newWSpan = Math.max(minWSpan, wSpan * factor);

  // Fraction of the way across the current view that the focus sits at.
  const fx = tdbSpan === 0 ? 0.5 : (focus.tdb - domain.tdbMin) / tdbSpan;
  const fy = wSpan === 0 ? 0.5 : (focus.w - domain.wMin) / wSpan;

  const tdbMin = focus.tdb - fx * newTdbSpan;
  const wMin = focus.w - fy * newWSpan;

  return clampDomain(
    { tdbMin, tdbMax: tdbMin + newTdbSpan, wMin, wMax: wMin + newWSpan },
    limits,
  );
}

/** Translate the view by a delta in psychrometric space. */
export function panDomain(
  domain: ChartDomain,
  deltaTdb: number,
  deltaW: number,
  limits: ChartDomain,
): ChartDomain {
  return clampDomain(
    {
      tdbMin: domain.tdbMin + deltaTdb,
      tdbMax: domain.tdbMax + deltaTdb,
      wMin: domain.wMin + deltaW,
      wMax: domain.wMax + deltaW,
    },
    limits,
  );
}

/* -------------------------------------------------------------------------- *
 * Axis ticks
 * -------------------------------------------------------------------------- */

/**
 * Tick values at a "nice" interval covering a range.
 *
 * Chooses from 1, 2, 2.5, 5, 10 × a power of ten, which is what keeps axis
 * labels readable as the user zooms rather than landing on values like 7.3.
 */
export function niceTicks(min: number, max: number, targetCount = 10): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];

  const rawStep = span / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;

  const step =
    magnitude *
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10);

  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Guard against floating-point drift accumulating over many steps.
  for (let i = 0; first + i * step <= max + step * 1e-9; i += 1) {
    const value = first + i * step;
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : value);
  }
  return ticks;
}
