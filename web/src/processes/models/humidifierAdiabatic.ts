/**
 * Adiabatic (evaporative) humidifier.
 *
 * Water evaporates into the airstream using heat from the air itself, so the
 * state slides down the constant wet-bulb line toward saturation.
 *
 * The physical limit is absolute: **the leaving dry bulb can never fall below
 * the entering wet bulb.** Effectiveness expresses how much of that available
 * wet-bulb depression the device actually achieves.
 *
 *     ε = (T₁ − T₂) / (T₁ − Twb₁)
 */
import { fromTdbTwb, fromTwbRh } from '../../psych/state.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { moistureRate, resolveFlow, splitDuty } from '../duty.js';

export interface AdiabaticHumidifierParams {
  /** Saturation effectiveness, 0–1. */
  readonly effectiveness?: number | undefined;
  /** Target leaving relative humidity, 0–1. */
  readonly rhOut?: number | undefined;
}

export const adiabaticHumidifierModel: ProcessModel<AdiabaticHumidifierParams> = {
  type: 'humidifier-adiabatic',
  displayName: 'Adiabatic humidifier',

  parseParams: (raw) => {
    const effectiveness = optionalNumber(raw, 'effectiveness');
    const rhOut = optionalNumber(raw, 'rhOut');
    if (effectiveness === undefined && rhOut === undefined) {
      throw new ProcessError(
        'Adiabatic humidifier: give either an effectiveness or a target relative humidity.',
        'humidifier-adiabatic',
        'effectiveness',
      );
    }
    if (effectiveness !== undefined && (effectiveness < 0 || effectiveness > 1)) {
      throw new ProcessError(
        'Adiabatic humidifier: effectiveness must be between 0 and 1. An ' +
          'effectiveness above 1 would cool the air below its wet bulb, which is ' +
          'thermodynamically impossible.',
        'humidifier-adiabatic',
        'effectiveness',
      );
    }
    return { effectiveness, rhOut };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) {
      throw new ProcessError('Adiabatic humidifier: needs an entering airstream.', 'humidifier-adiabatic');
    }

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Adiabatic humidifier',
    );

    // Constant wet bulb is the defining property, so both forms solve along the
    // entering wet-bulb line — no iteration needed in either case.
    const leaving =
      params.effectiveness !== undefined
        ? fromTdbTwb(
            entering.tdb - params.effectiveness * (entering.tdb - entering.twb),
            entering.twb,
            pressure,
            units,
          )
        : fromTwbRh(entering.twb, params.rhOut!, pressure, units);

    const achieved =
      entering.tdb === entering.twb
        ? 1
        : (entering.tdb - leaving.tdb) / (entering.tdb - entering.twb);

    const warnings: string[] = leaving.warnings.map((warning) => warning.message);
    if (achieved > 1 + 1e-9) {
      warnings.push(
        'This requires cooling the air below its entering wet bulb, which is not ' +
          'physically possible. If a supplier datasheet implies it, the entering ' +
          'condition on that datasheet is not yours.',
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: moistureRate(massFlow, leaving.w - entering.w, units),
      note:
        `Constant wet bulb at ${entering.twb.toFixed(1)}°; ` +
        `effectiveness ${(achieved * 100).toFixed(0)}%.`,
      warnings,
    };
  },
};
