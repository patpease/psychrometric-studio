/**
 * The light/dark palettes.
 *
 * The dark palette is written **twice** in `styles.css` — once inside a
 * `prefers-color-scheme` media query, for someone whose operating system asks
 * for dark, and once on a bare `[data-theme="dark"]`, for someone on a light
 * system who pressed the moon. There is no way in plain CSS to share one
 * declaration block between a media query and a bare selector.
 *
 * Duplication like that leaks: a colour gets adjusted in one block, the other
 * drifts, and the bug only shows for users in one of the two states — which is
 * exactly the bug nobody reports because it looks fine to whoever is looking.
 * This file is what makes the duplication safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Read from disk rather than importing the stylesheet.
 *
 * Vitest stubs CSS imports — `styles.css?raw` comes back as an empty string,
 * and every assertion below would then pass against nothing. The `both actually
 * define a palette` test exists because that is precisely how this file first
 * behaved.
 */
const css = readFileSync(
  fileURLToPath(new URL('../src/ui/styles.css', import.meta.url)),
  'utf8',
);

/** Every `--token: value;` inside a block, keyed by token. */
function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.trim();
  }
  return tokens;
}

/** The body of the first rule whose selector line contains `selector`. */
function blockFor(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `no rule found for ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n  }', open) > -1 && selector.includes(':not')
    ? css.indexOf('\n  }', open)
    : css.indexOf('\n}', open);
  return css.slice(open + 1, close);
}

describe('the two dark palettes agree', () => {
  const fromMedia = tokensIn(blockFor(":root:not([data-theme='light'])"));
  const fromAttribute = tokensIn(blockFor("[data-theme='dark'] {"));

  it('both actually define a palette', () => {
    // Guards the test itself: a parsing slip that produced two empty objects
    // would otherwise pass every assertion below.
    expect(Object.keys(fromMedia).length).toBeGreaterThan(20);
    expect(Object.keys(fromAttribute).length).toBeGreaterThan(20);
  });

  it('define exactly the same tokens', () => {
    expect(Object.keys(fromAttribute).sort()).toEqual(Object.keys(fromMedia).sort());
  });

  it('give every token the same value', () => {
    expect(fromAttribute).toEqual(fromMedia);
  });
});

describe('the light palette', () => {
  it('is defined for both the root and an explicit light choice', () => {
    // Without `[data-theme='light']` in this selector list, chart export — which
    // resolves styles inside a forced-light container — silently produces the
    // dark palette. See ADR 0004.
    expect(css).toMatch(/:root,\s*\n\[data-theme='light'\] \{/);
  });

  it('covers every token the dark palette defines', () => {
    const light = tokensIn(blockFor(":root,\n[data-theme='light'] {"));
    const dark = tokensIn(blockFor("[data-theme='dark'] {"));
    const missing = Object.keys(dark).filter((token) => !(token in light));
    expect(missing, 'defined only in dark; will fall back to an initial value').toEqual([]);
  });
});
