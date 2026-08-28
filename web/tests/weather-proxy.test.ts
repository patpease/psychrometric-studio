/**
 * The weather relay's judgement.
 *
 * The endpoint itself is a dozen lines of adapter; everything worth testing is
 * here. The most important tests are the refusals — an endpoint that fetches
 * whatever URL it is handed is an open proxy, and the allowlist is the entire
 * security model.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ALLOWED_HOST,
  MAX_ARCHIVE_BYTES,
  archiveNameFrom,
  isUrlProblem,
  isArchiveResponse,
  relayWeatherArchive,
  validateWeatherUrl,
} from '../src/weather/proxy.js';

const REAL =
  'https://climate.onebuilding.org/WMO_Region_4_North_and_Central_America/ABW_Aruba/' +
  'ABW_AA_Queen.Beatrix.Intl.AP.789820_TMYx.2009-2023.zip';

/** A fetch that returns the given archive without touching the network. */
function stubFetch(body: Uint8Array, init: Partial<{ status: number; length: string }> = {}) {
  return vi.fn(async () =>
    new Response(init.status && init.status >= 400 ? null : (body.slice().buffer as ArrayBuffer), {
      status: init.status ?? 200,
      headers: init.length ? { 'content-length': init.length } : {},
    }),
  ) as unknown as typeof fetch;
}

describe('what the relay will fetch', () => {
  it('accepts a real Climate.OneBuilding archive URL', () => {
    const url = validateWeatherUrl(REAL);
    expect(isUrlProblem(url)).toBe(false);
  });

  it('refuses any other host', () => {
    const url = validateWeatherUrl('https://example.com/weather.zip');
    expect(isUrlProblem(url) && url.status).toBe(403);
  });

  it('refuses a host that merely ends with the allowed name', () => {
    // `climate.onebuilding.org.attacker.example` ends with the allowed string
    // and is a completely different server. A suffix match would relay to it.
    const url = validateWeatherUrl(`https://${ALLOWED_HOST}.attacker.example/x.zip`);
    expect(isUrlProblem(url) && url.status).toBe(403);
  });

  it('refuses a subdomain that was not allowed', () => {
    const url = validateWeatherUrl(`https://evil.${ALLOWED_HOST}/x.zip`);
    expect(isUrlProblem(url) && url.status).toBe(403);
  });

  it('refuses plain http', () => {
    expect(isUrlProblem(validateWeatherUrl(`http://${ALLOWED_HOST}/x.zip`))).toBe(true);
  });

  it('refuses schemes that are not http at all', () => {
    for (const attempt of [
      `file:///etc/passwd`,
      `data:application/zip;base64,AAAA`,
      `javascript:alert(1)`,
    ]) {
      expect(isUrlProblem(validateWeatherUrl(attempt)), attempt).toBe(true);
    }
  });

  it('refuses a path that is not an archive', () => {
    const url = validateWeatherUrl(`https://${ALLOWED_HOST}/default.html`);
    expect(isUrlProblem(url) && url.message).toMatch(/\.zip/);
  });

  it('says what to do rather than what went wrong', () => {
    const url = validateWeatherUrl('not a url');
    expect(isUrlProblem(url) && url.message).toMatch(/https:\/\//);
  });
});

describe('relaying', () => {
  const archive = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

  it('returns the bytes for an allowed URL', async () => {
    const result = await relayWeatherArchive(REAL, stubFetch(archive));
    expect(result.status).toBe(200);
    expect(new Uint8Array(result.body!)).toEqual(archive);
  });

  it('never calls fetch for a refused URL', async () => {
    // The check must happen before the request, or the refusal is decorative:
    // the traffic has already left the edge by then.
    const doFetch = stubFetch(archive);
    await relayWeatherArchive('https://example.com/x.zip', doFetch);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('turns a 404 into something a person can act on', async () => {
    const result = await relayWeatherArchive(REAL, stubFetch(archive, { status: 404 }));
    expect(result.status).toBe(404);
    expect(result.message).toMatch(/no file at that address/i);
  });

  it('reports an unreachable host without throwing', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    const result = await relayWeatherArchive(REAL, doFetch);
    expect(result.status).toBe(502);
    expect(result.message).toMatch(/download the file and drop it in/);
  });

  it('refuses an oversized archive on its declared length', async () => {
    const result = await relayWeatherArchive(
      REAL,
      stubFetch(archive, { length: String(MAX_ARCHIVE_BYTES + 1) }),
    );
    expect(result.status).toBe(413);
  });

  it('refuses an oversized archive that understated its length', async () => {
    // content-length is a claim. A relay that trusts it can be made to buffer
    // whatever the far end feels like sending.
    const huge = new Uint8Array(MAX_ARCHIVE_BYTES + 10);
    const result = await relayWeatherArchive(REAL, stubFetch(huge, { length: '10' }));
    expect(result.status).toBe(413);
  });

  it('reports an empty response rather than handing back nothing', async () => {
    const result = await relayWeatherArchive(REAL, stubFetch(new Uint8Array(0)));
    expect(result.status).toBe(502);
  });
});

describe('naming the downloaded archive', () => {
  it('takes the filename from the URL', () => {
    expect(archiveNameFrom(REAL)).toBe('ABW_AA_Queen.Beatrix.Intl.AP.789820_TMYx.2009-2023.zip');
  });

  it('falls back when there is nothing to take', () => {
    expect(archiveNameFrom('nonsense')).toBe('weather.zip');
  });
});

describe('telling a relay answer from the application shell', () => {
  it('accepts a zip', () => {
    expect(isArchiveResponse('application/zip')).toBe(true);
    expect(isArchiveResponse('application/octet-stream')).toBe(true);
  });

  it('rejects HTML, whatever the status code said', () => {
    // A single-page deployment answers 200 with index.html for any path it does
    // not know — so a relay that was never deployed looks like success. This is
    // the check that turns "this .zip could not be opened" into something true.
    expect(isArchiveResponse('text/html')).toBe(false);
    expect(isArchiveResponse('text/html; charset=utf-8')).toBe(false);
    expect(isArchiveResponse('TEXT/HTML')).toBe(false);
  });

  it('does not treat a missing content-type as failure', () => {
    // Absence of a declaration is not evidence against the archive, and
    // refusing on it would break a correct relay that omitted the header.
    expect(isArchiveResponse(null)).toBe(true);
    expect(isArchiveResponse('')).toBe(true);
  });
});
