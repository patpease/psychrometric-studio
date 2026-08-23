/**
 * Editable parameters per stage type.
 *
 * This lives in the UI layer rather than on the process models so that the
 * models stay pure calculation, with no opinion about labels, units, or widget
 * kinds. The models already validate and produce messages that name the missing
 * field, so the editor can render every field as optional and let the solver
 * explain what a given stage still needs.
 */
import type { StageType } from '../types/project.js';
import type { StageResult } from '../processes/types.js';
import type { UnitSystem } from '../psych/units.js';
import { LABELS } from '../psych/units.js';

export type FieldKind = 'number' | 'percent' | 'boolean';

export interface ParamField {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** Which unit label to show, if any. */
  readonly unit?:
    | 'temperature'
    | 'duty'
    | 'power'
    | 'airflow'
    | 'moistureRate'
    | 'humidityRatio'
    | 'enthalpy';
  /**
   * How this value converts when the user switches unit systems.
   *
   * Defaults to the field's `unit`. Dimensionless fields (SHR, effectiveness,
   * relative humidity) declare `'none'` and are carried across unchanged.
   */
  readonly convert?: 'temperature' | 'temperatureDelta' | 'duty' | 'power' | 'airflow' | 'moistureRate' | 'none';
  readonly step?: number;
  readonly placeholder?: string;
  /**
   * What this field works out to when the user specified the *other* way of
   * defining the stage.
   *
   * Most stages can be defined by a leaving condition or by a capacity. Once
   * one is given, the other is determined — and showing it is the difference
   * between a form and a calculator. It is surfaced as a **placeholder**, so an
   * empty field still reads as "not specified" while telling you the answer.
   *
   * Percent fields return the stored fraction; the formatter scales it.
   */
  readonly derive?: (result: StageResult) => number | undefined;
  /** Shown under the field. Keep to one short sentence. */
  readonly help?: string;
}

export interface StageFields {
  /** One line describing what the stage does, shown when it is selected. */
  readonly summary: string;
  /** How to define the stage, when there is more than one way. */
  readonly alternatives?: string;
  readonly fields: readonly ParamField[];
}

const TEMPERATURE = { kind: 'number', unit: 'temperature', step: 1 } as const;
const DUTY = { kind: 'number', unit: 'duty', step: 1 } as const;
const PERCENT = { kind: 'percent', step: 1 } as const;

export const STAGE_FIELDS: Partial<Record<StageType, StageFields>> = {
  source: {
    summary:
      'The starting point of the airstream. Everything downstream is solved from ' +
      'here, so the quality of this input sets the quality of the whole analysis.',
    alternatives: 'Give dry bulb plus any one of the other properties.',
    fields: [
      { key: 'tdb', label: 'Dry bulb', ...TEMPERATURE, derive: (r) => r.state.tdb },
      { key: 'rh', label: 'Relative humidity', ...PERCENT, derive: (r) => r.state.rh },
      { key: 'twb', label: 'Wet bulb', ...TEMPERATURE, derive: (r) => r.state.twb },
      { key: 'tdp', label: 'Dew point', ...TEMPERATURE, derive: (r) => r.state.tdp },
    ],
  },

  mixing: {
    summary:
      'Two airstreams combine with no heat added or removed. The mixed state ' +
      'always lies on the straight line between them, positioned by mass fraction.',
    fields: [
      { key: 'airflow2', label: 'Second airflow', kind: 'number', unit: 'airflow', step: 50 },
      { key: 'tdb2', label: 'Second dry bulb', ...TEMPERATURE },
      { key: 'rh2', label: 'Second RH', ...PERCENT },
    ],
  },

  cooling: {
    summary:
      'Air passes over a coil below its dew point, so moisture condenses as the ' +
      'air cools.',
    alternatives:
      'Either leaving conditions, or a capacity with a sensible heat ratio — not both.',
    fields: [
      { key: 'tdbOut', label: 'Leaving dry bulb', ...TEMPERATURE, derive: (r) => r.state.tdb },
      { key: 'rhOut', label: 'Leaving RH', ...PERCENT, derive: (r) => r.state.rh },
      {
        key: 'power',
        label: 'Total capacity',
        ...DUTY,
        derive: (r) => Math.abs(r.duty.total),
      },
      {
        key: 'shr',
        label: 'Coil SHR',
        kind: 'number',
        step: 0.05,
        derive: (r) => (Number.isFinite(r.duty.shr) ? r.duty.shr : undefined),
        help: 'Fraction of the total capacity that is sensible.',
      },
    ],
  },

  heating: {
    summary:
      'A horizontal move to the right at constant humidity ratio. No moisture is ' +
      'exchanged, so relative humidity falls as the air warms.',
    alternatives: 'Either a leaving temperature or a capacity.',
    fields: [
      { key: 'tdbOut', label: 'Leaving dry bulb', ...TEMPERATURE, derive: (r) => r.state.tdb },
      { key: 'power', label: 'Capacity', ...DUTY, derive: (r) => r.duty.total },
    ],
  },

  'humidifier-steam': {
    summary:
      'Dry steam adds moisture with only a small sensible gain, so the process is ' +
      'a near-vertical climb — near-vertical, not vertical.',
    alternatives: 'Either a target relative humidity or a moisture rate.',
    fields: [
      { key: 'rhOut', label: 'Leaving RH', ...PERCENT, derive: (r) => r.state.rh },
      {
        key: 'moistureRate',
        label: 'Moisture rate',
        kind: 'number',
        unit: 'moistureRate',
        step: 1,
        derive: (r) => r.moistureRate,
      },
    ],
  },

  'humidifier-adiabatic': {
    summary:
      'Water evaporates using heat from the air itself, so the state slides down ' +
      'the constant wet-bulb line toward saturation.',
    alternatives: 'Either an effectiveness or a target relative humidity.',
    fields: [
      {
        key: 'effectiveness',
        label: 'Effectiveness',
        ...PERCENT,
        help: 'Fraction of the wet-bulb depression achieved. Never above 100%.',
      },
      { key: 'rhOut', label: 'Leaving RH', ...PERCENT, derive: (r) => r.state.rh },
    ],
  },

  fan: {
    summary:
      'Fan and motor losses enter the airstream as sensible heat. Typically 0.5–2°F, ' +
      'and routinely forgotten — after which the space runs warm at design load.',
    fields: [
      {
        key: 'power',
        label: 'Fan power',
        kind: 'number',
        unit: 'power',
        step: 0.25,
        help: 'Shaft power. The heat added to the air is calculated from it.',
      },
      {
        key: 'motorInAirstream',
        label: 'Motor in airstream',
        kind: 'boolean',
        help: 'Draw-through or blow-through changes where the gain lands.',
      },
    ],
  },

  room: {
    summary:
      'Supply air absorbs the space gains. The slope of this line is the room ' +
      'sensible heat ratio, fixed by the loads rather than chosen.',
    fields: [
      { key: 'sensible', label: 'Sensible load', ...DUTY, derive: (r) => r.duty.sensible },
      { key: 'latent', label: 'Latent load', ...DUTY, derive: (r) => r.duty.latent },
    ],
  },
};

/** The unit label for a field, or an empty string when it is dimensionless. */
export function unitLabelFor(field: ParamField, units: UnitSystem): string {
  if (field.kind === 'percent') return '%';
  if (!field.unit) return '';
  return LABELS[units][field.unit];
}

/**
 * Convert a stored parameter into what the input shows.
 *
 * Only percentages differ: relative humidity and effectiveness are stored as
 * fractions and edited as percentages, for the same reason they are displayed
 * that way everywhere else.
 */
export function toFieldValue(raw: unknown, field: ParamField): string {
  if (field.kind === 'boolean') return raw === true ? 'true' : 'false';
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return '';
  return field.kind === 'percent' ? String(Number((raw * 100).toFixed(4))) : String(raw);
}

/** Convert an edited value back to storage. Empty clears the parameter. */
export function fromFieldValue(text: string, field: ParamField): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return undefined;
  return field.kind === 'percent' ? value / 100 : value;
}


/**
 * Format a derived value for use as a field placeholder.
 *
 * Deliberately terse: it sits inside an input box, where a long string would be
 * clipped. Percent fields are scaled here to match how they are edited.
 */
export function formatDerived(value: number, field: ParamField): string {
  const shown = field.kind === 'percent' ? value * 100 : value;
  if (!Number.isFinite(shown)) return '—';
  const magnitude = Math.abs(shown);
  const digits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  return shown.toFixed(digits);
}
