/**
 * Binning weather hours, and counting them against a region of the chart.
 *
 * Eight thousand seven hundred and sixty points drawn as a scatter tell you
 * where a climate lives. They do not tell you *how long* it spends there —
 * overlapping points hide the density that matters, and the difference between
 * two hours a year and two hundred is invisible. Binning turns the chart from a
 * drawing into a screening tool: how many hours does this climate spend inside
 * the comfort zone, and how many outside it and in which direction.
 */
import type { DataPoint } from '../chart/scales.js';
import type { WeatherHour } from './epw.js';

export interface HourFilter {
  /** Months to include, 1–12. Empty means all. */
  readonly months: readonly number[];
  /** Hours of the day to include, 0–23. Empty means all. */
  readonly hours: readonly number[];
}

export const ALL_HOURS: HourFilter = { months: [], hours: [] };

/** Occupied-period presets, since that is the usual reason to filter. */
export const HOUR_PRESETS: { label: string; filter: HourFilter }[] = [
  { label: 'All 8,760 hours', filter: ALL_HOURS },
  {
    label: 'Occupied — weekday 8:00–18:00',
    // Day-of-week is not carried in a typical year in any dependable way, so
    // this is hours-of-day only. Named honestly rather than implying more.
    filter: { months: [], hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
  },
  { label: 'Cooling season — May to September', filter: { months: [5, 6, 7, 8, 9], hours: [] } },
  { label: 'Heating season — November to March', filter: { months: [11, 12, 1, 2, 3], hours: [] } },
];

export function applyFilter(
  hours: readonly WeatherHour[],
  filter: HourFilter,
): WeatherHour[] {
  const months = new Set(filter.months);
  const timesOfDay = new Set(filter.hours);
  if (months.size === 0 && timesOfDay.size === 0) return [...hours];

  return hours.filter(
    (hour) =>
      (months.size === 0 || months.has(hour.month)) &&
      (timesOfDay.size === 0 || timesOfDay.has(hour.hour)),
  );
}

/* -------------------------------------------------------------------------- *
 * Density grid
 * -------------------------------------------------------------------------- */

export interface DensityGrid {
  readonly tdbMin: number;
  readonly tdbMax: number;
  readonly wMin: number;
  readonly wMax: number;
  readonly columns: number;
  readonly rows: number;
  /** Hours per cell, row-major from the bottom-left. */
  readonly counts: Int32Array;
  /** The largest count in any cell, for scaling the colour ramp. */
  readonly peak: number;
  readonly total: number;
}

/**
 * Bin hours into a grid over the chart's own domain.
 *
 * The grid is built against the **view**, not against the data's extent, so a
 * cell is a fixed area of the chart. Binning to the data's own range would
 * change what a cell means as the user zooms, and a density map whose units
 * shift underneath you is worse than no density map.
 */
export function densityGrid(
  hours: readonly WeatherHour[],
  domain: { tdbMin: number; tdbMax: number; wMin: number; wMax: number },
  columns = 90,
  rows = 60,
): DensityGrid {
  const counts = new Int32Array(columns * rows);
  const tdbSpan = domain.tdbMax - domain.tdbMin;
  const wSpan = domain.wMax - domain.wMin;

  let total = 0;

  if (tdbSpan > 0 && wSpan > 0) {
    for (const hour of hours) {
      const column = Math.floor(((hour.tdb - domain.tdbMin) / tdbSpan) * columns);
      const row = Math.floor(((hour.w - domain.wMin) / wSpan) * rows);
      if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
      const cell = row * columns + column;
      counts[cell] = (counts[cell] ?? 0) + 1;
      total += 1;
    }
  }

  let peak = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index]!;
    if (count > peak) peak = count;
  }

  return { ...domain, columns, rows, counts, peak, total };
}

/* -------------------------------------------------------------------------- *
 * Hours inside a region
 * -------------------------------------------------------------------------- */

export interface ZoneStatistics {
  readonly label: string;
  readonly hoursInside: number;
  readonly hoursTotal: number;
  readonly fraction: number;
  /** Hours outside and warmer than the region, by dry bulb. */
  readonly hoursWarmer: number;
  /** Hours outside and cooler than the region. */
  readonly hoursCooler: number;
  /** Hours at a temperature the region covers, but too humid for it. */
  readonly hoursMoreHumid: number;
  /** Hours at a covered temperature but too dry — only meaningful if the
   *  region has a lower humidity bound, which an ASHRAE 55 zone does not. */
  readonly hoursDrier: number;
}

/**
 * Is a point inside a polygon? Ray casting, counting crossings to the right.
 *
 * Points exactly on an edge are not reliably classified by any crossing rule,
 * and there is no answer that is right for all of them. With 8,760 samples
 * against a smooth boundary the population on the edge is negligible, so the
 * simple rule is the honest choice rather than a false precision.
 */
export function pointInPolygon(
  point: DataPoint,
  polygon: readonly DataPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.w > point.w !== b.w > point.w;
    if (!straddles) continue;
    const crossing = ((b.tdb - a.tdb) * (point.w - a.w)) / (b.w - a.w) + a.tdb;
    if (point.tdb < crossing) inside = !inside;
  }
  return inside;
}

/** Horizontal extent of a polygon at a given humidity ratio, if any. */
function spanAtHumidity(
  polygon: readonly DataPoint[],
  w: number,
): [number, number] | null {
  const crossings: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.w > w !== b.w > w) {
      crossings.push(((b.tdb - a.tdb) * (w - a.w)) / (b.w - a.w) + a.tdb);
    }
  }
  if (crossings.length < 2) return null;
  return [Math.min(...crossings), Math.max(...crossings)];
}

/**
 * Count hours against a region, and say which way the rest miss it.
 *
 * "62% of hours are outside the comfort zone" is a number. "31% too warm, 24%
 * too cool, 7% warm enough but too humid" is a brief — it points at the plant
 * the building needs. The breakdown is the reason this function exists.
 *
 * Each hour lands in exactly one bucket, and hours that miss on both axes are
 * attributed to **temperature**: a hot humid hour is first of all hot, and
 * filing it under humidity would argue for the wrong equipment.
 */
export function zoneStatistics(
  hours: readonly WeatherHour[],
  polygon: readonly DataPoint[],
  label: string,
): ZoneStatistics {
  let inside = 0;
  let warmer = 0;
  let cooler = 0;
  let moreHumid = 0;
  let drier = 0;

  // The region's overall extent, for hours that miss it on both axes at once.
  const temperatures = polygon.map((point) => point.tdb);
  const humidities = polygon.map((point) => point.w);
  const coldest = Math.min(...temperatures);
  const warmest = Math.max(...temperatures);
  const wettest = Math.max(...humidities);

  for (const hour of hours) {
    const point: DataPoint = { tdb: hour.tdb, w: hour.w };
    if (pointInPolygon(point, polygon)) {
      inside += 1;
      continue;
    }

    const span = spanAtHumidity(polygon, hour.w);
    if (span) {
      // At a humidity the region covers, so it is missed on temperature alone.
      if (hour.tdb > span[1]) warmer += 1;
      else cooler += 1;
      continue;
    }

    // Outside the region's humidity range — but an hour can miss on both axes,
    // and **temperature is attributed first**. A summer design condition of
    // 35 °C at 40% RH sits above an ASHRAE 55 zone's humidity cap, so a
    // humidity-first rule would file it as "too humid" when what it plainly is
    // is too hot. Calling for dehumidification on that evidence would be the
    // wrong plant.
    if (hour.tdb > warmest) warmer += 1;
    else if (hour.tdb < coldest) cooler += 1;
    else if (hour.w > wettest) moreHumid += 1;
    else drier += 1;
  }

  const total = hours.length;
  return {
    label,
    hoursInside: inside,
    hoursTotal: total,
    fraction: total === 0 ? 0 : inside / total,
    hoursWarmer: warmer,
    hoursCooler: cooler,
    hoursMoreHumid: moreHumid,
    hoursDrier: drier,
  };
}
