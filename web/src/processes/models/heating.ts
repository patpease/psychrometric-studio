/**
 * Heating coil — sensible heating at constant humidity ratio.
 *
 * A horizontal move to the right on the chart. No moisture is exchanged, so
 * relative humidity falls as the air warms.
 */
import { fromTdbW } from '../../psych/state.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { applySensibleDuty, resolveFlow, splitDuty } from '../duty.js';

export interface HeatingParams {
  /** Leaving dry-bulb temperature. */
  readonly tdbOut?: number | undefined;
  /** Coil capacity, MBH | kW. Positive adds heat. */
  readonly power?: number | undefined;
}

export const heatingModel: ProcessModel<HeatingParams> = {
  type: 'heating',
  displayName: 'Heating coil',

  parseParams: (raw) => {
    const tdbOut = optionalNumber(raw, 'tdbOut');
    const power = optionalNumber(raw, 'power');
    if (tdbOut === undefined && power === undefined) {
      throw new ProcessError(
        'Heating coil: give either a leaving temperature or a capacity.',
        'heating',
        'tdbOut',
      );
    }
    return { tdbOut, power };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) throw new ProcessError('Heating coil: needs an entering airstream.', 'heating');

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Heating coil',
    );

    const leaving =
      params.tdbOut !== undefined
        ? fromTdbW(params.tdbOut, entering.w, pressure, units)
        : applySensibleDuty(entering, massFlow, Math.abs(params.power!), pressure, units);

    const warnings: string[] = leaving.warnings.map((warning) => warning.message);
    if (leaving.tdb < entering.tdb) {
      warnings.push(
        `Leaving temperature (${leaving.tdb.toFixed(1)}°) is below entering ` +
          `(${entering.tdb.toFixed(1)}°). A heating coil cannot cool the air.`,
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: 0,
      note: 'Sensible heating at constant humidity ratio.',
      warnings,
    };
  },
};
