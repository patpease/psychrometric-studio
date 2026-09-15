/**
 * What the PDF report says, separated from how it is drawn.
 *
 * Everything the report shows is computed **here** and handed to the layout
 * already solved and already formatted. The layout positions text; it does not
 * calculate, and it does not decide precision. That is what makes the report,
 * the screen, and the CSV agree — three things deriving the same numbers three
 * times is three chances to disagree, and the report would be the one nobody
 * notices is wrong.
 *
 * ## Why this is not a network payload any more
 *
 * It used to be. The report was rendered by a FastAPI service using ReportLab,
 * and this file built the JSON to post to it. That service was written, tested,
 * and never deployed — which is the honest measure of what it cost. Rendering
 * in the browser removes a container, a cold start, a CORS rule and a permanent
 * `connect-src` exception, and it keeps the claim that nothing leaves the
 * machine true rather than aspirational.
 *
 * The shape below survived the move deliberately. It was the contract between
 * "what we solved" and "what gets laid out" when those were two processes, and
 * it is worth keeping now that they are two modules.
 */
import type { SolvedAirstream } from '../processes/chain.js';
import { checkEnergyBalance, systemTotals } from '../processes/chain.js';
import { LABELS, type UnitSystem } from '../psych/units.js';
import type { Atmosphere } from '../psych/atmosphere.js';
import { describeBasis } from '../psych/atmosphere.js';
import type { ProjectMeta } from '../types/project.js';
import { DISCLAIMER_SHORT, provenanceStamp } from '../config/branding.js';
import {
  formatEnthalpy,
  formatHumidityRatio,
  formatPressure,
  formatRelativeHumidity,
  formatTemperature,
} from '../ui/format.js';

/** One row of the state-point table, already in display units. */
export interface ReportStatePoint {
  readonly point: number;
  readonly name: string;
  /** Present instead of the readings when the stage did not solve. */
  readonly error?: string;
  readonly tdb?: string;
  readonly twb?: string;
  readonly rh?: string;
  readonly tdp?: string;
  readonly w?: string;
  readonly h?: string;
}

/** One row of the load table. */
export interface ReportLoad {
  readonly point: number;
  readonly name: string;
  readonly total: string;
  readonly sensible: string;
  readonly latent: string;
  readonly shr: string;
}

export interface ReportTotals {
  readonly cooling: string;
  readonly heating: string;
  readonly humidification: string;
  readonly dehumidification: string;
  /** `null` when there is nothing solved to balance. */
  readonly balance: string | null;
  readonly balanceCloses: boolean;
}

/** One operating case — one page of the report. */
export interface ReportCase {
  readonly label: string;
  readonly statePoints: readonly ReportStatePoint[];
  readonly loads: readonly ReportLoad[];
  readonly totals: ReportTotals;
  /**
   * The chart, serialised as a standalone SVG document.
   *
   * Absent when the chart could not be serialised, which loses the drawing and
   * nothing else — the tables are the part somebody checks.
   */
  readonly chartSvg?: string | undefined;
}

export interface ReportPayload {
  readonly meta: ProjectMeta;
  readonly units: UnitSystem;
  /** The site pressure, as a sentence. */
  readonly pressure: string;
  readonly unitLabels: Record<string, string>;
  readonly cases: readonly ReportCase[];
  readonly provenance: ReturnType<typeof provenanceStamp>;
  readonly disclaimer: string;
}

export interface ReportInputCase {
  readonly label: string;
  readonly solved: SolvedAirstream;
  readonly chartSvg?: string | undefined;
}

export interface ReportInputs {
  readonly cases: readonly ReportInputCase[];
  readonly units: UnitSystem;
  readonly atmosphere: Atmosphere;
  readonly meta: ProjectMeta;
  readonly now?: Date;
}

/**
 * A duty, to one decimal, or an em dash.
 *
 * The same rule the Duties table uses on screen. A non-finite duty is a stage
 * that did not solve, and it prints as a gap rather than as `NaN` — but as a
 * gap in a row that is still there, so the reader can see that a component was
 * skipped.
 */
function duty(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function statePointsOf(solved: SolvedAirstream, units: UnitSystem): ReportStatePoint[] {
  return solved.stages.map((stage) => {
    const base = { point: stage.index + 1, name: stage.stage.name ?? stage.displayName };
    const result = stage.result;

    // A stage that did not solve travels as a named failure rather than being
    // dropped. A row silently missing from a schedule is how a mistake survives
    // review.
    if (!result) return { ...base, error: stage.error ?? 'did not solve' };

    const { state } = result;
    return {
      ...base,
      tdb: formatTemperature(state.tdb, units),
      twb: formatTemperature(state.twb, units),
      rh: formatRelativeHumidity(state.rh),
      tdp: formatTemperature(state.tdp, units),
      w: formatHumidityRatio(state.w, units),
      h: formatEnthalpy(state.h, units),
    };
  });
}

/**
 * The loads, minus the entering air.
 *
 * The source stage has no duty by definition — it is where the air arrives, not
 * something done to it — and a row of zeroes at the top of a load schedule
 * invites the reader to look for the equipment that produced them.
 */
function loadsOf(solved: SolvedAirstream): ReportLoad[] {
  return solved.stages
    .filter((stage) => stage.result && stage.index > 0)
    .map((stage) => {
      const { duty: split } = stage.result!;
      return {
        point: stage.index + 1,
        name: stage.stage.name ?? stage.displayName,
        total: duty(split.total),
        sensible: duty(split.sensible),
        latent: duty(split.latent),
        shr: Number.isFinite(split.shr) ? split.shr.toFixed(2) : '—',
      };
    });
}

function totalsOf(solved: SolvedAirstream, units: UnitSystem): ReportTotals {
  const totals = systemTotals(solved);
  const balance = checkEnergyBalance(solved, units);

  return {
    cooling: duty(totals.cooling),
    heating: duty(totals.heating),
    humidification: duty(totals.humidification),
    dehumidification: duty(totals.dehumidification),
    balanceCloses: balance?.closes ?? true,
    balance: balance
      ? balance.closes
        ? 'Energy balance closes across the chain.'
        : `Energy balance does not close — residual ${duty(balance.residual, 3)} ` +
          `${LABELS[units].duty} (${(balance.relativeResidual * 100).toFixed(2)}%).`
      : null,
  };
}

export function buildReportPayload({
  cases,
  units,
  atmosphere,
  meta,
  now,
}: ReportInputs): ReportPayload {
  return {
    meta,
    units,
    pressure: describeBasis(atmosphere, (p) => formatPressure(p, units, true)),
    unitLabels: { ...LABELS[units] },
    cases: cases.map((entry) => ({
      label: entry.label,
      statePoints: statePointsOf(entry.solved, units),
      loads: loadsOf(entry.solved),
      totals: totalsOf(entry.solved, units),
      ...(entry.chartSvg ? { chartSvg: entry.chartSvg } : {}),
    })),
    provenance: provenanceStamp(now),
    disclaimer: DISCLAIMER_SHORT,
  };
}
