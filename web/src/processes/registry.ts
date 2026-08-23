/**
 * The process model registry.
 *
 * Stage types are declared in the project schema; this maps them to models.
 * Types belonging to later phases are deliberately absent — a stage the solver
 * does not recognise reports "no model for this type" against that stage rather
 * than failing the whole chain, so a project file written by a later build
 * still opens and shows everything it can.
 */
import type { StageType } from '../types/project.js';
import type { ProcessModel } from './types.js';

import { sourceModel } from './models/source.js';
import { mixingModel } from './models/mixing.js';
import { heatingModel } from './models/heating.js';
import { coolingModel } from './models/cooling.js';
import { fanModel } from './models/fan.js';
import { roomModel } from './models/room.js';
import { steamHumidifierModel } from './models/humidifierSteam.js';
import { adiabaticHumidifierModel } from './models/humidifierAdiabatic.js';
import {
  sensibleWheelModel,
  enthalpyWheelModel,
  plateExchangerModel,
  runAroundModel,
} from './models/recovery.js';
import { wraparoundPrecoolModel, wraparoundReheatModel } from './models/wraparound.js';
import { directEvaporativeModel, indirectEvaporativeModel } from './models/evaporative.js';
import { desiccantModel } from './models/desiccant.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyModel = ProcessModel<any>;

/** Models available in this build. Phase 4 completes the planned set. */
export const MODELS: Partial<Record<StageType, AnyModel>> = {
  source: sourceModel,
  mixing: mixingModel,
  heating: heatingModel,
  cooling: coolingModel,
  fan: fanModel,
  room: roomModel,
  'humidifier-steam': steamHumidifierModel,
  'humidifier-adiabatic': adiabaticHumidifierModel,
  'recovery-wheel-sensible': sensibleWheelModel,
  'recovery-wheel-enthalpy': enthalpyWheelModel,
  'recovery-plate': plateExchangerModel,
  'recovery-runaround': runAroundModel,
  'recovery-wraparound-precool': wraparoundPrecoolModel,
  'recovery-wraparound-reheat': wraparoundReheatModel,
  'evaporative-direct': directEvaporativeModel,
  'evaporative-indirect': indirectEvaporativeModel,
  desiccant: desiccantModel,
};

/** Stage types a user can add, in the order they appear in the picker. */
export const AVAILABLE_STAGE_TYPES: StageType[] = [
  'source',
  'mixing',
  'cooling',
  'heating',
  'humidifier-steam',
  'humidifier-adiabatic',
  'fan',
  'room',
  'recovery-wheel-sensible',
  'recovery-wheel-enthalpy',
  'recovery-plate',
  'recovery-runaround',
  'recovery-wraparound-precool',
  'recovery-wraparound-reheat',
  'evaporative-direct',
  'evaporative-indirect',
  'desiccant',
];

/** Equipment grouped for the picker, so seventeen types stay navigable. */
export const STAGE_GROUPS: { label: string; types: StageType[] }[] = [
  { label: 'Air', types: ['source', 'mixing', 'fan', 'room'] },
  { label: 'Coils', types: ['cooling', 'heating'] },
  { label: 'Humidification', types: ['humidifier-steam', 'humidifier-adiabatic'] },
  {
    label: 'Energy recovery',
    types: [
      'recovery-wheel-sensible',
      'recovery-wheel-enthalpy',
      'recovery-plate',
      'recovery-runaround',
      'recovery-wraparound-precool',
      'recovery-wraparound-reheat',
    ],
  },
  {
    label: 'Evaporative & desiccant',
    types: ['evaporative-direct', 'evaporative-indirect', 'desiccant'],
  },
];

export function modelFor(type: StageType): AnyModel | undefined {
  return MODELS[type];
}

export function displayNameFor(type: StageType): string {
  return MODELS[type]?.displayName ?? type;
}
