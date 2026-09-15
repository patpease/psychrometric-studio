/**
 * The PDF report.
 *
 * Two things are pinned here. The first is that the report says the same thing
 * as the screen and the CSV — same columns, same order, same precision — which
 * is the only reason to trust a document produced by a different code path from
 * the one that drew the chart.
 *
 * The second is the rule that a report never carries the weather overlay. That
 * is enforced by the *type*, not by a call site remembering: `ReportChartOptions`
 * has no `weather` field, so there is nowhere to put one. The test for it at the
 * foot of this file is checked by `tsc`, not by this runner — widen the type and
 * the type check fails.
 */
import { describe, it, expect } from 'vitest';
import { buildReportPayload, type ReportPayload } from '../src/io/report.js';
import {
  chartBoxHeight,
  fitChart,
  footerLines,
  loadColumns,
  loadRows,
  projectLine,
  statePointColumns,
  statePointRows,
  totalsEntries,
  PAGE,
} from '../src/io/pdf.js';
import type { ReportChartOptions } from '../src/io/image.js';
import { solveSystem } from '../src/processes/chain.js';
import { standardAtmosphere } from '../src/psych/atmosphere.js';
import type { Stage } from '../src/types/project.js';
import type { UnitSystem } from '../src/psych/units.js';

const COOLING: Stage[] = [
  { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 500, params: { tdb: 95, rh: 0.4 } },
  { id: 'mx', type: 'mixing', name: 'Mixing box', params: { airflow2: 1500, tdb2: 75, rh2: 0.5 } },
  { id: 'cc', type: 'cooling', name: 'Cooling coil', params: { tdbOut: 54, rhOut: 0.93 } },
  { id: 'sf', type: 'fan', name: 'Supply fan', params: { power: 1.5, motorInAirstream: true } },
  { id: 'rm', type: 'room', name: 'Zone', params: { sensible: 42, latent: 11 } },
];

const HEATING: Stage[] = [
  { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 500, params: { tdb: 5, rh: 0.6 } },
  { id: 'mx', type: 'mixing', name: 'Mixing box', params: { airflow2: 1500, tdb2: 70, rh2: 0.294 } },
  { id: 'hc', type: 'heating', name: 'Heating coil', params: { tdbOut: 75 } },
  { id: 'rm', type: 'room', name: 'Zone', params: { sensible: -15, latent: 11 } },
];

function solve(stages: Stage[], units: UnitSystem = 'IP') {
  return solveSystem(
    { airstreams: [{ id: 'supply', name: 'Supply', role: 'supply', stages }] },
    standardAtmosphere(units).pressure,
    units,
  ).airstreams[0]!;
}

function payloadOf(units: UnitSystem = 'IP'): ReportPayload {
  return buildReportPayload({
    cases: [
      { label: 'System Mode 1', solved: solve(COOLING, units), chartSvg: '<svg/>' },
      { label: 'System Mode 2', solved: solve(HEATING, units), chartSvg: '<svg/>' },
    ],
    units,
    atmosphere: standardAtmosphere(units),
    meta: { name: 'Test AHU', engineer: 'PP' },
    now: new Date('2026-09-14T12:30:00Z'),
  });
}

/* -------------------------------------------------------------------------- */

describe('the payload', () => {
  const payload = payloadOf();

  it('carries one case per operating mode, in project order', () => {
    expect(payload.cases.map((entry) => entry.label)).toEqual(['System Mode 1', 'System Mode 2']);
  });

  /**
   * The report is handed strings, not numbers. Precision is decided once, by
   * the same formatters the screen uses, rather than twice — the layout has no
   * opinion about how many decimals a wet bulb takes.
   */
  it('arrives already formatted, in display units', () => {
    const first = payload.cases[0]!.statePoints[0]!;
    expect(first.tdb).toBe('95.0');
    expect(first.rh).toBe('40.0');
    // Humidity ratio in gr/lb, not lb/lb.
    expect(Number(first.w)).toBeGreaterThan(50);
  });

  it('gives each case its own totals', () => {
    const [cooling, heating] = payload.cases;
    expect(Number(cooling!.totals.cooling)).toBeLessThan(0);
    expect(Number(heating!.totals.cooling)).toBeGreaterThan(Number(cooling!.totals.cooling));
  });

  it('never prints an undefined SHR as NaN', () => {
    for (const entry of payload.cases) {
      for (const load of entry.loads) expect(load.shr).not.toMatch(/NaN/);
    }
  });

  it('omits the entering air from the loads, which moves no energy', () => {
    for (const entry of payload.cases) {
      expect(entry.loads.some((load) => load.point === 1)).toBe(false);
    }
  });

  it('states whether the energy balance closed', () => {
    expect(payload.cases[0]!.totals.balance).toMatch(/closes/);
    expect(payload.cases[0]!.totals.balanceCloses).toBe(true);
  });

  it('carries a stage that did not solve rather than dropping it', () => {
    const broken = buildReportPayload({
      cases: [{ label: 'Broken', solved: solve([{ id: 'cc', type: 'cooling', params: {} }]) }],
      units: 'IP',
      atmosphere: standardAtmosphere('IP'),
      meta: {},
    });
    expect(broken.cases[0]!.statePoints[0]!.error).toBeTruthy();
  });

  it('stamps the provenance and the disclaimer', () => {
    expect(payload.provenance.version).toBeTruthy();
    expect(payload.provenance.generated).toBe('2026-09-14T12:30:00.000Z');
    expect(payload.disclaimer).toMatch(/verify/i);
  });
});

/* -------------------------------------------------------------------------- */

describe('the tables', () => {
  const payload = payloadOf();
  const first = payload.cases[0]!;

  /**
   * The same columns as the State points panel, in the same order. A report
   * that reorders or renames them makes the reader check which is which, and
   * the whole value of a schedule is that they do not have to.
   */
  it('names the state-point columns the way the screen does', () => {
    expect(statePointColumns(payload.unitLabels)).toEqual([
      'Point',
      'Tdb (°F)',
      'Twb (°F)',
      'RH (%)',
      'Tdp (°F)',
      'W (gr/lb)',
      'h (Btu/lb)',
    ]);
  });

  it('switches the column units with the project', () => {
    const si = payloadOf('SI');
    expect(statePointColumns(si.unitLabels)).toContain('Tdb (°C)');
    expect(loadColumns(si.unitLabels)[1]).toBe('Total (kW)');
  });

  it('puts every value under its own heading', () => {
    const columns = statePointColumns(payload.unitLabels);
    const row = statePointRows(first)[0]!;
    expect(row).toHaveLength(columns.length);

    const cell = (heading: string): string => row[columns.findIndex((c) => c.startsWith(heading))]!;
    expect(cell('Tdb')).toBe(first.statePoints[0]!.tdb);
    expect(cell('Twb')).toBe(first.statePoints[0]!.twb);
    expect(cell('RH')).toBe(first.statePoints[0]!.rh);
    expect(cell('Tdp')).toBe(first.statePoints[0]!.tdp);
  });

  it('numbers each row so it can be found on the chart', () => {
    expect(statePointRows(first)[0]![0]).toMatch(/^1\s+Outdoor air$/);
    expect(loadRows(first)[0]![0]).toMatch(/^2\s+Mixing box$/);
  });

  it('spreads a failed stage across its row instead of leaving blanks that read as zero', () => {
    const broken = buildReportPayload({
      cases: [{ label: 'Broken', solved: solve([{ id: 'cc', type: 'cooling', params: {} }]) }],
      units: 'IP',
      atmosphere: standardAtmosphere('IP'),
      meta: {},
    });
    const row = statePointRows(broken.cases[0]!)[0]!;
    expect(row[1]).toMatch(/\S/);
    expect(row.slice(2).join('')).toBe('');
  });

  it('gives the totals their units', () => {
    const entries = totalsEntries(first, payload.unitLabels);
    expect(entries.map((entry) => entry.label)).toEqual([
      'Total cooling',
      'Total heating',
      'Humidification',
      'Dehumidification',
    ]);
    expect(entries[0]!.value).toMatch(/MBH$/);
    expect(entries[2]!.value).toMatch(/lb\/h$/);
  });
});

/* -------------------------------------------------------------------------- */

describe('the page', () => {
  const payload = payloadOf();

  it('names the project and what it was solved against', () => {
    const line = projectLine(payload);
    expect(line).toContain('Test AHU');
    expect(line).toContain('Engineer  PP');
    expect(line).toContain('IP units');
    expect(line).toMatch(/psia/);
  });

  it('leaves out the fields nobody filled in', () => {
    const bare = buildReportPayload({
      cases: [{ label: 'One', solved: solve(COOLING) }],
      units: 'IP',
      atmosphere: standardAtmosphere('IP'),
      meta: {},
    });
    // No empty separators from absent name, number, client or engineer.
    expect(projectLine(bare)).not.toMatch(/·\s+·/);
  });

  /**
   * The footer is the provenance claim, and it is the only place it is made —
   * the chart's own stamp is deliberately suppressed inside a report so the
   * same sentence does not appear on the page twice.
   */
  it('stamps the release, the basis, the pressure and the units on the footer', () => {
    const [stamp, disclaimer] = footerLines(payload);
    expect(stamp).toContain('Psychrometric Studio');
    expect(stamp).toMatch(/PsychroLib \d/);
    expect(stamp).toMatch(/psia/);
    expect(stamp).toContain('IP units');
    expect(stamp).toContain('generated 2026-09-14 12:30 UTC');
    expect(disclaimer).toMatch(/verify/i);
  });

  it('fits a wide chart on width and a tall one on height, centred either way', () => {
    const box = { width: 500, height: 300 };

    const wide = fitChart(1000, 400, box.width, box.height);
    expect(wide.width).toBeCloseTo(500, 5);
    expect(wide.height).toBeCloseTo(200, 5);
    expect(wide.offsetX).toBeCloseTo(0, 5);

    const tall = fitChart(400, 1000, box.width, box.height);
    expect(tall.height).toBeCloseTo(300, 5);
    expect(tall.width).toBeCloseTo(120, 5);
    // Centred, so a narrow chart does not hug the left margin.
    expect(tall.offsetX).toBeCloseTo(190, 5);
  });

  it('never scales a chart beyond its box', () => {
    for (const [w, h] of [[900, 620], [620, 900], [1, 1], [2000, 50]] as const) {
      const fitted = fitChart(w, h, 500, 300);
      expect(fitted.width).toBeLessThanOrEqual(500 + 1e-9);
      expect(fitted.height).toBeLessThanOrEqual(300 + 1e-9);
    }
  });

  it('survives a chart of no size rather than dividing by zero', () => {
    const fitted = fitChart(0, 0, 500, 300);
    expect(Number.isFinite(fitted.width)).toBe(true);
    expect(Number.isFinite(fitted.height)).toBe(true);
  });

  /**
   * The promise this document makes is a page per operating case, and the only
   * thing that can break it is a schedule long enough to push the tables past
   * the footer. The chart yields first.
   */
  it('gives a short schedule a bigger chart than a long one', () => {
    expect(chartBoxHeight(3, 2)).toBeGreaterThan(chartBoxHeight(5, 4));
    expect(chartBoxHeight(5, 4)).toBeGreaterThan(chartBoxHeight(12, 11));
  });

  it('leaves every case its tables, its totals and its footer on one page', () => {
    // The geometry the layout actually uses, restated here so a change to one
    // without the other is caught rather than discovered in a printed report.
    const ROW = 15.625;
    const chartTop = PAGE.margin + 26 + 13 + 12;
    const table = (rows: number): number => 4 + (rows + 1) * ROW + 14;

    for (const [points, loads] of [[2, 1], [3, 2], [5, 4], [8, 7], [12, 11]] as const) {
      const used =
        chartTop + chartBoxHeight(points, loads) + 14 + table(points) + table(loads) + 54;
      const floor = chartBoxHeight(points, loads) === 170;
      // Below the floor the chart stops shrinking and a spill is accepted; above
      // it, everything must fit clear of the footer.
      if (!floor) expect(used).toBeLessThanOrEqual(PAGE.height - PAGE.margin - 40 + 0.01);
    }
  });

  it('keeps the chart inside sane bounds however extreme the schedule', () => {
    for (const [points, loads] of [[0, 0], [1, 0], [40, 39]] as const) {
      const height = chartBoxHeight(points, loads);
      expect(height).toBeGreaterThanOrEqual(170);
      expect(height).toBeLessThanOrEqual(420);
    }
  });

  it('is US letter with margins wide enough to bind', () => {
    expect([PAGE.width, PAGE.height]).toEqual([612, 792]);
    expect(PAGE.margin).toBeGreaterThanOrEqual(36);
  });
});

/* -------------------------------------------------------------------------- */

describe('the weather rule', () => {
  /**
   * A report chart cannot be given weather, because the option does not exist.
   *
   * The weather cloud argues for a design in front of an audience; a record of
   * one is the chart, the process lines, and the table of points, and an
   * overlay on top of those is decoration over the lines somebody has to read.
   *
   * This is a **type** assertion, checked by `tsc` rather than by this runner,
   * and it is written as a key test rather than as a rejected object literal:
   * `weather` is optional on the wider type, so an excess-property check would
   * also be satisfied by an unrelated mistake in the value. Widen
   * `ReportChartOptions` and `weatherIsAbsent` stops being assignable.
   */
  type WeatherIsAbsent = 'weather' extends keyof ReportChartOptions ? false : true;
  const weatherIsAbsent: WeatherIsAbsent = true;

  it('has nowhere to put a weather overlay', () => {
    expect(weatherIsAbsent).toBe(true);
  });

  /** The same for the footer band, which the page footer already carries. */
  it('takes no caption, because it draws no footer band of its own', () => {
    type CaptionIsAbsent = 'caption' extends keyof ReportChartOptions ? false : true;
    const captionIsAbsent: CaptionIsAbsent = true;
    expect(captionIsAbsent).toBe(true);
  });
});
