/**
 * Duty accounting — the arithmetic every process shares.
 *
 * Two operations appear in almost every stage, and both are easy to get subtly
 * wrong, so they live here once rather than being re-derived per model:
 *
 *  - **Splitting a duty** into sensible and latent parts.
 *  - **Applying a duty** to an entering state to find the leaving state.
 *
 * They are exact inverses, which is what the round-trip tests assert.
 */
import { lib } from '../psych/psychrolib.js';
import { humidityRatioFromEnthalpy } from '../psych/inverse.js';
import { fromTdbW, solveState, type MoistAirState } from '../psych/state.js';
import {
  duty as dutyFromEnthalpy,
  deltaEnthalpyFromDuty,
  massFlow as massFlowFrom,
  airflow as airflowFrom,
  type UnitSystem,
} from '../psych/units.js';
import type { DutySplit } from './types.js';
import { ProcessError } from './types.js';

/**
 * Split the duty between two states into sensible and latent parts.
 *
 * The sensible part is defined as the enthalpy change that would have occurred
 * at the *entering* humidity ratio — that is, heating or cooling the air to its
 * final temperature without exchanging moisture. The latent part is whatever
 * remains.
 *
 * Defining it through enthalpy rather than as `m · cp · ΔT` keeps the split
 * consistent with the total to machine precision, and keeps it unit-agnostic:
 * the same expression works in Btu/lb and J/kg. This is bh-psych's
 * `_split_duty` and it is worth preserving exactly.
 */
export function splitDuty(
  entering: MoistAirState,
  leaving: MoistAirState,
  massFlow: number,
  units: UnitSystem,
): DutySplit {
  const psy = lib(units);
  const total = dutyFromEnthalpy(massFlow, leaving.h - entering.h, units);

  // Enthalpy of the leaving temperature at the entering humidity ratio.
  const sensibleEnthalpy = psy.GetMoistAirEnthalpy(leaving.tdb, entering.w);
  const sensible = dutyFromEnthalpy(massFlow, sensibleEnthalpy - entering.h, units);

  return {
    total,
    sensible,
    latent: total - sensible,
    shr: total === 0 ? Number.NaN : sensible / total,
  };
}

/**
 * Moisture exchange rate, lb/h (IP) | kg/h (SI).
 *
 * IP mass flow is already per hour; SI mass flow is per second and is scaled to
 * match, because a moisture rate quoted per second is useless to a designer
 * sizing a humidifier.
 */
export function moistureRate(
  massFlow: number,
  deltaW: number,
  units: UnitSystem,
): number {
  return units === 'IP' ? massFlow * deltaW : massFlow * deltaW * 3600;
}

/**
 * Apply a total duty with a given sensible heat ratio to an entering state.
 *
 * This is the inverse of {@link splitDuty}, and the shared core of every
 * power-defined process — cooling coils, room loads, and (with SHR = 1) heating
 * coils and fans.
 *
 * The leaving temperature comes from the sensible part applied at constant
 * humidity ratio; the leaving humidity ratio then comes from the total enthalpy
 * at that temperature. Working in this order means the split is honoured by
 * construction rather than approximated.
 *
 * A result past saturation is clamped by `solveState`, which records a warning
 * — a coil asked for more latent capacity than the air can give up is a real
 * design condition worth flagging, not an error to throw on.
 */
export function applyDuty(
  entering: MoistAirState,
  massFlow: number,
  totalDuty: number,
  shr: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  const psy = lib(units);
  const deltaTotal = deltaEnthalpyFromDuty(totalDuty, massFlow, units);
  const deltaSensible = deltaTotal * shr;

  const leavingTdb = psy.GetTDryBulbFromEnthalpyAndHumRatio(entering.h + deltaSensible, entering.w);
  const leavingEnthalpy = entering.h + deltaTotal;
  const leavingW = humidityRatioFromEnthalpy(leavingEnthalpy, leavingTdb, units);

  // A humidity ratio driven below zero means the requested SHR is impossible
  // for this duty — the air would have to give up more moisture than it holds.
  if (leavingW < 0) {
    return fromTdbW(leavingTdb, 0, pressure, units);
  }

  return solveState(leavingTdb, leavingW, pressure, units);
}

/** Apply a purely sensible duty: temperature changes, humidity ratio does not. */
export function applySensibleDuty(
  entering: MoistAirState,
  massFlow: number,
  totalDuty: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  const psy = lib(units);
  const delta = deltaEnthalpyFromDuty(totalDuty, massFlow, units);
  const leavingTdb = psy.GetTDryBulbFromEnthalpyAndHumRatio(entering.h + delta, entering.w);
  return fromTdbW(leavingTdb, entering.w, pressure, units);
}

/**
 * Resolve the mass flow and volumetric airflow for a stage.
 *
 * A stage with its own airflow figure computes mass flow from the specific
 * volume of the **entering** state. A stage without one inherits the upstream
 * mass flow and re-derives its volumetric flow from the same entering state —
 * which is why airflow changes down a chain even though mass flow does not.
 * Conflating the two is the classic source of a system that appears to gain air
 * across a heating coil.
 */
export function resolveFlow(
  entering: MoistAirState,
  declaredAirflow: number | undefined,
  upstreamMassFlow: number | null,
  units: UnitSystem,
  stageLabel: string,
): { massFlow: number; airflow: number } {
  if (declaredAirflow !== undefined && declaredAirflow > 0) {
    return {
      massFlow: massFlowFrom(declaredAirflow, entering.v, units),
      airflow: declaredAirflow,
    };
  }

  if (upstreamMassFlow === null) {
    throw new ProcessError(
      `${stageLabel}: the first stage of an airstream needs an airflow.`,
      'source',
      'airflow',
    );
  }

  return {
    massFlow: upstreamMassFlow,
    airflow: airflowFrom(upstreamMassFlow, entering.v, units),
  };
}
