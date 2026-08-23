/**
 * Air-to-air energy recovery.
 *
 * One model serves the sensible wheel, the enthalpy wheel, the plate heat
 * exchanger, and the run-around loop: they differ only in whether moisture
 * transfers and in what effectiveness is achievable, not in the arithmetic.
 *
 *     ε_sensible = (T₁ − T₂) / (T₁ − T₃)
 *     ε_latent   = (W₁ − W₂) / (W₁ − W₃)
 *
 * where 1 is this airstream entering, 2 is it leaving, and 3 is the other
 * airstream entering.
 *
 * ## Unequal airflows
 *
 * Effectiveness is defined against the **smaller** of the two mass flows —
 * the stream that limits how much can be exchanged. With equal flows the
 * distinction vanishes, which is why it is easy to omit and wrong to. With a
 * supply stream larger than the exhaust, using the supply flow would credit the
 * device with recovering more than the exhaust stream had to give.
 *
 * ## What this model does not do
 *
 * It solves **this** airstream. The other airstream's leaving condition is
 * computed and reported as an auxiliary state, but is *not* fed back into that
 * stream's own chain — the solver runs each airstream once, in dependency
 * order. For the usual case, where the exhaust stream ends at the recovery
 * device, that is complete. If you need to model something downstream of the
 * exhaust side, add it as its own stage there.
 */
import { fromEnthalpyW, fromTdbRh, fromTdbW, type MoistAirState } from '../../psych/state.js';
import { deltaEnthalpyFromDuty, duty as dutyFromEnthalpy } from '../../psych/units.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { moistureRate, resolveFlow, splitDuty } from '../duty.js';
import type { StageType } from '../../types/project.js';

export interface RecoveryParams {
  readonly sensible: number;
  /** Zero for devices that transfer no moisture. */
  readonly latent: number;
  /** Entering condition of the other stream, if not supplied by a coupling. */
  readonly tdb3?: number | undefined;
  readonly rh3?: number | undefined;
  /** Airflow of the other stream, for the unequal-flow correction. */
  readonly airflow3?: number | undefined;
}

/** Effectiveness ranges a real device achieves, used to flag optimistic input. */
const TYPICAL_MAX: Partial<Record<StageType, number>> = {
  'recovery-wheel-sensible': 0.85,
  'recovery-wheel-enthalpy': 0.85,
  'recovery-plate': 0.75,
  'recovery-runaround': 0.65,
};

function makeRecovery(
  type: StageType,
  displayName: string,
  options: { transfersMoisture: boolean; summary: string },
): ProcessModel<RecoveryParams> {
  return {
    type,
    displayName,

    parseParams: (raw) => {
      const sensible = optionalNumber(raw, 'sensible');
      if (sensible === undefined) {
        throw new ProcessError(
          `${displayName}: a sensible effectiveness is required.`,
          type,
          'sensible',
        );
      }
      if (sensible < 0 || sensible > 1) {
        throw new ProcessError(
          `${displayName}: effectiveness must be between 0 and 1. Above 1 the device ` +
            'would move more energy than the two streams differ by, which no ' +
            'passive exchanger can do.',
          type,
          'sensible',
        );
      }

      const latentRaw = optionalNumber(raw, 'latent') ?? 0;
      if (!options.transfersMoisture && latentRaw > 0) {
        throw new ProcessError(
          `${displayName}: this device transfers no moisture, so its latent ` +
            'effectiveness must be zero. Use an enthalpy wheel to recover moisture.',
          type,
          'latent',
        );
      }
      if (latentRaw < 0 || latentRaw > 1) {
        throw new ProcessError(
          `${displayName}: latent effectiveness must be between 0 and 1.`,
          type,
          'latent',
        );
      }

      return {
        sensible,
        latent: options.transfersMoisture ? latentRaw : 0,
        tdb3: optionalNumber(raw, 'tdb3'),
        rh3: optionalNumber(raw, 'rh3'),
        airflow3: optionalNumber(raw, 'airflow3'),
      };
    },

    apply: (context, params): StageResult => {
      const { entering, pressure, units } = context;
      if (!entering) throw new ProcessError(`${displayName}: needs an entering airstream.`, type);

      const { massFlow, airflow } = resolveFlow(
        entering,
        context.airflow,
        context.upstreamMassFlow,
        units,
        displayName,
      );

      // The other stream comes from a coupled airstream, or from a condition
      // entered directly on this stage.
      let other: MoistAirState;
      const coupled = context.couplings['exchange-stream'];
      if (coupled) {
        other = coupled;
      } else if (params.tdb3 !== undefined && params.rh3 !== undefined) {
        other = fromTdbRh(params.tdb3, params.rh3, pressure, units);
      } else {
        throw new ProcessError(
          `${displayName}: give the other airstream a condition, or couple this ` +
            'stage to the airstream it exchanges with.',
          type,
          'tdb3',
        );
      }

      // Effectiveness is referenced to the smaller mass flow.
      const otherMassFlow =
        context.couplingMassFlow['exchange-stream'] ??
        (params.airflow3 !== undefined
          ? resolveFlow(other, params.airflow3, null, units, displayName).massFlow
          : massFlow);
      const ratio = Math.min(otherMassFlow, massFlow) / massFlow;

      const leavingTdb = entering.tdb - params.sensible * ratio * (entering.tdb - other.tdb);
      const leavingW = entering.w - params.latent * ratio * (entering.w - other.w);

      const leaving = fromTdbW(leavingTdb, Math.max(leavingW, 0), pressure, units);
      const duty = splitDuty(entering, leaving, massFlow, units);

      /**
       * The other stream's leaving condition, derived from **conservation**
       * rather than from its own effectiveness.
       *
       * Mirroring the temperature change would be the obvious thing to do and
       * is subtly wrong: the two streams sit at different humidity ratios, so
       * their specific heats differ, and an equal ΔT does *not* carry equal
       * energy. Building the exhaust side that way leaves a residual of a few
       * per cent — small enough to look like rounding and large enough to be an
       * invented energy source.
       *
       * Instead: the water removed from one stream is the water added to the
       * other, and the energy leaving one is the energy entering the other.
       * Both balances then hold by construction, and the check below can only
       * fail if this reasoning is wrong.
       */
      const moistureTransferred = massFlow * (entering.w - leaving.w);
      const otherW = Math.max(other.w + moistureTransferred / otherMassFlow, 0);

      const energyTransferred = dutyFromEnthalpy(massFlow, leaving.h - entering.h, units);
      const otherEnthalpy =
        other.h - deltaEnthalpyFromDuty(energyTransferred, otherMassFlow, units);

      const otherLeaving = fromEnthalpyW(otherEnthalpy, otherW, pressure, units);

      const warnings: string[] = leaving.warnings.map((warning) => warning.message);
      const typical = TYPICAL_MAX[type];
      if (typical !== undefined && params.sensible > typical) {
        warnings.push(
          `A sensible effectiveness of ${(params.sensible * 100).toFixed(0)}% is above the ` +
            `${(typical * 100).toFixed(0)}% a ${displayName.toLowerCase()} typically achieves. ` +
            'Check the manufacturer data, and that the pump or wheel energy is ' +
            'counted against the recovery benefit.',
        );
      }

      // Energy must cross the boundary in equal and opposite amounts. It does,
      // by the construction above — so this check can only fire if that
      // reasoning is wrong, which is exactly what a guard is for.
      const otherDuty = dutyFromEnthalpy(otherMassFlow, otherLeaving.h - other.h, units);
      const imbalance = Math.abs(duty.total + otherDuty);
      const scale = Math.max(Math.abs(duty.total), 1e-9);
      if (imbalance / scale > 1e-6) {
        warnings.push(
          `Energy exchanged does not balance between the two airstreams ` +
            `(${duty.total.toFixed(2)} against ${otherDuty.toFixed(2)}). This is a ` +
            'defect in the tool, not in your system; please report it.',
        );
      }

      // Moisture balances too: a wheel moves water between streams, it does not
      // create or destroy it.
      const otherMoisture = otherMassFlow * (otherLeaving.w - other.w);
      if (Math.abs(moistureTransferred - otherMoisture) > Math.max(Math.abs(moistureTransferred), 1e-12) * 1e-6) {
        warnings.push(
          'Moisture exchanged does not balance between the two airstreams. This ' +
            'is a defect in the tool; please report it.',
        );
      }

      return {
        state: leaving,
        massFlow,
        airflow,
        duty,
        moistureRate: moistureRate(massFlow, leaving.w - entering.w, units),
        note:
          `${(params.sensible * 100).toFixed(0)}% sensible` +
          (options.transfersMoisture ? `, ${(params.latent * 100).toFixed(0)}% latent` : '') +
          (ratio < 1 ? ` · limited by the smaller airflow (${(ratio * 100).toFixed(0)}%)` : ''),
        warnings,
        auxiliary: [
          { label: 'Other stream entering', state: other },
          { label: 'Other stream leaving', state: otherLeaving },
        ],
      };
    },
  };
}

export const sensibleWheelModel = makeRecovery(
  'recovery-wheel-sensible',
  'Sensible wheel',
  {
    transfersMoisture: false,
    summary: 'A rotating matrix transfers heat only.',
  },
);

export const enthalpyWheelModel = makeRecovery(
  'recovery-wheel-enthalpy',
  'Enthalpy wheel',
  {
    transfersMoisture: true,
    summary: 'A desiccant-coated matrix transfers heat and moisture.',
  },
);

export const plateExchangerModel = makeRecovery('recovery-plate', 'Plate heat exchanger', {
  transfersMoisture: false,
  summary: 'Fixed plates separate the streams; sensible only, and no cross-leakage.',
});

export const runAroundModel = makeRecovery('recovery-runaround', 'Run-around coil', {
  transfersMoisture: false,
  summary: 'A pumped loop couples coils in two streams that never meet.',
});
