/**
 * Local type declarations for `jsthermalcomfort`.
 *
 * Two reasons these exist rather than using the package's own:
 *
 *  1. **The shipped declarations do not parse.** In 1.4.0,
 *     `lib/esm/types/models/pet_steady.d.ts` contains
 *     `(: [number, number, number]) => …` — a parameter with no name, from a
 *     generator bug. `skipLibCheck` suppresses *semantic* errors in declaration
 *     files but not *syntax* errors, so the build fails on a function this
 *     application never calls.
 *
 *  2. **The shipped signatures are `any`.** `pmv_ppd_ashrae(tdb: any, tr: any,
 *     …)` gives no protection against passing relative humidity as a fraction
 *     where percent is wanted, which is exactly the mistake worth catching.
 *
 * `tsconfig.json` maps the module here via `paths`, so TypeScript never reads
 * the package's own types. Runtime resolution is untouched — Vite still imports
 * the real module.
 *
 * Only the surface this application uses is declared. Anything else needs
 * adding here first, which is a feature: it forces a look at the upstream
 * signature rather than trusting `any`.
 */
declare module 'jsthermalcomfort' {
  export interface PmvPpdOptions {
    /** Unit system of the inputs. This application always passes `'SI'`. */
    units?: 'SI' | 'IP';
    /** When true, out-of-range inputs return NaN. */
    limit_inputs?: boolean;
    /** Whether the occupant controls air speed, per ASHRAE 55. */
    airspeed_control?: boolean;
    /**
     * Rounds PMV to 2 decimal places and PPD to 1.
     *
     * **Defaults to true, and must be false for the comfort-boundary solver** —
     * quantised PMV turns the bisection into a staircase that cannot converge.
     */
    round_output?: boolean;
  }

  export interface PmvPpdResult {
    /** Predicted Mean Vote on the ASHRAE 55 scale, −3 to +3. */
    pmv: number;
    /** Predicted Percentage Dissatisfied, %. */
    ppd: number;
  }

  /**
   * PMV and PPD per ASHRAE 55.
   *
   * For relative air speeds above 0.1 m/s this applies the SET-based cooling
   * effect of ASHRAE Appendix H before evaluating PMV.
   *
   * @param tdb Dry-bulb air temperature, °C (or °F when `units` is `'IP'`).
   * @param tr Mean radiant temperature, same units as `tdb`.
   * @param vr Relative air speed, m/s (or fps under `'IP'`).
   * @param rh Relative humidity as a **percentage**, 0–100.
   * @param met Metabolic rate, met.
   * @param clo Clothing insulation, clo.
   * @param wme External work, met. Almost always zero.
   */
  export function pmv_ppd_ashrae(
    tdb: number,
    tr: number,
    vr: number,
    rh: number,
    met: number,
    clo: number,
    wme?: number,
    kwargs?: PmvPpdOptions,
  ): PmvPpdResult;

  export interface AdaptiveAshraeResult {
    /** Neutral comfort temperature. Null when the inputs are out of range. */
    tmp_cmf: number;
    tmp_cmf_80_low: number;
    tmp_cmf_80_up: number;
    tmp_cmf_90_low: number;
    tmp_cmf_90_up: number;
    acceptability_80: boolean;
    acceptability_90: boolean;
  }

  /**
   * The ASHRAE 55 adaptive comfort model.
   *
   * Returns nulls in every temperature field when `t_running_mean` falls
   * outside 10–33.5 °C, which is how the out-of-range case is detected.
   *
   * @param tdb Dry-bulb air temperature.
   * @param tr Mean radiant temperature.
   * @param t_running_mean Prevailing mean outdoor temperature.
   * @param v Air speed, m/s.
   */
  export function adaptive_ashrae(
    tdb: number,
    tr: number,
    t_running_mean: number,
    v: number,
    units?: 'SI' | 'IP',
    limit_inputs?: boolean,
    round_output?: boolean,
  ): AdaptiveAshraeResult;
}
