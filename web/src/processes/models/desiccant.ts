/**
 * Desiccant dehumidification — **an idealisation, and labelled as one.**
 *
 * Air passes over a sorbent that removes water vapour. The heat of sorption is
 * released into the airstream, so the air leaves drier and hotter. This model
 * treats that exchange as **isenthalpic**: the moisture removed converts
 * exactly to sensible heat, and total enthalpy is unchanged.
 *
 * ## What that assumption is worth
 *
 * The isenthalpic path is a recognised teaching approximation and gets the
 * *shape* of the process right — down and to the right, at roughly constant
 * enthalpy. It is not a design model. A real rotary desiccant wheel departs
 * from it because the sorption isotherm is not linear, the regeneration
 * temperature sets how far the wheel can dry, and the matrix carries heat
 * between the process and regeneration sides. The standard analytical treatment
 * uses the F1/F2 characteristic potentials of Banks and Jurinak, which need the
 * regeneration condition as an input and are the documented follow-on.
 *
 * So this stage carries a warning on every result, and the plan records the
 * fidelity target. **Do not present its output as a coil selection.**
 *
 * @see PLAN.md §13 decision 2
 */
import { lib } from '../../psych/psychrolib.js';
import { bisect } from '../../psych/numeric.js';
import { solveState, type MoistAirState } from '../../psych/state.js';
import {
  ProcessError,
  optionalNumber,
  type ProcessModel,
  type StageResult,
} from '../types.js';
import { moistureRate, resolveFlow, splitDuty } from '../duty.js';
import { humidityRatioFromDisplay } from '../../psych/units.js';

export interface DesiccantParams {
  /** Target leaving humidity ratio, in **display** units (gr/lb | g/kg). */
  readonly wOut?: number | undefined;
  /** Or the fraction of the entering moisture removed, 0–1. */
  readonly removal?: number | undefined;
}

export const desiccantModel: ProcessModel<DesiccantParams> = {
  type: 'desiccant',
  displayName: 'Desiccant dehumidifier',

  parseParams: (raw) => {
    const wOut = optionalNumber(raw, 'wOut');
    const removal = optionalNumber(raw, 'removal');
    if (wOut === undefined && removal === undefined) {
      throw new ProcessError(
        'Desiccant: give either a leaving humidity ratio or the fraction of ' +
          'moisture removed.',
        'desiccant',
        'wOut',
      );
    }
    if (removal !== undefined && (removal < 0 || removal >= 1)) {
      throw new ProcessError(
        'Desiccant: the removal fraction must be between 0 and 1. Removing all ' +
          'the moisture is not achievable with any real sorbent.',
        'desiccant',
        'removal',
      );
    }
    return { wOut, removal };
  },

  apply: (context, params): StageResult => {
    const { entering, pressure, units } = context;
    if (!entering) throw new ProcessError('Desiccant: needs an entering airstream.', 'desiccant');

    const { massFlow, airflow } = resolveFlow(
      entering,
      context.airflow,
      context.upstreamMassFlow,
      units,
      'Desiccant',
    );

    const targetW =
      params.wOut !== undefined
        ? humidityRatioFromDisplay(params.wOut, units)
        : entering.w * (1 - params.removal!);

    if (targetW >= entering.w) {
      throw new ProcessError(
        'Desiccant: the target is wetter than the entering air. A desiccant ' +
          'removes moisture; it cannot add it.',
        'desiccant',
        params.wOut !== undefined ? 'wOut' : 'removal',
      );
    }

    // The isenthalpic assumption: enthalpy is unchanged, so the leaving
    // temperature is whatever holds total enthalpy constant at the drier state.
    const psy = lib(units);
    const leavingTdb = psy.GetTDryBulbFromEnthalpyAndHumRatio(entering.h, targetW);
    const leaving: MoistAirState = solveState(leavingTdb, targetW, pressure, units);

    const warnings: string[] = leaving.warnings.map((warning) => warning.message);

    // Every result carries this. The model is useful and it is not a design
    // tool, and the user should not have to remember which.
    warnings.push(
      'Modelled as an idealised isenthalpic sorption path: all the heat of ' +
        'sorption is assumed to appear as sensible heat, with no regeneration ' +
        'condition and no carry-over between the wheel’s two sides. The shape is ' +
        'right; the numbers are indicative. Use manufacturer performance data for ' +
        'selection.',
    );

    const rise = leaving.tdb - entering.tdb;
    if (rise <= 0) {
      warnings.push(
        'Drying air at constant enthalpy must warm it. A leaving temperature at ' +
          'or below the entering one means something is wrong; please report it.',
      );
    }

    return {
      state: leaving,
      massFlow,
      airflow,
      // Isenthalpic by construction, so total duty is zero: the sensible gain
      // and the latent loss are equal and opposite.
      duty: splitDuty(entering, leaving, massFlow, units),
      moistureRate: moistureRate(massFlow, leaving.w - entering.w, units),
      note: `Idealised: dries at constant enthalpy, warming ${rise.toFixed(1)}°.`,
      warnings,
    };
  },
};

/**
 * Leaving state for a desiccant at a target relative humidity.
 *
 * Both temperature and humidity ratio move along the constant-enthalpy line, so
 * relative humidity has no closed form here. It falls monotonically as the air
 * dries, which makes bisection safe.
 *
 * Exported for the field-derivation helper rather than used by the model.
 */
export function desiccantWForRelHum(
  entering: MoistAirState,
  targetRh: number,
  pressure: number,
  units: 'IP' | 'SI',
): number | null {
  const psy = lib(units);
  const residual = (w: number): number => {
    const tdb = psy.GetTDryBulbFromEnthalpyAndHumRatio(entering.h, w);
    return psy.GetRelHumFromHumRatio(tdb, w, pressure) - targetRh;
  };

  if (residual(entering.w) < 0) return null;
  try {
    return bisect(residual, entering.w * 1e-3, entering.w, { tolerance: 1e-12 });
  } catch {
    return null;
  }
}
