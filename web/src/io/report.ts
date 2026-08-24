/**
 * Building the payload for the PDF report, and asking the API for it.
 *
 * Everything the report shows is computed **here** and sent already solved. The
 * API lays out; it does not calculate. That is what makes the two agree — a
 * service that re-derived duties from state points would drift from the chart
 * on screen, and the report would be the thing that was wrong.
 *
 * The service is optional. The web application works with it down, and the
 * export panel only offers PDF once `/health` has answered, so the button is
 * never a promise the tool cannot keep.
 */
import type { SolvedAirstream } from '../processes/chain.js';
import { checkEnergyBalance, systemTotals } from '../processes/chain.js';
import {
  LABELS,
  humidityRatioToDisplay,
  enthalpyToDisplay,
  type UnitSystem,
} from '../psych/units.js';
import type { Atmosphere } from '../psych/atmosphere.js';
import { describeBasis } from '../psych/atmosphere.js';
import type { ProjectMeta } from '../types/project.js';
import { provenanceStamp } from '../config/branding.js';
import { formatPressure } from '../ui/format.js';

/**
 * Where the report service lives.
 *
 * Configured at build time. The default is the local development port, so a
 * checkout works without a `.env` and a deployment that forgets to set it fails
 * visibly — the health check does not answer and the button does not appear —
 * rather than silently posting projects to somewhere unexpected.
 */
export const API_BASE: string =
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:8000';

export interface ReportPayload {
  meta: ProjectMeta;
  units: UnitSystem;
  pressure: string;
  labels: Record<string, string>;
  statePoints: unknown[];
  loads: unknown[];
  totals: Record<string, unknown>;
  chartPng?: string;
  provenance: ReturnType<typeof provenanceStamp>;
}

export interface ReportInputs {
  readonly solved: SolvedAirstream;
  readonly units: UnitSystem;
  readonly atmosphere: Atmosphere;
  readonly meta: ProjectMeta;
  /** Base64 PNG of the chart, without a data: prefix. */
  readonly chartPng?: string | undefined;
}

export function buildReportPayload({
  solved,
  units,
  atmosphere,
  meta,
  chartPng,
}: ReportInputs): ReportPayload {
  const totals = systemTotals(solved);
  const balance = checkEnergyBalance(solved, units);

  const statePoints = solved.stages.map((stage) => {
    const base = {
      point: stage.index + 1,
      name: stage.stage.name ?? stage.displayName,
      type: stage.stage.type,
    };
    const result = stage.result;
    // A stage that did not solve travels as a named failure rather than being
    // dropped. A row silently missing from a schedule is how a mistake survives
    // review.
    if (!result) return { ...base, error: stage.error ?? 'did not solve' };

    return {
      ...base,
      tdb: result.state.tdb,
      twb: result.state.twb,
      tdp: result.state.tdp,
      rh: result.state.rh,
      w: humidityRatioToDisplay(result.state.w, units),
      h: enthalpyToDisplay(result.state.h, units),
      v: result.state.v,
      airflow: result.airflow,
      massFlow: result.massFlow,
    };
  });

  const loads = solved.stages
    .filter((stage) => stage.result && !(stage.index === 0 && stage.result.duty.total === 0))
    .map((stage) => {
      const result = stage.result!;
      return {
        point: stage.index + 1,
        name: stage.stage.name ?? stage.displayName,
        type: stage.stage.type,
        total: result.duty.total,
        sensible: result.duty.sensible,
        latent: result.duty.latent,
        // An undefined ratio travels as null. Sending NaN would arrive as the
        // JSON literal `null` anyway — but only by accident, and the receiving
        // end would have no way to tell that from a field nobody set.
        shr: Number.isFinite(result.duty.shr) ? result.duty.shr : null,
        moisture: result.moistureRate,
        adp: result.coil?.adp ?? null,
        bypass: result.coil?.bypassFactor ?? null,
        note: [result.note, ...result.warnings].filter(Boolean).join(' ') || null,
      };
    });

  return {
    meta,
    units,
    pressure: describeBasis(atmosphere, (p) => formatPressure(p, units, true)),
    labels: { ...LABELS[units] },
    statePoints,
    loads,
    totals: {
      cooling: totals.cooling,
      heating: totals.heating,
      humidification: totals.humidification,
      dehumidification: totals.dehumidification,
      netSensible: totals.netDuty.sensible,
      netLatent: totals.netDuty.latent,
      balance: balance
        ? balance.closes
          ? 'Energy balance closes across the chain.'
          : `Energy balance does not close: residual ${balance.residual.toFixed(3)} ` +
            `${LABELS[units].duty} (${(balance.relativeResidual * 100).toFixed(2)}%).`
        : null,
    },
    ...(chartPng ? { chartPng } : {}),
    provenance: provenanceStamp(),
  };
}

/** Is the report service answering? Used to decide whether to offer PDF at all. */
export async function reportServiceAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`, {
      // A health check that hangs is the same as one that failed, as far as
      // deciding whether to show a button goes.
      signal: signal ?? AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function requestReport(payload: ReportPayload): Promise<Blob> {
  const response = await fetch(`${API_BASE}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // The API returns a JSON detail; a proxy or a crash returns something else.
    // Both have to produce a sentence rather than "[object Object]".
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* not JSON; the status line is the best available. */
    }
    throw new Error(`The report service could not render this project — ${detail}`);
  }

  return response.blob();
}
