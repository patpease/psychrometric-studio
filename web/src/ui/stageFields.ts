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
import type { UnitSystem } from '../psych/units.js';
import { LABELS } from '../psych/units.js';

export type FieldKind = 'number' | 'percent' | 'boolean';

export interface ParamField {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** Which unit label to show, if any. */
  readonly unit?: 'temperature' | 'duty' | 'airflow' | 'massFlow' | 'humidityRatio' | 'enthalpy';
  readonly step?: number;
  readonly placeholder?: string;
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
      { key: 'tdb', label: 'Dry bulb', ...TEMPERATURE },
      { key: 'rh', label: 'Relative humidity', ...PERCENT },
      { key: 'twb', label: 'Wet bulb', ...TEMPERATURE },
      { key: 'tdp', label: 'Dew point', ...TEMPERATURE },
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
      { key: 'tdbOut', label: 'Leaving dry bulb', ...TEMPERATURE },
      { key: 'rhOut', label: 'Leaving RH', ...PERCENT },
      { key: 'power', label: 'Total capacity', ...DUTY },
      {
        key: 'shr',
        label: 'Coil SHR',
        kind: 'number',
        step: 0.05,
        placeholder: '0.85',
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
      { key: 'tdbOut', label: 'Leaving dry bulb', ...TEMPERATURE },
      { key: 'power', label: 'Capacity', ...DUTY },
    ],
  },

  'humidifier-steam': {
    summary:
      'Dry steam adds moisture with only a small sensible gain, so the process is ' +
      'a near-vertical climb — near-vertical, not vertical.',
    alternatives: 'Either a target relative humidity or a moisture rate.',
    fields: [
      { key: 'rhOut', label: 'Leaving RH', ...PERCENT },
      { key: 'moistureRate', label: 'Moisture rate', kind: 'number', unit: 'massFlow', step: 1 },
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
      { key: 'rhOut', label: 'Leaving RH', ...PERCENT },
    ],
  },

  fan: {
    summary:
      'Fan and motor losses enter the airstream as sensible heat. Typically 0.5–2°F, ' +
      'and routinely forgotten — after which the space runs warm at design load.',
    fields: [
      { key: 'power', label: 'Fan power', ...DUTY, step: 0.5 },
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
      { key: 'sensible', label: 'Sensible load', ...DUTY },
      { key: 'latent', label: 'Latent load', ...DUTY },
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
