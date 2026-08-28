import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { relayWeatherArchive, RELAY_PATH } from './src/weather/proxy.js';

/**
 * The weather relay, in development.
 *
 * In production this is a Cloudflare Pages Function; Vite's dev server knows
 * nothing about those, so without this the URL-fetch feature would 404 locally
 * and only be testable by deploying. Both call the same `relayWeatherArchive`,
 * so the behaviour under test here is the behaviour that ships — the adapter is
 * all that differs.
 */
function weatherRelay(): Plugin {
  return {
    name: 'psychro-weather-relay',
    configureServer(server) {
      server.middlewares.use(RELAY_PATH, async (request, response) => {
        const target = new URL(request.url ?? '', 'http://localhost').searchParams.get('url') ?? '';
        const result = await relayWeatherArchive(target);

        if (result.status !== 200 || !result.body) {
          response.statusCode = result.status;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ message: result.message ?? 'Unavailable.' }));
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/zip');
        response.end(Buffer.from(result.body));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), weatherRelay()],
  server: { port: 5183, strictPort: true },

  /**
   * The vendored PsychroLib is a UMD module consumed through the local
   * `vendor/` package (see vendor/PROVENANCE.md and docs/adr/0001).
   *
   * Vite does not pre-bundle symlinked/`file:` dependencies by default, and
   * Rollup's CommonJS plugin only looks inside node_modules. Without both
   * overrides below the browser receives the raw UMD file, finds no ESM export,
   * and the app fails to boot — while Node-based tests still pass, because
   * vitest's transform performs the interop. Keep these in sync; the divergence
   * between test and browser is silent otherwise.
   */
  optimizeDeps: {
    include: ['psychrolib-vendored'],
  },
  build: {
    commonjsOptions: {
      include: [/vendor/, /node_modules/],
    },
  },

  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
