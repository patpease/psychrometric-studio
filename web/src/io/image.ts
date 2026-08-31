/**
 * Vector and raster export of the chart.
 *
 * ## Why the live SVG cannot simply be serialised
 *
 * The renderer emits `stroke="var(--family-rh)"` and relies on class rules in
 * `styles.css`. Both are resolved by the stylesheet, and neither survives being
 * pulled out of the document: an SVG file opened on its own, or loaded into an
 * `<img>` to be rasterised, has no stylesheet and no custom properties. The
 * result is a chart drawn entirely in black, which looks enough like a
 * deliberate monochrome export that it can ship unnoticed.
 *
 * So every element is walked and its *computed* style written back as explicit
 * attributes. That resolves custom properties, class rules, and inherited
 * values in one pass, and produces a genuinely standalone file.
 *
 * ## Why the clone is mounted in a light container
 *
 * Computed styles are computed against the page, so a session in dark mode
 * would export a chart for a black background. The clone is mounted offscreen
 * inside `data-theme="light"`, which redefines the palette for that subtree
 * only — see the top of `styles.css`. The visible interface never changes.
 *
 * ## Fonts
 *
 * Not embedded. A psychrometric chart carries a few dozen numeric labels, and
 * subsetting and base64-ing a font file to carry them would add hundreds of
 * kilobytes to every export. The serialised file names a system stack instead,
 * so it renders with the reader's own UI font. Where exact typography matters —
 * a report — the PDF path rasterises at 2× and the API sets its own type.
 */
import type { ChartDomain, ChartMargin } from '../chart/scales.js';
import { drawWeather, type WeatherMode } from '../chart/WeatherLayer.js';
import type { WeatherHour } from '../weather/epw.js';
import { APP_VERSION, BRAND, DISCLAIMER_SHORT } from '../config/branding.js';
import { CALCULATION_BASIS } from '../psych/psychrolib.js';

/** Presentation properties worth carrying. Anything not here is not drawn. */
const CARRIED = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'letter-spacing',
  'visibility',
] as const;

/**
 * A font stack, substituted for whatever the page resolved to.
 *
 * The browser reports a concrete resolved family — "SF Pro Text", say — which
 * is exactly the wrong thing to write into a portable file: on a machine
 * without it the text falls back to a serif and the chart's numbers stop
 * matching its labels. A stack degrades in a controlled order instead.
 */
const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface ChartExportOptions {
  /** The live chart element. Cloned, never modified. */
  readonly svg: SVGSVGElement;
  readonly domain: ChartDomain;
  readonly margin?: ChartMargin | undefined;
  /** Weather to composite beneath the chart, if the overlay is on. */
  readonly weather?:
    | { readonly hours: readonly WeatherHour[]; readonly mode: WeatherMode }
    | undefined;
  /** Project name and the like, stamped into the footer. */
  readonly caption?: string | undefined;
  readonly generated?: Date;
}

/* -------------------------------------------------------------------------- *
 * Style inlining
 * -------------------------------------------------------------------------- */

/**
 * Write each element's resolved style onto itself.
 *
 * Two properties of this function are load-bearing, and both were learned the
 * hard way.
 *
 * **Styles are read from the clone, not from the original.** That is the whole
 * theme mechanism: the clone lives inside the `data-theme="light"` container,
 * so its custom properties resolve to the light palette while the original
 * resolves to whatever the viewer is looking at. Reading the original instead
 * compiles cleanly, produces a perfectly valid file, and silently exports the
 * dark palette.
 *
 * **It reads the whole tree before it writes any of it.** Half this stylesheet
 * is descendant rules — `.comfort-zone-0 path`, `.gridlines line`, `.axis
 * text`. Stripping a parent's class before its children have been read stops
 * those rules matching, and the children fall back to the initial value: black,
 * fully opaque. A translucent comfort zone exports as a solid black block, and
 * nothing about the code reads as wrong.
 */
function inlineStyles(root: Element): void {
  const elements: Element[] = [];
  const styles: string[] = [];

  const read = (element: Element): void => {
    elements.push(element);
    styles.push(resolvedStyle(element));
    for (const child of Array.from(element.children)) read(child);
  };
  read(root);

  for (const [index, element] of elements.entries()) {
    clean(element);
    element.setAttribute('style', styles[index]!);
  }
}

function resolvedStyle(element: Element): string {
  const computed = window.getComputedStyle(element);
  const parts: string[] = [];

  for (const property of CARRIED) {
    const value = computed.getPropertyValue(property);
    if (!value || value === 'normal' || value === 'auto') continue;
    // `none` is meaningful for fill and stroke — an unfilled path — and is a
    // no-op default for everything else in this set.
    if (value === 'none' && property !== 'fill' && property !== 'stroke') continue;
    parts.push(`${property}:${property === 'font-family' ? FONT_STACK : value}`);
  }

  return parts.join(';');
}

/**
 * Attributes made redundant by the inlined style.
 *
 * The renderer emits `stroke="var(--family-rh)"` as a presentation attribute.
 * Inline style outranks it, so leaving it in place changes nothing about how
 * the file renders — but it leaves an unresolvable `var()` in a document that
 * claims to be standalone, which is exactly the sort of thing that looks like a
 * bug six months later and is not. Removing them also takes a twentieth off the
 * file.
 */
function clean(element: Element): void {
  // The class carried no meaning once its rules are inlined, and leaving it
  // invites someone to think the file still depends on a stylesheet.
  element.removeAttribute('class');
  for (const property of CARRIED) {
    if (element.hasAttribute(property)) element.removeAttribute(property);
  }
}

/** Paint the weather layer to a data URL, at the size the chart occupies. */
function weatherImage(
  options: ChartExportOptions,
  width: number,
  height: number,
  scale: number,
): string | null {
  const weather = options.weather;
  if (!weather || weather.mode === 'off' || weather.hours.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawWeather(context, {
    hours: weather.hours,
    mode: weather.mode,
    domain: options.domain,
    width,
    height,
    margin: options.margin,
    // Always the light palette: this is going into a document, not onto the
    // screen the user is looking at.
    dark: false,
  });

  return canvas.toDataURL('image/png');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Serialise the chart to a standalone SVG document.
 *
 * `weatherScale` controls the resolution of the composited raster layer only;
 * everything else stays vector.
 */
/** The measured size of a live chart element. */
function sizeOf(svg: SVGSVGElement): { width: number; height: number } {
  return {
    width: svg.width.baseVal.value || svg.clientWidth,
    height: svg.height.baseVal.value || svg.clientHeight,
  };
}

/**
 * A light-themed offscreen host, torn down whatever happens inside it.
 *
 * The clone is styled inside a light container so an export never carries the
 * viewer's theme. It has to be *in* the document for styles to compute, so it
 * is parked offscreen rather than hidden — `display: none` computes no layout,
 * and text-anchor and font metrics would come back unresolved.
 */
function inLightHost<T>(run: (host: HTMLDivElement) => T): T {
  const host = document.createElement('div');
  host.setAttribute('data-theme', 'light');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden';
  document.body.appendChild(host);
  try {
    return run(host);
  } finally {
    // Removed even if inlining threw, or a failed export would leave an
    // invisible copy of the chart in the document for the rest of the session.
    host.remove();
  }
}

/**
 * One chart, cloned and made self-contained: styles inlined, weather
 * composited, page painted.
 *
 * Shared by the single-chart export and the side-by-side one so the two cannot
 * drift. Export styling is the part of this codebase with the longest history
 * of looking right and being wrong (ADR 0004), and it earns exactly one
 * implementation.
 */
function prepareChart(
  options: ChartExportOptions,
  host: HTMLDivElement,
  weatherScale: number,
  withFooter: boolean,
): { clone: SVGSVGElement; width: number; height: number } {
  const { svg } = options;
  const { width, height } = sizeOf(svg);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  host.appendChild(clone);

  inlineStyles(clone);

  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // An opaque page. Without it the chart is transparent, which reads as white
  // in a browser and as whatever is underneath it in a document — the classic
  // way an exported chart arrives with black text on a black slide.
  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('x', '0');
  background.setAttribute('y', '0');
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);

  const weather = weatherImage(options, width, height, weatherScale);
  if (weather) {
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
    image.setAttribute('href', weather);
    // Beneath the chart furniture and above the background, which is the
    // same order the live page composites them in.
    clone.insertBefore(image, background.nextSibling);
  }

  if (withFooter) clone.appendChild(footer(options, width, height));
  return { clone, width, height };
}

/**
 * Serialise the chart to a standalone SVG document.
 *
 * `weatherScale` controls the resolution of the composited raster layer only;
 * everything else stays vector.
 */
export function chartToSvg(options: ChartExportOptions, weatherScale = 2): string {
  const serialised = inLightHost((host) => {
    const { clone } = prepareChart(options, host, weatherScale, true);
    return new XMLSerializer().serializeToString(clone);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialised}`;
}

/**
 * The provenance stamp, drawn into the chart itself.
 *
 * On the chart rather than beside it, because the two get separated: a chart
 * pasted into a slide leaves its caption behind, and the version and pressure
 * that produced it are exactly what someone will need six months later.
 */
function footer(options: ChartExportOptions, width: number, height: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  const generated = (options.generated ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');

  const lines = [
    [options.caption, `${BRAND.appName} — ${BRAND.organisation}`].filter(Boolean).join('  ·  '),
    `${CALCULATION_BASIS.library} ${CALCULATION_BASIS.version} · v${APP_VERSION} · ${generated} UTC · ${DISCLAIMER_SHORT}`,
  ];

  lines.forEach((text, index) => {
    const element = document.createElementNS(SVG_NS, 'text');
    element.setAttribute('x', '8');
    element.setAttribute('y', String(height - 14 + index * 10));
    element.setAttribute(
      'style',
      `font-family:${FONT_STACK};font-size:${index === 0 ? 9 : 7.5}px;fill:#5d6b7a`,
    );
    element.textContent = text;
    group.appendChild(element);
  });

  // Referenced so the signature stays honest about needing the width.
  group.setAttribute('data-width', String(width));
  return group;
}

/* -------------------------------------------------------------------------- *
 * Two cases, side by side
 * -------------------------------------------------------------------------- */

/** One operating case in a combined drawing. */
export interface CombinedChartCase {
  readonly label: string;
  readonly options: ChartExportOptions;
}

/** Layout of the composite, in SVG user units. */
const COMBINED = { pad: 14, gap: 22, labelBand: 26, footerBand: 34 } as const;

/**
 * Measure a composite before drawing it, so the raster path can size a canvas
 * without building the document twice.
 */
export function combinedChartSize(cases: readonly CombinedChartCase[]): {
  width: number;
  height: number;
} {
  const sizes = cases.map((entry) => sizeOf(entry.options.svg));
  const panels = sizes.reduce((total, size) => total + size.width, 0);
  return {
    width: COMBINED.pad * 2 + panels + COMBINED.gap * Math.max(0, cases.length - 1),
    height:
      COMBINED.pad + COMBINED.labelBand + Math.max(0, ...sizes.map((s) => s.height)) + COMBINED.footerBand,
  };
}

/**
 * Both operating cases on one page, each keeping its own chart and its own view.
 *
 * Side by side rather than overlaid: a winter case sits cold and dry and a
 * summer one warm and humid, and the axes that contain both leave each chain
 * crowded into a corner of a chart that is mostly empty. Two charts at their
 * own scales compare better than one at a scale that suits neither.
 *
 * Each panel is a nested `<svg>` with its own viewBox, so the charts keep their
 * coordinate systems and nothing has to be re-projected. That only works
 * because each chart's `<defs>` carry instance-unique ids — two panels sharing
 * an `id="plot-clip"` would both resolve to whichever came first, and the
 * second would be clipped by the first one's plot rectangle.
 */
export function chartsToSvg(cases: readonly CombinedChartCase[], weatherScale = 2): string {
  if (cases.length === 0) throw new Error('A combined chart needs at least one case.');

  const total = combinedChartSize(cases);

  const serialised = inLightHost((host) => {
    const root = document.createElementNS(SVG_NS, 'svg');
    root.setAttribute('xmlns', SVG_NS);
    root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    root.setAttribute('width', String(total.width));
    root.setAttribute('height', String(total.height));
    root.setAttribute('viewBox', `0 0 ${total.width} ${total.height}`);

    const page = document.createElementNS(SVG_NS, 'rect');
    page.setAttribute('x', '0');
    page.setAttribute('y', '0');
    page.setAttribute('width', String(total.width));
    page.setAttribute('height', String(total.height));
    page.setAttribute('fill', '#ffffff');
    root.appendChild(page);

    let x = COMBINED.pad;
    for (const entry of cases) {
      // No per-panel footer: the provenance is stamped once, on the page.
      const { clone, width } = prepareChart(entry.options, host, weatherScale, false);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(COMBINED.pad + 12));
      label.setAttribute('style', `font-family:${FONT_STACK};font-size:12px;font-weight:600;fill:#14202b`);
      label.textContent = entry.label;
      root.appendChild(label);

      clone.setAttribute('x', String(x));
      clone.setAttribute('y', String(COMBINED.pad + COMBINED.labelBand));
      root.appendChild(clone);

      x += width + COMBINED.gap;
    }

    root.appendChild(footer(cases[0]!.options, total.width, total.height));
    return new XMLSerializer().serializeToString(root);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialised}`;
}

/** The combined drawing, rasterised. */
export async function chartsToPng(
  cases: readonly CombinedChartCase[],
  scale = 2,
): Promise<Blob> {
  const svgText = chartsToSvg(cases, scale);
  const { width, height } = combinedChartSize(cases);
  return rasterise(svgText, width, height, scale);
}

/* -------------------------------------------------------------------------- *
 * Raster
 * -------------------------------------------------------------------------- */

/**
 * Rasterise the chart.
 *
 * The SVG is loaded through an `<img>`, which is the only route from vector to
 * canvas that does not involve reimplementing the renderer. It requires the SVG
 * to be genuinely self-contained — every external reference would be blocked as
 * a cross-origin load and silently dropped — which the serialiser above already
 * guarantees, and which is why the weather layer is embedded as a data URI
 * rather than linked.
 */
export async function chartToPng(options: ChartExportOptions, scale = 2): Promise<Blob> {
  const { width, height } = sizeOf(options.svg);
  return rasterise(chartToSvg(options, scale), width, height, scale);
}

/**
 * Turn a serialised SVG into a PNG blob.
 *
 * Shared by the single and combined paths: they differ only in what they drew
 * and how big it is, and a second copy of the canvas dance is a second place
 * for the white page fill to go missing.
 */
async function rasterise(
  svgText: string,
  width: number,
  height: number,
  scale: number,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));

  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser did not provide a 2D canvas context.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The chart could not be encoded as PNG.'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          'The chart could not be rasterised. This usually means the serialised SVG ' +
            'still refers to something outside itself.',
        ),
      );
    image.src = url;
  });
}

/** A PNG as a bare base64 payload, for handing to the report API. */
export async function chartToBase64Png(options: ChartExportOptions, scale = 2): Promise<string> {
  const blob = await chartToPng(options, scale);
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
