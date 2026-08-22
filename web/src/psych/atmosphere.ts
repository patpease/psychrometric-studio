/**
 * Site atmosphere.
 *
 * Barometric pressure is the third independent variable of every state. It is
 * derived from site altitude by the standard atmosphere, or entered directly,
 * and is stamped on every export — a psychrometric result without its pressure
 * is not reproducible.
 */
import { lib, type PsychroLib } from './psychrolib.js';
import type { UnitSystem } from './units.js';
import { DEFAULTS } from './units.js';

/** How the site pressure was arrived at. Carried into reports. */
export type PressureBasis =
  | { kind: 'standard'; units: UnitSystem }
  | { kind: 'altitude'; altitude: number; units: UnitSystem }
  | { kind: 'explicit'; units: UnitSystem };

export interface Atmosphere {
  /** Barometric pressure in canonical units: psia (IP) | Pa (SI). */
  readonly pressure: number;
  readonly basis: PressureBasis;
  readonly units: UnitSystem;
}

/**
 * Standard-atmosphere pressure at altitude.
 * Altitude is in ft (IP) or m (SI); result is psia (IP) or Pa (SI).
 */
export function pressureFromAltitude(altitude: number, units: UnitSystem): number {
  return lib(units).GetStandardAtmPressure(altitude);
}

/** Standard-atmosphere temperature at altitude, °F (IP) | °C (SI). */
export function temperatureFromAltitude(altitude: number, units: UnitSystem): number {
  return lib(units).GetStandardAtmTemperature(altitude);
}

/** Sea-level standard atmosphere. */
export function standardAtmosphere(units: UnitSystem): Atmosphere {
  return {
    pressure: DEFAULTS[units].standardPressure,
    basis: { kind: 'standard', units },
    units,
  };
}

/** Atmosphere derived from site altitude. */
export function atmosphereFromAltitude(altitude: number, units: UnitSystem): Atmosphere {
  return {
    pressure: pressureFromAltitude(altitude, units),
    basis: { kind: 'altitude', altitude, units },
    units,
  };
}

/**
 * Atmosphere from a directly entered barometric pressure, in canonical units
 * (psia | Pa). Use `pressureFromDisplay` first if the value came from a UI
 * field showing kPa.
 */
export function atmosphereFromPressure(pressure: number, units: UnitSystem): Atmosphere {
  if (!(pressure > 0)) {
    throw new RangeError(`atmosphereFromPressure: pressure must be positive, got ${pressure}`);
  }
  return { pressure, basis: { kind: 'explicit', units }, units };
}

/**
 * Altitude implied by a barometric pressure — the inverse of the standard
 * atmosphere. PsychroLib provides no inverse, so this solves the standard
 * relation directly.
 *
 *   p = p₀ (1 − 2.25577e-5 · z)^5.2559   [SI, z in m, p in Pa]
 *
 * Used to label a chart drawn from an entered pressure with its equivalent
 * elevation, which is how most engineers hold the number in their head.
 */
export function altitudeFromPressure(pressure: number, units: UnitSystem): number {
  const p0 = DEFAULTS[units].standardPressure;
  const ratio = Math.pow(pressure / p0, 1 / 5.2559);
  const altitudeMetres = (1 - ratio) / 2.25577e-5;
  return units === 'SI' ? altitudeMetres : altitudeMetres / 0.3048;
}

/** A one-line description of the pressure basis, for report footers. */
export function describeBasis(atmosphere: Atmosphere, formatPressure: (p: number) => string): string {
  const { basis, pressure } = atmosphere;
  switch (basis.kind) {
    case 'standard':
      return `${formatPressure(pressure)} (sea-level standard atmosphere)`;
    case 'altitude':
      return `${formatPressure(pressure)} (standard atmosphere at ${basis.altitude.toFixed(0)} ${
        basis.units === 'IP' ? 'ft' : 'm'
      })`;
    case 'explicit':
      return `${formatPressure(pressure)} (entered)`;
  }
}

export type { PsychroLib };
