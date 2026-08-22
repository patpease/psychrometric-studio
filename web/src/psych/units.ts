/**
 * Unit systems.
 *
 * IP is primary. Calculations run *natively* in the selected system rather than
 * converting at the boundary — PsychroLib supports both directly, and native
 * evaluation avoids compounding rounding through conversion layers.
 *
 * Two traps are encoded here rather than left to callers:
 *
 *  1. PsychroLib SI enthalpy is **J/kg**, not kJ/kg. Everything is stored in the
 *     library's native unit and converted only for display.
 *  2. Humidity ratio is stored as lb/lb or kg/kg but conventionally *displayed*
 *     as gr/lb or g/kg. Store canonical, format at the edge — never the reverse.
 */

export type UnitSystem = 'IP' | 'SI';

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['IP', 'SI'] as const;

/** IP is the primary system. */
export const DEFAULT_UNITS: UnitSystem = 'IP';

/** Grains of water per pound. Exact by definition: 1 lb = 7000 gr. */
const GRAINS_PER_POUND = 7000;

export interface UnitLabels {
  temperature: string;
  humidityRatio: string;
  enthalpy: string;
  specificVolume: string;
  density: string;
  pressure: string;
  vapourPressure: string;
  airflow: string;
  massFlow: string;
  duty: string;
  altitude: string;
  relativeHumidity: string;
}

export const LABELS: Record<UnitSystem, UnitLabels> = {
  IP: {
    temperature: '°F',
    humidityRatio: 'gr/lb',
    enthalpy: 'Btu/lb',
    specificVolume: 'ft³/lb',
    density: 'lb/ft³',
    pressure: 'psia',
    vapourPressure: 'psia',
    airflow: 'CFM',
    massFlow: 'lb/h',
    duty: 'MBH',
    altitude: 'ft',
    relativeHumidity: '%',
  },
  SI: {
    temperature: '°C',
    humidityRatio: 'g/kg',
    enthalpy: 'kJ/kg',
    specificVolume: 'm³/kg',
    density: 'kg/m³',
    pressure: 'kPa',
    vapourPressure: 'Pa',
    airflow: 'L/s',
    massFlow: 'kg/s',
    duty: 'kW',
    altitude: 'm',
    relativeHumidity: '%',
  },
};

/* -------------------------------------------------------------------------- *
 * Display conversions — canonical (PsychroLib-native) → display
 * -------------------------------------------------------------------------- */

/** Humidity ratio: lb/lb → gr/lb, or kg/kg → g/kg. */
export function humidityRatioToDisplay(w: number, units: UnitSystem): number {
  return units === 'IP' ? w * GRAINS_PER_POUND : w * 1000;
}

/** Humidity ratio: gr/lb → lb/lb, or g/kg → kg/kg. */
export function humidityRatioFromDisplay(value: number, units: UnitSystem): number {
  return units === 'IP' ? value / GRAINS_PER_POUND : value / 1000;
}

/**
 * Enthalpy: Btu/lb → Btu/lb (IP, unchanged), or **J/kg → kJ/kg** (SI).
 * This is the single most commonly mishandled value in the library.
 */
export function enthalpyToDisplay(h: number, units: UnitSystem): number {
  return units === 'IP' ? h : h / 1000;
}

/** Enthalpy: display → canonical. Inverse of {@link enthalpyToDisplay}. */
export function enthalpyFromDisplay(value: number, units: UnitSystem): number {
  return units === 'IP' ? value : value * 1000;
}

/** Pressure: psia → psia (IP), or **Pa → kPa** (SI). */
export function pressureToDisplay(p: number, units: UnitSystem): number {
  return units === 'IP' ? p : p / 1000;
}

/** Pressure: display → canonical. Inverse of {@link pressureToDisplay}. */
export function pressureFromDisplay(value: number, units: UnitSystem): number {
  return units === 'IP' ? value : value * 1000;
}

/** Relative humidity: PsychroLib works in 0..1; the UI shows 0..100. */
export function relHumToDisplay(rh: number): number {
  return rh * 100;
}

/** Relative humidity: 0..100 → 0..1. */
export function relHumFromDisplay(value: number): number {
  return value / 100;
}

/* -------------------------------------------------------------------------- *
 * Flow and duty
 * -------------------------------------------------------------------------- */

/**
 * Dry-air mass flow from volumetric airflow and the specific volume of the
 * *entering* state.
 *
 *   IP: CFM × 60 ÷ (ft³/lb)   → lb/h
 *   SI: (L/s ÷ 1000) ÷ (m³/kg) → kg/s
 *
 * Note the asymmetry in time base: IP mass flow is per hour, SI per second.
 * That is conventional in each system and is preserved deliberately, because
 * every downstream formula and label assumes it.
 */
export function massFlow(airflow: number, specificVolume: number, units: UnitSystem): number {
  if (specificVolume <= 0) {
    throw new RangeError(`massFlow: specific volume must be positive, got ${specificVolume}`);
  }
  return units === 'IP' ? (airflow * 60) / specificVolume : airflow / 1000 / specificVolume;
}

/** Volumetric airflow from dry-air mass flow. Inverse of {@link massFlow}. */
export function airflow(massFlowRate: number, specificVolume: number, units: UnitSystem): number {
  return units === 'IP'
    ? (massFlowRate / 60) * specificVolume
    : massFlowRate * specificVolume * 1000;
}

/**
 * Duty from mass flow and an enthalpy difference, in display units.
 *
 *   IP: (lb/h) × (Btu/lb) = Btu/h → MBH   (÷1000)
 *   SI: (kg/s) × (J/kg)   = W     → kW    (÷1000)
 *
 * Both divide by 1000, but for different reasons. Sign convention: positive
 * into the airstream, so cooling is negative.
 */
export function duty(massFlowRate: number, deltaEnthalpy: number, _units: UnitSystem): number {
  return (massFlowRate * deltaEnthalpy) / 1000;
}

/** Enthalpy difference implied by a duty. Inverse of {@link duty}. */
export function deltaEnthalpyFromDuty(
  dutyValue: number,
  massFlowRate: number,
  _units: UnitSystem,
): number {
  if (massFlowRate === 0) {
    throw new RangeError('deltaEnthalpyFromDuty: mass flow must be non-zero');
  }
  return (dutyValue * 1000) / massFlowRate;
}

/* -------------------------------------------------------------------------- *
 * Temperature — used for chart tick generation and cross-system comparison,
 * not in the calculation path (PsychroLib works natively in each system).
 * -------------------------------------------------------------------------- */

export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/** A temperature *difference*, which scales without the 32° offset. */
export function deltaFahrenheitToCelsius(df: number): number {
  return (df * 5) / 9;
}

/** A temperature *difference*, which scales without the 32° offset. */
export function deltaCelsiusToFahrenheit(dc: number): number {
  return (dc * 9) / 5;
}

/* -------------------------------------------------------------------------- *
 * Sensible defaults per system
 * -------------------------------------------------------------------------- */

export interface SystemDefaults {
  /** Standard sea-level atmospheric pressure, canonical units. */
  standardPressure: number;
  /** Default chart dry-bulb range, canonical units. */
  tdbRange: readonly [number, number];
  /** Default chart humidity-ratio ceiling, canonical units (lb/lb | kg/kg). */
  maxHumidityRatio: number;
  /** Decimal places for display of each quantity. */
  precision: Record<keyof UnitLabels, number>;
}

export const DEFAULTS: Record<UnitSystem, SystemDefaults> = {
  IP: {
    standardPressure: 14.695948775, // psia
    tdbRange: [20, 120],
    maxHumidityRatio: 0.03,
    precision: {
      temperature: 1,
      humidityRatio: 1,
      enthalpy: 2,
      specificVolume: 3,
      density: 4,
      pressure: 3,
      vapourPressure: 4,
      airflow: 0,
      massFlow: 0,
      duty: 1,
      altitude: 0,
      relativeHumidity: 1,
    },
  },
  SI: {
    standardPressure: 101325, // Pa
    tdbRange: [-10, 50],
    maxHumidityRatio: 0.03,
    precision: {
      temperature: 1,
      humidityRatio: 2,
      enthalpy: 2,
      specificVolume: 4,
      density: 4,
      pressure: 3,
      vapourPressure: 1,
      airflow: 0,
      massFlow: 3,
      duty: 2,
      altitude: 0,
      relativeHumidity: 1,
    },
  },
};
