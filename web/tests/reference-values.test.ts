/**
 * Phase 0 gate: property validation against ASHRAE Handbook — Fundamentals
 * Chapter 1 reference values.
 *
 * The tolerances are deliberately non-uniform, and that is the point of this
 * file. PsychroLib implements the Chapter 1 *equations*, which omit the
 * water-vapour enhancement factor. The published tables are computed from the
 * real-gas formulation. The two therefore disagree — by up to 2% in saturated
 * humidity ratio and 3% in saturated enthalpy near freezing — while agreeing to
 * 0.03% in saturation vapour pressure.
 *
 * An engineer comparing this tool against a printed ASHRAE chart will see that
 * discrepancy near the saturation curve and reasonably wonder if the tool is
 * broken. It is not, and this test encodes exactly how much divergence is
 * expected and where, so the answer is auditable rather than folklore.
 */
import { describe, it, expect } from 'vitest';
import { lib } from '../src/psych/psychrolib.js';
import type { PsychroLib } from '../src/psych/psychrolib.js';
import type { UnitSystem } from '../src/psych/units.js';
import reference from './fixtures/ashrae-reference.json' with { type: 'json' };

/** Relative difference, matching PsychroLib's own `checkRelDiff` convention. */
function relativeDifference(actual: number, expected: number): number {
  return Math.abs((actual - expected) / expected);
}

function expectWithin(actual: number, expected: number, tolerance: number, label: string): void {
  const difference = relativeDifference(actual, expected);
  expect(
    difference,
    `${label}: got ${actual}, expected ${expected} (rel. diff ${(difference * 100).toFixed(4)}%, ` +
      `tolerance ${(tolerance * 100).toFixed(4)}%)`,
  ).toBeLessThanOrEqual(tolerance);
}

const systems: UnitSystem[] = ['IP', 'SI'];

describe.each(systems)('ASHRAE Ch. 1 reference values — %s', (units) => {
  const psy = lib(units);
  const data = reference[units];

  it('saturation vapour pressure matches Table 3', () => {
    for (const point of data.satVapPres.points) {
      expectWithin(
        psy.GetSatVapPres(point.tdb),
        point.expected,
        data.satVapPres.tolerance,
        `GetSatVapPres(${point.tdb})`,
      );
    }
  });

  it('saturation humidity ratio matches Table 2 within the documented spread', () => {
    for (const point of data.satHumRatio.points) {
      expectWithin(
        psy.GetSatHumRatio(point.tdb, data.pressure),
        point.expected,
        point.tolerance,
        `GetSatHumRatio(${point.tdb})`,
      );
    }
  });

  it('saturated air enthalpy matches Table 2 within the documented spread', () => {
    for (const point of data.satAirEnthalpy.points) {
      expectWithin(
        psy.GetSatAirEnthalpy(point.tdb, data.pressure),
        point.expected,
        point.tolerance,
        `GetSatAirEnthalpy(${point.tdb})`,
      );
    }
  });

  it('dry-air properties match Table 2', () => {
    for (const point of data.dryAir.points) {
      const fn = psy[point.fn as keyof PsychroLib] as (...args: number[]) => number;
      expectWithin(
        fn.apply(psy, point.args),
        point.expected,
        point.tolerance,
        `${point.fn}(${point.args.join(', ')})`,
      );
    }
  });
});

describe('moist-air properties at off-standard pressure — IP', () => {
  const psy = lib('IP');

  it('matches reference values', () => {
    for (const point of reference.IP.moistAir.points) {
      const fn = psy[point.fn as keyof PsychroLib] as (...args: number[]) => number;
      expectWithin(
        fn.apply(psy, point.args),
        point.expected,
        point.tolerance,
        `${point.fn}(${point.args.join(', ')})`,
      );
    }
  });
});

describe('the enhancement-factor divergence is real and bounded', () => {
  /**
   * Guards the claim made in the file header. If a future PsychroLib release
   * adds the enhancement factor, this test fails and the documentation in
   * docs/calculation-reference.md must be revised — which is the intent.
   */
  it('saturated humidity ratio at 25 °C sits below the tabulated value by ~0.5%', () => {
    const computed = lib('SI').GetSatHumRatio(25, 101325);
    const tabulated = 0.020173;
    const difference = (tabulated - computed) / tabulated;

    expect(computed).toBeLessThan(tabulated);
    expect(difference).toBeGreaterThan(0.003);
    expect(difference).toBeLessThan(0.006);
  });
});
