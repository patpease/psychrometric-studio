/**
 * Typed access to the vendored PsychroLib.
 *
 * PsychroLib ships as UMD and exports a *singleton* whose unit system is
 * module-global mutable state, set via `SetUnitSystem`. Every call thereafter
 * silently depends on whichever system was set last. bh-psych guarded this with
 * a threading lock; the equivalent hazard in JavaScript is any interleaving
 * between setting the system and reading a value, plus the outright
 * impossibility of computing IP and SI side by side.
 *
 * The fix: construct two independent instances from the singleton's own
 * constructor, pin each to one unit system at module load, and never call
 * `SetUnitSystem` again. The vendored file stays unmodified.
 *
 * @see docs/adr/0002-dual-instance-unit-systems.md
 */
// @ts-expect-error — vendored UMD module, no type declarations upstream.
// Resolved via the local `vendor/` package so the bundler handles UMD interop
// identically in the browser, in the production build, and under vitest.
import psychrolibSingleton from 'psychrolib-vendored';

/** The subset of the PsychroLib surface this application uses. */
export interface PsychroLib {
  // Saturation
  GetSatVapPres(tDryBulb: number): number;
  GetSatHumRatio(tDryBulb: number, pressure: number): number;
  GetSatAirEnthalpy(tDryBulb: number, pressure: number): number;

  // Humidity ratio conversions
  GetHumRatioFromRelHum(tDryBulb: number, relHum: number, pressure: number): number;
  GetHumRatioFromTWetBulb(tDryBulb: number, tWetBulb: number, pressure: number): number;
  GetHumRatioFromTDewPoint(tDewPoint: number, pressure: number): number;
  GetHumRatioFromVapPres(vapPres: number, pressure: number): number;
  /** Present in PsychroLib 2.5.0 — no hand-derived enthalpy inverse is needed. */
  GetHumRatioFromEnthalpyAndTDryBulb(moistAirEnthalpy: number, tDryBulb: number): number;

  // Derived properties
  GetRelHumFromHumRatio(tDryBulb: number, humRatio: number, pressure: number): number;
  GetTWetBulbFromHumRatio(tDryBulb: number, humRatio: number, pressure: number): number;
  GetTDewPointFromHumRatio(tDryBulb: number, humRatio: number, pressure: number): number;
  GetVapPresFromHumRatio(humRatio: number, pressure: number): number;
  GetRelHumFromTWetBulb(tDryBulb: number, tWetBulb: number, pressure: number): number;
  GetTWetBulbFromRelHum(tDryBulb: number, relHum: number, pressure: number): number;
  GetDegreeOfSaturation(tDryBulb: number, humRatio: number, pressure: number): number;

  // Enthalpy / volume / density
  GetDryAirEnthalpy(tDryBulb: number): number;
  GetMoistAirEnthalpy(tDryBulb: number, humRatio: number): number;
  GetMoistAirVolume(tDryBulb: number, humRatio: number, pressure: number): number;
  GetMoistAirDensity(tDryBulb: number, humRatio: number, pressure: number): number;
  GetDryAirVolume(tDryBulb: number, pressure: number): number;
  GetTDryBulbFromEnthalpyAndHumRatio(moistAirEnthalpy: number, humRatio: number): number;
  GetTDryBulbFromMoistAirVolumeAndHumRatio(
    moistAirVolume: number,
    humRatio: number,
    pressure: number,
  ): number;

  // Atmosphere
  GetStandardAtmPressure(altitude: number): number;
  GetStandardAtmTemperature(altitude: number): number;

  // Unit-system constants (present on every instance)
  readonly IP: number;
  readonly SI: number;
  SetUnitSystem(system: number): void;
  isIP(): boolean;
}

type UnitSystem = 'IP' | 'SI';

/**
 * `psychrolibSingleton` is `new Psychrometrics()`, so its `.constructor` is the
 * class itself. Constructing from it yields instances with private unit state.
 */
const Psychrometrics = (psychrolibSingleton as PsychroLib)
  .constructor as new () => PsychroLib;

function pinned(system: UnitSystem): PsychroLib {
  const instance = new Psychrometrics();
  instance.SetUnitSystem(system === 'IP' ? instance.IP : instance.SI);
  return instance;
}

/** PsychroLib pinned to IP units. Never call `SetUnitSystem` on this. */
export const psyIP: PsychroLib = pinned('IP');

/** PsychroLib pinned to SI units. Never call `SetUnitSystem` on this. */
export const psySI: PsychroLib = pinned('SI');

/** The PsychroLib instance for a unit system. Both are always available. */
export function lib(units: UnitSystem): PsychroLib {
  return units === 'IP' ? psyIP : psySI;
}

/**
 * PsychroLib's internal floor on humidity ratio.
 *
 * Every function that accepts a humidity ratio clamps it to at least this value
 * — so `GetMoistAirVolume(t, 0, p)` actually returns the volume at 1e-7, and any
 * inverse correctly recovers 1e-7 rather than 0. In display terms this is
 * 0.0007 gr/lb or 0.0001 g/kg: far below measurable, but it means round trips
 * through bone-dry air are not bit-exact, and tests must sweep above it.
 */
export const MIN_HUM_RATIO = 1e-7;

/**
 * PsychroLib's own iterative convergence tolerance, in temperature units.
 *
 * `GetTWetBulbFromHumRatio` and `GetTDewPointFromVapPres` are iterative and
 * stop once the bracket is narrower than this. **Wet-bulb temperature is
 * therefore resolved only to about ±0.001 °C**, and any humidity ratio derived
 * through a wet bulb inherits roughly 4e-7 kg/kg of slop (about 0.0004 g/kg,
 * or 0.003 gr/lb).
 *
 * That is far below engineering significance, but it is the noise floor of the
 * whole application: no downstream solver, test, or displayed value should
 * claim precision finer than this. Tests that assert tighter agreement are
 * asserting something the calculation basis cannot deliver.
 */
export const CONVERGENCE_TOLERANCE = {
  /** Degrees Fahrenheit. */
  IP: 0.001 * (9 / 5),
  /** Degrees Celsius. */
  SI: 0.001,
  /** Approximate resulting slop in humidity ratio, lb/lb | kg/kg. */
  humidityRatio: 4e-7,
} as const;

/**
 * The calculation basis, stamped on every export so a result can always be
 * traced back to the code that produced it.
 * @see web/vendor/PROVENANCE.md
 */
export const CALCULATION_BASIS = {
  library: 'PsychroLib',
  version: '2.5.0',
  reference: 'ASHRAE Handbook — Fundamentals, Chapter 1 (2017)',
  sha256: 'a46572b93a90263b8e19e8d1372fe3135429aa9611cd57e00674188640cc96c9',
} as const;

/**
 * How PsychroLib asks to be cited.
 *
 * Two entries, because the project asks for two: the software summary paper,
 * and **the version actually in use** — each with its own DOI. A concept DOI
 * pointing at "whatever is latest" would be the easy thing to write and the
 * wrong thing to publish, since the numbers in a report came from one release
 * and no other.
 *
 * Written in the same form as the weather citation the About panel already
 * carries — authors, year, title, source, DOI — so the two read as one
 * bibliography rather than as two libraries' house styles.
 *
 * `version` below must move with `CALCULATION_BASIS.version`; the DOI is the
 * per-release one from Zenodo, not the concept DOI.
 * `tests/calculation-basis.test.ts` fails if the two disagree.
 */
export const PSYCHROLIB_CITATION = {
  /** The software summary paper. */
  paper:
    'Meyer, D., D. Thevenard. 2019. PsychroLib: a library of psychrometric ' +
    'functions to calculate thermodynamic properties of air. Journal of Open ' +
    'Source Software 4(33): 1137. https://doi.org/10.21105/joss.01137',
  /** The release this tool is built on. */
  software:
    'Meyer, D., D. Thevenard. 2020. PsychroLib (v2.5.0). ' +
    'https://doi.org/10.5281/zenodo.3748874',
  version: '2.5.0',
} as const;
