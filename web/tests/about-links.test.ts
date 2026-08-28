/**
 * The "Built on" credits in the About panel are hand-written, and the packages
 * they credit are not. A link typed from memory can be plausible and wrong —
 * `jsthermalcomfort` is a port of CBE's `pythermalcomfort`, so its repository
 * reads as though it should live under CBE, and for a while this panel said it
 * did. That link 404'd in production.
 *
 * So pin the credits to the installed tree rather than to a reviewer noticing.
 * Only entries the check can resolve are checked: a GitHub href is compared
 * against the repository the package itself declares, and a version against the
 * version actually installed. A credit that deliberately links somewhere other
 * than GitHub (React points at react.dev) carries no repository claim to test.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);
const panel = readFileSync(
  fileURLToPath(new URL('../src/ui/AboutPanel.tsx', import.meta.url)),
  'utf8',
);

interface Credit {
  name: string;
  version: string;
  href: string;
}

/** Pull `{ name, version, ..., href }` out of the `BUNDLED` literal. */
function credits(): Credit[] {
  const found: Credit[] = [];
  const entry = new RegExp(
    String.raw`name: '([^']+)',\s*\n\s*version: ([^,]+),[\s\S]*?href: '([^']+)',`,
    'g',
  );
  for (const match of panel.matchAll(entry)) {
    found.push({
      name: match[1] ?? '',
      // May be a literal or an expression: PsychroLib reads its own version.
      version: (match[2] ?? '').replace(/'/g, ''),
      href: match[3] ?? '',
    });
  }
  return found;
}

/** `owner/repo`, or null if the URL does not name a GitHub repository. */
function githubPath(url: string): string | null {
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return match ? (match[1]?.toLowerCase() ?? null) : null;
}

/** The installed manifest, or null when the credit is not an npm dependency. */
function manifestOf(
  name: string,
): { version: string; repository?: string | { url?: string } } | null {
  try {
    return require_(`${name}/package.json`) as { version: string };
  } catch {
    return null; // Vendored, or credited under a different name.
  }
}

describe('about panel credits', () => {
  const parsed = credits();

  it('finds every credit in the source', () => {
    // Guards the regex above: a refactor that reshapes BUNDLED must not leave
    // this file silently asserting nothing.
    expect(parsed.map((c) => c.name)).toEqual([
      'PsychroLib',
      'jsthermalcomfort',
      'fflate',
      'React',
    ]);
  });

  it.each(parsed)('$name links to the repository it ships from', (credit) => {
    const manifest = manifestOf(credit.name);
    const linked = githubPath(credit.href);
    if (manifest === null || linked === null) return;
    const declared =
      typeof manifest.repository === 'string'
        ? manifest.repository
        : (manifest.repository?.url ?? '');
    const actual = githubPath(declared);
    if (actual === null) return; // The package declares no GitHub repository.
    expect(linked).toBe(actual);
  });

  it.each(parsed)('$name credits the installed version', (credit) => {
    const manifest = manifestOf(credit.name);
    if (manifest === null) return; // Vendored; pinned by the SHA-256 check.
    // A credit may be as coarse as the major ('19'), but never contradict.
    expect(manifest.version.startsWith(credit.version)).toBe(true);
  });
});
