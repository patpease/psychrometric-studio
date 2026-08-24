/**
 * EnergyPlus Weather (EPW) files.
 *
 * An EPW is a CSV with eight header lines followed by 8,760 hourly records —
 * one for every hour of a typical year. The format is fixed-column and always
 * **SI**, whatever the application is displaying.
 *
 * Files are sourced from Climate.OneBuilding.org, whose TMYx data set should be
 * cited as:
 *
 *   Lawrie, Linda K, Drury B Crawley. 2026. *Development of Global Typical
 *   Meteorological Years (TMYx)*.
 *
 * ## Parsing never throws
 *
 * A malformed file returns a result carrying the problems, the same shape the
 * coil and comfort solvers use. Someone who drags in the wrong file needs to be
 * told which line failed and why, not handed a stack trace — and a file that is
 * *mostly* good is worth plotting, with the bad rows counted and reported.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { lib } from '../psych/psychrolib.js';
import { celsiusToFahrenheit, type UnitSystem } from '../psych/units.js';

/** One hour of weather, in the application's own unit system. */
export interface WeatherHour {
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
  /** 0–23. EPW stores 1–24; hour 24 is the hour *ending* at midnight. */
  readonly hour: number;
  /** Dry-bulb temperature, °F | °C. */
  readonly tdb: number;
  /** Humidity ratio, canonical lb/lb | kg/kg. */
  readonly w: number;
  /** Relative humidity, 0–1. */
  readonly rh: number;
  /** Station pressure for this hour, psia | Pa. */
  readonly pressure: number;
}

export interface EpwLocation {
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly source: string;
  readonly wmo: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timeZone: number;
  /** Site elevation, ft | m — converted to the application's units. */
  readonly elevation: number;
}

export interface EpwFile {
  readonly location: EpwLocation;
  readonly hours: readonly WeatherHour[];
  /** Rows that could not be read, with the reason. Empty for a clean file. */
  readonly problems: readonly string[];
  /** The unit system the hours were converted into. */
  readonly units: UnitSystem;
}

/**
 * EPW's missing-data sentinels.
 *
 * They are *values*, not blanks — 99.9 °C is a plausible-looking temperature
 * that would drag a scatter plot off the chart and skew every statistic. Rows
 * carrying them for a field this tool needs are dropped and counted.
 */
const MISSING = {
  temperature: 99.9,
  relativeHumidity: 999,
  pressure: 999999,
} as const;

/** Field positions in an EPW data row. */
const FIELD = {
  year: 0,
  month: 1,
  day: 2,
  hour: 3,
  minute: 4,
  dryBulb: 6,
  dewPoint: 7,
  relativeHumidity: 8,
  pressure: 9,
} as const;

const HEADER_LINES = 8;

function parseLocation(line: string, units: UnitSystem): EpwLocation {
  const parts = line.split(',');
  const number = (index: number): number => {
    const value = Number.parseFloat(parts[index] ?? '');
    return Number.isFinite(value) ? value : 0;
  };

  const elevationMetres = number(9);

  return {
    city: (parts[1] ?? '').trim(),
    state: (parts[2] ?? '').trim(),
    country: (parts[3] ?? '').trim(),
    source: (parts[4] ?? '').trim(),
    wmo: (parts[5] ?? '').trim(),
    latitude: number(6),
    longitude: number(7),
    timeZone: number(8),
    elevation: units === 'IP' ? elevationMetres / 0.3048 : elevationMetres,
  };
}

/**
 * Parse EPW text into hourly records.
 *
 * `units` is the system to convert into. The file itself is always SI.
 */
export function parseEpw(text: string, units: UnitSystem): EpwFile {
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);

  if (lines.length < HEADER_LINES + 1 || !(lines[0] ?? '').startsWith('LOCATION')) {
    return {
      location: emptyLocation(),
      hours: [],
      problems: [
        'This does not look like an EPW file — the first line should begin with ' +
          '"LOCATION". If you downloaded a .zip from Climate.OneBuilding, drop the ' +
          'whole .zip in; it will be opened for you.',
      ],
      units,
    };
  }

  const location = parseLocation(lines[0]!, units);
  const psy = lib('SI');
  const hours: WeatherHour[] = [];

  let missingRows = 0;
  let malformedRows = 0;

  for (let index = HEADER_LINES; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.trim() === '') continue;

    const parts = line.split(',');
    if (parts.length < 10) {
      malformedRows += 1;
      continue;
    }

    const tdbC = Number.parseFloat(parts[FIELD.dryBulb] ?? '');
    const rhPercent = Number.parseFloat(parts[FIELD.relativeHumidity] ?? '');
    const pressurePa = Number.parseFloat(parts[FIELD.pressure] ?? '');

    if (!Number.isFinite(tdbC) || !Number.isFinite(rhPercent)) {
      malformedRows += 1;
      continue;
    }
    if (tdbC >= MISSING.temperature || rhPercent >= MISSING.relativeHumidity) {
      missingRows += 1;
      continue;
    }

    // Station pressure is per-hour in an EPW and is the physically right
    // pressure for that hour's humidity ratio. Where it is missing, fall back
    // to the standard atmosphere at the site elevation rather than to sea
    // level, which would misplace every point for a high-altitude station.
    const pressure =
      Number.isFinite(pressurePa) && pressurePa < MISSING.pressure
        ? pressurePa
        : psy.GetStandardAtmPressure(units === 'IP' ? location.elevation * 0.3048 : location.elevation);

    const rh = Math.min(Math.max(rhPercent / 100, 0), 1);
    const w = psy.GetHumRatioFromRelHum(tdbC, rh, pressure);

    hours.push({
      month: Number.parseInt(parts[FIELD.month] ?? '0', 10),
      day: Number.parseInt(parts[FIELD.day] ?? '0', 10),
      // EPW hours run 1–24; hour 24 is the one ending at midnight.
      hour: (Number.parseInt(parts[FIELD.hour] ?? '1', 10) - 1 + 24) % 24,
      tdb: units === 'IP' ? celsiusToFahrenheit(tdbC) : tdbC,
      w,
      rh,
      pressure: units === 'IP' ? pressure / 6894.757 : pressure,
    });
  }

  if (missingRows > 0) {
    problems.push(
      `${missingRows} hour${missingRows === 1 ? '' : 's'} carried EPW's missing-data ` +
        'markers for temperature or humidity and have been left out. Those markers ' +
        'are values (99.9 °C, 999% RH), not blanks, so plotting them would put ' +
        'points far off the chart.',
    );
  }
  if (malformedRows > 0) {
    problems.push(`${malformedRows} row${malformedRows === 1 ? '' : 's'} could not be read.`);
  }
  if (hours.length === 0) {
    problems.push('No usable hourly data was found in this file.');
  } else if (hours.length < 8000) {
    problems.push(
      `Only ${hours.length} hours were read; a full year is 8,760. Statistics from ` +
        'a partial year are still valid, but are not annual totals.',
    );
  }

  return { location, hours, problems, units };
}

function emptyLocation(): EpwLocation {
  return {
    city: '',
    state: '',
    country: '',
    source: '',
    wmo: '',
    latitude: 0,
    longitude: 0,
    timeZone: 0,
    elevation: 0,
  };
}

/**
 * Read a dropped file, opening a `.zip` if that is what arrived.
 *
 * Climate.OneBuilding distributes zipped archives containing the `.epw`
 * alongside `.ddy`, `.stat` and other files, so unzipping is not a convenience
 * — it is the normal path for the source this tool recommends.
 */
export async function readWeatherFile(file: File, units: UnitSystem): Promise<EpwFile> {
  const isZip = file.name.toLowerCase().endsWith('.zip');

  if (!isZip) {
    return parseEpw(await file.text(), units);
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return {
      location: emptyLocation(),
      hours: [],
      problems: ['This .zip could not be opened.'],
      units,
    };
  }

  const epwName = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.epw'));
  if (!epwName) {
    return {
      location: emptyLocation(),
      hours: [],
      problems: [
        'No .epw file inside this archive. A Climate.OneBuilding download should ' +
          'contain one alongside the .ddy and .stat files.',
      ],
      units,
    };
  }

  return parseEpw(strFromU8(entries[epwName]!), units);
}

/** A one-line description of where the data came from, for the panel and exports. */
export function describeLocation(location: EpwLocation): string {
  const place = [location.city, location.state, location.country].filter(Boolean).join(', ');
  return location.wmo ? `${place} (WMO ${location.wmo})` : place;
}

/** One day of the year, with the mean of the hours recorded for it. */
export interface DailyMean {
  readonly month: number;
  readonly day: number;
  /** Mean dry bulb for the day, in the file's current unit system. */
  readonly mean: number;
  /** Hours the mean was taken over. A short day is a gappy file, not an error. */
  readonly hours: number;
}

/**
 * Collapse hourly records into one mean per calendar day, in file order.
 *
 * File order rather than calendar order, deliberately: an EPW is a *typical*
 * year assembled from several real ones, and its rows are the authority on
 * sequence. Sorting by month and day would give the same answer for a
 * well-formed file and would quietly reorder a malformed one into something
 * that looks fine.
 */
export function dailyMeanSeries(hours: readonly WeatherHour[]): DailyMean[] {
  const byDay = new Map<string, { month: number; day: number; sum: number; n: number; order: number }>();

  for (const [index, hour] of hours.entries()) {
    const key = `${hour.month}-${hour.day}`;
    const existing = byDay.get(key);
    if (existing) {
      existing.sum += hour.tdb;
      existing.n += 1;
    } else {
      byDay.set(key, { month: hour.month, day: hour.day, sum: hour.tdb, n: 1, order: index });
    }
  }

  return [...byDay.values()]
    .sort((a, b) => a.order - b.order)
    .map((entry) => ({
      month: entry.month,
      day: entry.day,
      mean: entry.sum / entry.n,
      hours: entry.n,
    }));
}

/**
 * The warmest day of the year, by daily mean.
 *
 * The default day to assess against the adaptive model. A naturally ventilated
 * building is judged on whether it stays acceptable when the weather is at its
 * worst, so opening on the warmest day asks the question that matters rather
 * than an arbitrary one.
 */
export function warmestDay(hours: readonly WeatherHour[]): DailyMean | null {
  const series = dailyMeanSeries(hours);
  if (series.length === 0) return null;
  return series.reduce((warmest, day) => (day.mean > warmest.mean ? day : warmest));
}

/**
 * Daily mean dry-bulb temperatures, most recent first, for the adaptive comfort
 * model's running mean.
 *
 * `endMonth`/`endDay` name the day to look back from. The adaptive model wants
 * the days *preceding* the one being assessed, so the day itself is excluded.
 */
export function dailyMeansBefore(
  hours: readonly WeatherHour[],
  endMonth: number,
  endDay: number,
  count = 30,
): number[] {
  const series = dailyMeanSeries(hours);
  const endIndex = series.findIndex((entry) => entry.month === endMonth && entry.day === endDay);
  if (endIndex < 0) return [];

  // Walk backwards from the day before, wrapping through the end of the year so
  // that early January looks back into the previous December.
  const means: number[] = [];
  for (let step = 1; step <= count; step += 1) {
    const index = (endIndex - step + series.length * 2) % series.length;
    means.push(series[index]!.mean);
  }
  return means;
}

/**
 * Re-express a parsed file in another unit system.
 *
 * Hours are stored in the display system so the rest of the application can
 * treat them like any other value. Switching systems therefore has to convert
 * them, for exactly the reason the stage parameters do: leaving 35 in place and
 * relabelling it °F puts every point in the wrong half of the chart.
 *
 * Humidity ratio is dimensionless and carries across untouched.
 */
export function convertHoursTo(file: EpwFile, units: UnitSystem): EpwFile {
  if (file.units === units) return file;

  const temperature = (value: number): number =>
    units === 'IP' ? celsiusToFahrenheit(value) : (value - 32) * (5 / 9);
  const pressure = (value: number): number =>
    units === 'IP' ? value / 6894.757 : value * 6894.757;
  const elevation = (value: number): number =>
    units === 'IP' ? value / 0.3048 : value * 0.3048;

  return {
    ...file,
    units,
    location: { ...file.location, elevation: elevation(file.location.elevation) },
    hours: file.hours.map((hour) => ({
      ...hour,
      tdb: temperature(hour.tdb),
      pressure: pressure(hour.pressure),
    })),
  };
}
