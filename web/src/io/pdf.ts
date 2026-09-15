/**
 * The report, drawn.
 *
 * One operating case per page: the chart, the state points, the loads, the
 * totals, and a footer that says where the numbers came from. Laid out by hand
 * rather than through a template engine — the document is a fixed structure
 * with no conditional shape to speak of, so a template would add a dependency
 * and a second place to look without removing any work.
 *
 * ## Why the chart gets a box, and why the box moves
 *
 * The chart is whatever shape the browser window made it, and that shape is not
 * the report's business. A tall chart drawn at full width would push the tables
 * off the page on some screens and not others, which is the worst kind of bug:
 * it depends on the reader's window. So the chart is fitted into a box and
 * centred, and never scaled past it.
 *
 * The box is sized from the schedule rather than fixed, because the schedule is
 * the thing that varies: a five-stage system and a twelve-stage one want very
 * different amounts of table. A fixed box generous enough for the first pushes
 * the second onto a continuation page and breaks the one promise this document
 * makes — a page per operating case. The row height below is measured, not
 * estimated.
 *
 * The box is a ceiling, not a reservation. A chart that fits on width uses less
 * height than it was offered, and the tables move up to meet it rather than
 * leaving a band of nothing in the middle of the page.
 *
 * ## Why the libraries load late
 *
 * jsPDF and its two companions are about 280 kB gzipped — roughly twice the
 * application. Imported at the top of this file they would be paid for by every
 * visitor, including the ones who never export anything. They are pulled in on
 * the first click instead. The cost is that this one feature needs the network
 * once per session; everything else in the tool still works offline.
 *
 * ## Three things this file takes seriously
 *
 * **The stamp.** Version, calculation basis, site pressure, unit system and
 * generation time appear in the footer of *every* page, not once on the first.
 * Reports get printed, split, and stapled into other documents; a page that
 * leaves the set must still say where it came from.
 *
 * **The disclaimer.** Present, on every page, beside the stamp.
 *
 * **Failure.** A case whose chart could not be serialised loses the drawing and
 * nothing else. The tables are the part somebody checks.
 */
import { BRAND } from '../config/branding.js';
import type { ReportCase, ReportPayload } from './report.js';

/* -------------------------------------------------------------------------- *
 * Geometry and palette
 * -------------------------------------------------------------------------- */

/** PostScript points per inch. jsPDF is driven in points throughout. */
const PT = 72;

export const PAGE = {
  width: 8.5 * PT,
  height: 11 * PT,
  margin: 0.6 * PT,
} as const;

const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;

const MASTHEAD_HEIGHT = 26;
/** Room kept clear at the foot of every page for the stamp. */
const FOOTER_RESERVE = 40;

/**
 * One row of a report table, in points.
 *
 * Measured against autoTable at the styles below rather than derived: it is
 * `fontSize × 1.15 + 2 × cellPadding`, and the day one of those changes this
 * number has to change with it. A header row costs the same as a body row.
 */
const ROW_HEIGHT = 15.625;

/** Top of the chart box, below the masthead and the project line. */
const CHART_TOP = PAGE.margin + MASTHEAD_HEIGHT + 13 + 12;

/** The totals strip: heading, rule, labels, figures, balance line. */
const TOTALS_HEIGHT = 54;

/** Gap above a table heading, and below the table that follows it. */
const TABLE_LEAD = 4;
const TABLE_TRAIL = 14;

/**
 * How tall the chart may be on a page carrying these tables.
 *
 * Bounded at both ends. Below the floor the drawing has stopped being readable
 * and a continuation page is the more honest outcome; above the ceiling a
 * three-stage system would get a chart that dwarfs its own schedule.
 */
const CHART_BOX = { min: 170, max: 420 } as const;

export function chartBoxHeight(statePoints: number, loads: number): number {
  const table = (rows: number): number =>
    TABLE_LEAD + (rows + 1) * ROW_HEIGHT + TABLE_TRAIL;

  const below =
    TABLE_TRAIL + table(statePoints) + (loads > 0 ? table(loads) : 0) + TOTALS_HEIGHT;

  const available = PAGE.height - PAGE.margin - FOOTER_RESERVE - CHART_TOP - below;
  return Math.min(CHART_BOX.max, Math.max(CHART_BOX.min, available));
}

type Rgb = readonly [number, number, number];

/** `#rrggbb` to the triple jsPDF wants. */
function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The report palette.
 *
 * The identity greens come from `BRAND` so that changing the mark changes the
 * report. The neutrals are the light-theme tokens from `styles.css`, repeated
 * here as literals because a PDF has no custom properties to resolve — the same
 * reason chart export inlines computed styles rather than shipping a stylesheet.
 */
const COLOUR = {
  accent: rgb(BRAND.colours.accent),
  accentBright: rgb(BRAND.colours.accentBright),
  ink: rgb('#14202b'),
  muted: rgb('#5d6b7a'),
  rule: rgb('#d9dee5'),
  band: rgb('#f2f5f4'),
  danger: rgb('#b3261e'),
} as const;

/* -------------------------------------------------------------------------- *
 * Table contents — pure, and tested as such
 * -------------------------------------------------------------------------- */

/**
 * The state-point columns, in the order and with the units the screen uses.
 *
 * Same columns, same order, same precision as `ResultsPanel` and the CSV. The
 * point of a report is to be the same information somewhere durable, not a
 * second opinion.
 */
export function statePointColumns(unitLabels: Record<string, string>): string[] {
  const unit = (key: string): string => (unitLabels[key] ? ` (${unitLabels[key]})` : '');
  return [
    'Point',
    `Tdb${unit('temperature')}`,
    `Twb${unit('temperature')}`,
    `RH${unit('relativeHumidity')}`,
    `Tdp${unit('temperature')}`,
    `W${unit('humidityRatio')}`,
    `h${unit('enthalpy')}`,
  ];
}

export function statePointRows(reportCase: ReportCase): string[][] {
  return reportCase.statePoints.map((point) => {
    const name = `${point.point}   ${point.name}`;
    // A stage that did not solve keeps its row and states the reason across the
    // readings, rather than showing six blanks that read as zeroes.
    if (point.error) return [name, point.error, '', '', '', '', ''];
    return [name, point.tdb!, point.twb!, point.rh!, point.tdp!, point.w!, point.h!];
  });
}

export function loadColumns(unitLabels: Record<string, string>): string[] {
  const duty = unitLabels['duty'] ? ` (${unitLabels['duty']})` : '';
  return ['Component', `Total${duty}`, `Sensible${duty}`, `Latent${duty}`, 'SHR'];
}

export function loadRows(reportCase: ReportCase): string[][] {
  return reportCase.loads.map((load) => [
    `${load.point}   ${load.name}`,
    load.total,
    load.sensible,
    load.latent,
    load.shr,
  ]);
}

/** The totals strip: four figures, each with the unit it is measured in. */
export function totalsEntries(
  reportCase: ReportCase,
  unitLabels: Record<string, string>,
): { label: string; value: string }[] {
  const duty = unitLabels['duty'] ?? '';
  const moisture = unitLabels['moistureRate'] ?? '';
  const { totals } = reportCase;
  return [
    { label: 'Total cooling', value: `${totals.cooling} ${duty}` },
    { label: 'Total heating', value: `${totals.heating} ${duty}` },
    { label: 'Humidification', value: `${totals.humidification} ${moisture}` },
    { label: 'Dehumidification', value: `${totals.dehumidification} ${moisture}` },
  ];
}

/**
 * The line under the masthead: who the project belongs to and what it was
 * solved against.
 *
 * Only the fields that were filled in. An empty project should print a short
 * line rather than a row of dangling labels.
 */
export function projectLine(payload: ReportPayload): string {
  const { meta } = payload;
  return [
    meta.name,
    meta.projectNumber,
    meta.client,
    meta.engineer ? `Engineer  ${meta.engineer}` : '',
    payload.pressure,
    `${payload.units} units`,
  ]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join('   ·   ');
}

/**
 * The two footer lines carried on every page.
 *
 * This is the whole provenance claim: the release, the calculation library and
 * its version, the pressure the project was solved at, the unit system, and
 * when it was generated.
 */
export function footerLines(payload: ReportPayload): [string, string] {
  const { provenance } = payload;
  const generated = provenance.generated.slice(0, 16).replace('T', ' ');
  return [
    `${provenance.application}  ·  v${provenance.version}  ·  ${provenance.libraryVersion}  ·  ` +
      `${payload.pressure}  ·  ${payload.units} units  ·  generated ${generated} UTC`,
    payload.disclaimer,
  ];
}

/** What the file is called. Mirrors `projectFilename`'s shape. */
export const REPORT_QUALIFIER = 'report';

/* -------------------------------------------------------------------------- *
 * Drawing
 * -------------------------------------------------------------------------- */

/**
 * Where a chart of this shape sits inside the fixed box, and how big.
 *
 * Fitted on whichever axis binds and centred horizontally, so a square chart
 * and a wide one both sit in the same band with the same top edge.
 */
export function fitChart(
  svgWidth: number,
  svgHeight: number,
  boxWidth: number = CONTENT_WIDTH,
  boxHeight: number = CHART_BOX.max,
): { width: number; height: number; offsetX: number } {
  if (!(svgWidth > 0) || !(svgHeight > 0)) {
    return { width: boxWidth, height: boxHeight, offsetX: 0 };
  }
  const scale = Math.min(boxWidth / svgWidth, boxHeight / svgHeight);
  const width = svgWidth * scale;
  const height = svgHeight * scale;
  return { width, height, offsetX: (boxWidth - width) / 2 };
}

/**
 * Render the report.
 *
 * Returns a PDF blob. Throws only if jsPDF itself cannot be loaded — a case
 * that fails to draw its chart still produces its tables.
 */
export async function reportToPdf(payload: ReportPayload): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    // Registers `doc.svg()` on the jsPDF prototype. Imported for the side
    // effect, so it has to be awaited alongside rather than after.
    import('svg2pdf.js'),
  ]);

  // `compress` is not a nicety. A vector psychrometric chart is a few thousand
  // path segments, and two of them come to roughly 420 kB uncompressed against
  // 85 kB deflated — for byte-identical output.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  doc.setFont('helvetica', 'normal');

  for (const [index, reportCase] of payload.cases.entries()) {
    if (index > 0) doc.addPage();
    await drawCase(doc, autoTable, payload, reportCase);
  }

  drawFooters(doc, payload);
  return doc.output('blob') as Blob;
}

/* The two libraries have no useful published types for what we pass around. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Doc = any;
type AutoTable = (doc: Doc, options: Record<string, unknown>) => void;

async function drawCase(
  doc: Doc,
  autoTable: AutoTable,
  payload: ReportPayload,
  reportCase: ReportCase,
): Promise<void> {
  const left = PAGE.margin;
  let y = PAGE.margin;

  /* -- masthead ---------------------------------------------------------- */
  doc.setFillColor(...COLOUR.accent);
  doc.rect(left, y, CONTENT_WIDTH, MASTHEAD_HEIGHT, 'F');
  doc.setFillColor(...COLOUR.accentBright);
  doc.rect(left, y, 4, MASTHEAD_HEIGHT, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Psychrometric Study', left + 12, y + 17.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(reportCase.label, left + CONTENT_WIDTH - 12, y + 17.5, { align: 'right' });
  y += MASTHEAD_HEIGHT + 13;

  /* -- project line ------------------------------------------------------ */
  doc.setTextColor(...COLOUR.muted);
  doc.setFontSize(8);
  doc.text(projectLine(payload), left, y);
  y += 12;

  /* -- chart ------------------------------------------------------------- */
  const boxHeight = chartBoxHeight(reportCase.statePoints.length, reportCase.loads.length);
  y += (await drawChart(doc, reportCase, left, y, boxHeight)) + TABLE_TRAIL;

  /* -- tables ------------------------------------------------------------ */
  const table = (title: string, head: string[], body: string[][]): void => {
    doc.setTextColor(...COLOUR.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(title, left, y);
    y += TABLE_LEAD;

    autoTable(doc, {
      startY: y,
      // The bottom margin keeps a long schedule from running into the footer
      // when it breaks onto a continuation page.
      margin: { left, right: PAGE.margin, bottom: PAGE.margin + FOOTER_RESERVE },
      head: [head],
      body,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 3.5,
        textColor: COLOUR.ink,
        lineColor: COLOUR.rule,
        lineWidth: 0.4,
        halign: 'right',
      },
      headStyles: { fillColor: COLOUR.accent, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLOUR.band },
      // The name column carries the point number and reads left; every other
      // column is a figure and reads right, so the decimal points line up.
      columnStyles: { 0: { halign: 'left', cellWidth: 126 } },
    });

    y = doc.lastAutoTable.finalY + TABLE_TRAIL;
  };

  table('State points', statePointColumns(payload.unitLabels), statePointRows(reportCase));

  if (reportCase.loads.length > 0) {
    table('Loads', loadColumns(payload.unitLabels), loadRows(reportCase));
  }

  drawTotals(doc, payload, reportCase, left, y);
}

/**
 * Place the chart, or say plainly that it is missing.
 *
 * A failure here is recoverable and must not take the page with it: the tables
 * below are the part of a report anybody checks a number against.
 */
async function drawChart(
  doc: Doc,
  reportCase: ReportCase,
  left: number,
  top: number,
  boxHeight: number,
): Promise<number> {
  const missing = (message: string): number => {
    doc.setDrawColor(...COLOUR.rule);
    doc.setLineWidth(0.5);
    doc.rect(left, top, CONTENT_WIDTH, boxHeight);
    doc.setTextColor(...COLOUR.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(message, left + CONTENT_WIDTH / 2, top + boxHeight / 2, { align: 'center' });
    return boxHeight;
  };

  if (!reportCase.chartSvg) {
    return missing('The chart could not be included. The tables below are complete.');
  }

  const parsed = new DOMParser().parseFromString(reportCase.chartSvg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) {
    return missing('The chart could not be included. The tables below are complete.');
  }

  const element = parsed.documentElement as unknown as SVGSVGElement;

  // svg2pdf resolves attributes against a live document, so the element has to
  // be in one. Parked offscreen rather than hidden: `display: none` computes no
  // layout and text metrics would come back unresolved.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden';
  host.appendChild(element);
  document.body.appendChild(host);

  try {
    const fitted = fitChart(
      Number(element.getAttribute('width')),
      Number(element.getAttribute('height')),
      CONTENT_WIDTH,
      boxHeight,
    );
    await doc.svg(element, {
      x: left + fitted.offsetX,
      y: top,
      width: fitted.width,
      height: fitted.height,
    });
    return fitted.height;
  } catch {
    return missing('The chart could not be drawn. The tables below are complete.');
  } finally {
    host.remove();
  }
}

/** The totals strip, and the energy-balance line beneath it. */
function drawTotals(
  doc: Doc,
  payload: ReportPayload,
  reportCase: ReportCase,
  left: number,
  top: number,
): void {
  const entries = totalsEntries(reportCase, payload.unitLabels);
  const column = CONTENT_WIDTH / entries.length;

  doc.setTextColor(...COLOUR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Totals', left, top);

  let y = top + 12;
  doc.setDrawColor(...COLOUR.rule);
  doc.setLineWidth(0.5);
  doc.line(left, y, left + CONTENT_WIDTH, y);
  y += 12;

  entries.forEach((entry, index) => {
    const x = left + index * column;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOUR.muted);
    doc.text(entry.label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COLOUR.ink);
    doc.text(entry.value, x, y + 12);
  });

  if (reportCase.totals.balance) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    // A balance that does not close is a defect in the tool, and it is marked
    // as one rather than left to blend into the provenance grey.
    doc.setTextColor(...(reportCase.totals.balanceCloses ? COLOUR.muted : COLOUR.danger));
    doc.text(reportCase.totals.balance, left, y + 26);
  }
}

/**
 * The footer, written after every page exists so it can say "of N".
 */
function drawFooters(doc: Doc, payload: ReportPayload): void {
  const pages = doc.getNumberOfPages();
  const [stamp, disclaimer] = footerLines(payload);
  const left = PAGE.margin;
  const baseline = PAGE.height - PAGE.margin;

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...COLOUR.rule);
    doc.setLineWidth(0.5);
    doc.line(left, baseline - 24, PAGE.width - PAGE.margin, baseline - 24);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLOUR.muted);
    doc.text(stamp, left, baseline - 14);
    doc.text(disclaimer, left, baseline - 5);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.margin, baseline - 5, {
      align: 'right',
    });
  }
}
