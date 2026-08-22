/**
 * State engine behaviour: every input pair resolves to the same state, and
 * impossible states are clamped loudly rather than silently.
 */
import { describe, it, expect } from 'vitest';
import {
  solve,
  solveState,
  fromTdbRh,
  fromTdbTwb,
  fromTdbTdp,
  fromTdbW,
  fromTdbEnthalpy,
  fromEnthalpyW,
  fromTwbRh,
  saturationHumidityRatio,
  isSaturated,
  wasClamped,
  type StateInput,
} from '../src/psych/state.js';
import { DEFAULTS, type UnitSystem } from '../src/psych/units.js';
import { CONVERGENCE_TOLERANCE } from '../src/psych/psychrolib.js';

/**
 * Precision limits of the calculation basis, not of this code.
 *
 * PsychroLib resolves wet-bulb temperature iteratively to ±0.001 °C
 * (`CONVERGENCE_TOLERANCE`). Any humidity ratio obtained *through* a wet bulb
 * therefore carries roughly 4e-7 kg/kg, and any dry bulb recovered from a
 * wet-bulb pair carries roughly 4e-4 degrees. Pairs that involve no iteration
 * — dew point, humidity ratio, enthalpy — agree to machine precision.
 *
 * These constants are deliberately named rather than inlined: asserting
 * anything tighter would be asserting precision the library cannot deliver,
 * and the resulting failure would look like a bug in this repository.
 */
const EXACT_DIGITS = 10;
/** Humidity ratio via a wet bulb: |diff| < 5e-7. */
const WETBULB_W_DIGITS = 6;
/** Relative humidity via a wet bulb: |diff| < 5e-5. */
const WETBULB_RH_DIGITS = 4;
/**
 * Dry bulb recovered from a wet-bulb pair, as an absolute bound in the
 * project's own temperature units. This must be unit-aware: PsychroLib's
 * tolerance is 0.001 °C, which is 0.0018 °F — a fixed decimal-digit assertion
 * passes in SI and fails in IP for no physical reason.
 */
const wetBulbTdbBound = (units: UnitSystem): number => CONVERGENCE_TOLERANCE[units];

const CASES: Record<UnitSystem, { tdb: number; rh: number; pressure: number }> = {
  IP: { tdb: 75, rh: 0.5, pressure: DEFAULTS.IP.standardPressure },
  SI: { tdb: 24, rh: 0.5, pressure: DEFAULTS.SI.standardPressure },
};

describe.each(['IP', 'SI'] as UnitSystem[])('input pairs agree — %s', (units) => {
  const { tdb, rh, pressure } = CASES[units];
  const base = fromTdbRh(tdb, rh, pressure, units);

  it('solves a reference state without warnings', () => {
    expect(base.warnings).toHaveLength(0);
    expect(base.rh).toBeCloseTo(rh, 9);
    expect(base.tdb).toBeCloseTo(tdb, 9);
    expect(base.w).toBeGreaterThan(0);
    expect(base.w).toBeLessThan(base.wSaturation);
  });

  it('Tdb + Twb reproduces it, to the library\'s wet-bulb precision', () => {
    const s = fromTdbTwb(tdb, base.twb, pressure, units);
    expect(s.w).toBeCloseTo(base.w, WETBULB_W_DIGITS);
    expect(s.rh).toBeCloseTo(base.rh, WETBULB_RH_DIGITS);
    // And the slop really is bounded by the documented figure.
    expect(Math.abs(s.w - base.w)).toBeLessThan(CONVERGENCE_TOLERANCE.humidityRatio);
  });

  it('Tdb + Tdp reproduces it exactly', () => {
    const s = fromTdbTdp(tdb, base.tdp, pressure, units);
    expect(s.w).toBeCloseTo(base.w, EXACT_DIGITS);
  });

  it('Tdb + W reproduces it exactly', () => {
    const s = fromTdbW(tdb, base.w, pressure, units);
    expect(s.h).toBeCloseTo(base.h, 8);
    expect(s.twb).toBe(base.twb);
  });

  it('Tdb + h reproduces it exactly', () => {
    const s = fromTdbEnthalpy(tdb, base.h, pressure, units);
    expect(s.w).toBeCloseTo(base.w, EXACT_DIGITS);
  });

  it('h + W reproduces it', () => {
    const s = fromEnthalpyW(base.h, base.w, pressure, units);
    expect(s.tdb).toBeCloseTo(base.tdb, 6);
  });

  it('Twb + RH reproduces it via bisection', () => {
    const s = fromTwbRh(base.twb, base.rh, pressure, units);
    expect(Math.abs(s.tdb - base.tdb)).toBeLessThan(wetBulbTdbBound(units));
    expect(s.w).toBeCloseTo(base.w, WETBULB_W_DIGITS);
  });

  it('round-trips through the declarative solve() dispatcher', () => {
    const inputs: StateInput[] = [
      { kind: 'tdb-rh', tdb, rh },
      { kind: 'tdb-twb', tdb, twb: base.twb },
      { kind: 'tdb-tdp', tdb, tdp: base.tdp },
      { kind: 'tdb-w', tdb, w: base.w },
      { kind: 'tdb-h', tdb, h: base.h },
      { kind: 'h-w', h: base.h, w: base.w },
      { kind: 'twb-rh', twb: base.twb, rh: base.rh },
    ];

    for (const input of inputs) {
      const s = solve(input, pressure, units);
      expect(Math.abs(s.tdb - base.tdb), `input ${input.kind}`).toBeLessThan(
        wetBulbTdbBound(units),
      );
      expect(s.w, `input ${input.kind}`).toBeCloseTo(base.w, WETBULB_W_DIGITS);
    }
  });
});

describe('saturation clamping', () => {
  it('clamps an impossible humidity ratio and says so', () => {
    const pressure = DEFAULTS.IP.standardPressure;
    const ws = saturationHumidityRatio(75, pressure, 'IP');
    const state = solveState(75, ws * 1.5, pressure, 'IP');

    expect(wasClamped(state)).toBe(true);
    expect(state.w).toBeCloseTo(ws, 12);
    expect(isSaturated(state)).toBe(true);

    const warning = state.warnings.find((w) => w.code === 'saturation-clamped');
    expect(warning).toBeDefined();
    expect(warning?.requested).toBeCloseTo(ws * 1.5, 12);
    expect(warning?.applied).toBeCloseTo(ws, 12);
    // The message must be actionable, not just "clamped".
    expect(warning?.message).toContain('cannot hold this much moisture');
  });

  it('leaves a physical state untouched', () => {
    const pressure = DEFAULTS.SI.standardPressure;
    const state = fromTdbRh(24, 0.5, pressure, 'SI');
    expect(wasClamped(state)).toBe(false);
    expect(state.warnings).toHaveLength(0);
  });

  it('treats exactly-saturated air as saturated but not clamped', () => {
    const pressure = DEFAULTS.SI.standardPressure;
    const ws = saturationHumidityRatio(20, pressure, 'SI');
    const state = solveState(20, ws, pressure, 'SI');

    expect(wasClamped(state)).toBe(false);
    expect(isSaturated(state)).toBe(true);
    expect(state.rh).toBeCloseTo(1, 6);
  });

  it('clamps out-of-range relative humidity with a warning', () => {
    const state = fromTdbRh(75, 1.4, DEFAULTS.IP.standardPressure, 'IP');
    expect(state.warnings.some((w) => w.code === 'rh-clamped')).toBe(true);
    expect(state.rh).toBeCloseTo(1, 6);
  });
});

describe('input validation refuses impossible pairs', () => {
  const pressure = DEFAULTS.IP.standardPressure;

  it('rejects wet bulb above dry bulb', () => {
    expect(() => fromTdbTwb(70, 75, pressure, 'IP')).toThrow(/cannot exceed dry-bulb/);
  });

  it('rejects dew point above dry bulb', () => {
    expect(() => fromTdbTdp(70, 75, pressure, 'IP')).toThrow(/cannot exceed dry-bulb/);
  });

  it('rejects non-positive pressure', () => {
    expect(() => solveState(75, 0.01, 0, 'IP')).toThrow(/pressure must be positive/);
  });

  it('rejects negative humidity ratio', () => {
    expect(() => solveState(75, -0.001, pressure, 'IP')).toThrow(/non-negative/);
  });

  it('rejects a non-finite temperature', () => {
    expect(() => solveState(Number.NaN, 0.01, pressure, 'IP')).toThrow(/must be finite/);
  });
});

describe('pressure sensitivity', () => {
  it('produces a different state at altitude for the same Tdb and RH', () => {
    const sea = fromTdbRh(75, 0.5, DEFAULTS.IP.standardPressure, 'IP');
    const denver = fromTdbRh(75, 0.5, 12.1, 'IP'); // ≈ 5,300 ft

    // Lower pressure holds more moisture at the same RH, and wet bulb falls.
    expect(denver.w).toBeGreaterThan(sea.w);
    expect(denver.twb).toBeLessThan(sea.twb);
    expect(denver.v).toBeGreaterThan(sea.v);
  });
});


describe('the wet-bulb precision limit is real and bounded', () => {
  /**
   * Documents the noise floor of the whole application. If a future PsychroLib
   * release tightens its convergence tolerance this test fails, and
   * CONVERGENCE_TOLERANCE plus docs/calculation-reference.md must be revised —
   * which is the intent.
   */
  it('round-tripping through wet bulb loses precision, but less than the documented bound', () => {
    const pressure = DEFAULTS.SI.standardPressure;
    const base = fromTdbRh(24, 0.5, pressure, 'SI');
    const viaWetBulb = fromTdbTwb(24, base.twb, pressure, 'SI');

    const error = Math.abs(viaWetBulb.w - base.w);
    expect(error, 'some precision is lost').toBeGreaterThan(0);
    expect(error, 'but it stays within the documented bound').toBeLessThan(
      CONVERGENCE_TOLERANCE.humidityRatio,
    );
  });

  it('is negligible in display terms — under 0.001 g/kg', () => {
    const pressure = DEFAULTS.SI.standardPressure;
    const base = fromTdbRh(24, 0.5, pressure, 'SI');
    const viaWetBulb = fromTdbTwb(24, base.twb, pressure, 'SI');

    const displayError = Math.abs(viaWetBulb.w - base.w) * 1000;
    expect(displayError).toBeLessThan(0.001);
  });
});
