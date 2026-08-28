/**
 * The chains a new project opens with.
 *
 * Separate from the component because they are data, and because a test has to
 * be able to solve them without mounting an interface. Both close their own
 * loop — the air leaves the room at exactly the condition the mixing box
 * declares for return air — and `tests/starter.test.ts` fails if either stops
 * doing so. An opening example that does not close teaches the wrong thing on
 * first contact, and these are the first psychrometrics most users will read.
 */
import type { Stage } from '../types/project.js';

/**
 * Summer design: outdoor and return air mixed, a coil, fan heat, a space load.
 *
 * 500 CFM of outdoor air and 1,500 of return, through a 54 °F coil, land the
 * zone back at 75.7 °F and 49.7% RH — the condition the return air was declared
 * at. This is also the system the walkthrough builds, step by step.
 */
export const STARTER_COOLING: Stage[] = [
  { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 500, params: { tdb: 95, rh: 0.4 } },
  {
    id: 'mx',
    type: 'mixing',
    name: 'Mixing box',
    params: { airflow2: 1500, tdb2: 75, rh2: 0.5 },
  },
  { id: 'cc', type: 'cooling', name: 'Cooling coil', params: { tdbOut: 54, rhOut: 0.93 } },
  { id: 'sf', type: 'fan', name: 'Supply fan', params: { power: 1.5, motorInAirstream: true } },
  { id: 'rm', type: 'room', name: 'Zone', params: { sensible: 42, latent: 11 } },
];

/**
 * Winter design, on the same air handler.
 *
 * The same machine and the same occupancy as the cooling case — only the
 * weather and the coil change. There is no humidifier, because most buildings
 * do not have one, and the chart is more useful for showing what that means:
 * outdoor air at 5 °F carries almost no moisture, so the space is left to find
 * its own humidity on the moisture its occupants give off. It settles near
 * 29% RH, which is the winter dryness people actually complain about.
 *
 * The room's sensible load is negative because in winter the space *loses*
 * heat and the supply air is what makes it up. The loads are derived rather
 * than chosen: they are whatever returns the air to the condition the mixing
 * box declares. See `tests/starter.test.ts`.
 */
export const STARTER_HEATING: Stage[] = [
  { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 500, params: { tdb: 5, rh: 0.6 } },
  {
    id: 'mx',
    type: 'mixing',
    name: 'Mixing box',
    params: { airflow2: 1500, tdb2: 70, rh2: 0.294 },
  },
  { id: 'hc', type: 'heating', name: 'Heating coil', params: { tdbOut: 92 } },
  { id: 'sf', type: 'fan', name: 'Supply fan', params: { power: 1.5, motorInAirstream: true } },
  { id: 'rm', type: 'room', name: 'Zone', params: { sensible: -53, latent: 11 } },
];
