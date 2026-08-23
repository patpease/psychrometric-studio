/**
 * Wrap-around coil — a passive circuit with two legs.
 *
 * The upstream leg pre-cools air before the cooling coil; the downstream leg
 * returns that same heat afterwards as free reheat. The circuit is passive, so
 * **the two legs must balance**: the heat taken out upstream is exactly the
 * heat put back downstream. If they do not balance, energy is being created.
 *
 * That balance is enforced by construction rather than checked afterwards. The
 * reheat leg does not take a duty of its own — it reads the pre-cool leg's
 * result through a `paired-leg` coupling and mirrors it. A model that let both
 * legs be specified independently would let a user build a circuit that
 * violates the first law and see no complaint.
 *
 * Both legs are sensible only: a heat pipe or pumped loop transfers no
 * moisture.
 */
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { applySensibleDuty, resolveFlow, splitDuty } from '../duty.js';
import { fromTdbW } from '../../psych/state.js';

export interface WraparoundPrecoolParams {
  /** Temperature drop across the pre-cool leg, in the project's degrees. */
  readonly deltaT?: number | undefined;
  /** Or the leg's duty, MBH | kW. Negative into the air. */
  readonly power?: number | undefined;
}

export const wraparoundPrecoolModel: ProcessModel<WraparoundPrecoolParams> = {
  type: 'recovery-wraparound-precool',
  displayName: 'Wrap-around — pre-cool',

  parseParams: (raw) => {
    const deltaT = optionalNumber(raw, 'deltaT');
    const power = optionalNumber(raw, 'power');
    if (deltaT === undefined && power === undefined) {
      throw new ProcessError(
        'Wrap-around pre-cool: give either a temperature drop or a duty.',
        'recovery-wraparound-precool',
        'deltaT',
      );
    }
    if (deltaT !== undefined && deltaT < 0) {
      throw new ProcessError(
        'Wrap-around pre-cool: the temperature drop must be positive — this leg ' +
          'cools the air.',
        'recovery-wraparound-precool',
        'deltaT',
      );
    }
    return { deltaT, power };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) {
      throw new ProcessError(
        'Wrap-around pre-cool: needs an entering airstream.',
        'recovery-wraparound-precool',
      );
    }

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Wrap-around pre-cool',
    );

    const leaving =
      params.deltaT !== undefined
        ? fromTdbW(entering.tdb - params.deltaT, entering.w, pressure, units)
        : applySensibleDuty(entering, massFlow, -Math.abs(params.power!), pressure, units);

    const warnings: string[] = leaving.warnings.map((warning) => warning.message);
    if (leaving.tdb < entering.tdp) {
      warnings.push(
        'This leg has cooled the air below its dew point, so it would condense. ' +
          'A wrap-around pre-cool leg is normally kept dry; the reheat leg cannot ' +
          'return latent heat, so the circuit would no longer balance.',
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: 0,
      note: `Pre-cools ${(entering.tdb - leaving.tdb).toFixed(1)}° before the coil, at constant humidity ratio.`,
      warnings,
    };
  },
};

export interface WraparoundReheatParams {
  /**
   * Nothing to configure.
   *
   * The reheat leg mirrors the pre-cool leg by definition. Exposing a duty here
   * would let the circuit be unbalanced, which is exactly what a passive
   * wrap-around cannot be.
   */
  readonly _: never | undefined;
}

export const wraparoundReheatModel: ProcessModel<WraparoundReheatParams> = {
  type: 'recovery-wraparound-reheat',
  displayName: 'Wrap-around — reheat',

  parseParams: () => ({ _: undefined }),

  apply: (context): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) {
      throw new ProcessError(
        'Wrap-around reheat: needs an entering airstream.',
        'recovery-wraparound-reheat',
      );
    }

    const paired = context.couplingResults['paired-leg'];
    if (!paired) {
      throw new ProcessError(
        'Wrap-around reheat: pair this leg with its pre-cool leg. The heat it ' +
          'returns is the heat that leg removed, so it cannot be solved alone.',
        'recovery-wraparound-reheat',
      );
    }

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Wrap-around reheat',
    );

    // Mirror the pre-cool leg exactly: what came out goes back in.
    const recovered = -paired.duty.total;
    const leaving = applySensibleDuty(entering, massFlow, recovered, pressure, units);
    const duty = splitDuty(entering, leaving, massFlow, units);

    const warnings: string[] = leaving.warnings.map((warning) => warning.message);

    // The defining property, asserted rather than assumed.
    const residual = Math.abs(duty.total + paired.duty.total);
    if (residual > Math.max(Math.abs(paired.duty.total), 1e-9) * 1e-6) {
      warnings.push(
        `The two legs do not balance (${paired.duty.total.toFixed(2)} removed against ` +
          `${duty.total.toFixed(2)} returned). A passive circuit cannot do this; ` +
          'please report it.',
      );
    }

    // The pre-cool leg's mass flow should match this one's; if a stage between
    // them changed the airflow, the same duty produces a different ΔT.
    if (Math.abs(paired.massFlow - massFlow) / Math.max(massFlow, 1e-9) > 1e-6) {
      warnings.push(
        'The two legs carry different mass flows, so the same recovered heat ' +
          'produces a different temperature change on each. Check that nothing ' +
          'between them adds or removes air.',
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      duty,
      moistureRate: 0,
      note: `Returns ${Math.abs(recovered).toFixed(1)} from the pre-cool leg — free reheat, no new energy.`,
      warnings,
    };
  },
};
