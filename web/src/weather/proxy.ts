/**
 * Fetching a weather archive by URL.
 *
 * Climate.OneBuilding sends no `Access-Control-Allow-Origin`, so a browser
 * cannot read a response from it however the request is phrased. `no-cors`
 * returns an opaque body that cannot be inspected, which is worse than an
 * error because it looks like success. Verified, not assumed — twice now, in
 * Phase 5 and again before this was written.
 *
 * So the request is relayed by a Cloudflare Pages Function on the same origin
 * as the site. This module is the part with the judgement in it, kept free of
 * any framework so that the Function and the Vite dev server can both use it
 * and there is only one implementation to get right.
 *
 * ## Why the host is pinned
 *
 * An endpoint that fetches whatever URL it is handed is an **open proxy**:
 * anyone on the internet can route traffic through your domain, and your logs
 * and your reputation carry it. The allowlist is the whole security model here,
 * and it is a single host rather than a pattern because a single host is what
 * the feature needs.
 *
 * ## On bandwidth
 *
 * This relays one archive per deliberate user action — the same file the user
 * would otherwise download by hand, at the same frequency. That is a different
 * proposition from the station index Phase 5 declined to build, which would
 * have crawled the whole site. If usage ever grows past incidental, the right
 * move is to ask Climate.OneBuilding rather than to keep quiet.
 */

/** The only host this relay will fetch from. */
export const ALLOWED_HOST = 'climate.onebuilding.org';

/**
 * Largest archive to relay.
 *
 * A TMYx zip is 1–3 MB. Twenty is generous for a bundled multi-year set and
 * still small enough that a request cannot be used to tie up the edge.
 */
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

export interface UrlProblem {
  readonly status: number;
  readonly message: string;
}

/**
 * Check a URL before anything is fetched.
 *
 * Returns the parsed URL or the reason it was refused. The message is shown to
 * the user, so it says what to do rather than what went wrong internally.
 */
export function validateWeatherUrl(raw: string): URL | UrlProblem {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { status: 400, message: 'No address was given.' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      status: 400,
      message: 'That is not a complete web address. It should begin with https://',
    };
  }

  if (url.protocol !== 'https:') {
    return { status: 400, message: 'Only https addresses are fetched.' };
  }

  // Exact host, not a suffix match: `climate.onebuilding.org.example.com` ends
  // with the allowed name and is a completely different server.
  if (url.hostname.toLowerCase() !== ALLOWED_HOST) {
    return {
      status: 403,
      message:
        `This tool only fetches from ${ALLOWED_HOST}. For a file from anywhere ` +
        'else, download it and drop it in.',
    };
  }

  if (!url.pathname.toLowerCase().endsWith('.zip')) {
    return {
      status: 400,
      message:
        'That address does not end in .zip. Copy the link to the archive itself — ' +
        'on Climate.OneBuilding, right-click the file and copy the link address.',
    };
  }

  return url;
}

export function isUrlProblem(value: URL | UrlProblem): value is UrlProblem {
  return !(value instanceof URL);
}

export interface RelayResult {
  readonly status: number;
  readonly body?: ArrayBuffer;
  readonly message?: string;
}

/**
 * Fetch the archive, with the checks a relay owes both ends.
 *
 * `doFetch` is injected so this can be tested without a network and so the
 * Pages Function and the dev server can each supply their own.
 */
export async function relayWeatherArchive(
  raw: string,
  doFetch: typeof fetch = fetch,
): Promise<RelayResult> {
  const url = validateWeatherUrl(raw);
  if (isUrlProblem(url)) return { status: url.status, message: url.message };

  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      // Identifying the caller is the courteous minimum when relaying someone
      // else's bandwidth, and it means they can contact us rather than block us.
      headers: { 'User-Agent': 'Psychrometric-Studio/1.0 (+https://psychrometric-studio.pages.dev)' },
      redirect: 'follow',
    });
  } catch {
    return {
      status: 502,
      message: `${ALLOWED_HOST} could not be reached. Try again, or download the file and drop it in.`,
    };
  }

  if (!response.ok) {
    return {
      status: response.status === 404 ? 404 : 502,
      message:
        response.status === 404
          ? 'There is no file at that address. Check the link, or browse to it again.'
          : `${ALLOWED_HOST} returned ${response.status}. Try again shortly.`,
    };
  }

  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    return { status: 413, message: 'That archive is larger than this tool will fetch.' };
  }

  const body = await response.arrayBuffer();
  // Checked again after reading: `content-length` is a claim, not a guarantee.
  if (body.byteLength > MAX_ARCHIVE_BYTES) {
    return { status: 413, message: 'That archive is larger than this tool will fetch.' };
  }
  if (body.byteLength === 0) {
    return { status: 502, message: 'That address returned an empty file.' };
  }

  return { status: 200, body };
}

/** Where the browser sends its request. Same origin, so no CORS is involved. */
export const RELAY_PATH = '/api/weather';

/** A filename for the fetched archive, taken from the URL. */
export function archiveNameFrom(raw: string): string {
  try {
    const last = new URL(raw).pathname.split('/').pop();
    return last && last.length > 0 ? decodeURIComponent(last) : 'weather.zip';
  } catch {
    return 'weather.zip';
  }
}
