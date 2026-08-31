/**
 * CSV export: every solved state point and every process load.
 *
 * A CSV is where this data goes to be argued with — pasted into a load
 * schedule, checked against a manufacturer's selection, diffed against last
 * week's run. So it is written for a spreadsheet to read and for a person to
 * audit, which pulls in two directions and is resolved the same way bh-psych
 * resolved it: a commented provenance block first, then clean rectangular data.
 *
 * The provenance block is not decoration. Every number below depends on the
 * barometric pressure and the unit system, and a column of dry-bulb
 * temperatures with no indication of which is a trap. Excel shows the `#` lines
 * as text in the first column and skips over them; a human reads them first.
 */
import type { SolvedAirstream } from '../processes/chain.js';
import { systemTotals, type SystemTotals } from '../processes/chain.js';
import { LABELS, humidityRatioToDisplay, enthalpyToDisplay, type UnitSystem } from '../psych/units.js';
import type { Atmosphere } from '../psych/atmosphere.js';
import { describeBasis } from '../psych/atmosphere.js';
import type { ProjectMeta } from '../types/project.js';
import { APP_VERSION, BRAND, DISCLAIMER_SHORT } from '../config/branding.js';
import { CALCULATION_BASIS } from '../psych/psychrolib.js';
import { formatPressure } from '../ui/format.js';

/**
 * Quote a field for CSV.
 *
 * RFC 4180: wrap in quotes if the value contains a comma, a quote, or a
 * newline, and double any embedded quotes. Stage names are user-typed and
 * "Coil, 4-row" is an entirely reasonable thing to type.
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values: readonly (string | number | null | undefined)[]): string {
  return values.map(cell).join(',');
}

/** Fixed decimals, or blank for a value that is not a number. */
function num(value: number | null | undefined, places: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : '';
}

export interface CsvOptions {
  readonly solved: SolvedAirstream;
  readonly units: UnitSystem;
  readonly atmosphere: Atmosphere;
  readonly meta: ProjectMeta;
  readonly generated?: Date;
}

export function toCsv({
  solved,
  units,
  atmosphere,
  meta,
  generated = new Date(),
}: CsvOptions): string {
  const lines: string[] = [];

  lines.push(...provenance({ units, atmosphere, meta, generated }));

  lines.push(...systemSections(solved, units));

  return `${lines.join('\r\n')}\r\n`;
}


/** One operating case in a combined schedule. */
export interface CombinedCsvCase {
  readonly label: string;
  readonly solved: SolvedAirstream;
}

export interface CombinedCsvOptions {
  readonly cases: readonly CombinedCsvCase[];
  readonly units: UnitSystem;
  readonly atmosphere: Atmosphere;
  readonly meta: ProjectMeta;
  readonly generated?: Date;
}

/**
 * Every operating case in one schedule, with the totals set against each other.
 *
 * The provenance is written once, because it is true of the whole file: one
 * project, one unit system, one site pressure, one build. What repeats is the
 * per-case block, verbatim from the same generator the single-case export uses.
 *
 * The comparison at the end is the reason the file exists. A reader with two
 * separate exports has to align the totals by hand and can get it wrong; here
 * the peak cooling and the peak heating for the same air handler sit on one
 * row, which is the number a plant selection is actually made from.
 */
export function toCombinedCsv({
  cases,
  units,
  atmosphere,
  meta,
  generated = new Date(),
}: CombinedCsvOptions): string {
  const labels = LABELS[units];
  const lines: string[] = [
    ...provenance({ units, atmosphere, meta, generated }),
    `# Operating cases: ${cases.map((entry) => entry.label).join(', ')}`,
    '',
  ];

  for (const entry of cases) {
    lines.push(`# ===== ${entry.label} =====`);
    lines.push('');
    lines.push(...systemSections(entry.solved, units));
    lines.push('');
  }

  /* -- comparison -------------------------------------------------------- */
  const totals = cases.map((entry) => systemTotals(entry.solved));
  lines.push('# Comparison');
  lines.push(row(['Quantity', ...cases.map((entry) => entry.label), 'Unit']));

  const compare = [
    ['Total cooling', (t: SystemTotals) => num(t.cooling, 2), labels.duty],
    ['Total heating', (t: SystemTotals) => num(t.heating, 2), labels.duty],
    ['Humidification', (t: SystemTotals) => num(t.humidification, 2), labels.moistureRate],
    ['Dehumidification', (t: SystemTotals) => num(t.dehumidification, 2), labels.moistureRate],
    ['Net sensible', (t: SystemTotals) => num(t.netDuty.sensible, 2), labels.duty],
    ['Net latent', (t: SystemTotals) => num(t.netDuty.latent, 2), labels.duty],
  ] as const;

  for (const [name, read, unit] of compare) {
    lines.push(row([name, ...totals.map(read), unit]));
  }

  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The header every export carries: who made it, from what, at what pressure.
 *
 * One copy, because a combined file states it once for the whole schedule and
 * a single-case file states it once for the case. A report that cannot be
 * traced to the build that produced it is a liability, so this is not
 * optional and not allowed to differ between the two.
 */
function provenance({
  units,
  atmosphere,
  meta,
  generated,
}: {
  units: UnitSystem;
  atmosphere: Atmosphere;
  meta: ProjectMeta;
  generated: Date;
}): string[] {
  const lines: string[] = [];

  /* -- provenance ------------------------------------------------------- */
  lines.push(`# ${BRAND.appName} — ${BRAND.organisation}`);
  if (meta.name) lines.push(`# Project: ${meta.name}`);
  if (meta.projectNumber) lines.push(`# Project number: ${meta.projectNumber}`);
  if (meta.client) lines.push(`# Client: ${meta.client}`);
  if (meta.engineer) lines.push(`# Engineer: ${meta.engineer}`);
  lines.push(`# Generated: ${generated.toISOString()}`);
  lines.push(`# Application version: ${APP_VERSION}`);
  lines.push(`# Calculation basis: ${CALCULATION_BASIS.library} ${CALCULATION_BASIS.version} — ${CALCULATION_BASIS.reference}`);
  lines.push(`# Unit system: ${units}`);
  lines.push(`# Site pressure: ${describeBasis(atmosphere, (p) => formatPressure(p, units, true))}`);
  lines.push(`# ${DISCLAIMER_SHORT}`);
  lines.push('#');
  lines.push('# Sign convention: duties are positive INTO the airstream, so a cooling coil is negative.');
  lines.push('');

  return lines;
}
/**
 * Everything about one operating case: its state points, its process loads,
 * and its totals.
 *
 * Split out so the single-case export and the combined one emit byte-identical
 * sections. A second copy would drift, and a schedule that disagrees with
 * itself between two exports of the same project is worse than either.
 */
function systemSections(solved: SolvedAirstream, units: UnitSystem): string[] {
  const labels = LABELS[units];
  const lines: string[] = [];

  /* -- state points ------------------------------------------------------ */
  lines.push('# State points');
  lines.push(
    row([
      'Point',
      'Stage',
      'Type',
      `Dry bulb (${labels.temperature})`,
      `Wet bulb (${labels.temperature})`,
      'Relative humidity (%)',
      `Dew point (${labels.temperature})`,
      `Humidity ratio (${labels.humidityRatio})`,
      `Enthalpy (${labels.enthalpy})`,
      `Specific volume (${labels.specificVolume})`,
      `Density (${labels.density})`,
      `Airflow (${labels.airflow})`,
      `Mass flow (${labels.massFlow})`,
    ]),
  );

  for (const stage of solved.stages) {
    const result = stage.result;
    if (!result) {
      // A stage that did not solve is written out with its reason rather than
      // omitted. A row silently missing from a schedule is how a mistake
      // survives review.
      lines.push(row([stage.index + 1, stage.stage.name ?? stage.displayName, stage.stage.type, `ERROR: ${stage.error ?? 'did not solve'}`]));
      continue;
    }
    const state = result.state;
    lines.push(
      row([
        stage.index + 1,
        stage.stage.name ?? stage.displayName,
        stage.stage.type,
        num(state.tdb, 2),
        num(state.twb, 2),
        num(state.rh * 100, 1),
        num(state.tdp, 2),
        num(humidityRatioToDisplay(state.w, units), units === 'IP' ? 2 : 3),
        num(enthalpyToDisplay(state.h, units), 2),
        num(state.v, 3),
        num(state.density, 4),
        num(result.airflow, 0),
        num(result.massFlow, units === 'IP' ? 0 : 3),
      ]),
    );
  }

  lines.push('');

  /* -- loads ------------------------------------------------------------- */
  lines.push('# Process loads');
  lines.push(
    row([
      'Point',
      'Stage',
      'Type',
      `Total (${labels.duty})`,
      `Sensible (${labels.duty})`,
      `Latent (${labels.duty})`,
      'SHR',
      `Moisture (${labels.moistureRate})`,
      `Apparatus dew point (${labels.temperature})`,
      'Bypass factor',
      'Notes',
    ]),
  );

  for (const stage of solved.stages) {
    const result = stage.result;
    if (!result) continue;
    // The source stage moves no energy; a row of zeros beside it invites
    // someone to sum the column and get the right answer for the wrong reason.
    if (stage.index === 0 && result.duty.total === 0) continue;

    const notes = [result.note, ...result.warnings].filter(Boolean).join(' ');
    lines.push(
      row([
        stage.index + 1,
        stage.stage.name ?? stage.displayName,
        stage.stage.type,
        num(result.duty.total, 2),
        num(result.duty.sensible, 2),
        num(result.duty.latent, 2),
        // NaN is what an undefined ratio *is* — zero total duty — and printing
        // it as 1.000 would be a lie a reader cannot detect.
        Number.isFinite(result.duty.shr) ? num(result.duty.shr, 3) : '',
        num(result.moistureRate, 2),
        num(result.coil?.adp ?? null, 2),
        num(result.coil?.bypassFactor ?? null, 3),
        notes,
      ]),
    );
  }

  lines.push('');

  /* -- totals ------------------------------------------------------------ */
  const totals = systemTotals(solved);
  lines.push('# System totals');
  lines.push(row(['Quantity', 'Value', 'Unit']));
  lines.push(row(['Total cooling', num(totals.cooling, 2), labels.duty]));
  lines.push(row(['Total heating', num(totals.heating, 2), labels.duty]));
  lines.push(row(['Humidification', num(totals.humidification, 2), labels.moistureRate]));
  lines.push(row(['Dehumidification', num(totals.dehumidification, 2), labels.moistureRate]));
  lines.push(row(['Net sensible', num(totals.netDuty.sensible, 2), labels.duty]));
  lines.push(row(['Net latent', num(totals.netDuty.latent, 2), labels.duty]));

  return lines;
}
