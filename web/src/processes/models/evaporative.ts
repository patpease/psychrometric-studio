/**
 * Evaporative cooling.
 *
 * **Direct** evaporative cooling is adiabatic humidification by another name:
 * water evaporates into the airstream using the air's own heat, so the state
 * slides down the constant wet-bulb line. It is a separate stage type from the
 * adiabatic humidifier because the intent differs — one is cooling equipment,
 * the other is humidity control — and the equipment list should read the way an
 * engineer thinks about it.
 *
 * **Indirect** evaporative cooling cools a *secondary* airstream
 * evaporatively, then uses it to cool the primary stream through a heat
 * exchanger. The primary air never touches the water, so it cools at
 * **constant humidity ratio** — the whole point of the arrangement. Its limit
 * is the secondary stream's wet bulb, not its own.
 */
import { fromTdbRh, fromTdbTwb, fromTdbW, type MoistAirState } from '../../psych/state.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { moistureRate, resolveFlow, splitDuty } from '../duty.js';

export interface DirectEvaporativeParams {
  readonly effectiveness: number;
}

export const directEvaporativeModel: ProcessModel<DirectEvaporativeParams> = {
  type: 'evaporative-direct',
  displayName: 'Direct evaporative',

  parseParams: (raw) => {
    const effectiveness = optionalNumber(raw, 'effectiveness');
    if (effectiveness === undefined) {
      throw new ProcessError(
        'Direct evaporative: a saturation effectiveness is required.',
        'evaporative-direct',
        'effectiveness',
      );
    }
    if (effectiveness < 0 || effectiveness > 1) {
      throw new ProcessError(
        'Direct evaporative: effectiveness must be between 0 and 1. Above 1 the air ' +
          'would leave below its own wet bulb, which is not possible.',
        'evaporative-direct',
        'effectiveness',
      );
    }
    return { effectiveness };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) {
      throw new ProcessError('Direct evaporative: needs an entering airstream.', 'evaporative-direct');
    }

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Direct evaporative',
    );

    const leaving = fromTdbTwb(
      entering.tdb - params.effectiveness * (entering.tdb - entering.twb),
      entering.twb,
      pressure,
      units,
    );

    const warnings: string[] = leaving.warnings.map((warning) => warning.message);
    const depression = entering.tdb - entering.twb;
    if (depression < (units === 'IP' ? 9 : 5)) {
      warnings.push(
        `The wet-bulb depression is only ${depression.toFixed(1)}°, so there is little ` +
          'evaporative cooling available. This process suits dry climates; in a ' +
          'humid one it adds moisture for very little temperature benefit.',
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: moistureRate(massFlow, leaving.w - entering.w, units),
      note: `Down the ${entering.twb.toFixed(1)}° wet-bulb line — the air cools by adding moisture.`,
      warnings,
    };
  },
};

export interface IndirectEvaporativeParams {
  /** Effectiveness of the heat exchanger between the two streams. */
  readonly effectiveness: number;
  /** Saturation effectiveness of the secondary (scavenger) evaporative stage. */
  readonly secondaryEffectiveness: number;
  /** Secondary stream condition, when not supplied by a coupling. */
  readonly tdbSecondary?: number | undefined;
  readonly rhSecondary?: number | undefined;
}

export const indirectEvaporativeModel: ProcessModel<IndirectEvaporativeParams> = {
  type: 'evaporative-indirect',
  displayName: 'Indirect evaporative',

  parseParams: (raw) => {
    const effectiveness = optionalNumber(raw, 'effectiveness');
    if (effectiveness === undefined) {
      throw new ProcessError(
        'Indirect evaporative: a heat exchanger effectiveness is required.',
        'evaporative-indirect',
        'effectiveness',
      );
    }
    if (effectiveness < 0 || effectiveness > 1) {
      throw new ProcessError(
        'Indirect evaporative: effectiveness must be between 0 and 1.',
        'evaporative-indirect',
        'effectiveness',
      );
    }
    const secondary = optionalNumber(raw, 'secondaryEffectiveness') ?? 0.85;
    if (secondary < 0 || secondary > 1) {
      throw new ProcessError(
        'Indirect evaporative: secondary effectiveness must be between 0 and 1.',
        'evaporative-indirect',
        'secondaryEffectiveness',
      );
    }
    return {
      effectiveness,
      secondaryEffectiveness: secondary,
      tdbSecondary: optionalNumber(raw, 'tdbSecondary'),
      rhSecondary: optionalNumber(raw, 'rhSecondary'),
    };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) {
      throw new ProcessError(
        'Indirect evaporative: needs an entering airstream.',
        'evaporative-indirect',
      );
    }

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Indirect evaporative',
    );

    // The scavenger stream: a coupled airstream, a condition entered here, or —
    // as is usual — the same outdoor air the primary stream started from.
    let secondaryEntering: MoistAirState;
    const coupled = context.couplings['secondary-stream'];
    if (coupled) {
      secondaryEntering = coupled;
    } else if (params.tdbSecondary !== undefined && params.rhSecondary !== undefined) {
      secondaryEntering = fromTdbRh(params.tdbSecondary, params.rhSecondary, pressure, units);
    } else {
      secondaryEntering = entering;
    }

    // The scavenger is evaporatively cooled first...
    const secondaryCooled = fromTdbTwb(
      secondaryEntering.tdb -
        params.secondaryEffectiveness * (secondaryEntering.tdb - secondaryEntering.twb),
      secondaryEntering.twb,
      pressure,
      units,
    );

    // ...and the primary stream is then cooled toward it, at constant humidity
    // ratio, because the two never mix.
    const leaving = fromTdbW(
      entering.tdb - params.effectiveness * (entering.tdb - secondaryCooled.tdb),
      entering.w,
      pressure,
      units,
    );

    const warnings: string[] = leaving.warnings.map((warning) => warning.message);
    if (leaving.tdb < secondaryEntering.twb - 1e-6) {
      warnings.push(
        'The primary air has been cooled below the secondary stream’s wet bulb, ' +
          'which is the limit of this arrangement. Check the effectiveness values.',
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      // The defining property of indirect: no moisture added to the supply air.
      moistureRate: 0,
      note:
        `Cooled at constant humidity ratio toward a scavenger stream at ` +
        `${secondaryCooled.tdb.toFixed(1)}°.`,
      warnings,
      auxiliary: [
        { label: 'Scavenger entering', state: secondaryEntering },
        { label: 'Scavenger cooled', state: secondaryCooled },
      ],
    };
  },
};
