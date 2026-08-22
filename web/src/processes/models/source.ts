/**
 * Entering air — the start of an airstream.
 *
 * Everything downstream is solved from here, so the quality of this input sets
 * the quality of the whole analysis.
 */
import { solve, type StateInput } from '../../psych/state.js';
import { massFlow as massFlowFrom } from '../../psych/units.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { ZERO_DUTY } from '../types.js';

export interface SourceParams {
  readonly input: StateInput;
}

/**
 * Accept any of the pairs the state engine supports, so a user can enter the
 * condition in whatever form their data arrived in rather than converting by
 * hand first.
 */
function parseStateInput(raw: unknown): StateInput {
  const record = (raw ?? {}) as Record<string, unknown>;
  const number = (key: string): number | undefined => optionalNumber(record, key);

  const tdb = number('tdb');
  const rh = number('rh');
  const twb = number('twb');
  const tdp = number('tdp');
  const w = number('w');
  const h = number('h');

  if (tdb !== undefined && rh !== undefined) return { kind: 'tdb-rh', tdb, rh };
  if (tdb !== undefined && twb !== undefined) return { kind: 'tdb-twb', tdb, twb };
  if (tdb !== undefined && tdp !== undefined) return { kind: 'tdb-tdp', tdb, tdp };
  if (tdb !== undefined && w !== undefined) return { kind: 'tdb-w', tdb, w };
  if (tdb !== undefined && h !== undefined) return { kind: 'tdb-h', tdb, h };
  if (twb !== undefined && rh !== undefined) return { kind: 'twb-rh', twb, rh };
  if (h !== undefined && w !== undefined) return { kind: 'h-w', h, w };

  throw new ProcessError(
    'Entering air: give dry bulb plus one of relative humidity, wet bulb, ' +
      'dew point, humidity ratio, or enthalpy.',
    'source',
  );
}

export const sourceModel: ProcessModel<SourceParams> = {
  type: 'source',
  displayName: 'Entering air',
  isSource: true,

  parseParams: (raw) => ({ input: parseStateInput(raw) }),

  apply: (context, params): StageResult => {
    const state = solve(params.input, context.pressure, context.units);

    if (context.airflow === undefined || !(context.airflow > 0)) {
      throw new ProcessError('Entering air: an airflow is required.', 'source', 'airflow');
    }

    return {
      state,
      massFlow: massFlowFrom(context.airflow, state.v, context.units),
      airflow: context.airflow,
      duty: ZERO_DUTY,
      moistureRate: 0,
      note: 'Defined entering condition.',
      warnings: state.warnings.map((warning) => warning.message),
    };
  },
};
