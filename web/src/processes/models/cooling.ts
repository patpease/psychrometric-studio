/**
 * Cooling coil — sensible and latent cooling.
 *
 * Air passes over a coil whose surface sits below the entering dew point, so
 * moisture condenses while the air cools. Two ways to define it:
 *
 *  - **Leaving conditions** — the coil is already selected and you know what it
 *    delivers.
 *  - **Capacity and SHR** — you know the duty and want the leaving condition.
 *
 * Apparatus dew point and bypass factor are Phase 4; this stage is the process
 * line, not the coil construction.
 */
import { fromTdbRh } from '../../psych/state.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { applyDuty, moistureRate, resolveFlow, splitDuty } from '../duty.js';

export interface CoolingParams {
  readonly tdbOut?: number | undefined;
  readonly rhOut?: number | undefined;
  /** Total capacity, MBH | kW. Magnitude only; cooling is applied as negative. */
  readonly power?: number | undefined;
  /** Sensible heat ratio of the coil, 0–1. */
  readonly shr: number;
}

/** Off-coil air below this leaves the coil unusually dry for its duty. */
const TYPICAL_LEAVING_RH_MIN = 0.85;

export const coolingModel: ProcessModel<CoolingParams> = {
  type: 'cooling',
  displayName: 'Cooling coil',

  parseParams: (raw) => {
    const tdbOut = optionalNumber(raw, 'tdbOut');
    const rhOut = optionalNumber(raw, 'rhOut');
    const power = optionalNumber(raw, 'power');
    const shr = optionalNumber(raw, 'shr') ?? 0.85;

    const hasLeaving = tdbOut !== undefined && rhOut !== undefined;
    if (!hasLeaving && power === undefined) {
      throw new ProcessError(
        'Cooling coil: give either leaving conditions (temperature and relative ' +
          'humidity) or a capacity with a sensible heat ratio.',
        'cooling',
        'power',
      );
    }
    if (shr < 0 || shr > 1) {
      throw new ProcessError('Cooling coil: sensible heat ratio must be between 0 and 1.', 'cooling', 'shr');
    }
    return { tdbOut, rhOut, power, shr };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) throw new ProcessError('Cooling coil: needs an entering airstream.', 'cooling');

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Cooling coil',
    );

    const leaving =
      params.tdbOut !== undefined && params.rhOut !== undefined
        ? fromTdbRh(params.tdbOut, params.rhOut, pressure, units)
        : // Cooling removes energy, so the duty is applied negative.
          applyDuty(entering, massFlow, -Math.abs(params.power!), params.shr, pressure, units);

    const duty = splitDuty(entering, leaving, massFlow, units);
    const warnings: string[] = leaving.warnings.map((warning) => warning.message);

    // When a requested capacity and SHR would drive the air past saturation,
    // the state is clamped to the saturation curve — and the duty the coil
    // actually delivers is then not the duty that was asked for. Reporting the
    // clamped result without saying so would show a coil quietly doing more
    // work than it was specified to do.
    if (params.power !== undefined) {
      const requested = -Math.abs(params.power);
      const shortfall = Math.abs(duty.total - requested);
      if (shortfall > Math.abs(requested) * 1e-6) {
        warnings.push(
          `Delivers ${Math.abs(duty.total).toFixed(1)} against the ${Math.abs(requested).toFixed(1)} ` +
            `requested: a sensible heat ratio of ${params.shr.toFixed(2)} at this capacity would ` +
            'drive the air past saturation, so the leaving state has been clamped to the ' +
            'saturation curve. Lower the sensible heat ratio, or reduce the capacity.',
        );
      }
    }

    if (leaving.tdb > entering.tdb) {
      warnings.push(
        `Leaving temperature (${leaving.tdb.toFixed(1)}°) is above entering ` +
          `(${entering.tdb.toFixed(1)}°). A cooling coil cannot heat the air.`,
      );
    }

    // The check a senior engineer makes, carried over from bh-psych's teaching
    // content and evaluated here rather than left as advice: real coils leave
    // air close to saturation, so a dry leaving condition means the selection,
    // the SHR, or the bypass factor deserves another look.
    if (duty.latent < 0 && leaving.rh < TYPICAL_LEAVING_RH_MIN) {
      warnings.push(
        `Off-coil relative humidity is ${(leaving.rh * 100).toFixed(0)}%. Coils that ` +
          'dehumidify typically leave air at 90–95% RH — check the selection, the ' +
          'sensible heat ratio, or the bypass factor.',
      );
    }

    if (entering.tdp <= leaving.tdb && duty.latent < -1e-9) {
      warnings.push(
        'This coil is removing moisture, but its leaving temperature is at or ' +
          'above the entering dew point — no condensation could occur. Check the ' +
          'sensible heat ratio.',
      );
    }

    const dryingNote =
      duty.latent < -1e-9 ? 'Sensible and latent cooling.' : 'Sensible cooling only — no condensation.';

    return {
      state: leaving,
      massFlow,
      airflow,
      duty,
      moistureRate: moistureRate(massFlow, leaving.w - entering.w, units),
      note: dryingNote,
      warnings,
    };
  },
};
