import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
