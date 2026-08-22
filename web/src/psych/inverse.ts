/**
 * Hand-derived inverses.
 *
 * PsychroLib is the source of truth wherever it provides a function. This file
 * holds the exceptions — and as of Phase 1 there is exactly one in the
 * calculation path. Every function here is round-tripped against its PsychroLib
 * forward function in `tests/inverse.test.ts` to 1e-9 or better, because this is
 * the one place where an arithmetic slip would silently distort the chart
 * rather than throw.
 *
 * @see docs/calculation-reference.md §8
 */
import { lib } from './psychrolib.js';
import type { UnitSystem } from './units.js';

/**
 * Ratio of the molar mass of dry air to that of water, as used by PsychroLib's
 * `GetMoistAirVolume`. Asserted against the library's own implied value in the
 * test suite so it cannot drift out of step with the vendored source.
 */
export const MOLAR_MASS_RATIO = 1.607858;

/**
 * Humidity ratio at a given specific volume and dry-bulb temperature.
 *
 * Needed for the constant-specific-volume chart family: PsychroLib inverts
 * volume for *temperature* (`GetTDryBulbFromMoistAirVolumeAndHumRatio`) but not
 * for humidity ratio.
 *
 * The forward relation is exactly linear in W:
 *
 *     v = v_dry · (1 + 1.607858 · W)
 *
 * where `v_dry` is the specific volume of dry air at the same temperature and
 * pressure — which PsychroLib provides directly as `GetDryAirVolume`. So the
 * inverse needs no gas constants and no re-derived physics, only a
 * rearrangement:
 *
 *     W = (v / v_dry − 1) / 1.607858
 *
 * Deriving it this way rather than expanding `R_da · T / P` keeps the physics
 * inside PsychroLib, where it is validated, and confines the hand-written part
 * to arithmetic that a round-trip test can pin down completely.
 *
 * Returns a value that may be negative for a volume below the dry-air volume at
 * that temperature — physically impossible, and left to the caller to clip,
 * because the chart wants to know that the line has left the domain.
 */
export function humidityRatioFromVolume(
  specificVolume: number,
  tdb: number,
  pressure: number,
  units: UnitSystem,
): number {
  const dryAirVolume = lib(units).GetDryAirVolume(tdb, pressure);
  return (specificVolume / dryAirVolume - 1) / MOLAR_MASS_RATIO;
}

/**
 * Dry-bulb temperature at a given specific volume and humidity ratio.
 *
 * A thin pass-through to PsychroLib, present so that callers working with the
 * volume family have both inverses in one place.
 */
export function tdbFromVolume(
  specificVolume: number,
  w: number,
  pressure: number,
  units: UnitSystem,
): number {
  return lib(units).GetTDryBulbFromMoistAirVolumeAndHumRatio(specificVolume, w, pressure);
}

/**
 * Humidity ratio at a given enthalpy and dry-bulb temperature.
 *
 * Not hand-derived — PsychroLib 2.5.0 supplies this directly. It is re-exported
 * here so the chart's line-family code has a single, consistent import site for
 * every "W as a function of Tdb along a constant X" relation, and so that the
 * asymmetry between the enthalpy family (upstream) and the volume family
 * (local) does not leak into the caller.
 */
export function humidityRatioFromEnthalpy(
  enthalpy: number,
  tdb: number,
  units: UnitSystem,
): number {
  return lib(units).GetHumRatioFromEnthalpyAndTDryBulb(enthalpy, tdb);
}
