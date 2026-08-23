/**
 * Fan — sensible heat gain from fan and motor losses.
 *
 * A short horizontal move to the right, typically 0.5–2 °F (0.3–1 °C), and
 * routinely forgotten — after which the space runs warm at design load.
 */
import {
  ProcessError,
  optionalBoolean,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { applySensibleDuty, resolveFlow, splitDuty } from '../duty.js';
import { powerAsDuty, LABELS } from '../../psych/units.js';

export interface FanParams {
  /**
   * Fan shaft power, **HP (IP) | kW (SI)** — how a fan is actually specified.
   * The heat delivered to the airstream is derived from it, not entered.
   */
  readonly power: number;
  /**
   * Whether the motor sits in the airstream. When it does, motor losses reach
   * the air as well as shaft power; when it does not, only shaft power does.
   */
  readonly motorInAirstream: boolean;
  /** Motor efficiency, used only when the motor is outside the airstream. */
  readonly motorEfficiency: number;
}

export const fanModel: ProcessModel<FanParams> = {
  type: 'fan',
  displayName: 'Fan',

  parseParams: (raw) => {
    const power = optionalNumber(raw, 'power');
    if (power === undefined) {
      throw new ProcessError('Fan: a power input is required.', 'fan', 'power');
    }
    return {
      power: Math.abs(power),
      motorInAirstream: optionalBoolean(raw, 'motorInAirstream') ?? true,
      motorEfficiency: optionalNumber(raw, 'motorEfficiency') ?? 0.9,
    };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) throw new ProcessError('Fan: needs an entering airstream.', 'fan');

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Fan',
    );

    // Shaft power becomes a thermal duty: 1 HP = 2.5444 MBH; kW is already kW.
    const dutyInput = powerAsDuty(params.power, units);
    const toAir = params.motorInAirstream ? dutyInput : dutyInput * params.motorEfficiency;
    const leaving = applySensibleDuty(entering, massFlow, toAir, pressure, units);

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: 0,
      note: params.motorInAirstream
        ? `${params.power} ${LABELS[units].power} — all fan and motor heat enters the airstream.`
        : `${params.power} ${LABELS[units].power}; motor outside the airstream, so ` +
          `${(params.motorEfficiency * 100).toFixed(0)}% of input reaches the air.`,
      warnings: leaving.warnings.map((warning) => warning.message),
    };
  },
};
