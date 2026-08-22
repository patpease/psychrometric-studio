/**
 * The moist-air state engine.
 *
 * A state is fully determined by dry-bulb temperature, humidity ratio, and
 * barometric pressure. Every other property derives from those three. Users
 * enter whichever pair they have; each pair is resolved to (Tdb, W) and then
 * solved once, so there is exactly one code path producing properties.
 *
 * Two behaviours are load-bearing and carried over from bh-psych:
 *
 *  - **Saturation clamp with a warning.** A requested state above the
 *    saturation curve is impossible. Clamping silently is how confusing results
 *    reach reports, so the clamp is recorded on the state and surfaced.
 *  - **Canonical storage.** W in lb/lb | kg/kg, enthalpy in Btu/lb | J/kg.
 *    Display conversion happens at the edge, in `units.ts`, never here.
 */
import { lib } from './psychrolib.js';
import type { UnitSystem } from './units.js';
import { bisect } from './numeric.js';

/** Something the engine had to do to the user's input to make it physical. */
export interface StateWarning {
  readonly code: 'saturation-clamped' | 'below-freezing' | 'rh-clamped';
  readonly message: string;
  /** The value as requested, before adjustment. */
  readonly requested: number;
  /** The value actually used. */
  readonly applied: number;
}

/** A fully solved moist-air state. All values in canonical units. */
export interface MoistAirState {
  readonly units: UnitSystem;
  /** Dry-bulb temperature, °F | °C. */
  readonly tdb: number;
  /** Humidity ratio, lb/lb | kg/kg. */
  readonly w: number;
  /** Barometric pressure, psia | Pa. */
  readonly pressure: number;
  /** Relative humidity, 0..1. */
  readonly rh: number;
  /** Wet-bulb temperature, °F | °C. */
  readonly twb: number;
  /** Dew-point temperature, °F | °C. */
  readonly tdp: number;
  /** Moist air enthalpy per unit dry air, Btu/lb | **J/kg**. */
  readonly h: number;
  /** Moist air volume per unit dry air, ft³/lb | m³/kg. */
  readonly v: number;
  /** Moist air density, lb/ft³ | kg/m³. */
  readonly density: number;
  /** Partial pressure of water vapour, psia | Pa. */
  readonly vapourPressure: number;
  /** Degree of saturation, 0..1. */
  readonly degreeOfSaturation: number;
  /** Saturation humidity ratio at this Tdb and pressure, lb/lb | kg/kg. */
  readonly wSaturation: number;
  readonly warnings: readonly StateWarning[];
}

/** Saturation humidity ratio at a temperature and pressure. */
export function saturationHumidityRatio(
  tdb: number,
  pressure: number,
  units: UnitSystem,
): number {
  return lib(units).GetSatHumRatio(tdb, pressure);
}

/**
 * Solve a state from its three independent variables.
 *
 * This is the only function that constructs a `MoistAirState`; every named
 * constructor below resolves its inputs to (Tdb, W) and delegates here.
 */
export function solveState(
  tdb: number,
  w: number,
  pressure: number,
  units: UnitSystem,
  priorWarnings: readonly StateWarning[] = [],
): MoistAirState {
  if (!Number.isFinite(tdb)) {
    throw new RangeError(`solveState: dry-bulb temperature must be finite, got ${tdb}`);
  }
  if (!(pressure > 0)) {
    throw new RangeError(`solveState: pressure must be positive, got ${pressure}`);
  }
  if (!(w >= 0)) {
    throw new RangeError(`solveState: humidity ratio must be non-negative, got ${w}`);
  }

  const psy = lib(units);
  const warnings: StateWarning[] = [...priorWarnings];

  const wSaturation = psy.GetSatHumRatio(tdb, pressure);
  let wUsed = w;

  if (w > wSaturation) {
    warnings.push({
      code: 'saturation-clamped',
      message:
        `Humidity ratio ${w.toExponential(4)} exceeds saturation ` +
        `${wSaturation.toExponential(4)} at this temperature and pressure. ` +
        'The state has been clamped to the saturation curve — the air cannot ' +
        'hold this much moisture. Check the entering condition or the process ' +
        'that produced it.',
      requested: w,
      applied: wSaturation,
    });
    wUsed = wSaturation;
  }

  return {
    units,
    tdb,
    w: wUsed,
    pressure,
    rh: psy.GetRelHumFromHumRatio(tdb, wUsed, pressure),
    twb: psy.GetTWetBulbFromHumRatio(tdb, wUsed, pressure),
    tdp: psy.GetTDewPointFromHumRatio(tdb, wUsed, pressure),
    h: psy.GetMoistAirEnthalpy(tdb, wUsed),
    v: psy.GetMoistAirVolume(tdb, wUsed, pressure),
    density: psy.GetMoistAirDensity(tdb, wUsed, pressure),
    vapourPressure: psy.GetVapPresFromHumRatio(wUsed, pressure),
    degreeOfSaturation: psy.GetDegreeOfSaturation(tdb, wUsed, pressure),
    wSaturation,
    warnings,
  };
}

/* -------------------------------------------------------------------------- *
 * Named constructors, one per input pair a user might have
 * -------------------------------------------------------------------------- */

/** Dry bulb + relative humidity (0..1). */
export function fromTdbRh(
  tdb: number,
  rh: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  const warnings: StateWarning[] = [];
  let rhUsed = rh;

  if (rh < 0 || rh > 1) {
    rhUsed = Math.min(Math.max(rh, 0), 1);
    warnings.push({
      code: 'rh-clamped',
      message: `Relative humidity ${(rh * 100).toFixed(1)}% is outside 0–100% and has been clamped.`,
      requested: rh,
      applied: rhUsed,
    });
  }

  const w = lib(units).GetHumRatioFromRelHum(tdb, rhUsed, pressure);
  return solveState(tdb, w, pressure, units, warnings);
}

/** Dry bulb + wet bulb. */
export function fromTdbTwb(
  tdb: number,
  twb: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  if (twb > tdb) {
    throw new RangeError(
      `fromTdbTwb: wet-bulb (${twb}) cannot exceed dry-bulb (${tdb}). ` +
        'Wet-bulb equals dry-bulb only at saturation.',
    );
  }
  const w = lib(units).GetHumRatioFromTWetBulb(tdb, twb, pressure);
  return solveState(tdb, w, pressure, units);
}

/** Dry bulb + dew point. */
export function fromTdbTdp(
  tdb: number,
  tdp: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  if (tdp > tdb) {
    throw new RangeError(
      `fromTdbTdp: dew point (${tdp}) cannot exceed dry-bulb (${tdb}). ` +
        'Dew point equals dry-bulb only at saturation.',
    );
  }
  const w = lib(units).GetHumRatioFromTDewPoint(tdp, pressure);
  return solveState(tdb, w, pressure, units);
}

/** Dry bulb + humidity ratio (canonical lb/lb | kg/kg). */
export function fromTdbW(
  tdb: number,
  w: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  return solveState(tdb, w, pressure, units);
}

/**
 * Dry bulb + enthalpy (canonical Btu/lb | J/kg).
 *
 * PsychroLib 2.5.0 supplies `GetHumRatioFromEnthalpyAndTDryBulb`, so no
 * hand-derived inverse is required here.
 */
export function fromTdbEnthalpy(
  tdb: number,
  h: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  const w = lib(units).GetHumRatioFromEnthalpyAndTDryBulb(h, tdb);
  return solveState(tdb, Math.max(w, 0), pressure, units);
}

/** Enthalpy + humidity ratio, both canonical. Used by the mixing solver. */
export function fromEnthalpyW(
  h: number,
  w: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  const tdb = lib(units).GetTDryBulbFromEnthalpyAndHumRatio(h, w);
  return solveState(tdb, w, pressure, units);
}

/**
 * Wet bulb + relative humidity.
 *
 * No closed form: dry bulb is found by bisection on the residual
 * `RH(Tdb, Twb) − RH_target`, which is monotonic in Tdb for fixed Twb.
 * The bracket runs from the wet-bulb temperature (where RH = 100%) upward.
 */
export function fromTwbRh(
  twb: number,
  rh: number,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  if (rh <= 0 || rh > 1) {
    throw new RangeError(`fromTwbRh: relative humidity must be in (0, 1], got ${rh}`);
  }
  if (rh === 1) return fromTdbTwb(twb, twb, pressure, units);

  const psy = lib(units);
  // 200 °F / 110 °C above the wet bulb is far beyond any habitable state and
  // guarantees the bracket spans the root.
  const span = units === 'IP' ? 200 : 110;
  const residual = (tdb: number): number =>
    psy.GetRelHumFromTWetBulb(tdb, twb, pressure) - rh;

  // Tightening past PsychroLib's own 0.001° convergence tolerance buys nothing
  // — the residual function is not resolved more finely than that. 1e-6 is
  // comfortably below the noise floor without spinning on meaningless digits.
  const tdb = bisect(residual, twb, twb + span, { tolerance: 1e-6 });
  return fromTdbTwb(tdb, twb, pressure, units);
}

/* -------------------------------------------------------------------------- *
 * Declarative input — the form stored in project files
 * -------------------------------------------------------------------------- */

/**
 * A state as the user specified it. Stored in project files rather than the
 * solved values, so that reopening a project at a different site pressure
 * re-solves rather than silently carrying stale properties.
 */
export type StateInput =
  | { readonly kind: 'tdb-rh'; readonly tdb: number; readonly rh: number }
  | { readonly kind: 'tdb-twb'; readonly tdb: number; readonly twb: number }
  | { readonly kind: 'tdb-tdp'; readonly tdb: number; readonly tdp: number }
  | { readonly kind: 'tdb-w'; readonly tdb: number; readonly w: number }
  | { readonly kind: 'tdb-h'; readonly tdb: number; readonly h: number }
  | { readonly kind: 'h-w'; readonly h: number; readonly w: number }
  | { readonly kind: 'twb-rh'; readonly twb: number; readonly rh: number };

/** Solve any declared input against a site pressure. */
export function solve(
  input: StateInput,
  pressure: number,
  units: UnitSystem,
): MoistAirState {
  switch (input.kind) {
    case 'tdb-rh':
      return fromTdbRh(input.tdb, input.rh, pressure, units);
    case 'tdb-twb':
      return fromTdbTwb(input.tdb, input.twb, pressure, units);
    case 'tdb-tdp':
      return fromTdbTdp(input.tdb, input.tdp, pressure, units);
    case 'tdb-w':
      return fromTdbW(input.tdb, input.w, pressure, units);
    case 'tdb-h':
      return fromTdbEnthalpy(input.tdb, input.h, pressure, units);
    case 'h-w':
      return fromEnthalpyW(input.h, input.w, pressure, units);
    case 'twb-rh':
      return fromTwbRh(input.twb, input.rh, pressure, units);
  }
}

/** True if the state sits on the saturation curve, within tolerance. */
export function isSaturated(state: MoistAirState, tolerance = 1e-9): boolean {
  return Math.abs(state.w - state.wSaturation) <= tolerance;
}

/** True if the engine had to adjust the requested state to make it physical. */
export function wasClamped(state: MoistAirState): boolean {
  return state.warnings.some((warning) => warning.code === 'saturation-clamped');
}
