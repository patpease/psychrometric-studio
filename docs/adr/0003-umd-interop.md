# ADR 0003 — Consume the vendored UMD through a local package

**Status:** accepted · **Date:** 2026-08-22 · **Phase:** 0

## Context

With PsychroLib vendored (ADR 0001) and imported directly as
`../../vendor/psychrolib.js`, the full test suite passed — 101 tests — while the
application failed to boot in a browser with:

> SyntaxError: The requested module '/vendor/psychrolib.js' does not provide an
> export named 'default'

The two environments resolve the same file differently:

- **vitest** runs the file through Vite's Node transform, which performs
  CommonJS interop and synthesises a default export.
- **the browser** receives the file as a native ES module. The UMD wrapper
  detects neither AMD nor CommonJS, assigns to `self.psychrolib`, and exports
  nothing. The import fails at parse time.

This is the dangerous class of bug: not a wrong number, but a green suite
standing over an application that cannot start.

## Decision

Consume the vendored file through a local package rather than by path:

- `web/vendor/package.json` declares `psychrolib-vendored` with
  `"main": "psychrolib.js"`.
- `web/package.json` depends on it via `file:vendor`.
- `vite.config.ts` sets `optimizeDeps.include: ['psychrolib-vendored']` and
  `build.commonjsOptions.include: [/vendor/, /node_modules/]`.

Both overrides are required and for different reasons: Vite does not pre-bundle
symlinked (`file:`) dependencies by default, and Rollup's CommonJS plugin only
looks inside `node_modules`. Omitting either restores the failure in dev or in
the production build respectively.

`psychrolib.js` itself remains byte-identical to upstream, so ADR 0001's
provenance guarantee and the CI checksum both stand.

## Consequences

**Good.** One interop mechanism serves dev, production build, and tests. No
`eval`, so no `unsafe-eval` in the deployed site's Content Security Policy. No
modification to the vendored file. Verified working in the browser and in a
production build.

**Costs.** Two Vite settings must stay in sync with the vendoring arrangement,
and their necessity is not self-evident — both are commented in `vite.config.ts`
pointing here.

**Process consequence, and the more important one.** Phase 0's gate was "the
reference-value suite passes". That gate was met while the app was broken. Every
subsequent phase gate that touches module loading, rendering, or the DOM must
include a browser check, not only `npm test`. Recorded in PLAN.md §14 finding 5.
