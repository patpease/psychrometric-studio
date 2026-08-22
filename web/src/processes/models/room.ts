/**
 * Room or zone — the space load line.
 *
 * Supply air absorbs the room's sensible and latent gains and arrives at the
 * space condition. The slope of this line is the room sensible heat ratio,
 * which is fixed by the loads and is not the designer's to choose.
 */
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { applyDuty, moistureRate, resolveFlow, splitDuty } from '../duty.js';

export interface RoomParams {
  /** Room sensible gain, MBH | kW. Positive warms the air. */
  readonly sensible: number;
  /** Room latent gain, MBH | kW. Positive adds moisture. */
  readonly latent: number;
}

export const roomModel: ProcessModel<RoomParams> = {
  type: 'room',
  displayName: 'Room / zone',

  parseParams: (raw) => {
    const sensible = optionalNumber(raw, 'sensible');
    if (sensible === undefined) {
      throw new ProcessError('Room: a sensible load is required.', 'room', 'sensible');
    }
    return { sensible, latent: optionalNumber(raw, 'latent') ?? 0 };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) throw new ProcessError('Room: needs a supply airstream.', 'room');

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Room',
    );

    const total = params.sensible + params.latent;
    if (total === 0) {
      return {
        state: entering,
        massFlow,
        airflow,
        duty: { total: 0, sensible: 0, latent: 0, shr: Number.NaN },
        moistureRate: 0,
        note: 'No load — the air leaves as it entered.',
        warnings: [],
      };
    }

    const rshr = params.sensible / total;
    const leaving = applyDuty(entering, massFlow, total, rshr, pressure, units);

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: moistureRate(massFlow, leaving.w - entering.w, units),
      note: `Room sensible heat ratio ${rshr.toFixed(2)}.`,
      warnings: leaving.warnings.map((warning) => warning.message),
    };
  },
};
