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
 * The moisture properties, in the order this model prefers them.
 *
 * A moist-air state is fixed by dry bulb plus **exactly one** of these. Storing
 * two is not extra information, it is a contradiction — and one of them has to
 * lose. The editor keeps a source stage down to one at a time (see
 * `withParams` in the UI layer); this order decides what happens to a file that
 * arrived carrying more than one anyway, and it is the order this model has
 * always used, so an old project solves to the numbers it always did.
 */
export const MOISTURE_PARAMS = ['rh', 'twb', 'tdp', 'w', 'h'] as const;

/**
 * Accept any of the pairs the state engine supports, so a user can enter the
 * condition in whatever form their data arrived in rather than converting by
 * hand first.
 */
function parseStateInput(raw: unknown): StateInput {
  const record = (raw ?? {}) as Record<string, unknown>;
  const number = (key: string): number | undefined => optionalNumber(record, key);

  const tdb = number('tdb');

  if (tdb !== undefined) {
    for (const key of MOISTURE_PARAMS) {
      const value = number(key);
      if (value === undefined) continue;
      switch (key) {
        case 'rh':
          return { kind: 'tdb-rh', tdb, rh: value };
        case 'twb':
          return { kind: 'tdb-twb', tdb, twb: value };
        case 'tdp':
          return { kind: 'tdb-tdp', tdb, tdp: value };
        case 'w':
          return { kind: 'tdb-w', tdb, w: value };
        case 'h':
          return { kind: 'tdb-h', tdb, h: value };
      }
    }
  }

  // Pairs that do not involve dry bulb at all. Not offered by the editor, but
  // a hand-written or machine-generated file may carry them.
  const rh = number('rh');
  const twb = number('twb');
  const w = number('w');
  const h = number('h');

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
