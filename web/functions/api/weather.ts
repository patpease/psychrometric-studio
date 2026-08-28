/**
 * Cloudflare Pages Function: relay a weather archive.
 *
 * Deliberately thin. Everything with a decision in it lives in
 * `src/weather/proxy.ts`, which the Vite dev server also uses — so what runs in
 * development is the same code that runs at the edge, and this file is only the
 * adapter between Cloudflare's Request/Response and that logic.
 *
 * This is the one piece of the deployment that cannot be exercised on a
 * developer's machine without Wrangler. Keeping it to a dozen lines is what
 * makes that acceptable.
 *
 * Lives at `web/functions/` because the Pages project's root directory is
 * `web` — Functions are found relative to that, not to the repository root.
 */
import { relayWeatherArchive, archiveNameFrom } from '../../src/weather/proxy.js';

interface PagesContext {
  request: Request;
}

export async function onRequestGet({ request }: PagesContext): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  const result = await relayWeatherArchive(target);

  if (result.status !== 200 || !result.body) {
    return new Response(JSON.stringify({ message: result.message ?? 'Unavailable.' }), {
      status: result.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  return new Response(result.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveNameFrom(target)}"`,
      // A weather archive for a given station does not change often, and a
      // repeated request is usually the same person trying again.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
