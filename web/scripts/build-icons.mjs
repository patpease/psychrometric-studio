/**
 * Turn the SVG icon set into a TypeScript module.
 *
 * The icons could be loaded at runtime — `import.meta.glob('*.svg?raw')` or a
 * fetch per file — but both make the icons a *build* concern that behaves one
 * way in Vite, another in Vitest, and a third in a plain Node script. This
 * project has been bitten by exactly that once already (see ADR 0003), so the
 * icons are compiled ahead of time into ordinary TypeScript that every
 * environment reads identically.
 *
 * Two transformations happen here, and both matter:
 *
 * 1. **The ink colour becomes `currentColor`.** The artwork is drawn in a very
 *    dark green (#0B2B28) which is invisible on a dark background. Handing the
 *    outline to CSS lets one icon serve both themes; the blue, green and orange
 *    accents are left alone because they carry meaning — supply against
 *    exhaust, water against air.
 * 2. **The outer <svg> wrapper is stripped**, leaving only the drawing. The
 *    React component supplies its own wrapper so that sizing, accessibility,
 *    and the title element are decided in one place rather than fifty-four.
 *
 * Run: npm run build:icons
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, '..', 'src', 'icons', 'svg');
const outFile = join(here, '..', 'src', 'icons', 'generated.ts');

/** The artwork's outline colour, which must follow the theme. */
const INK = /#0B2B28/gi;

const files = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.svg'))
  .sort();

const entries = files.map((file) => {
  const name = basename(file, '.svg');
  const raw = readFileSync(join(sourceDir, file), 'utf8');

  const opening = raw.match(/<svg\b[^>]*>/i);
  if (!opening) throw new Error(`${file}: no <svg> element`);

  const viewBox = /viewBox="([^"]+)"/i.exec(opening[0])?.[1];
  if (viewBox !== '0 0 48 48') {
    throw new Error(`${file}: expected a 0 0 48 48 viewBox, found ${viewBox ?? 'none'}`);
  }

  const body = raw
    .slice(opening.index + opening[0].length, raw.lastIndexOf('</svg>'))
    .replace(INK, 'currentColor')
    .replace(/\s+/g, ' ')
    .trim();

  return { name, body };
});

const source = `/**
 * GENERATED FILE — do not edit.
 *
 * Produced by \`scripts/build-icons.mjs\` from \`src/icons/svg/\`. To change an
 * icon, change the SVG and re-run \`npm run build:icons\`.
 *
 * The outline colour has been replaced with \`currentColor\` so one icon serves
 * both themes; the accent colours are the artwork's own and are left intact.
 */

/** Icon drawing bodies, keyed by file name, on a 0 0 48 48 canvas. */
export const ICON_SOURCES: Readonly<Record<string, string>> = Object.freeze({
${entries.map((e) => `  ${JSON.stringify(e.name)}: ${JSON.stringify(e.body)},`).join('\n')}
});

export type IconName = keyof typeof ICON_SOURCES & string;

/** Every icon in the set, sorted, for the picker and for tests. */
export const ICON_NAMES: readonly string[] = Object.freeze(Object.keys(ICON_SOURCES));
`;

writeFileSync(outFile, source, 'utf8');
console.log(`Wrote ${entries.length} icons to ${outFile}`);
