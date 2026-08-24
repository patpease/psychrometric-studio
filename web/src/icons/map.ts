/**
 * Which icon stands for which piece of equipment.
 *
 * The mapping is a module of its own rather than a field on the process model
 * because the artwork and the physics have different owners and change at
 * different times. Swapping an icon should never mean editing a solver.
 *
 * ## Icons still to be drawn
 *
 * Six of the seventeen stage types have no artwork in the supplied set. They
 * are named here anyway, with the file name they will have, and `PENDING_ICONS`
 * records why. A pending icon renders as a neutral placeholder — deliberately
 * plain, so a missing icon looks missing rather than looking like a decision.
 * Dropping the SVG into `src/icons/svg/` and re-running `npm run build:icons`
 * is the whole of the work; nothing else needs to change.
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
  'outdoor-air':
    'The entering air condition — outdoor, return, or any measured state. ' +
    'Distinct from state-point, which marks a point on the chart rather than a ' +
    'source of air.',
  'room-zone':
    'The conditioned space itself: the load the system exists to meet. A room ' +
    'outline with supply and return, rather than a thermostat.',
  'sensible-wheel':
    'A rotary wheel transferring heat only, to sit beside enthalpy-wheel and ' +
    'read as visibly different from it — no moisture crossing.',
  'wraparound-precool':
    'The upstream leg of a wrap-around heat-pipe circuit, cooling air before ' +
    'the coil. Should pair visually with wraparound-reheat.',
  'wraparound-reheat':
    'The downstream leg of the same circuit, returning that heat after the ' +
    'coil. The mirror of wraparound-precool.',
  'indirect-evaporative':
    'Evaporative cooling on a secondary airstream, transferred through a ' +
    'surface — the primary air is cooled without being wetted.',
});

/** Is there real artwork for this name, or only a placeholder? */
export function iconExists(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_SOURCES, name);
}

export function iconForStage(type: StageType): string {
  return STAGE_ICONS[type];
}
