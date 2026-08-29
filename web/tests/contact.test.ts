/**
 * The feedback address, and keeping it off a public page.
 *
 * Two things are being protected here, and the second one is easy to forget:
 * the deployed bundle, and **this repository**. The source is public, so an
 * address written into a test file is exactly as harvestable as one written
 * into the markup — a crawler does not care which file it came from. So the
 * expected value is pinned by hash rather than spelled out, the same way the
 * vendored calculation library is.
 *
 * @see src/config/contact.ts for what the obfuscation buys and what it does not
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { feedbackAddress, feedbackMailto } from '../src/config/contact.js';

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const ADDRESS = feedbackAddress();

describe('the feedback address', () => {
  it('assembles to the address it is meant to', () => {
    expect(sha256(ADDRESS)).toBe(
      'e2d27f2b458636110bce7d32778e4f77f71a336887753c657345e80ac5bdcb22',
    );
  });

  it('is one address and not a fragment of one', () => {
    // Guards the hash above against a change that made it pass trivially.
    expect(ADDRESS.split('@')).toHaveLength(2);
    expect(ADDRESS.split('@')[0]!.length).toBeGreaterThan(3);
    expect(ADDRESS).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  });

  it('never appears whole in its own source', () => {
    // The point of the module is that this string is not in the file. If a
    // later simplification writes it back, everything else here still passes.
    const source = read('../src/config/contact.ts');
    expect(source).not.toContain(ADDRESS);
    expect(source).not.toContain(ADDRESS.split('@')[1]!);
  });

  it('never appears whole anywhere in the source tree', () => {
    for (const file of [
      '../src/ui/FeedbackPanel.tsx',
      '../src/ui/App.tsx',
      '../src/config/branding.ts',
    ]) {
      expect(read(file), `${file} contains the address in plain text`).not.toContain(
        ADDRESS,
      );
    }
  });
});

describe('the pre-addressed message', () => {
  const mailto = feedbackMailto('9.9.9', 'IP');

  it('addresses the mail and names the build', () => {
    expect(mailto.startsWith(`mailto:${ADDRESS}?`)).toBe(true);
    expect(decodeURIComponent(mailto)).toContain('v9.9.9');
  });

  it('escapes the subject and body rather than trusting them', () => {
    // An unescaped '&' or '#' truncates everything after it, silently losing
    // the half of the message the reader could see in the compose window.
    expect(mailto).toContain('subject=');
    expect(mailto).toContain('body=');
    expect(mailto.split('?')[1]!.split('&')).toHaveLength(2);
  });

  it('says which unit system the reader was in', () => {
    expect(decodeURIComponent(feedbackMailto('1.0.0', 'SI'))).toContain('SI units');
  });
});
