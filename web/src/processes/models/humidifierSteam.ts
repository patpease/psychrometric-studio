/**
 * Steam humidifier — isothermal humidification.
 *
 * Dry steam injects moisture with only a small sensible gain, so the process is
 * a near-vertical climb on the chart. Near-vertical, not vertical: the steam
 * arrives hot and the air does warm slightly. Drawing it as exactly vertical is
 * a common simplification that this tool deliberately does not make, because
 * seeing the lean is part of understanding the process.
 *
 *     h₂ = h₁ + (W₂ − W₁) · h_steam
 */
import { fromEnthalpyW, saturationHumidityRatio } from '../../psych/state.js';
import { bisect } from '../../psych/numeric.js';
import { lib } from '../../psych/psychrolib.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { moistureRate, resolveFlow, splitDuty } from '../duty.js';
import type { UnitSystem } from '../../psych/units.js';

/**
 * Enthalpy of the injected saturated steam, in canonical units
 * (Btu/lb | J/kg). Exposed as a parameter because a humidifier fed from a
 * different steam pressure carries a different enthalpy.
 */
const DEFAULT_STEAM_ENTHALPY: Record<UnitSystem, number> = { IP: 1150, SI: 2.676e6 };

export interface SteamHumidifierParams {
  /** Target leaving relative humidity, 0–1. */
  readonly rhOut?: number | undefined;
  /** Moisture injection rate, lb/h | kg/h. */
  readonly moistureRate?: number | undefined;
  /** Enthalpy of the steam, canonical units. */
  readonly steamEnthalpy?: number | undefined;
}

export const steamHumidifierModel: ProcessModel<SteamHumidifierParams> = {
  type: 'humidifier-steam',
  displayName: 'Steam humidifier',

  parseParams: (raw) => {
    const rhOut = optionalNumber(raw, 'rhOut');
    const rate = optionalNumber(raw, 'moistureRate');
    if (rhOut === undefined && rate === undefined) {
      throw new ProcessError(
        'Steam humidifier: give either a target relative humidity or a moisture rate.',
        'humidifier-steam',
        'rhOut',
      );
    }
    if (rhOut !== undefined && (rhOut <= 0 || rhOut > 1)) {
      throw new ProcessError(
        'Steam humidifier: target relative humidity must be between 0 and 1.',
        'humidifier-steam',
        'rhOut',
      );
    }
    return { rhOut, moistureRate: rate, steamEnthalpy: optionalNumber(raw, 'steamEnthalpy') };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) {
      throw new ProcessError('Steam humidifier: needs an entering airstream.', 'humidifier-steam');
    }

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Steam humidifier',
    );

    const steamEnthalpy = params.steamEnthalpy ?? DEFAULT_STEAM_ENTHALPY[units];
    const psy = lib(units);

    /** The leaving state for a given moisture addition, per the energy balance. */
    const stateForDeltaW = (deltaW: number) =>
      fromEnthalpyW(entering.h + deltaW * steamEnthalpy, entering.w + deltaW, pressure, units);

    let deltaW: number;

    if (params.moistureRate !== undefined) {
      // Convert the rate back to a humidity-ratio change. IP mass flow is per
      // hour and matches the rate directly; SI mass flow is per second.
      deltaW =
        units === 'IP'
          ? params.moistureRate / massFlow
          : params.moistureRate / (massFlow * 3600);
    } else {
      // Both temperature and humidity ratio move, so the target RH has no
      // closed form. RH rises monotonically with moisture added, which makes
      // bisection safe. The upper bracket is saturation at the entering
      // temperature — the leaving temperature is slightly higher, so this is a
      // conservative bound that always contains the answer.
      const target = params.rhOut!;
      const maxDeltaW = Math.max(
        saturationHumidityRatio(entering.tdb, pressure, units) - entering.w,
        0,
      );
      if (maxDeltaW <= 0) {
        throw new ProcessError(
          'Steam humidifier: the entering air is already saturated.',
          'humidifier-steam',
          'rhOut',
        );
      }

      const residual = (dw: number): number => {
        const trial = stateForDeltaW(dw);
        return psy.GetRelHumFromHumRatio(trial.tdb, trial.w, pressure) - target;
      };

      if (residual(0) >= 0) {
        throw new ProcessError(
          `Steam humidifier: the entering air is already at or above ${(target * 100).toFixed(0)}% RH.`,
          'humidifier-steam',
          'rhOut',
        );
      }

      deltaW = residual(maxDeltaW) < 0 ? maxDeltaW : bisect(residual, 0, maxDeltaW, { tolerance: 1e-12 });
    }

    const leaving = stateForDeltaW(deltaW);
    const warnings: string[] = leaving.warnings.map((warning) => warning.message);

    if (deltaW < 0) {
      warnings.push('A humidifier cannot remove moisture. Check the target condition.');
    }
    if (leaving.rh > 0.9) {
      warnings.push(
        `Leaving air is at ${(leaving.rh * 100).toFixed(0)}% RH. Check the absorption ` +
          'distance — steam must fully absorb before the next component or duct ' +
          'sensor, or condensation and false humidity readings follow.',
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: moistureRate(massFlow, deltaW, units),
      note: `Near-isothermal: dry bulb rises ${(leaving.tdb - entering.tdb).toFixed(1)}°.`,
      warnings,
    };
  },
};
