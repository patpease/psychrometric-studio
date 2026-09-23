/**
 * The phone layout: the gesture arithmetic, and the stylesheet ordering that
 * broke it once already.
 *
 * Most of the phone layout is only visible in a browser (see
 * docs/design-system.md for the checks run there). Two parts are not, and are
 * pinned here: the pinch, which is pure arithmetic over chart domains, and the
 * CSS rule order that left every panel 50px short of a phone for as long as
 * the stacked layout existed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createScales, defaultDomain, domainLimits, pinchDomain } from '../src/chart/scales.js';
import { COMPACT_LAYOUT } from '../src/ui/useMediaQuery.js';

const WIDTH = 390;
const HEIGHT = 600;
const start = defaultDomain('IP');
const limits = domainLimits('IP');
const scales = createScales(start, WIDTH, HEIGHT);
const mid = { x: scales.margin.left + scales.plotWidth / 2, y: scales.margin.top + scales.plotHeight / 2 };
const focus = scales.invert(mid.x, mid.y);

const span = (d: typeof start) => d.tdbMax - d.tdbMin;

describe('a two-finger pinch', () => {
  it('zooms in as the fingers spread, by how far they spread', () => {
    const next = pinchDomain(start, focus, 100, 200, mid, WIDTH, HEIGHT, limits);
    expect(span(next)).toBeCloseTo(span(start) / 2, 6);
  });

  it('zooms out as they close', () => {
    // From a zoomed-in view, so there is room inside the limits to zoom out.
    const inner = pinchDomain(start, focus, 100, 300, mid, WIDTH, HEIGHT, limits);
    const out = pinchDomain(inner, focus, 200, 100, mid, WIDTH, HEIGHT, limits);
    expect(span(out)).toBeCloseTo(span(inner) * 2, 6);
  });

  it('keeps the condition between the fingers between the fingers', () => {
    const next = pinchDomain(start, focus, 100, 180, mid, WIDTH, HEIGHT, limits);
    const under = createScales(next, WIDTH, HEIGHT).invert(mid.x, mid.y);
    expect(under.tdb).toBeCloseTo(focus.tdb, 6);
    expect(under.w).toBeCloseTo(focus.w, 9);
  });

  it('pans when the fingers move together without spreading', () => {
    const inner = pinchDomain(start, focus, 100, 300, mid, WIDTH, HEIGHT, limits);
    const innerScales = createScales(inner, WIDTH, HEIGHT);
    const held = innerScales.invert(mid.x, mid.y);
    const moved = { x: mid.x - 40, y: mid.y };
    const next = pinchDomain(inner, held, 100, 100, moved, WIDTH, HEIGHT, limits);
    expect(span(next)).toBeCloseTo(span(inner), 6);
    // The held condition followed the fingers 40px left, so the view moved right.
    expect(next.tdbMin).toBeGreaterThan(inner.tdbMin);
    expect(createScales(next, WIDTH, HEIGHT).invert(moved.x, moved.y).tdb).toBeCloseTo(held.tdb, 6);
  });

  it('does nothing with a degenerate spread rather than dividing by zero', () => {
    const next = pinchDomain(start, focus, 0, 0, mid, WIDTH, HEIGHT, limits);
    expect(span(next)).toBeCloseTo(span(start), 6);
  });
});

/** Read from disk: vitest stubs CSS imports. See tests/theme.test.ts. */
const css = readFileSync(fileURLToPath(new URL('../src/ui/styles.css', import.meta.url)), 'utf8');

describe('the tab layout in styles.css', () => {
  it('uses the breakpoint the code uses', () => {
    const width = COMPACT_LAYOUT.match(/max-width: (\d+)px/)![1];
    expect(css).toMatch(new RegExp(`@media \\(max-width: ${width}px\\) \\{\\n  \\.app \\{`));
    expect(css).toContain(`${width}px  viewport  the tab layout`);
  });

  /*
   * `.panel-left { width: 21.5rem }` and `.panel-right { width: 21rem }` are
   * declared as bare rules. The stacked layout's `width: 100%` came BEFORE
   * them in the file, at equal specificity, and lost — every panel stayed at
   * its desk width on a phone. The phone rule has to come after them.
   */
  it('overrides the desk panel widths after they are declared', () => {
    const deskLeft = css.indexOf('.panel-left {');
    const deskRight = css.indexOf('.panel-right {');
    const phone = css.indexOf('  .panel,\n  .panel-left,\n  .panel-right {\n    width: 100%;');
    expect(deskLeft).toBeGreaterThan(-1);
    expect(deskRight).toBeGreaterThan(-1);
    expect(phone).toBeGreaterThan(Math.max(deskLeft, deskRight));
  });

  it('scopes the phone chart type to the live chart, never to a media query', () => {
    // The export's desk copy is drawn in the same document on the same phone:
    // a media-query rule would restyle it too, and the export with it.
    const rules = css.match(/[^}]*\.line-label[^{]*\{[^}]*font-size: 11px/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).toContain('.psych-chart.compact');
  });
});
