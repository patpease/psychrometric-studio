/**
 * Live evaluation of the design checks.
 *
 * Every rule here answers one question: *would a reviewer stop at this stage
 * and ask about it?* Not "is this wrong" — the tool cannot know that. The
 * wording of every message is chosen to be a question rather than a verdict,
 * because a rule that says "incorrect" about a design it does not understand
 * costs more trust than it earns.
 *
 * Three properties every rule must have, and which the tests enforce:
 *
 * 1. **It never fires on the tool's own default system.** A tool that opens
 *    showing warnings has taught the user to ignore warnings by the second
 *    minute.
 * 2. **Its thresholds are unit-aware.** A 3 K limit is 5.4 °F, and a rule that
 *    compares a Fahrenheit delta against 3 is wrong in one system out of two.
 * 3. **It returns `null` rather than guessing** when the stage did not solve or
 *    the property it needs is absent.
 */
import type { MoistAirState } from '../psych/state.js';
import type { UnitSystem } from '../psych/units.js';
import { deltaCelsiusToFahrenheit } from '../psych/units.js';
import type { CheckContext, CheckRule, MoveProperty, ObservedMove } from './types.js';

/** A temperature difference expressed in kelvin, in the display system. */
export function kelvinAs(delta: number, units: UnitSystem): number {
  return units === 'IP' ? deltaCelsiusToFahrenheit(delta) : delta;
}

/**
 * How small a change counts as "no change".
 *
 * Humidity ratio is the one that matters: a heating coil or a fan must not
 * move it at all, but the state solver round-trips through wet bulb and
 * carries a convergence tolerance of its own. The floor below is an order of
 * magnitude above that noise and two orders below any real moisture transfer,
 * so it separates the two cleanly without pretending to an exactness the
 * calculation basis does not have.
 */
const CONSTANT_W = 1e-6;

function fmtPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/* -------------------------------------------------------------------------- *
 * Observed movement
 * -------------------------------------------------------------------------- */

/**
 * The properties reported as "what changed".
 *
 * Typed as the subset that a `MoistAirState` actually carries — `slope` is a
 * `MoveProperty` a room's load line can declare, but it is a property of the
 * process, not of either end state, so it cannot be observed by comparing two
 * states and is excluded here rather than being read as `undefined`.
 */
type StateProperty = Extract<MoveProperty, 'tdb' | 'w' | 'h' | 'rh' | 'twb' | 'tdp' | 'v'>;

const OBSERVED: readonly StateProperty[] = ['tdb', 'w', 'h', 'rh', 'twb', 'tdp', 'v'];

/** The threshold below which each property is reported as unchanged. */
function noiseFloor(property: StateProperty, units: UnitSystem): number {
  switch (property) {
    case 'w':
      return CONSTANT_W;
    case 'rh':
      return 0.002;
    case 'h':
      return units === 'IP' ? 0.01 : 20; // Btu/lb | J/kg
    case 'v':
      return 0.001;
    default:
      return kelvinAs(0.05, units);
  }
}

/**
 * What each property actually did between two states.
 *
 * This is the promised upgrade of `moves` from documentation into behaviour:
 * the panel can show the declared direction beside the measured one, and a
 * disagreement — a "constant W" heating coil whose W moved — becomes visible
 * without anyone having to look for it.
 */
export function observedMoves(
  entering: MoistAirState | null,
  leaving: MoistAirState,
  units: UnitSystem,
): ObservedMove[] {
  if (!entering) return [];

  return OBSERVED.map((property) => {
    const from = entering[property];
    const to = leaving[property];
    const delta = to - from;
    const floor = noiseFloor(property, units);
    const direction: ObservedMove['direction'] =
      Math.abs(delta) <= floor ? 'constant' : delta > 0 ? 'up' : 'down';
    return { property, direction, from, to, delta };
  });
}

/* -------------------------------------------------------------------------- *
 * The rules
 * -------------------------------------------------------------------------- */

/**
 * Humidity ratio must not change across a purely sensible device.
 *
 * Shared by the heating coil and the fan, which are the two places a modelling
 * slip most often shows up as moisture appearing from nowhere.
 */
function sensibleOnly(deviceName: string): CheckRule {
  return ({ entering, result }: CheckContext): string | null => {
    if (!entering) return null;
    const change = result.state.w - entering.w;
    if (Math.abs(change) <= CONSTANT_W) return null;
    return (
      `Humidity ratio moved by ${change.toExponential(1)} across the ${deviceName}. ` +
      'A sensible-only device cannot add or remove moisture — this points at the ' +
      'model rather than at the design.'
    );
  };
}

export const coolingCoilCheck: CheckRule = ({ entering, result, units }) => {
  if (!entering) return null;
  const notes: string[] = [];
  const leavingRh = result.state.rh;

  // A real coil leaves air close to saturation. Well below that usually means
  // the leaving condition was typed rather than selected, or the SHR is not
  // one this coil can deliver.
  if (leavingRh < 0.85 && result.state.w < entering.w - CONSTANT_W) {
    notes.push(
      `Off-coil air is at ${fmtPercent(leavingRh)} RH. A dehumidifying coil ` +
        'typically leaves at 90–95%; below about 85% the leaving condition, the ' +
        'SHR, or the bypass factor is worth a second look.',
    );
  }

  const bypass = result.coil?.bypassFactor;
  if (typeof bypass === 'number' && bypass > 0.3) {
    notes.push(
      `Bypass factor is ${bypass.toFixed(2)}. Above about 0.30 the coil is doing ` +
        'little work on most of the air — usually too few rows or too high a face ' +
        'velocity for the duty asked of it.',
    );
  }
  if (typeof bypass === 'number' && bypass < 0.02) {
    notes.push(
      `Bypass factor is ${bypass.toFixed(3)}. A coil that reaches its apparatus ` +
        'dew point almost exactly is an ideal, not a selection; confirm against a ' +
        'manufacturer rating before relying on the leaving condition.',
    );
  }

  // Claiming latent capacity from a coil that never gets below the dew point.
  if (result.duty.latent < 0 && result.coil?.adp === null) {
    notes.push(
      result.coil.problem ??
        'The process line never reaches saturation, so this coil has no apparatus ' +
          'dew point — the dehumidification it reports has no surface to condense on.',
    );
  }

  // A leaving temperature above the entering one is not a cooling coil.
  if (result.state.tdb > entering.tdb + kelvinAs(0.1, units)) {
    notes.push('This coil is warming the air. A heating coil models that intent directly.');
  }

  return notes.length > 0 ? notes.join(' ') : null;
};

export const heatingCoilCheck: CheckRule = (context) => {
  const constant = sensibleOnly('heating coil')(context);
  if (constant) return constant;

  // Heating dry air pushes RH down fast; below 20% is where occupants and
  // static-sensitive equipment start to notice.
  const rh = context.result.state.rh;
  if (rh < 0.2 && rh > 0) {
    return (
      `Leaving air is at ${fmtPercent(rh)} RH. Heating without humidification in ` +
      'winter routinely drops space humidity below comfort and static limits — ' +
      'check what the space actually needs before accepting it.'
    );
  }
  return null;
};

export const fanCheck: CheckRule = (context) => {
  const constant = sensibleOnly('fan')(context);
  if (constant) return constant;

  const { entering, result, units } = context;
  if (!entering) return null;
  const rise = result.state.tdb - entering.tdb;
  if (rise > kelvinAs(2.8, units)) {
    return (
      `Fan heat is raising the air by ${rise.toFixed(1)}°. Typical is 0.3–1.1 K ` +
      '(0.5–2 °F); a larger rise means either a high static system or a motor ' +
      'power that belongs to a different airflow.'
    );
  }
  return null;
};

export const roomCheck: CheckRule = ({ entering, result, units }) => {
  if (!entering) return null;
  const notes: string[] = [];

  // The classic failure: a supply condition that holds temperature but cannot
  // absorb the latent load, so the space drifts humid.
  if (result.state.rh > 0.6) {
    notes.push(
      `The space settles at ${fmtPercent(result.state.rh)} RH. A supply condition ` +
        'that meets the sensible load but not the latent one holds temperature ' +
        'while humidity drifts — the coil, not the airflow, is usually the fix.',
    );
  }

  const lift = result.state.tdb - entering.tdb;
  if (lift > kelvinAs(16.7, units)) {
    notes.push(
      `Supply air is ${lift.toFixed(1)}° below the space. Above about 30 °F (16.7 K) ` +
        'the supply temperature difference is beyond what most diffusers will ' +
        'throw without dumping cold air into the occupied zone.',
    );
  }

  return notes.length > 0 ? notes.join(' ') : null;
};

export const steamHumidifierCheck: CheckRule = ({ result }) => {
  if (result.state.rh > 0.9) {
    return (
      `Leaving air is at ${fmtPercent(result.state.rh)} RH. Steam needs absorption ` +
      'distance before the next component or duct sensor, and air this close to ' +
      'saturation will condense on the first cold surface it meets.'
    );
  }
  return null;
};

/** Direct evaporative and adiabatic humidification share a physical limit. */
export const adiabaticCheck: CheckRule = ({ entering, result, units }) => {
  if (!entering) return null;
  const notes: string[] = [];

  // The wet-bulb floor. The models enforce it, so this firing means the model
  // is wrong — which is precisely why it is worth checking.
  if (result.state.tdb < entering.twb - kelvinAs(0.2, units)) {
    notes.push(
      'Leaving dry bulb is below the entering wet bulb, which no adiabatic process ' +
        'can do. Treat the result as a modelling error, not as performance.',
    );
  }

  const approach = entering.tdb - entering.twb;
  if (approach < kelvinAs(2.8, units)) {
    notes.push(
      `There is only ${approach.toFixed(1)}° between entering dry bulb and wet bulb, ` +
        'so there is almost no evaporative cooling available here. This is a ' +
        'climate question before it is an equipment question.',
    );
  }

  return notes.length > 0 ? notes.join(' ') : null;
};

/**
 * Recovery effectiveness against the band the device type actually achieves.
 *
 * The bands are the ones a reviewer carries in their head. A claim above them
 * is not impossible — it is a claim that needs a rating to back it.
 */
function effectivenessCheck(
  deviceName: string,
  band: { readonly low: number; readonly high: number },
  key = 'sensible',
): CheckRule {
  return ({ stage }: CheckContext): string | null => {
    const value = (stage.params ?? {})[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (value > band.high) {
      return (
        `${fmtPercent(value)} effectiveness is above the ${fmtPercent(band.low)}–` +
        `${fmtPercent(band.high)} a ${deviceName} typically achieves. Above that band, ` +
        'ask for a certified rating at your face velocity and flow ratio.'
      );
    }
    if (value < band.low) {
      return (
        `${fmtPercent(value)} is below the ${fmtPercent(band.low)}–${fmtPercent(band.high)} ` +
        `a ${deviceName} typically achieves — conservative, but confirm it is a ` +
        'selection rather than a placeholder.'
      );
    }
    return null;
  };
}

export const sensibleWheelCheck = effectivenessCheck('sensible wheel', { low: 0.65, high: 0.85 });
export const enthalpyWheelCheck = effectivenessCheck('enthalpy wheel', { low: 0.65, high: 0.85 });
export const plateCheck = effectivenessCheck('plate exchanger', { low: 0.5, high: 0.75 });
export const runaroundCheck = effectivenessCheck('run-around loop', { low: 0.45, high: 0.65 });
export const indirectEvaporativeCheck = effectivenessCheck('indirect evaporative cooler', {
  low: 0.55,
  high: 0.8,
});

/**
 * The wrap-around legs must balance.
 *
 * Same airflow, sensible only, no external energy: whatever the pre-cool leg
 * takes out, the reheat leg puts back. If the model shows otherwise, energy is
 * being created — and that is worth saying in those words.
 */
export const wraparoundReheatCheck: CheckRule = ({ entering, result, units }) => {
  if (!entering) return null;
  const rise = result.state.tdb - entering.tdb;
  if (rise <= 0) {
    return (
      'The reheat leg is not adding heat. It recovers what the pre-cool leg removed, ' +
      'so a leg pairing that yields nothing usually means the two are not coupled.'
    );
  }
  if (rise > kelvinAs(11, units)) {
    return (
      `The reheat leg is lifting the air by ${rise.toFixed(1)}°. Free reheat that ` +
      'overshoots the supply temperature the space needs is no longer free — it has ' +
      'to be cooled back down.'
    );
  }
  return null;
};

export const desiccantCheck: CheckRule = ({ stage }) => {
  const removal = (stage.params ?? {})['removal'];
  const idealisation =
    'This is modelled as an isenthalpic idealisation. A real desiccant wheel runs ' +
    'slightly above the constant-enthalpy line and needs a regeneration airstream ' +
    'that this model does not account for — size the regeneration heat separately.';

  if (typeof removal === 'number' && removal > 0.8) {
    return (
      `Removing ${fmtPercent(removal)} of the entering moisture is at the top of what a ` +
      `single wheel pass achieves. ${idealisation}`
    );
  }
  return idealisation;
};

/**
 * How much of the mixture is outdoor air.
 *
 * Taken from the **mass flows**, not from the declared airflows. The second
 * stream is entered volumetrically at its own condition, and 1,600 CFM of 75 °F
 * return air is not the same quantity of dry air as 1,600 CFM of 95 °F outdoor
 * air. Dividing the volumes would put the fraction out by several percent —
 * always in the direction that flatters the ventilation rate.
 */
export const mixingCheck: CheckRule = ({ result, enteringMassFlow }) => {
  if (enteringMassFlow === null || !(result.massFlow > 0)) return null;
  const fraction = enteringMassFlow / result.massFlow;
  if (fraction < 0.1) {
    return (
      `Outdoor air is ${fmtPercent(fraction)} of the mixture. Confirm this still meets ` +
      'the ventilation rate the space is required to have — the mix point being ' +
      'comfortable is not the same as the air being adequate.'
    );
  }
  return null;
};
