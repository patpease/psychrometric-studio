/**
 * Converting a project between unit systems.
 *
 * Switching IP → SI changes what the labels say. Without this, it does **not**
 * change what the numbers mean: an entering condition of 95 °F stays as the
 * number 95 and is then read as 95 °C, which is off the chart entirely and
 * solves to nonsense. That was a real defect — the labels updated, the values
 * did not, and the chart went blank.
 *
 * Each field declares how it converts, in `stageFields.ts`, so this walks the
 * declaration rather than carrying a second list that could drift out of step.
 * A field with no declared conversion is dimensionless and passes through
 * untouched — relative humidity, sensible heat ratio, effectiveness.
 */
import type { Stage } from '../types/project.js';
import {
  convertAirflow,
  convertDuty,
  convertHumidityRatioDisplay,
  convertMoistureRate,
  convertPower,
  convertTemperature,
  convertTemperatureDelta,
  type UnitSystem,
} from '../psych/units.js';
import { STAGE_FIELDS, type ParamField } from './stageFields.js';

/** How a field converts, defaulting to whatever its display unit implies. */
function conversionFor(field: ParamField): NonNullable<ParamField['convert']> {
  if (field.convert) return field.convert;
  // A percentage is a fraction of something dimensionless; it never converts.
  if (field.kind === 'percent' || field.kind === 'boolean') return 'none';
  switch (field.unit) {
    case 'temperature':
      return 'temperature';
    case 'duty':
      return 'duty';
    case 'power':
      return 'power';
    case 'airflow':
      return 'airflow';
    case 'moistureRate':
      return 'moistureRate';
    case 'humidityRatio':
      return 'humidityRatio';
    default:
      return 'none';
  }
}

function convertValue(
  value: number,
  how: NonNullable<ParamField['convert']>,
  from: UnitSystem,
  to: UnitSystem,
): number {
  switch (how) {
    case 'temperature':
      return convertTemperature(value, from, to);
    case 'temperatureDelta':
      return convertTemperatureDelta(value, from, to);
    case 'duty':
      return convertDuty(value, from, to);
    case 'power':
      return convertPower(value, from, to);
    case 'airflow':
      return convertAirflow(value, from, to);
    case 'moistureRate':
      return convertMoistureRate(value, from, to);
    case 'humidityRatio':
      return convertHumidityRatioDisplay(value, from, to);
    case 'none':
      return value;
  }
}

/**
 * Round a converted value to a sensible number of digits.
 *
 * 95 °F is exactly 35 °C, but 72 °F is 22.22222222222222 °C, and an input box
 * full of noise invites the user to think the tool is confused. Rounded to a
 * precision finer than anyone designs to, and far coarser than the calculation
 * basis — so this changes nothing that matters and removes something that
 * looks wrong.
 */
function tidy(value: number): number {
  // Three decimals: fine enough that an IP → SI → IP round trip returns the
  // original to well within a design tolerance, coarse enough that the input
  // box does not fill with digits nobody typed.
  return Number(value.toFixed(3));
}

/** Convert every stage in an airstream from one unit system to another. */
export function convertStages(
  stages: readonly Stage[],
  from: UnitSystem,
  to: UnitSystem,
): Stage[] {
  if (from === to) return [...stages];

  return stages.map((stage) => {
    const next: Stage = { ...stage };

    // Airflow lives on the stage itself, not in its parameters.
    if (typeof stage.airflow === 'number' && Number.isFinite(stage.airflow)) {
      next.airflow = tidy(convertAirflow(stage.airflow, from, to));
    }

    const meta = STAGE_FIELDS[stage.type];
    if (!meta || !stage.params) return next;

    const params: Record<string, unknown> = { ...stage.params };
    for (const field of meta.fields) {
      const value = params[field.key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      params[field.key] = tidy(convertValue(value, conversionFor(field), from, to));
    }

    next.params = params;
    return next;
  });
}

/**
 * Comfort settings that carry units.
 *
 * Air speed is stored in m/s in both systems — ASHRAE 55 defines it that way —
 * so it is absent here. `mrtOffset` is a temperature **difference** and must
 * convert as one; the adaptive temperatures are absolute.
 */
export interface ConvertibleComfort {
  mrtOffset: number;
  adaptiveIndoor: number;
  adaptivePrevailing: number;
}

export function convertComfort<T extends ConvertibleComfort>(
  comfort: T,
  from: UnitSystem,
  to: UnitSystem,
): T {
  if (from === to) return comfort;
  return {
    ...comfort,
    mrtOffset: tidy(convertTemperatureDelta(comfort.mrtOffset, from, to)),
    adaptiveIndoor: tidy(convertTemperature(comfort.adaptiveIndoor, from, to)),
    adaptivePrevailing: tidy(convertTemperature(comfort.adaptivePrevailing, from, to)),
  };
}

/** Convert a site altitude, feet ↔ metres. */
export function convertAltitude(altitude: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return altitude;
  return tidy(from === 'IP' ? altitude * 0.3048 : altitude / 0.3048);
}
