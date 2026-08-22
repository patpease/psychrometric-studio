# ADR 0001 — Vendor PsychroLib rather than depend on the npm package

**Status:** accepted · **Date:** 2026-08-22 · **Phase:** 0

## Context

The plan specified psychrolib as the basis for all property calculations, taken
from npm. On inspection:

- The npm package `psychrolib` is published from `nicfv/psychrolib-npm`, a
  third-party republish, **not** by the `psychrometrics` organisation.
- Its latest version is `1.1.1`, while the library it contains is **2.5.0**. The
  package version tracks the wrapper repository, not the library.
- The file it ships is **byte-identical** to upstream `src/js/psychrolib.js`
  at `master` (verified by diff).

So this is not a trust problem. It is a **traceability** problem: this tool
stamps its calculation basis on every exported report, and `psychrolib@1.1.1`
does not identify the calculation basis a reader needs to reproduce a result.

## Decision

Vendor `src/js/psychrolib.js` from `psychrometrics/psychrolib` directly into
`web/vendor/`, unmodified, with:

- the upstream MIT licence alongside it,
- a `PROVENANCE.md` recording source URL, library version, SHA-256, and date,
- `scripts/vendor-psychrolib.sh` to verify or refresh it,
- a CI step that runs the verify form on every build.

## Consequences

**Good.** The calculation basis is pinned to a specific artifact and cannot
drift silently — a changed file fails CI. Reports can cite a meaningful version.
No dependency on a wrapper repository that may lag upstream. This is also the
approach PsychPlotter takes.

**Costs.** Updates are manual: run the script with `--update`, review the diff,
update the recorded hash, re-run the reference-value suite. That friction is
intentional — an unexamined change to the calculation basis is exactly what
should be hard.

**Rejected alternative:** depending on `psychrolib@^1.1.1` from npm. Convenient,
and the code is identical today, but it makes the version stamp on a sealed PDF
report meaningless.
