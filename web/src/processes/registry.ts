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

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyModel = ProcessModel<any>;

/** Models available in this build. Phase 2 ships the core set. */
export const MODELS: Partial<Record<StageType, AnyModel>> = {
  source: sourceModel,
  mixing: mixingModel,
  heating: heatingModel,
  cooling: coolingModel,
  fan: fanModel,
  room: roomModel,
  'humidifier-steam': steamHumidifierModel,
  'humidifier-adiabatic': adiabaticHumidifierModel,
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
];

export function modelFor(type: StageType): AnyModel | undefined {
  return MODELS[type];
}

export function displayNameFor(type: StageType): string {
  return MODELS[type]?.displayName ?? type;
}
