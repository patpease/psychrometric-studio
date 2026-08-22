/**
 * Site atmosphere and the hand-derived altitude inverse.
 */
import { describe, it, expect } from 'vitest';
import {
  pressureFromAltitude,
  altitudeFromPressure,
  standardAtmosphere,
  atmosphereFromAltitude,
  atmosphereFromPressure,
  describeBasis,
} from '../src/psych/atmosphere.js';
import { DEFAULTS, type UnitSystem } from '../src/psych/units.js';

describe.each(['IP', 'SI'] as UnitSystem[])('standard atmosphere — %s', (units) => {
  it('returns sea-level standard pressure at zero altitude', () => {
    expect(pressureFromAltitude(0, units)).toBeCloseTo(DEFAULTS[units].standardPressure, 3);
  });

  it('falls with altitude', () => {
    const high = units === 'IP' ? 5000 : 1500;
    expect(pressureFromAltitude(high, units)).toBeLessThan(pressureFromAltitude(0, units));
  });

  it('altitudeFromPressure inverts pressureFromAltitude', () => {
    const altitudes = units === 'IP' ? [0, 1000, 5280, 10000] : [0, 300, 1609, 3000];
    for (const altitude of altitudes) {
      const p = pressureFromAltitude(altitude, units);
      expect(altitudeFromPressure(p, units), `altitude ${altitude}`).toBeCloseTo(altitude, 0);
    }
  });
});

describe('atmosphere constructors carry their basis', () => {
  it('standard', () => {
    const a = standardAtmosphere('IP');
    expect(a.basis.kind).toBe('standard');
    expect(a.pressure).toBeCloseTo(DEFAULTS.IP.standardPressure, 9);
  });

  it('altitude', () => {
    const a = atmosphereFromAltitude(5280, 'IP');
    expect(a.basis.kind).toBe('altitude');
    expect(a.pressure).toBeLessThan(DEFAULTS.IP.standardPressure);
  });

  it('explicit', () => {
    const a = atmosphereFromPressure(12.1, 'IP');
    expect(a.basis.kind).toBe('explicit');
    expect(a.pressure).toBe(12.1);
  });

  it('refuses a non-positive explicit pressure', () => {
    expect(() => atmosphereFromPressure(0, 'IP')).toThrow(/must be positive/);
  });
});

describe('basis description for reports', () => {
  const format = (p: number): string => `${p.toFixed(3)} psia`;

  it('names the altitude a pressure came from', () => {
    const text = describeBasis(atmosphereFromAltitude(5280, 'IP'), format);
    expect(text).toContain('5280 ft');
    expect(text).toContain('standard atmosphere');
  });

  it('marks an entered pressure as entered', () => {
    expect(describeBasis(atmosphereFromPressure(12.1, 'IP'), format)).toContain('entered');
  });

  it('marks sea level', () => {
    expect(describeBasis(standardAtmosphere('IP'), format)).toContain('sea-level');
  });
});
