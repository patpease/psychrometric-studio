/**
 * Display formatting.
 *
 * The single place where canonical values become strings. Every function here
 * pairs a conversion with a precision drawn from `DEFAULTS[units].precision`,
 * so a value can never be shown in the wrong unit or at a precision the
 * calculation basis cannot support.
 */
import {
  DEFAULTS,
  LABELS,
  enthalpyToDisplay,
  humidityRatioToDisplay,
  pressureToDisplay,
  relHumToDisplay,
  type UnitSystem,
} from '../psych/units.js';

function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function formatTemperature(tdb: number, units: UnitSystem, withUnit = false): string {
  const text = fixed(tdb, DEFAULTS[units].precision.temperature);
  return withUnit ? `${text} ${LABELS[units].temperature}` : text;
}

export function formatHumidityRatio(w: number, units: UnitSystem, withUnit = false): string {
  const text = fixed(humidityRatioToDisplay(w, units), DEFAULTS[units].precision.humidityRatio);
  return withUnit ? `${text} ${LABELS[units].humidityRatio}` : text;
}

export function formatEnthalpy(h: number, units: UnitSystem, withUnit = false): string {
  const text = fixed(enthalpyToDisplay(h, units), DEFAULTS[units].precision.enthalpy);
  return withUnit ? `${text} ${LABELS[units].enthalpy}` : text;
}

export function formatSpecificVolume(v: number, units: UnitSystem, withUnit = false): string {
  const text = fixed(v, DEFAULTS[units].precision.specificVolume);
  return withUnit ? `${text} ${LABELS[units].specificVolume}` : text;
}

export function formatDensity(rho: number, units: UnitSystem, withUnit = false): string {
  const text = fixed(rho, DEFAULTS[units].precision.density);
  return withUnit ? `${text} ${LABELS[units].density}` : text;
}

export function formatRelativeHumidity(rh: number, withUnit = false): string {
  const text = fixed(relHumToDisplay(rh), 1);
  return withUnit ? `${text} %` : text;
}

export function formatPressure(p: number, units: UnitSystem, withUnit = false): string {
  const text = fixed(pressureToDisplay(p, units), DEFAULTS[units].precision.pressure);
  return withUnit ? `${text} ${LABELS[units].pressure}` : text;
}

export function formatVapourPressure(p: number, units: UnitSystem, withUnit = false): string {
  const text = fixed(p, DEFAULTS[units].precision.vapourPressure);
  return withUnit ? `${text} ${LABELS[units].vapourPressure}` : text;
}

/**
 * Compact labels for chart lines, where space is tight and the unit is implied
 * by the family's legend entry.
 */
export const lineLabel = {
  wetBulb: (twb: number, units: UnitSystem): string => fixed(twb, units === 'IP' ? 0 : 0),
  dewPoint: (tdp: number, units: UnitSystem): string => fixed(tdp, units === 'IP' ? 0 : 0),
  enthalpy: (h: number, units: UnitSystem): string =>
    fixed(enthalpyToDisplay(h, units), units === 'IP' ? 0 : 0),
  specificVolume: (v: number, units: UnitSystem): string => fixed(v, units === 'IP' ? 1 : 2),
};
