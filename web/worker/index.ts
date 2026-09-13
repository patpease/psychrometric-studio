/**
 * Cloudflare Worker entry point.
 *
 * The site deploys through **Workers Builds**, not Pages. The two are different
 * products with different conventions, and the difference is not cosmetic: a
 * Pages-style `functions/` directory is silently ignored here, and every
 * unrecognised path falls through to the application shell — so a relay that
 * was never deployed answers `200 text/html` rather than `404`. That is how
 * this was discovered, on the live deployment, after the previous version
 * shipped.
 *
 * Under Workers the shape is explicit instead: one script owns every request,
 * handles what it recognises, and hands the rest to the static assets binding.
 *
 * As with the Pages function it replaces, this is an adapter and nothing more.
 * The judgement lives in `src/weather/proxy.ts`, which the Vite dev server also
 * serves — so the logic running at the edge is the logic exercised locally.
 */
import { relayWeatherArchive, archiveNameFrom, RELAY_PATH } from '../src/weather/proxy.js';

interface Env {
  /** Static assets, bound by `assets.binding` in wrangler.jsonc. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === RELAY_PATH) {
      if (request.method !== 'GET') {
        return json({ message: 'Use GET.' }, 405);
      }

      const target = url.searchParams.get('url') ?? '';
      const result = await relayWeatherArchive(target);

      if (result.status !== 200 || !result.body) {
        return json({ message: result.message ?? 'Unavailable.' }, result.status);
      }

      return new Response(result.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${archiveNameFrom(target)}"`,
          // A station's archive rarely changes, and a repeated request is
          // usually the same person trying again.
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const response = await env.ASSETS.fetch(request);

    // A FAILURE MUST NEVER INHERIT THE IMMUTABLE CACHE RULE.
    //
    // public/_headers matches on the PATH, not on the outcome, so a 404 under
    // /assets/ came back stamped "max-age=31536000, immutable". Every deploy
    // has a window where the new index.html is live before a given edge has
    // the new bundle; a browser loading the site in that window caches the 404
    // FOR A YEAR and shows a blank page from then on, with no error a user
    // could act on and nothing a reload fixes.
    //
    // This is not hypothetical: it took heat-balance-studio down on a real
    // deploy, and this site was serving the same header on a missing asset.
    if (!response.ok) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
