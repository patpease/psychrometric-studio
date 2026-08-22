# ADR 0002 — Two pinned PsychroLib instances instead of a global unit system

**Status:** accepted · **Date:** 2026-08-22 · **Phase:** 0

## Context

PsychroLib's UMD bundle exports a **singleton** — `new Psychrometrics()` — whose
unit system is module-global mutable state set by `SetUnitSystem`. Every
subsequent call silently depends on whichever system was set last, and calling a
property function before setting one throws.

bh-psych, the Python predecessor, wrapped every single call in a
`threading.Lock` and a `_set(units)` call for precisely this reason.

The hazard translates to JavaScript in two forms:

1. **Order dependence.** Any code path that sets the system and then reads a
   value can be interleaved with another that sets it differently. There are no
   threads, but there are async boundaries, event handlers, and future workers.
2. **No side-by-side evaluation.** A CSV export in both unit systems, or a unit
   toggle that shows before-and-after, would have to thrash global state.

Both are silent failures. Numbers come back wrong, not missing.

## Decision

Construct **two instances** from the singleton's own constructor, pin each to
one unit system at module load, and never call `SetUnitSystem` again:

```ts
const Psychrometrics = psychrolibSingleton.constructor as new () => PsychroLib;
export const psyIP = pinned('IP');
export const psySI = pinned('SI');
export const lib = (units: UnitSystem) => (units === 'IP' ? psyIP : psySI);
```

`psychrolibSingleton` is `new Psychrometrics()`, so `.constructor` is the class
itself. Each instance gets its own unit state.

All application code goes through `lib(units)`. Nothing imports the vendored
file directly, and nothing calls `SetUnitSystem`.

## Consequences

**Good.** Unit state cannot be corrupted by call order. IP and SI evaluate
concurrently. No locking, no set-then-read discipline for callers to remember,
and no ambient state to reason about at a call site. `web/tests/psychrolib-instances.test.ts`
proves independence under aggressive interleaving.

**Costs.** It relies on `.constructor` reaching the class through the UMD
factory. That is stable JavaScript semantics, not a trick of this build, but it
is an assumption about upstream's module shape — so it is asserted in tests
rather than trusted. If a future PsychroLib release exports the class directly,
this simplifies; if it freezes the singleton, the tests fail loudly and the
fallback is a small modification to the vendored file (giving up the
"byte-identical to upstream" property recorded in ADR 0001).

**Rejected alternatives.** Calling `SetUnitSystem` before every call — restores
the exact fragility the lock existed to paper over. Vendoring two copies of the
file under different module names — works, doubles the bundle and the audit
surface for no benefit.
