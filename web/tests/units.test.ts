/**
 * Unit handling — chiefly the two traps documented in `units.ts`:
 * SI enthalpy arriving as J/kg, and humidity ratio being stored canonically
 * but displayed in grains or grams.
 */
import { describe, it, expect } from 'vitest';
import {
  humidityRatioToDisplay,
  humidityRatioFromDisplay,
  enthalpyToDisplay,
  enthalpyFromDisplay,
  pressureToDisplay,
  pressureFromDisplay,
  relHumToDisplay,
  relHumFromDisplay,
  massFlow,
  airflow,
  duty,
  deltaEnthalpyFromDuty,
  fahrenheitToCelsius,
  celsiusToFahrenheit,
  deltaFahrenheitToCelsius,
  DEFAULTS,
  LABELS,
  type UnitSystem,
} from '../src/psych/units.js';
import { fromTdbRh } from '../src/psych/state.js';

describe('humidity ratio display conversion', () => {
  it('IP converts lb/lb to grains per pound', () => {
    expect(humidityRatioToDisplay(0.01, 'IP')).toBeCloseTo(70, 10);
  });

  it('SI converts kg/kg to grams per kilogram', () => {
    expect(humidityRatioToDisplay(0.01, 'SI')).toBeCloseTo(10, 10);
  });

  it.each(['IP', 'SI'] as UnitSystem[])('round-trips in %s', (units) => {
    const w = 0.0123456;
    expect(humidityRatioFromDisplay(humidityRatioToDisplay(w, units), units)).toBeCloseTo(w, 15);
  });
});

describe('enthalpy display conversion', () => {
  it('leaves IP enthalpy in Btu/lb', () => {
    expect(enthalpyToDisplay(28.5, 'IP')).toBe(28.5);
  });

  it('converts SI enthalpy from J/kg to kJ/kg', () => {
    expect(enthalpyToDisplay(50000, 'SI')).toBe(50);
  });

  it('keeps a real SI state in a sane display range', () => {
    // 24 °C / 50% RH is roughly 47 kJ/kg. If the J/kg trap were mishandled this
    // would read as 47,000 or 0.047 and the error would be obvious downstream —
    // which is exactly why it is asserted here.
    const state = fromTdbRh(24, 0.5, DEFAULTS.SI.standardPressure, 'SI');
    const display = enthalpyToDisplay(state.h, 'SI');
    expect(display).toBeGreaterThan(40);
    expect(display).toBeLessThan(55);
  });

  it.each(['IP', 'SI'] as UnitSystem[])('round-trips in %s', (units) => {
    const h = 42.5;
    expect(enthalpyFromDisplay(enthalpyToDisplay(h, units), units)).toBeCloseTo(h, 10);
  });
});

describe('pressure display conversion', () => {
  it('converts SI pressure from Pa to kPa', () => {
    expect(pressureToDisplay(101325, 'SI')).toBeCloseTo(101.325, 10);
  });

  it('leaves IP pressure in psia', () => {
    expect(pressureToDisplay(14.696, 'IP')).toBe(14.696);
  });

  it.each(['IP', 'SI'] as UnitSystem[])('round-trips in %s', (units) => {
    const p = DEFAULTS[units].standardPressure;
    expect(pressureFromDisplay(pressureToDisplay(p, units), units)).toBeCloseTo(p, 6);
  });
});

describe('relative humidity display', () => {
  it('scales 0..1 to 0..100', () => {
    expect(relHumToDisplay(0.55)).toBeCloseTo(55, 10);
    expect(relHumFromDisplay(55)).toBeCloseTo(0.55, 10);
  });
});

describe('mass flow and airflow', () => {
  it('IP: 1000 CFM at 13.5 ft³/lb gives about 4,444 lb/h', () => {
    expect(massFlow(1000, 13.5, 'IP')).toBeCloseTo((1000 * 60) / 13.5, 9);
  });

  it('SI: 500 L/s at 0.85 m³/kg gives about 0.588 kg/s', () => {
    expect(massFlow(500, 0.85, 'SI')).toBeCloseTo(0.5 / 0.85, 9);
  });

  it.each(['IP', 'SI'] as UnitSystem[])('airflow inverts mass flow in %s', (units) => {
    const v = units === 'IP' ? 13.5 : 0.85;
    const q = units === 'IP' ? 1000 : 500;
    expect(airflow(massFlow(q, v, units), v, units)).toBeCloseTo(q, 8);
  });

  it('rejects a non-positive specific volume', () => {
    expect(() => massFlow(1000, 0, 'IP')).toThrow(/must be positive/);
  });
});

describe('duty', () => {
  it('IP: lb/h × Btu/lb becomes MBH', () => {
    // 4,444 lb/h through a 10 Btu/lb rise = 44,440 Btu/h = 44.44 MBH
    expect(duty(4444, 10, 'IP')).toBeCloseTo(44.44, 6);
  });

  it('SI: kg/s × J/kg becomes kW', () => {
    // 0.588 kg/s through a 20,000 J/kg rise = 11,760 W = 11.76 kW
    expect(duty(0.588, 20000, 'SI')).toBeCloseTo(11.76, 6);
  });

  it('is negative for cooling, matching the sign convention', () => {
    expect(duty(4444, -10, 'IP')).toBeLessThan(0);
  });

  it.each(['IP', 'SI'] as UnitSystem[])('inverts to an enthalpy difference in %s', (units) => {
    const m = units === 'IP' ? 4444 : 0.588;
    const dh = units === 'IP' ? 10 : 20000;
    expect(deltaEnthalpyFromDuty(duty(m, dh, units), m, units)).toBeCloseTo(dh, 6);
  });

  it('refuses zero mass flow', () => {
    expect(() => deltaEnthalpyFromDuty(10, 0, 'IP')).toThrow(/non-zero/);
  });
});

describe('temperature conversion', () => {
  it('converts absolute temperatures with the offset', () => {
    expect(fahrenheitToCelsius(77)).toBeCloseTo(25, 12);
    expect(celsiusToFahrenheit(25)).toBeCloseTo(77, 12);
    expect(fahrenheitToCelsius(32)).toBeCloseTo(0, 12);
  });

  it('converts differences without the offset', () => {
    expect(deltaFahrenheitToCelsius(9)).toBeCloseTo(5, 12);
    // The distinction that catches people: 9 °F of *rise* is 5 °C of rise,
    // not −12.8 °C.
    expect(deltaFahrenheitToCelsius(9)).not.toBeCloseTo(fahrenheitToCelsius(9), 1);
  });
});

describe('system metadata', () => {
  it('labels every quantity in both systems', () => {
    const keys = Object.keys(LABELS.IP) as (keyof typeof LABELS.IP)[];
    for (const key of keys) {
      expect(LABELS.IP[key], `IP label for ${key}`).toBeTruthy();
      expect(LABELS.SI[key], `SI label for ${key}`).toBeTruthy();
    }
  });

  it('defines display precision for every labelled quantity', () => {
    for (const units of ['IP', 'SI'] as UnitSystem[]) {
      for (const key of Object.keys(LABELS[units]) as (keyof typeof LABELS.IP)[]) {
        expect(DEFAULTS[units].precision[key], `${units} precision for ${key}`).toBeTypeOf('number');
      }
    }
  });
});
