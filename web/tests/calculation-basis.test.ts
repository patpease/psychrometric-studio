/**
 * The calculation basis and how it is cited.
 *
 * `CALCULATION_BASIS` is stamped on every export, and `PSYCHROLIB_CITATION` is
 * what a reader is meant to put in a reference list. Both name a version, and
 * the failure they exist to prevent is the two drifting apart: someone
 * re-vendors PsychroLib, updates the version and the SHA — because CI forces
 * that — and leaves a citation pointing at the DOI of a release the tool no
 * longer uses. Nothing else would notice, and the wrong release would be cited
 * in every report produced afterwards.
 *
 * PsychroLib asks for two citations: the software summary paper, and the
 * version in use, each with its own DOI. Both are checked here.
 *
 * @see https://github.com/psychrometrics/psychrolib#how-to-cite
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CALCULATION_BASIS, PSYCHROLIB_CITATION } from '../src/psych/psychrolib.js';

describe('the PsychroLib citation', () => {
  it('cites the version actually in use', () => {
    expect(PSYCHROLIB_CITATION.version).toBe(CALCULATION_BASIS.version);
    expect(PSYCHROLIB_CITATION.software).toContain(`v${CALCULATION_BASIS.version}`);
  });

  /**
   * The concept DOI — 10.5281/zenodo.2537945 — resolves to whatever release is
   * newest, which is the one thing a provenance stamp must never do. Each
   * release has its own, and that is the one to publish.
   */
  it('uses the per-release DOI, not the concept DOI', () => {
    expect(PSYCHROLIB_CITATION.software).toMatch(/https:\/\/doi\.org\/10\.5281\/zenodo\.\d+/);
    expect(PSYCHROLIB_CITATION.software).not.toContain('zenodo.2537945');
  });

  it('cites the summary paper as well, which is the other half of the request', () => {
    expect(PSYCHROLIB_CITATION.paper).toContain('https://doi.org/10.21105/joss.01137');
    expect(PSYCHROLIB_CITATION.paper).toContain('Journal of Open Source Software');
    expect(PSYCHROLIB_CITATION.paper).toContain('Meyer');
    expect(PSYCHROLIB_CITATION.paper).toContain('Thevenard');
  });

  /**
   * The house style, taken from the weather citation the About panel already
   * carried: authors, year, title, source, link. Two bibliographies in one
   * panel is how a page starts looking assembled rather than written.
   */
  it('is written in the same form as the weather citation', () => {
    for (const entry of [PSYCHROLIB_CITATION.paper, PSYCHROLIB_CITATION.software]) {
      // Surname-first author, then a year, then the rest, ending in a link.
      expect(entry).toMatch(/^[A-Z][a-z]+, [A-Z]\./);
      expect(entry).toMatch(/\.\s(19|20)\d{2}\.\s/);
      expect(entry).toMatch(/https:\/\/\S+$/);
    }
  });

  /**
   * The version is asserted in four hand-written places besides the code. A
   * re-vendor that misses one leaves the repository claiming two different
   * calculation bases, and the reader has no way to tell which is stale.
   */
  it.each([
    ['web/vendor/PROVENANCE.md', /PsychroLib (\d+\.\d+\.\d+)/],
    ['docs/calculation-reference.md', /\*\*PsychroLib (\d+\.\d+\.\d+)\*\*/],
    ['README.md', /PsychroLib\]\([^)]+\) (\d+\.\d+\.\d+)/],
  ])('%s names the version in use', (relative, pattern) => {
    const text = readFileSync(
      fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
      'utf8',
    );
    const found = pattern.exec(text);
    expect(found, `no version found in ${relative}`).not.toBeNull();
    expect(found![1]).toBe(CALCULATION_BASIS.version);
  });

  it.each(['web/vendor/PROVENANCE.md', 'docs/calculation-reference.md', 'README.md'])(
    '%s links the DOI of that release',
    (relative) => {
      const text = readFileSync(
        fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
        'utf8',
      );
      const doi = /10\.5281\/zenodo\.(\d+)/.exec(PSYCHROLIB_CITATION.software)![0];
      expect(text).toContain(doi);
    },
  );
});
