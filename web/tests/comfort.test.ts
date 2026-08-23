/**
 * Phase 3 gate: comfort results match the CBE Thermal Comfort Tool for
 * identical inputs, and the comfort zone has the shape ASHRAE 55 defines.
 *
 * The reference values come from `jsthermalcomfort`'s own documented example
 * and from the properties the standard states, rather than from numbers typed
 * in from a screenshot. Where a value is a published example it is named.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateComfort,
  pmvAtCelsius,
  PMV_LIMITS,
  comfortZone,
  comfortZones,
  HUMIDITY_LIMIT,
  PMV_BOUND,
  evaluateAdaptive,
  adaptiveBands,
  runningMeanOutdoor,
  ADAPTIVE_LIMITS,
} from '../src/comfort/index.js';
import { lib } from '../src/psych/psychrolib.js';
import { DEFAULTS, celsiusToFahrenheit, type UnitSystem } from '../src/psych/units.js';

const SI_PRESSURE = DEFAULTS.SI.standardPressure;
const IP_PRESSURE = DEFAULTS.IP.standardPressure;

describe('PMV against published values', () => {
  it('reproduces the documented reference case', () => {
    // jsthermalcomfort's own example, itself validated against the CBE tool:
    // 25 °C air and radiant, 0.1 m/s, 50% RH, 1.2 met, 0.5 clo -> PMV 0.08.
    const result = evaluateComfort(
      { tdb: 25, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 0.5 },
      'SI',
    );

    expect(result.pmv).toBeCloseTo(0.08, 2);
    expect(result.ppd).toBeCloseTo(5.1, 1);
    expect(result.comfortable).toBe(true);
    expect(result.limits).toHaveLength(0);
  });

  it('gives the same answer in IP for the same physical air', () => {
    // 77 °F is exactly 25 °C. Comfort is a property of the air, not of the
    // units it is described in.
    const si = evaluateComfort(
      { tdb: 25, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 0.5 },
      'SI',
    );
    const ip = evaluateComfort(
      { tdb: 77, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 0.5 },
      'IP',
    );

    expect(ip.pmv).toBeCloseTo(si.pmv, 6);
    expect(ip.ppd).toBeCloseTo(si.ppd, 6);
  });

  it('converts a radiant offset as a temperature difference, not a temperature', () => {
    // 9 °F of radiant offset is 5 °C of offset, not −12.8 °C. Getting this
    // wrong would swing PMV wildly rather than subtly.
    const si = evaluateComfort(
      { tdb: 25, mrtOffset: 5, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 0.5 },
      'SI',
    );
    const ip = evaluateComfort(
      { tdb: 77, mrtOffset: 9, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 0.5 },
      'IP',
    );

    expect(ip.pmv).toBeCloseTo(si.pmv, 6);
    // A warmer radiant environment must read warmer.
    expect(si.pmv).toBeGreaterThan(
      evaluateComfort({ tdb: 25, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 0.5 }, 'SI')
        .pmv,
    );
  });

  it('PPD is at its minimum near neutral and rises either side', () => {
    const at = (tdb: number): number =>
      evaluateComfort({ tdb, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 1.1, clo: 0.5 }, 'SI').ppd;

    // PPD bottoms out at 5% by construction of the model.
    expect(at(25)).toBeLessThan(10);
    expect(at(18)).toBeGreaterThan(at(25));
    expect(at(32)).toBeGreaterThan(at(25));
    expect(at(25)).toBeGreaterThanOrEqual(5);
  });
});

describe('PMV is monotonic in dry bulb', () => {
  /**
   * The comfort-boundary solver bisects on PMV, which is only safe if PMV rises
   * monotonically with temperature. Asserted rather than assumed, across the
   * full range of clothing and activity the zone is drawn for.
   */
  it('rises with temperature at every clothing and activity level', () => {
    for (const clo of [0, 0.5, 1.0, 1.5]) {
      for (const met of [1.0, 1.4, 2.0]) {
        let previous = Number.NEGATIVE_INFINITY;
        for (let tdb = 10; tdb <= 40; tdb += 1) {
          const pmv = pmvAtCelsius(tdb, 0, 0.5, 0.1, met, clo);
          expect(pmv, `clo ${clo}, met ${met}, ${tdb} °C`).toBeGreaterThan(previous);
          previous = pmv;
        }
      }
    }
  });
});

describe('elevated air speed', () => {
  /**
   * ASHRAE 55 Appendix H credits air movement with a SET-based cooling effect.
   * The Phase 1 notes recorded this as deferred; the ASHRAE variant in
   * jsthermalcomfort applies it internally, so the tool does account for it.
   */
  it('moves a warm condition toward neutral', () => {
    const still = pmvAtCelsius(27, 0, 0.5, 0.1, 1.1, 0.5);
    const moving = pmvAtCelsius(27, 0, 0.5, 0.4, 1.1, 0.5);
    const fast = pmvAtCelsius(27, 0, 0.5, 0.8, 1.1, 0.5);

    expect(still).toBeGreaterThan(0);
    expect(moving).toBeLessThan(still);
    expect(fast).toBeLessThan(moving);
  });

  it('widens the comfort zone toward warmer temperatures', () => {
    const base = { met: 1.1, mrtOffset: 0, pressure: SI_PRESSURE, units: 'SI' as UnitSystem };
    const still = comfortZone({ ...base, clo: 0.5, airSpeed: 0.1 }, 'still');
    const moving = comfortZone({ ...base, clo: 0.5, airSpeed: 0.8 }, 'moving');

    const warmest = (zone: typeof still): number =>
      Math.max(...zone.points.map((point) => point.tdb));

    expect(warmest(moving)).toBeGreaterThan(warmest(still));
  });
});

describe('applicability limits are reported, not silently applied', () => {
  it('flags a metabolic rate above the PMV range', () => {
    const result = evaluateComfort(
      { tdb: 25, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 3.0, clo: 0.5 },
      'SI',
    );
    expect(result.limits.join(' ')).toMatch(/metabolic rate/i);
    expect(result.limits.join(' ')).toContain(String(PMV_LIMITS.met.max));
  });

  it('flags clothing above the PMV range', () => {
    const result = evaluateComfort(
      { tdb: 25, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 2.0 },
      'SI',
    );
    expect(result.limits.join(' ')).toMatch(/clothing/i);
  });

  it('flags an air temperature outside the model range', () => {
    const result = evaluateComfort(
      { tdb: 45, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 1.2, clo: 0.5 },
      'SI',
    );
    expect(result.limits.join(' ')).toMatch(/outside the 10–40 °C/);
  });

  it('still returns a number alongside the warning', () => {
    // Refusing to compute would be unhelpful; computing without saying the
    // input is out of range would be misleading. Do both.
    const result = evaluateComfort(
      { tdb: 25, mrtOffset: 0, rh: 0.5, airSpeed: 0.1, met: 3.0, clo: 0.5 },
      'SI',
    );
    expect(Number.isFinite(result.pmv)).toBe(true);
    expect(result.limits.length).toBeGreaterThan(0);
  });
});

describe('the comfort zone polygon', () => {
  const base = {
    met: 1.1,
    airSpeed: 0.1,
    mrtOffset: 0,
    pressure: SI_PRESSURE,
    units: 'SI' as UnitSystem,
  };

  it('is a closed region with area', () => {
    const zone = comfortZone({ ...base, clo: 0.5 }, 'summer');
    expect(zone.problems).toHaveLength(0);
    expect(zone.points.length).toBeGreaterThan(20);
  });

  it('contains a condition that is comfortable and excludes ones that are not', () => {
    const zone = comfortZone({ ...base, clo: 0.5 }, 'summer');

    // 25 °C / 50% RH at 0.5 clo is squarely comfortable.
    const inside = pointInPolygon(
      { tdb: 25, w: lib('SI').GetHumRatioFromRelHum(25, 0.5, SI_PRESSURE) },
      zone.points,
    );
    expect(inside).toBe(true);

    // 33 °C is not, at any humidity.
    const tooWarm = pointInPolygon(
      { tdb: 33, w: lib('SI').GetHumRatioFromRelHum(33, 0.5, SI_PRESSURE) },
      zone.points,
    );
    expect(tooWarm).toBe(false);

    // Nor is 15 °C.
    const tooCool = pointInPolygon(
      { tdb: 15, w: lib('SI').GetHumRatioFromRelHum(15, 0.5, SI_PRESSURE) },
      zone.points,
    );
    expect(tooCool).toBe(false);
  });

  it('has PMV within ±0.5 everywhere inside it', () => {
    // The defining property. Sample the interior and check the model agrees
    // with the boundary the solver drew.
    const zone = comfortZone({ ...base, clo: 0.5 }, 'summer');
    const psy = lib('SI');

    let tested = 0;
    for (let tdb = 18; tdb <= 32; tdb += 0.5) {
      for (let rh = 0.1; rh <= 0.9; rh += 0.1) {
        const w = psy.GetHumRatioFromRelHum(tdb, rh, SI_PRESSURE);
        if (!pointInPolygon({ tdb, w }, zone.points)) continue;

        const pmv = pmvAtCelsius(tdb, 0, rh, base.airSpeed, base.met, 0.5);
        // A small tolerance for the polygon's straight-line interpolation
        // between humidity samples.
        expect(Math.abs(pmv), `${tdb} °C, ${(rh * 100).toFixed(0)}% RH`).toBeLessThan(
          PMV_BOUND + 0.03,
        );
        tested += 1;
      }
    }
    expect(tested).toBeGreaterThan(20);
  });

  it('never exceeds the ASHRAE 55-2023 humidity limit', () => {
    for (const clo of [0.5, 1.0]) {
      const zone = comfortZone({ ...base, clo }, `${clo} clo`);
      for (const point of zone.points) {
        expect(point.w, `clo ${clo}`).toBeLessThanOrEqual(HUMIDITY_LIMIT + 1e-9);
      }
    }
  });

  it('reaches the humidity limit rather than stopping short of it', () => {
    // Clipping by dropping samples would leave a visible gap below the cap.
    const zone = comfortZone({ ...base, clo: 0.5 }, 'summer');
    const highest = Math.max(...zone.points.map((point) => point.w));
    expect(highest).toBeCloseTo(HUMIDITY_LIMIT, 9);
  });

  it('imposes no lower humidity limit, as 55-2023 does not', () => {
    // Earlier editions of the standard had one; drawing it would be wrong.
    const zone = comfortZone({ ...base, clo: 0.5 }, 'summer');
    const lowest = Math.min(...zone.points.map((point) => point.w));
    expect(lowest).toBeLessThan(0.001);
  });

  it('places the winter zone cooler than the summer zone', () => {
    const winter = comfortZone({ ...base, clo: 1.0 }, 'winter');
    const summer = comfortZone({ ...base, clo: 0.5 }, 'summer');

    const mean = (zone: typeof winter): number =>
      zone.points.reduce((sum, point) => sum + point.tdb, 0) / zone.points.length;

    // More clothing means comfort at lower temperatures.
    expect(mean(winter)).toBeLessThan(mean(summer));
  });

  it('produces the same zone in IP as in SI', () => {
    const si = comfortZone({ ...base, clo: 0.5 }, 'summer');
    const ip = comfortZone(
      { ...base, clo: 0.5, pressure: IP_PRESSURE, units: 'IP' },
      'summer',
    );

    const siWarmest = Math.max(...si.points.map((p) => p.tdb));
    const ipWarmest = Math.max(...ip.points.map((p) => p.tdb));
    expect(ipWarmest).toBeCloseTo(celsiusToFahrenheit(siWarmest), 1);
  });

  it('explains itself rather than throwing when no zone exists', () => {
    // Heavy activity in heavy clothing: no habitable temperature satisfies the
    // standard, so there is nothing to draw and a reason to give.
    const zone = comfortZone({ ...base, clo: 1.5, met: 4.0 }, 'impossible');
    expect(zone.points).toHaveLength(0);
    expect(zone.problems.length).toBeGreaterThan(0);
  });

  it('builds both default zones', () => {
    const zones = comfortZones(base);
    expect(zones).toHaveLength(2);
    expect(zones.map((zone) => zone.clo)).toEqual([1.0, 0.5]);
  });
});

describe('the adaptive model', () => {
  it('matches the ASHRAE 55 relation', () => {
    // t_comf = 0.31 * t_pma + 17.8. At 20 °C prevailing that is 24.0 °C.
    const result = evaluateAdaptive({ indoor: 24, prevailing: 20, airSpeed: 0.1 }, 'SI');
    expect(result.comfort).toBeCloseTo(0.31 * 20 + 17.8, 1);
  });

  it('uses ±2.5 K for 90% and ±3.5 K for 80% acceptability', () => {
    const result = evaluateAdaptive({ indoor: 24, prevailing: 20, airSpeed: 0.1 }, 'SI');
    const comfort = result.comfort!;

    expect(result.band90![0]).toBeCloseTo(comfort - 2.5, 1);
    expect(result.band90![1]).toBeCloseTo(comfort + 2.5, 1);
    expect(result.band80![0]).toBeCloseTo(comfort - 3.5, 1);
    expect(result.band80![1]).toBeCloseTo(comfort + 3.5, 1);
  });

  it('reports acceptability against the bands', () => {
    const inside = evaluateAdaptive({ indoor: 24, prevailing: 20, airSpeed: 0.1 }, 'SI');
    expect(inside.acceptable90).toBe(true);

    const outside = evaluateAdaptive({ indoor: 31, prevailing: 20, airSpeed: 0.1 }, 'SI');
    expect(outside.acceptable80).toBe(false);
  });

  it('returns null rather than NaN outside the outdoor range', () => {
    // The library signals out-of-range with NaN. JSON.stringify renders NaN as
    // "null", which makes it easy to believe the library returns null and to
    // write a === null guard that never fires — letting "NaN °F" reach the UI.
    const cold = evaluateAdaptive({ indoor: 22, prevailing: 2, airSpeed: 0.1 }, 'SI');
    expect(cold.comfort).toBeNull();
    expect(cold.band80).toBeNull();
    expect(cold.band90).toBeNull();
    expect(Number.isNaN(cold.comfort as unknown as number)).toBe(false);
  });

  it('refuses to extrapolate outside the outdoor range, and says why', () => {
    const cold = evaluateAdaptive({ indoor: 22, prevailing: 2, airSpeed: 0.1 }, 'SI');
    expect(cold.comfort).toBeNull();
    expect(cold.limits.join(' ')).toMatch(/outside the 10–33.5 °C range/);

    const hot = evaluateAdaptive({ indoor: 30, prevailing: 40, airSpeed: 0.1 }, 'SI');
    expect(hot.comfort).toBeNull();
    expect(hot.limits.length).toBeGreaterThan(0);
  });

  it('works in IP', () => {
    const si = evaluateAdaptive({ indoor: 24, prevailing: 20, airSpeed: 0.1 }, 'SI');
    const ip = evaluateAdaptive(
      { indoor: celsiusToFahrenheit(24), prevailing: celsiusToFahrenheit(20), airSpeed: 0.1 },
      'IP',
    );
    expect(ip.comfort).toBeCloseTo(celsiusToFahrenheit(si.comfort!), 1);
  });

  it('gives bands spanning the model’s valid range for plotting', () => {
    const bands = adaptiveBands('SI');
    expect(bands).toHaveLength(2);
    expect(bands[0]!.prevailing).toBeCloseTo(ADAPTIVE_LIMITS.prevailingCelsius.min, 6);
    expect(bands[1]!.prevailing).toBeCloseTo(ADAPTIVE_LIMITS.prevailingCelsius.max, 6);
    // Warmer outdoors means a warmer neutral temperature.
    expect(bands[1]!.comfort).toBeGreaterThan(bands[0]!.comfort);
  });
});

describe('running mean outdoor temperature', () => {
  it('weights recent days more heavily than a plain average would', () => {
    // The property that matters: the weighted mean is pulled *toward the most
    // recent day* relative to the arithmetic mean of the same days.
    const warmestDayMostRecent = [30, 10, 10, 10, 10];
    const coolestDayMostRecent = [10, 30, 30, 30, 30];

    const arithmetic = (days: number[]): number =>
      days.reduce((sum, day) => sum + day, 0) / days.length;

    // Recent warmth pulls the mean up from 14.
    expect(runningMeanOutdoor(warmestDayMostRecent)).toBeGreaterThan(
      arithmetic(warmestDayMostRecent),
    );
    // Recent cool pulls it down from 26.
    expect(runningMeanOutdoor(coolestDayMostRecent)).toBeLessThan(
      arithmetic(coolestDayMostRecent),
    );
    // And both stay inside the range of the data.
    expect(runningMeanOutdoor(warmestDayMostRecent)).toBeGreaterThan(10);
    expect(runningMeanOutdoor(warmestDayMostRecent)).toBeLessThan(30);
  });

  it('returns the value itself for a constant history', () => {
    expect(runningMeanOutdoor([20, 20, 20, 20])).toBeCloseTo(20, 12);
  });

  it('reports NaN for an empty history rather than zero', () => {
    // Zero would be a plausible-looking 0 °C.
    expect(runningMeanOutdoor([])).toBeNaN();
  });
});

/* -------------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------------- */

/** Ray-casting point-in-polygon, for testing zone membership. */
function pointInPolygon(
  point: { tdb: number; w: number },
  polygon: readonly { tdb: number; w: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.w > point.w !== b.w > point.w &&
      point.tdb < ((b.tdb - a.tdb) * (point.w - a.w)) / (b.w - a.w) + a.tdb;
    if (intersects) inside = !inside;
  }
  return inside;
}

describe('Phase 3 gate — zone boundaries against published ASHRAE 55 values', () => {
  /**
   * The comfort zone as drawn in ASHRAE Standard 55 and reproduced by the CBE
   * Thermal Comfort Tool, at 50% relative humidity, 1.1 met, still air, with
   * mean radiant temperature equal to air temperature:
   *
   *   winter, 1.0 clo   ≈ 20–24 °C   (68–75 °F)
   *   summer, 0.5 clo   ≈ 23–26 °C   (74–79 °F)
   *
   * The published figures are read off a printed chart and vary by a few tenths
   * between editions and metabolic assumptions, so the tolerance here is 1 K —
   * tight enough to catch a real error in the boundary solver, loose enough not
   * to fail on which edition someone measured.
   */
  const boundaryAt = (target: number, rh: number, clo: number): number => {
    let low = 5;
    let high = 45;
    for (let i = 0; i < 200; i += 1) {
      const mid = (low + high) / 2;
      if (pmvAtCelsius(mid, 0, rh, 0.1, 1.1, clo) < target) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  };

  it('places the winter zone where the standard does', () => {
    expect(boundaryAt(-PMV_BOUND, 0.5, 1.0)).toBeCloseTo(20.3, 0);
    expect(boundaryAt(PMV_BOUND, 0.5, 1.0)).toBeCloseTo(24.5, 0);
  });

  it('places the summer zone where the standard does', () => {
    expect(boundaryAt(-PMV_BOUND, 0.5, 0.5)).toBeCloseTo(23.9, 0);
    expect(boundaryAt(PMV_BOUND, 0.5, 0.5)).toBeCloseTo(26.9, 0);
  });

  it('the drawn polygon agrees with the boundary solver', () => {
    // Guards against the polygon builder and the raw solver drifting apart —
    // for instance through a unit conversion applied in one and not the other.
    const zone = comfortZone(
      {
        clo: 0.5,
        met: 1.1,
        airSpeed: 0.1,
        mrtOffset: 0,
        pressure: SI_PRESSURE,
        units: 'SI',
      },
      'summer',
    );

    const psy = lib('SI');
    const targetW = psy.GetHumRatioFromRelHum(25, 0.5, SI_PRESSURE);

    // Find where the polygon's edges sit at this humidity ratio.
    const near = zone.points.filter((point) => Math.abs(point.w - targetW) < 0.0004);
    expect(near.length).toBeGreaterThanOrEqual(2);

    const coolEdge = Math.min(...near.map((point) => point.tdb));
    const warmEdge = Math.max(...near.map((point) => point.tdb));

    expect(coolEdge).toBeCloseTo(boundaryAt(-PMV_BOUND, 0.5, 0.5), 0);
    expect(warmEdge).toBeCloseTo(boundaryAt(PMV_BOUND, 0.5, 0.5), 0);
  });
});
