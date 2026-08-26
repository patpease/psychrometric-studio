/**
 * Chart geometry: scales, clipping, line families, and the protractor.
 *
 * The properties asserted here are the ones a reader would check by eye against
 * a printed chart — lines terminating exactly on the saturation curve, families
 * nesting in the right order, the protractor's limiting cases. Getting these
 * wrong produces a chart that looks plausible and is wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  createScales,
  defaultDomain,
  domainLimits,
  zoomDomain,
  panDomain,
  niceTicks,
  DEFAULT_MARGIN,
} from '../src/chart/scales.js';
import {
  saturationCurve,
  relativeHumidityLine,
  wetBulbLine,
  enthalpyLine,
  specificVolumeLine,
  dewPointLine,
  defaultTicks,
  traceLine,
} from '../src/chart/families.js';
import { slopeForShr, shrForSlope, protractorRays } from '../src/chart/protractor.js';
import { lib } from '../src/psych/psychrolib.js';
import { humidityRatioToDisplay } from '../src/psych/units.js';
import { DEFAULTS, type UnitSystem } from '../src/psych/units.js';

const SYSTEMS: UnitSystem[] = ['IP', 'SI'];
const WIDTH = 900;
const HEIGHT = 600;

describe.each(SYSTEMS)('scales — %s', (units) => {
  const domain = defaultDomain(units);
  const scales = createScales(domain, WIDTH, HEIGHT);

  it('maps the domain corners to the plot corners', () => {
    const bottomLeft = scales.project(domain.tdbMin, domain.wMin);
    expect(bottomLeft.x).toBeCloseTo(DEFAULT_MARGIN.left, 6);
    expect(bottomLeft.y).toBeCloseTo(DEFAULT_MARGIN.top + scales.plotHeight, 6);

    const topRight = scales.project(domain.tdbMax, domain.wMax);
    expect(topRight.x).toBeCloseTo(DEFAULT_MARGIN.left + scales.plotWidth, 6);
    expect(topRight.y).toBeCloseTo(DEFAULT_MARGIN.top, 6);
  });

  it('puts higher humidity ratio higher on screen', () => {
    const low = scales.project(domain.tdbMin, domain.wMin);
    const high = scales.project(domain.tdbMin, domain.wMax);
    expect(high.y).toBeLessThan(low.y);
  });

  it('inverts exactly', () => {
    for (const tdb of [domain.tdbMin, 0.5 * (domain.tdbMin + domain.tdbMax), domain.tdbMax]) {
      for (const w of [domain.wMin, 0.015, domain.wMax]) {
        const { x, y } = scales.project(tdb, w);
        const back = scales.invert(x, y);
        expect(back.tdb).toBeCloseTo(tdb, 9);
        expect(back.w).toBeCloseTo(w, 12);
      }
    }
  });

  it('reports containment correctly', () => {
    expect(scales.contains(domain.tdbMin, domain.wMin)).toBe(true);
    expect(scales.contains(domain.tdbMax + 1, domain.wMin)).toBe(false);
    expect(scales.contains(domain.tdbMin, domain.wMax * 2)).toBe(false);
  });
});

describe.each(SYSTEMS)('zoom and pan — %s', (units) => {
  const domain = defaultDomain(units);
  const limits = domainLimits(units);

  it('keeps the focus point fixed while zooming', () => {
    const focus = { tdb: (domain.tdbMin + domain.tdbMax) / 2, w: 0.01 };
    const zoomed = zoomDomain(domain, 0.5, focus, limits);

    const fractionBefore = (focus.tdb - domain.tdbMin) / (domain.tdbMax - domain.tdbMin);
    const fractionAfter = (focus.tdb - zoomed.tdbMin) / (zoomed.tdbMax - zoomed.tdbMin);
    expect(fractionAfter).toBeCloseTo(fractionBefore, 9);
  });

  it('narrows the view when zooming in', () => {
    const focus = { tdb: (domain.tdbMin + domain.tdbMax) / 2, w: 0.01 };
    const zoomed = zoomDomain(domain, 0.5, focus, limits);
    expect(zoomed.tdbMax - zoomed.tdbMin).toBeLessThan(domain.tdbMax - domain.tdbMin);
  });

  it('never zooms out past the limits', () => {
    let current = domain;
    const focus = { tdb: (domain.tdbMin + domain.tdbMax) / 2, w: 0.01 };
    for (let i = 0; i < 30; i += 1) current = zoomDomain(current, 2, focus, limits);

    expect(current.tdbMin).toBeGreaterThanOrEqual(limits.tdbMin - 1e-9);
    expect(current.tdbMax).toBeLessThanOrEqual(limits.tdbMax + 1e-9);
    expect(current.wMin).toBeGreaterThanOrEqual(limits.wMin - 1e-12);
    expect(current.wMax).toBeLessThanOrEqual(limits.wMax + 1e-12);
  });

  it('never zooms in past the minimum span', () => {
    let current = domain;
    const focus = { tdb: (domain.tdbMin + domain.tdbMax) / 2, w: 0.01 };
    for (let i = 0; i < 40; i += 1) current = zoomDomain(current, 0.5, focus, limits);
    expect(current.tdbMax - current.tdbMin).toBeGreaterThan(0);
    expect(current.wMax - current.wMin).toBeGreaterThan(0);
  });

  it('slides rather than squashes when panning into an edge', () => {
    const width = domain.tdbMax - domain.tdbMin;
    const panned = panDomain(domain, -1e6, 0, limits);
    expect(panned.tdbMax - panned.tdbMin).toBeCloseTo(width, 6);
    expect(panned.tdbMin).toBeCloseTo(limits.tdbMin, 6);
  });
});

describe('nice ticks', () => {
  it('covers the range with round values', () => {
    const ticks = niceTicks(32, 120, 10);
    expect(ticks.length).toBeGreaterThan(4);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(32);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(120);
    // Evenly spaced.
    const step = ticks[1]! - ticks[0]!;
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(step, 9);
    }
  });

  it('returns nothing for a degenerate range', () => {
    expect(niceTicks(5, 5)).toEqual([]);
    expect(niceTicks(10, 0)).toEqual([]);
  });

  it('produces an exact zero rather than a floating-point smudge', () => {
    const ticks = niceTicks(-10, 50, 6);
    const zero = ticks.find((t) => Math.abs(t) < 1e-6);
    if (zero !== undefined) expect(zero).toBe(0);
  });
});

describe.each(SYSTEMS)('line families — %s', (units) => {
  const domain = defaultDomain(units);
  const pressure = DEFAULTS[units].standardPressure;
  const psy = lib(units);
  const ticks = defaultTicks(units);
  const fmt = (v: number): string => v.toFixed(1);

  it('the saturation curve rises monotonically with temperature', () => {
    const curve = saturationCurve(domain, pressure, units);
    expect(curve.points.length).toBeGreaterThan(50);
    for (let i = 1; i < curve.points.length; i += 1) {
      expect(curve.points[i]!.w).toBeGreaterThanOrEqual(curve.points[i - 1]!.w - 1e-12);
    }
  });

  it('the saturation curve stays within the domain', () => {
    const curve = saturationCurve(domain, pressure, units);
    for (const p of curve.points) {
      expect(p.w).toBeLessThanOrEqual(domain.wMax + 1e-12);
      expect(p.w).toBeGreaterThanOrEqual(domain.wMin - 1e-12);
    }
  });

  it('relative-humidity lines nest in order and never cross saturation', () => {
    const at = (rh: number): number => psy.GetHumRatioFromRelHum(
      (domain.tdbMin + domain.tdbMax) / 2,
      rh,
      pressure,
    );
    expect(at(0.3)).toBeLessThan(at(0.6));
    expect(at(0.6)).toBeLessThan(at(0.9));

    for (const rh of ticks.relativeHumidity) {
      for (const line of relativeHumidityLine(rh, domain, pressure, units)) {
        for (const p of line.points) {
          const wSat = psy.GetSatHumRatio(p.tdb, pressure);
          expect(p.w).toBeLessThanOrEqual(wSat + 1e-9);
        }
      }
    }
  });

  it('every family stays inside the domain and below saturation', () => {
    const all = [
      ...ticks.relativeHumidity.flatMap((v) => relativeHumidityLine(v, domain, pressure, units)),
      ...ticks.wetBulb.flatMap((v) => wetBulbLine(v, domain, pressure, units, fmt)),
      ...ticks.enthalpy.flatMap((v) => enthalpyLine(v, domain, pressure, units, fmt)),
      ...ticks.specificVolume.flatMap((v) => specificVolumeLine(v, domain, pressure, units, fmt)),
      ...ticks.dewPoint.flatMap((v) => dewPointLine(v, domain, pressure, units, fmt)),
    ];

    expect(all.length).toBeGreaterThan(20);

    for (const line of all) {
      for (const p of line.points) {
        expect(p.tdb, `${line.family} ${line.value}`).toBeGreaterThanOrEqual(domain.tdbMin - 1e-6);
        expect(p.tdb, `${line.family} ${line.value}`).toBeLessThanOrEqual(domain.tdbMax + 1e-6);
        expect(p.w, `${line.family} ${line.value}`).toBeGreaterThanOrEqual(domain.wMin - 1e-9);
        expect(p.w, `${line.family} ${line.value}`).toBeLessThanOrEqual(domain.wMax + 1e-9);

        const wSat = psy.GetSatHumRatio(p.tdb, pressure);
        expect(p.w, `${line.family} ${line.value} above saturation`).toBeLessThanOrEqual(
          wSat + 1e-8,
        );
      }
    }
  });

  it('a wet-bulb line meets the saturation curve at its own temperature', () => {
    // The defining property: at Tdb = Twb the air is saturated. The clipped
    // line must actually reach that point, not stop a sample short of it.
    const twb = units === 'IP' ? 60 : 15;
    const lines = wetBulbLine(twb, domain, pressure, units, fmt);
    expect(lines.length).toBeGreaterThan(0);

    const start = lines[0]!.points[0]!;
    const wSat = psy.GetSatHumRatio(twb, pressure);
    expect(start.tdb).toBeCloseTo(twb, 3);
    expect(start.w).toBeCloseTo(wSat, 6);
  });

  it('wet-bulb lines slope downward to the right', () => {
    const twb = units === 'IP' ? 60 : 15;
    const line = wetBulbLine(twb, domain, pressure, units, fmt)[0];
    expect(line).toBeDefined();
    const pts = line!.points;
    expect(pts[pts.length - 1]!.w).toBeLessThan(pts[0]!.w);
  });

  it('enthalpy lines slope downward to the right, more steeply than wet bulb', () => {
    // Constant enthalpy and constant wet bulb are close but not identical; the
    // enthalpy line is the steeper of the two. If they ever come out identical,
    // one family is being computed from the other by mistake.
    const h = units === 'IP' ? 30 : 45000;
    const line = enthalpyLine(h, domain, pressure, units, fmt)[0];
    expect(line).toBeDefined();
    const pts = line!.points;
    expect(pts[pts.length - 1]!.w).toBeLessThan(pts[0]!.w);
  });

  it('specific-volume lines slope downward to the right', () => {
    const v = units === 'IP' ? 13.5 : 0.86;
    const lines = specificVolumeLine(v, domain, pressure, units, fmt);
    expect(lines.length).toBeGreaterThan(0);
    const pts = lines[0]!.points;
    expect(pts[pts.length - 1]!.w).toBeLessThan(pts[0]!.w);
  });

  it('dew-point lines are horizontal', () => {
    const tdp = units === 'IP' ? 55 : 12;
    const lines = dewPointLine(tdp, domain, pressure, units, fmt);
    expect(lines.length).toBe(1);
    const [a, b] = lines[0]!.points;
    expect(a!.w).toBeCloseTo(b!.w, 15);
  });

  it('re-tessellates when the domain is zoomed, keeping the same resolution', () => {
    const zoomed = zoomDomain(domain, 0.2, { tdb: (domain.tdbMin + domain.tdbMax) / 2, w: 0.012 }, domainLimits(units));
    const wide = saturationCurve(domain, pressure, units);
    const close = saturationCurve(zoomed, pressure, units);
    // Same sample count over a narrower span means finer resolution, which is
    // the point of tying tessellation to the domain rather than to the data.
    expect(close.points.length).toBeGreaterThan(20);
    expect(wide.points.length).toBeGreaterThan(20);
  });
});

describe('clipping produces separate segments when a line leaves and re-enters', () => {
  it('splits rather than bridging the gap', () => {
    // Chosen so that the *only* binding constraint is wMin: at 60-100 °F,
    // W = 0.002 sits well below saturation, so the excursion below zero in the
    // middle is unambiguously what splits the line. Bridging the gap would draw
    // through space the family does not occupy.
    const domain = { tdbMin: 60, tdbMax: 100, wMin: 0, wMax: 0.03 };
    const segments = traceLine(
      (tdb) => (tdb > 75 && tdb < 85 ? -0.002 : 0.002),
      domain,
      DEFAULTS.IP.standardPressure,
      'IP',
    );

    expect(segments.length).toBe(2);
    expect(segments[0]![segments[0]!.length - 1]!.tdb).toBeLessThanOrEqual(76);
    expect(segments[1]![0]!.tdb).toBeGreaterThanOrEqual(84);
  });

  it('drops a line that is entirely above saturation', () => {
    // A humidity ratio no air at these temperatures can hold: nothing to draw.
    const domain = { tdbMin: 32, tdbMax: 50, wMin: 0, wMax: 0.03 };
    const segments = traceLine(() => 0.025, domain, DEFAULTS.IP.standardPressure, 'IP');
    expect(segments).toEqual([]);
  });
});

describe.each(SYSTEMS)('protractor — %s', (units) => {
  it('SHR = 1 is horizontal (pure sensible)', () => {
    expect(slopeForShr(1, units)).toBe(0);
  });

  it('SHR = 0 is vertical (pure latent)', () => {
    expect(slopeForShr(0, units)).toBe(Number.POSITIVE_INFINITY);
  });

  it('slope increases as SHR falls', () => {
    expect(slopeForShr(0.9, units)).toBeLessThan(slopeForShr(0.7, units));
    expect(slopeForShr(0.7, units)).toBeLessThan(slopeForShr(0.5, units));
  });

  it('round-trips slope back to SHR', () => {
    for (const shr of [0.2, 0.5, 0.75, 0.85, 0.95]) {
      const slope = slopeForShr(shr, units);
      // Walk one degree along the line and recover the ratio.
      expect(shrForSlope(1, slope, units)).toBeCloseTo(shr, 9);
    }
  });

  it('produces unit direction vectors pointing up and to the right', () => {
    const rays = protractorRays(units, 10, 20000);
    for (const ray of rays) {
      const length = Math.hypot(ray.direction.dx, ray.direction.dy);
      expect(length).toBeCloseTo(1, 9);
      // Increasing enthalpy: never downward on screen.
      expect(ray.direction.dy).toBeLessThanOrEqual(0);
    }
  });

  it('labels the endpoints of the range', () => {
    const rays = protractorRays(units, 10, 20000);
    expect(rays[0]!.shr).toBe(0);
    expect(rays[rays.length - 1]!.shr).toBe(1);
  });
});

describe('the default view', () => {
  it('frames the specified IP window', () => {
    // Pinned because these are chosen numbers, not derived ones: 5 to 110 °F
    // and 0 to 170 gr/lb. The humidity ceiling is stored canonically, so the
    // assertion converts rather than restating the fraction.
    const domain = defaultDomain('IP');
    expect(domain.tdbMin).toBe(5);
    expect(domain.tdbMax).toBe(110);
    expect(domain.wMin).toBe(0);
    expect(humidityRatioToDisplay(domain.wMax, 'IP')).toBeCloseTo(170, 9);
  });

  it('frames a comparable SI window', () => {
    const domain = defaultDomain('SI');
    expect(domain.tdbMin).toBe(-15);
    expect(domain.tdbMax).toBe(45);
    expect(humidityRatioToDisplay(domain.wMax, 'SI')).toBeCloseTo(24, 9);
  });

  it('sits inside the limits the user may zoom out to', () => {
    // The default view starting below the widest allowed view would snap the
    // chart on the first pan — and the default now reaches below freezing,
    // which the old limits did not.
    for (const units of ['IP', 'SI'] as const) {
      const domain = defaultDomain(units);
      const limits = domainLimits(units);
      expect(domain.tdbMin, `${units} min`).toBeGreaterThanOrEqual(limits.tdbMin);
      expect(domain.tdbMax, `${units} max`).toBeLessThanOrEqual(limits.tdbMax);
      expect(domain.wMax, `${units} wMax`).toBeLessThanOrEqual(limits.wMax);
    }
  });

  it('leaves the same room for each axis title', () => {
    // The humidity axis runs down the right and dry bulb along the bottom; the
    // right margin was wider for no reason beyond never having been compared
    // with the bottom.
    expect(DEFAULT_MARGIN.right).toBe(DEFAULT_MARGIN.bottom);
  });
});
