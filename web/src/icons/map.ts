/**
 * Which icon stands for which piece of equipment.
 *
 * The mapping is a module of its own rather than a field on the process model
 * because the artwork and the physics have different owners and change at
 * different times. Swapping an icon should never mean editing a solver.
 *
 * ## Artwork that has not arrived yet
 *
 * Every stage type has an icon today. `PENDING_ICONS` stays because the set
 * will grow — new stage types, and the nineteen supplied icons with no stage
 * behind them yet — and a name with no artwork should render as an obvious
 * placeholder rather than as a silent gap or a crash. Naming a pending icon
 * here is what distinguishes "not drawn yet" from "typo in the mapping"; the
 * test in `education.test.ts` fails on the second and tolerates the first.
 */
import type { StageType } from '../types/project.js';
import { ICON_SOURCES } from './generated.js';

/** Stage type → icon file name (without extension). */
export const STAGE_ICONS: Readonly<Record<StageType, string>> = Object.freeze({
  source: 'outdoor-air',
  mixing: 'mixing-box',
  cooling: 'cooling-coil',
  heating: 'heating-coil',
  fan: 'fan',
  room: 'room-zone',
  'humidifier-steam': 'humidifier',
  'humidifier-adiabatic': 'adiabatic-humidifier',
  'recovery-wheel-sensible': 'sensible-wheel',
  'recovery-wheel-enthalpy': 'enthalpy-wheel',
  'recovery-plate': 'plate-hx',
  'recovery-runaround': 'runaround-coil',
  'recovery-wraparound-precool': 'wraparound-precool',
  'recovery-wraparound-reheat': 'wraparound-reheat',
  'evaporative-direct': 'wetted-media',
  'evaporative-indirect': 'indirect-evaporative',
  desiccant: 'desiccant-wheel',
} as Record<StageType, string>);

/**
 * Artwork that has been specified but not yet supplied.
 *
 * The description is the brief: it is what someone drawing the icon needs to
 * know, kept next to the name it has to be saved under.
 */
export const PENDING_ICONS: Readonly<Record<string, string>> = Object.freeze({
  // Empty: all seventeen stage types have artwork. An entry here is a brief —
  // the name the file must be saved under, and what it should show — for an
  // icon that has been specified but not yet drawn.
});

/** Is there real artwork for this name, or only a placeholder? */
export function iconExists(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_SOURCES, name);
}

export function iconForStage(type: StageType): string {
  return STAGE_ICONS[type];
}
