/**
 * Round-trip validation of every hand-derived inverse.
 *
 * The plan singles this out as the highest-risk arithmetic in the project: an
 * error here would not throw, it would bend the chart's gridlines by a fraction
 * of a percent and be invisible until someone checked a number by hand. So the
 * inverses are exercised across the whole plotted domain, in both unit systems,
 * at sea level and at altitude.
 *
 * @see PLAN.md §4.3, §10 item 4
 */
import { describe, it, expect } from 'vitest';
import {
  humidityRatioFromVolume,
  humidityRatioFromEnthalpy,
  tdbFromVolume,
  MOLAR_MASS_RATIO,
} from '../src/psych/inverse.js';
import { lib, MIN_HUM_RATIO } from '../src/psych/psychrolib.js';
import { saturationHumidityRatio } from '../src/psych/state.js';
import { DEFAULTS, type UnitSystem } from '../src/psych/units.js';
import { pressureFromAltitude } from '../src/psych/atmosphere.js';

/** Sea level and a high-altitude case, in each system's own units. */
const PRESSURES: Record<UnitSystem, { label: string; pressure: number }[]> = {
  IP: [
    { label: 'sea level', pressure: DEFAULTS.IP.standardPressure },
    { label: '5,280 ft', pressure: pressureFromAltitude(5280, 'IP') },
    { label: '10,000 ft', pressure: pressureFromAltitude(10000, 'IP') },
  ],
  SI: [
    { label: 'sea level', pressure: DEFAULTS.SI.standardPressure },
    { label: '1,600 m', pressure: pressureFromAltitude(1600, 'SI') },
    { label: '3,000 m', pressure: pressureFromAltitude(3000, 'SI') },
  ],
};

/** A sweep of dry-bulb temperatures spanning the plotted domain. */
function temperatures(units: UnitSystem): number[] {
  const [min, max] = DEFAULTS[units].tdbRange;
  const out: number[] = [];
  for (let i = 0; i <= 20; i += 1) out.push(min + ((max - min) * i) / 20);
  return out;
}

describe.each(['IP', 'SI'] as UnitSystem[])('specific-volume inverse — %s', (units) => {
  const psy = lib(units);

  it('agrees with the molar mass ratio PsychroLib actually uses', () => {
    // v(W) = v_dry (1 + k W). Recover k from the library itself: with W = 1,
    // v/v_dry - 1 = k. If the vendored source ever changed this constant, the
    // inverse would drift silently — so it is measured, not assumed.
    const tdb = units === 'IP' ? 70 : 20;
    const pressure = DEFAULTS[units].standardPressure;
    const vDry = psy.GetDryAirVolume(tdb, pressure);
    const vAtUnitW = psy.GetMoistAirVolume(tdb, 1, pressure);
    const implied = vAtUnitW / vDry - 1;

    expect(implied).toBeCloseTo(MOLAR_MASS_RATIO, 9);
  });

  describe.each(PRESSURES[units])('at $label', ({ pressure }) => {
    it('round-trips W → v → W to 1e-9 across the domain', () => {
      for (const tdb of temperatures(units)) {
        const wSat = saturationHumidityRatio(tdb, pressure, units);
        // Sweep from just above PsychroLib's floor up to saturation. Starting
        // at exactly zero would test the library's MIN_HUM_RATIO clamp, not
        // this inverse — that behaviour is asserted separately below.
        for (let f = 0.01; f <= 1; f += 0.1) {
          const w = wSat * f;
          const v = psy.GetMoistAirVolume(tdb, w, pressure);
          const recovered = humidityRatioFromVolume(v, tdb, pressure, units);

          expect(
            Math.abs(recovered - w),
            `tdb=${tdb}, w=${w}, v=${v} → recovered ${recovered}`,
          ).toBeLessThan(1e-9);
        }
      }
    });

    it('round-trips v → W → v to relative 1e-12', () => {
      for (const tdb of temperatures(units)) {
        const wSat = saturationHumidityRatio(tdb, pressure, units);
        const v = psy.GetMoistAirVolume(tdb, wSat / 2, pressure);
        const w = humidityRatioFromVolume(v, tdb, pressure, units);
        const back = psy.GetMoistAirVolume(tdb, w, pressure);

        expect(Math.abs((back - v) / v), `tdb=${tdb}`).toBeLessThan(1e-12);
      }
    });

    it('returns zero humidity ratio at exactly the dry-air volume', () => {
      for (const tdb of temperatures(units)) {
        const vDry = psy.GetDryAirVolume(tdb, pressure);
        expect(Math.abs(humidityRatioFromVolume(vDry, tdb, pressure, units))).toBeLessThan(1e-12);
      }
    });

    it('recovers the library floor, not zero, for nominally dry air', () => {
      // GetMoistAirVolume clamps W to MIN_HUM_RATIO, so v(0) is really v(1e-7)
      // and the inverse correctly returns 1e-7. Documented rather than hidden:
      // a round trip through bone-dry air is not bit-exact, by design upstream.
      for (const tdb of temperatures(units)) {
        const v = psy.GetMoistAirVolume(tdb, 0, pressure);
        const recovered = humidityRatioFromVolume(v, tdb, pressure, units);
        expect(recovered, `tdb=${tdb}`).toBeCloseTo(MIN_HUM_RATIO, 12);
      }
    });

    it('reports a negative humidity ratio below the dry-air volume, rather than clipping', () => {
      // The chart needs to know the line has left the physical domain; silently
      // clamping to zero would draw a gridline where none exists.
      const tdb = units === 'IP' ? 70 : 20;
      const vDry = psy.GetDryAirVolume(tdb, pressure);
      expect(humidityRatioFromVolume(vDry * 0.99, tdb, pressure, units)).toBeLessThan(0);
    });

    it('inverts for temperature consistently with PsychroLib', () => {
      for (const tdb of temperatures(units)) {
        const w = saturationHumidityRatio(tdb, pressure, units) / 2;
        const v = psy.GetMoistAirVolume(tdb, w, pressure);
        expect(tdbFromVolume(v, w, pressure, units), `tdb=${tdb}`).toBeCloseTo(tdb, 8);
      }
    });
  });
});

describe.each(['IP', 'SI'] as UnitSystem[])('enthalpy inverse — %s', (units) => {
  const psy = lib(units);

  it('round-trips W → h → W to 1e-12 across the domain', () => {
    const pressure = DEFAULTS[units].standardPressure;
    for (const tdb of temperatures(units)) {
      const wSat = saturationHumidityRatio(tdb, pressure, units);
      for (let f = 0.05; f <= 1; f += 0.1) {
        const w = wSat * f;
        const h = psy.GetMoistAirEnthalpy(tdb, w);
        const recovered = humidityRatioFromEnthalpy(h, tdb, units);

        expect(Math.abs(recovered - w), `tdb=${tdb}, w=${w}`).toBeLessThan(1e-12);
      }
    }
  });
});
