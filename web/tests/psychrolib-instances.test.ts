/**
 * The dual-instance guarantee.
 *
 * PsychroLib's unit system is module-global mutable state. This suite exists to
 * prove that the two pinned instances in `psych/psychrolib.ts` cannot interfere
 * with one another — if this ever regresses, every number in the application
 * becomes silently dependent on call order.
 *
 * @see docs/adr/0002-dual-instance-unit-systems.md
 */
import { describe, it, expect } from 'vitest';
import { psyIP, psySI, lib, CALCULATION_BASIS } from '../src/psych/psychrolib.js';

describe('pinned PsychroLib instances', () => {
  it('are distinct objects', () => {
    expect(psyIP).not.toBe(psySI);
  });

  it('report the unit system they were pinned to', () => {
    expect(psyIP.isIP()).toBe(true);
    expect(psySI.isIP()).toBe(false);
  });

  it('are selected correctly by lib()', () => {
    expect(lib('IP')).toBe(psyIP);
    expect(lib('SI')).toBe(psySI);
  });

  it('do not disturb each other under interleaved calls', () => {
    const ipBefore = psyIP.GetSatHumRatio(75, 14.696);
    const siBefore = psySI.GetSatHumRatio(25, 101325);

    // Interleave aggressively: if unit state were shared, these would corrupt
    // one another and the "after" values would differ from the "before" ones.
    for (let i = 0; i < 50; i += 1) {
      psyIP.GetSatHumRatio(60 + i, 14.696);
      psySI.GetSatHumRatio(10 + i * 0.5, 101325);
      psyIP.GetMoistAirEnthalpy(75, 0.01);
      psySI.GetMoistAirEnthalpy(25, 0.01);
    }

    expect(psyIP.GetSatHumRatio(75, 14.696)).toBe(ipBefore);
    expect(psySI.GetSatHumRatio(25, 101325)).toBe(siBefore);
  });

  it('produce physically consistent results across systems for the same state', () => {
    // 77 °F is exactly 25 °C; 14.696 psia is 101325 Pa to within rounding.
    const wIP = psyIP.GetSatHumRatio(77, 14.696);
    const wSI = psySI.GetSatHumRatio(25, 101325);

    // Humidity ratio is dimensionless, so the two must agree closely.
    expect(Math.abs(wIP - wSI) / wSI).toBeLessThan(1e-4);
  });

  it('expose a calculation basis for export stamping', () => {
    expect(CALCULATION_BASIS.library).toBe('PsychroLib');
    expect(CALCULATION_BASIS.version).toBe('2.5.0');
    expect(CALCULATION_BASIS.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
