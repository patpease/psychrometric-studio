/**
 * Mixing box — adiabatic mixing of two airstreams.
 *
 * The mixed state always lies on the straight line between the two entering
 * states, positioned by dry-air **mass** fraction. Positioning by volumetric
 * fraction is the classic error: the two streams are at different densities, so
 * the lever arm is wrong and the mix point lands in the wrong place.
 */
import { fromEnthalpyW, fromTdbRh, type MoistAirState } from '../../psych/state.js';
import { massFlow as massFlowFrom, airflow as airflowFrom } from '../../psych/units.js';
import {
  ProcessError,
  optionalNumber,
  ZERO_DUTY,
  type ProcessModel,
  type StageResult,
} from '../types.js';

export interface MixingParams {
  /** Airflow of the second stream, CFM | L/s. */
  readonly airflow2: number;
  /** Second-stream condition, when not supplied by a coupled airstream. */
  readonly tdb2?: number | undefined;
  readonly rh2?: number | undefined;
}

export const mixingModel: ProcessModel<MixingParams> = {
  type: 'mixing',
  displayName: 'Mixing box',

  parseParams: (raw) => {
    const airflow2 = optionalNumber(raw, 'airflow2');
    if (airflow2 === undefined || !(airflow2 > 0)) {
      throw new ProcessError('Mixing box: the second stream needs an airflow.', 'mixing', 'airflow2');
    }
    return {
      airflow2,
      tdb2: optionalNumber(raw, 'tdb2'),
      rh2: optionalNumber(raw, 'rh2'),
    };
  },

  apply: (context, params): StageResult => {
    const { entering, upstreamMassFlow, pressure, units } = context;
    if (!entering || upstreamMassFlow === null) {
      throw new ProcessError('Mixing box: needs an entering airstream.', 'mixing');
    }

    // The second stream comes either from a coupled airstream or from a
    // condition entered directly on this stage.
    let second: MoistAirState;
    const coupled = context.couplings['second-stream'];
    if (coupled) {
      second = coupled;
    } else if (params.tdb2 !== undefined && params.rh2 !== undefined) {
      second = fromTdbRh(params.tdb2, params.rh2, pressure, units);
    } else {
      throw new ProcessError(
        'Mixing box: give the second stream a condition, or couple it to another airstream.',
        'mixing',
        'tdb2',
      );
    }

    const m1 = upstreamMassFlow;
    const m2 = massFlowFrom(params.airflow2, second.v, units);
    const total = m1 + m2;

    // Mass-weighted averages of the two conserved quantities.
    const w = (m1 * entering.w + m2 * second.w) / total;
    const h = (m1 * entering.h + m2 * second.h) / total;
    const state = fromEnthalpyW(h, w, pressure, units);

    const primaryPercent = (m1 / total) * 100;

    return {
      state,
      massFlow: total,
      airflow: airflowFrom(total, state.v, units),
      // Adiabatic: no energy crosses the boundary. The stream changes, the
      // energy content does not.
      duty: ZERO_DUTY,
      moistureRate: 0,
      note:
        `Mass fractions: ${primaryPercent.toFixed(0)}% primary / ` +
        `${(100 - primaryPercent).toFixed(0)}% secondary.`,
      warnings: state.warnings.map((warning) => warning.message),
      auxiliary: [{ label: 'Second stream', state: second }],
    };
  },
};
