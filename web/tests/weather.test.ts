/**
 * Phase 5 gate: EPW parsing, binning, and hours-in-zone.
 *
 * The synthetic files here exercise the cases a real download will eventually
 * present — missing-data sentinels, a short year, a wrong file — because those
 * are what turn a working import into a broken one at the worst moment.
 */
import { describe, it, expect } from 'vitest';
import {
  parseEpw,
  convertHoursTo,
  describeLocation,
  dailyMeansBefore,
  type WeatherHour,
} from '../src/weather/epw.js';
import {
  applyFilter,
  densityGrid,
  zoneStatistics,
  pointInPolygon,
  HOUR_PRESETS,
  ALL_HOURS,
} from '../src/weather/bins.js';
import { comfortZone } from '../src/comfort/polygon.js';
import { lib } from '../src/psych/psychrolib.js';
import { DEFAULTS, celsiusToFahrenheit } from '../src/psych/units.js';

const SI_PRESSURE = DEFAULTS.SI.standardPressure;

/** Eight header lines, matching a real EPW's shape. */
const HEADER = [
  'LOCATION,Denver Intl Ap,CO,USA,TMYx,724666,39.833,-104.658,-7.0,1650.0',
  'DESIGN CONDITIONS,0',
  'TYPICAL/EXTREME PERIODS,0',
  'GROUND TEMPERATURES,0',
  'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0',
  'COMMENTS 1,synthetic',
  'COMMENTS 2,synthetic',
  'DATA PERIODS,1,1,Data,Sunday, 1/ 1,12/31',
].join('\n');

/** One EPW data row. Only the fields this tool reads are meaningful. */
function row(
  month: number,
  day: number,
  hour: number,
  tdbC: number,
  rhPercent: number,
  pressurePa = 101325,
): string {
  const rest = Array.from({ length: 25 }, () => '0').join(',');
  return `1990,${month},${day},${hour},60,?9?9?9?9,${tdbC},10.0,${rhPercent},${pressurePa},${rest}`;
}

function buildEpw(rows: string[]): string {
  return `${HEADER}\n${rows.join('\n')}\n`;
}

describe('EPW parsing', () => {
  it('reads the location header', () => {
    const file = parseEpw(buildEpw([row(1, 1, 1, 20, 50)]), 'SI');

    expect(file.location.city).toBe('Denver Intl Ap');
    expect(file.location.country).toBe('USA');
    expect(file.location.wmo).toBe('724666');
    expect(file.location.latitude).toBeCloseTo(39.833, 3);
    expect(file.location.elevation).toBeCloseTo(1650, 1);
    expect(describeLocation(file.location)).toContain('Denver');
  });

  it('converts the elevation into IP', () => {
    const file = parseEpw(buildEpw([row(1, 1, 1, 20, 50)]), 'IP');
    // 1650 m is 5,413 ft.
    expect(file.location.elevation).toBeCloseTo(5413, 0);
  });

  it('computes humidity ratio from dry bulb, humidity, and station pressure', () => {
    const file = parseEpw(buildEpw([row(7, 15, 14, 30, 40)]), 'SI');
    const hour = file.hours[0]!;

    const expected = lib('SI').GetHumRatioFromRelHum(30, 0.4, 101325);
    expect(hour.tdb).toBeCloseTo(30, 9);
    expect(hour.rh).toBeCloseTo(0.4, 9);
    expect(hour.w).toBeCloseTo(expected, 12);
  });

  it('uses each hour’s own station pressure, not a fixed one', () => {
    // A station at altitude reports a lower pressure, which holds more moisture
    // at the same relative humidity. Using sea level would misplace every point.
    const atSeaLevel = parseEpw(buildEpw([row(7, 15, 14, 30, 40, 101325)]), 'SI');
    const atAltitude = parseEpw(buildEpw([row(7, 15, 14, 30, 40, 83000)]), 'SI');

    expect(atAltitude.hours[0]!.w).toBeGreaterThan(atSeaLevel.hours[0]!.w);
  });

  it('converts temperatures to IP while leaving humidity ratio alone', () => {
    const si = parseEpw(buildEpw([row(7, 15, 14, 30, 40)]), 'SI');
    const ip = parseEpw(buildEpw([row(7, 15, 14, 30, 40)]), 'IP');

    expect(ip.hours[0]!.tdb).toBeCloseTo(celsiusToFahrenheit(30), 6);
    // Humidity ratio is dimensionless.
    expect(ip.hours[0]!.w).toBeCloseTo(si.hours[0]!.w, 12);
  });

  it('maps EPW hour 1–24 onto 0–23', () => {
    const file = parseEpw(
      buildEpw([row(1, 1, 1, 10, 50), row(1, 1, 12, 10, 50), row(1, 1, 24, 10, 50)]),
      'SI',
    );
    expect(file.hours.map((hour) => hour.hour)).toEqual([0, 11, 23]);
  });
});

describe('EPW missing-data handling', () => {
  it('drops rows carrying the sentinel values and says how many', () => {
    // 99.9 °C and 999% are EPW's *markers*, not readings. Plotted, they would
    // sit far off the chart and drag every statistic with them.
    const file = parseEpw(
      buildEpw([
        row(1, 1, 1, 20, 50),
        row(1, 1, 2, 99.9, 50),
        row(1, 1, 3, 20, 999),
        row(1, 1, 4, 21, 55),
      ]),
      'SI',
    );

    expect(file.hours).toHaveLength(2);
    expect(file.problems.join(' ')).toMatch(/2 hours carried EPW's missing-data markers/);
  });

  it('falls back to the site elevation when pressure is missing, not to sea level', () => {
    const file = parseEpw(buildEpw([row(7, 15, 14, 30, 40, 999999)]), 'SI');
    const hour = file.hours[0]!;

    // Denver's 1650 m, not 101325 Pa.
    const atElevation = lib('SI').GetStandardAtmPressure(1650);
    expect(hour.pressure).toBeCloseTo(atElevation, 0);
    expect(hour.pressure).toBeLessThan(SI_PRESSURE);
  });

  it('counts malformed rows without abandoning the file', () => {
    const file = parseEpw(buildEpw([row(1, 1, 1, 20, 50), 'nonsense', row(1, 1, 2, 21, 55)]), 'SI');
    expect(file.hours).toHaveLength(2);
    expect(file.problems.join(' ')).toMatch(/could not be read/);
  });

  it('rejects a file that is not an EPW, with a useful message', () => {
    const file = parseEpw('Name,Value\nfoo,1\n', 'SI');
    expect(file.hours).toHaveLength(0);
    expect(file.problems.join(' ')).toMatch(/does not look like an EPW/);
    expect(file.problems.join(' ')).toMatch(/\.zip/);
  });

  it('notes when a year is short rather than presenting it as annual', () => {
    const file = parseEpw(buildEpw([row(1, 1, 1, 20, 50)]), 'SI');
    expect(file.problems.join(' ')).toMatch(/a full year is 8,760/);
  });

  it('never throws, whatever it is given', () => {
    for (const text of ['', 'LOCATION', '\n\n\n', 'LOCATION,a\n1\n2\n3\n4\n5\n6\n7\n8\n']) {
      expect(() => parseEpw(text, 'IP')).not.toThrow();
    }
  });
});

describe('converting a parsed file between unit systems', () => {
  it('converts temperatures and leaves humidity ratio alone', () => {
    const si = parseEpw(buildEpw([row(7, 15, 14, 30, 40)]), 'SI');
    const ip = convertHoursTo(si, 'IP');

    expect(ip.units).toBe('IP');
    expect(ip.hours[0]!.tdb).toBeCloseTo(86, 4);
    expect(ip.hours[0]!.w).toBeCloseTo(si.hours[0]!.w, 12);
    expect(ip.location.elevation).toBeCloseTo(5413, 0);
  });

  it('round-trips', () => {
    const si = parseEpw(buildEpw([row(7, 15, 14, 30, 40)]), 'SI');
    const back = convertHoursTo(convertHoursTo(si, 'IP'), 'SI');
    expect(back.hours[0]!.tdb).toBeCloseTo(30, 6);
    expect(back.location.elevation).toBeCloseTo(1650, 3);
  });

  it('is a no-op when the system already matches', () => {
    const si = parseEpw(buildEpw([row(7, 15, 14, 30, 40)]), 'SI');
    expect(convertHoursTo(si, 'SI')).toBe(si);
  });
});

/* -------------------------------------------------------------------------- *
 * Binning and statistics
 * -------------------------------------------------------------------------- */

/** A synthetic year: one hour per (month, hour-of-day) pair. */
function syntheticYear(): WeatherHour[] {
  const hours: WeatherHour[] = [];
  for (let month = 1; month <= 12; month += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const tdb = 10 + month * 1.5 + hour * 0.4;
      hours.push({
        month,
        day: 15,
        hour,
        tdb,
        w: lib('SI').GetHumRatioFromRelHum(tdb, 0.5, SI_PRESSURE),
        rh: 0.5,
        pressure: SI_PRESSURE,
      });
    }
  }
  return hours;
}

describe('filtering', () => {
  const year = syntheticYear();

  it('passes everything through with no filter', () => {
    expect(applyFilter(year, ALL_HOURS)).toHaveLength(year.length);
  });

  it('filters by month', () => {
    const summer = applyFilter(year, { months: [6, 7, 8], hours: [] });
    expect(summer).toHaveLength(3 * 24);
    expect(summer.every((hour) => [6, 7, 8].includes(hour.month))).toBe(true);
  });

  it('filters by hour of day', () => {
    const occupied = applyFilter(year, { months: [], hours: [9, 10, 11] });
    expect(occupied).toHaveLength(12 * 3);
  });

  it('applies both together', () => {
    const filtered = applyFilter(year, { months: [7], hours: [12, 13] });
    expect(filtered).toHaveLength(2);
  });

  it('ships presets that all select something', () => {
    for (const preset of HOUR_PRESETS) {
      expect(applyFilter(year, preset.filter).length, preset.label).toBeGreaterThan(0);
    }
  });
});

describe('density grid', () => {
  const year = syntheticYear();
  const domain = { tdbMin: 0, tdbMax: 50, wMin: 0, wMax: 0.03 };

  it('counts every hour that falls inside the domain', () => {
    const grid = densityGrid(year, domain);
    const summed = [...grid.counts].reduce((total, count) => total + count, 0);
    expect(summed).toBe(grid.total);
    expect(grid.total).toBeGreaterThan(0);
    expect(grid.total).toBeLessThanOrEqual(year.length);
  });

  it('bins against the view, so a cell is a fixed area of the chart', () => {
    // Zooming changes how many cells the data occupies, not what a cell means.
    const wide = densityGrid(year, domain);
    const zoomed = densityGrid(year, { tdbMin: 15, tdbMax: 30, wMin: 0, wMax: 0.02 });

    expect(zoomed.total).toBeLessThan(wide.total);
    expect(zoomed.columns).toBe(wide.columns);
  });

  it('excludes hours outside the domain rather than clamping them to the edge', () => {
    const grid = densityGrid(year, { tdbMin: 40, tdbMax: 50, wMin: 0, wMax: 0.03 });
    expect(grid.total).toBeLessThan(year.length);
  });

  it('reports a peak that scales the ramp', () => {
    const grid = densityGrid(year, domain);
    expect(grid.peak).toBeGreaterThan(0);
    expect(grid.peak).toBeLessThanOrEqual(grid.total);
  });

  it('handles an empty set without dividing by zero', () => {
    const grid = densityGrid([], domain);
    expect(grid.total).toBe(0);
    expect(grid.peak).toBe(0);
  });
});

describe('hours in the comfort zone', () => {
  const zone = comfortZone(
    { clo: 0.5, met: 1.1, airSpeed: 0.1, mrtOffset: 0, pressure: SI_PRESSURE, units: 'SI' },
    'summer',
  );

  it('counts hours inside and classifies the rest by how they miss', () => {
    const hours: WeatherHour[] = [
      // Comfortable.
      makeHour(25, 0.5),
      makeHour(25, 0.45),
      // Too warm.
      makeHour(35, 0.4),
      // Too cool.
      makeHour(12, 0.5),
    ];

    const stats = zoneStatistics(hours, zone.points, 'summer');

    expect(stats.hoursTotal).toBe(4);
    expect(stats.hoursInside).toBe(2);
    expect(stats.fraction).toBeCloseTo(0.5, 9);
    expect(stats.hoursWarmer).toBe(1);
    expect(stats.hoursCooler).toBe(1);
  });

  it('classifies an hour that is warm enough but too humid', () => {
    // 26 °C at 90% RH is inside the zone's temperature span but above its
    // humidity cap — the case that argues for dehumidification rather than
    // cooling, which is the whole reason the breakdown exists.
    const stats = zoneStatistics([makeHour(26, 0.9)], zone.points, 'summer');
    expect(stats.hoursInside).toBe(0);
    expect(stats.hoursMoreHumid).toBe(1);
  });

  it('every hour is accounted for in exactly one bucket', () => {
    const year = syntheticYear();
    const stats = zoneStatistics(year, zone.points, 'summer');
    const summed =
      stats.hoursInside +
      stats.hoursWarmer +
      stats.hoursCooler +
      stats.hoursMoreHumid +
      stats.hoursDrier;

    expect(summed).toBe(stats.hoursTotal);
  });

  it('reports zero rather than dividing by zero for an empty set', () => {
    const stats = zoneStatistics([], zone.points, 'summer');
    expect(stats.fraction).toBe(0);
    expect(stats.hoursTotal).toBe(0);
  });

  it('agrees with a direct point-in-polygon test', () => {
    const year = syntheticYear();
    const direct = year.filter((hour) => pointInPolygon({ tdb: hour.tdb, w: hour.w }, zone.points));
    expect(zoneStatistics(year, zone.points, 'summer').hoursInside).toBe(direct.length);
  });
});

function makeHour(tdbC: number, rh: number): WeatherHour {
  return {
    month: 7,
    day: 15,
    hour: 12,
    tdb: tdbC,
    w: lib('SI').GetHumRatioFromRelHum(tdbC, rh, SI_PRESSURE),
    rh,
    pressure: SI_PRESSURE,
  };
}

describe('daily means for the adaptive running mean', () => {
  it('returns the days preceding the one asked for, most recent first', () => {
    const hours: WeatherHour[] = [];
    for (let day = 1; day <= 10; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        hours.push({
          month: 1,
          day,
          hour,
          tdb: day, // Each day's mean is its own number, making order checkable.
          w: 0.005,
          rh: 0.5,
          pressure: SI_PRESSURE,
        });
      }
    }

    const means = dailyMeansBefore(hours, 1, 5, 3);
    expect(means).toEqual([4, 3, 2]);
  });

  it('wraps through the end of the year for early January', () => {
    const hours: WeatherHour[] = [];
    for (const [month, day] of [
      [12, 30],
      [12, 31],
      [1, 1],
      [1, 2],
    ] as const) {
      hours.push({ month, day, hour: 0, tdb: month * 100 + day, w: 0.005, rh: 0.5, pressure: SI_PRESSURE });
    }

    // Looking back from 1 January should reach into December.
    const means = dailyMeansBefore(hours, 1, 1, 2);
    expect(means).toEqual([1231, 1230]);
  });

  it('returns nothing for a day the file does not contain', () => {
    expect(dailyMeansBefore(syntheticYear(), 13, 40, 5)).toEqual([]);
  });
});
