# Psychrometric Studio

A psychrometric chart that solves an air-handling chain, checks it against
ASHRAE 55 comfort, and counts a year of weather against it. Everything runs in
the browser: no account, no upload, nothing kept. Live at
`psychrometric-studio.patpease0.workers.dev`; source is MIT.

It is a **Cloudflare Worker, not a Pages site.** They are different products and
the difference has broken a deploy: a `functions/` directory is ignored here,
and a route that should 404 instead returns the SPA shell with a 200. The Worker
entry point is `web/worker/index.ts`.

**Read this file first, then only what you need.** `PLAN.md` is 1,400 lines of
build history — a record of *why*, not an orientation. Do not read it whole.

## Layout

```
web/src/psych/       unit-aware state engine over vendored PsychroLib
web/src/chart/       scales, line families, SVG renderer, overlays
web/src/processes/   17 process models, chain solver, duty accounting
web/src/comfort/     ASHRAE 55 PMV/PPD, comfort polygon, adaptive model
web/src/weather/     EPW parsing, density binning, hours-in-zone
web/src/education/   equipment + concept content, live design checks, walkthrough
web/src/io/          project files, share links, CSV, SVG/PNG, report client
web/src/icons/       60 equipment SVGs + build-time generator
web/worker/          the Worker entry point and the weather relay route
api/                 FastAPI PDF report service. Optional; not deployed.
shared/schema/       project.schema.json — authoritative project file format
```

## The shape of a project

A project holds **operating cases** — normally two, a cooling one and a heating
one, turned between by the folded corner on the chart. This sits *above*
airstreams and the distinction matters: an airstream is a parallel duct within
one case and stage couplings resolve across them **by id, scoped per case**. Two
cases both having a `return` stream is ordinary; a coupling in one must never
resolve to the other's duct. `solveSystem` therefore takes one case, not a
project.

Shared across cases: units, site pressure, comfort, the weather file, and
`meta`. Per case: the chain, the chart view, the hour filter, and its own notes.
`meta` deliberately does not fork — a client name in two places is one that will
disagree with itself.

The schema is at version 2 and `MIGRATIONS` is no longer empty; a v1 file opens
as a single cooling case.

## Verifying a change

```bash
cd web && npm run typecheck && npm test && npm run build
```

**A green suite is not evidence the browser works.** This project has been
bitten by exactly that (see `docs/adr/0003-umd-interop.md`): tests passed while
the app failed to boot, because vitest did CJS interop that Vite's ESM pipeline
would not. For anything user-visible, open it. `npm run dev` serves on 5183.

**A green build is not evidence the deploy works either.** Two deploys have
failed with everything passing — once on the root directory, once on
Pages-versus-Workers. `npm run preview:worker` serves the built site and the
relay together in the real Workers runtime, and would have caught both.

**Measure performance on the production build, never the dev one.** React's
development build is several times slower. A page turn measured a 100 ms hitch
in dev and 18 ms in production; optimising against the dev number would have
been chasing something no user has. `npm run preview` serves the built app on
4183.

## Rules the tests enforce

1. **Never import `web/vendor/psychrolib.js` directly.** Go through
   `src/psych/psychrolib.ts` and `lib(units)`. Nothing may call
   `SetUnitSystem` — there are two pinned instances (ADR 0002).
2. **Store canonical, convert at the edge.** Humidity ratio in lb/lb or kg/kg;
   enthalpy in Btu/lb or **J/kg**. Display conversion lives in `units.ts`.
3. **Do not assert precision finer than `CONVERGENCE_TOLERANCE`.** Wet bulb is
   iterative and good to ±0.001 °C.
4. **Enthalpy is not comparable across unit systems.** IP measures from 0 °F,
   SI from 0 °C. Only *differences* convert.
5. **The API lays out; it never calculates.** Every number in a report is solved
   in the browser and sent ready to typeset.
6. **A design check must stay silent on a good design**, in both unit systems.
   Thresholds are declared in kelvin and converted; never compare a Fahrenheit
   delta against a Celsius limit.

## Things that look right and are not

Each of these shipped, compiled, and passed tests before being caught. They are
the failure shapes this codebase produces.

- **Reading computed styles from the source element instead of the export
  clone.** Produces a valid SVG in the wrong theme. See ADR 0004.
- **Stripping a parent's class before reading its children.** Kills every
  descendant CSS rule below it; the comfort zone exported as a solid black box.
- **Effect cleanup that clears state the crash screen needs.** React unmounts
  the tree when an error boundary catches, so `setRescue(null)` on unmount wipes
  the rescue exactly when it is wanted. `web/src/io/rescue.ts`.
- **`JSON.stringify(NaN)` prints `null`.** jsthermalcomfort returns NaN, not
  null, out of range. A `=== null` guard never fires and "NaN °F" reaches the
  UI. Test finiteness.
- **Unit switching that relabels without converting.** 95 °F left as the number
  95 is read as 95 °C. Everything the project holds converts together —
  `ui/convertProject.ts`.
- **Volumetric flow used where mass flow is meant.** 500 CFM at 95 °F is not the
  same dry-air mass as 500 CFM at 75 °F. The error always flatters the
  outdoor-air percentage.
- **A `useCallback` holding a setter that is no longer stable.** The write-through
  setters in `App.tsx` used to be `useState` setters, whose identity never
  changes, and several callers still capture one with an empty dependency array.
  When those setters started closing over the active case, every such caller
  wrote to whichever case was open when it was created — a click that did
  nothing on the second page, and a drag that silently edited the first. They
  read the target through a ref now, so their identity stays stable. There is no
  linter here to catch the next one.
- **`?? []` in a prop.** It builds a new array every render, so a memoised child
  comparing props shallowly re-renders every time regardless. Share one frozen
  empty value.
- **The walkthrough writing over a real design.** It builds a worked example on
  top of the chain that is there. It now runs on the cooling case by role,
  snapshots what it covered, and puts it back on exit.

## Regenerated files

`npm run build` regenerates `src/icons/generated.ts` and the third-party
notices. Both are committed, and CI fails if they drift. After adding an icon or
a runtime dependency, rebuild and commit the output.

## Where the detail lives

| Question | File |
|---|---|
| What is computed, and where it diverges from ASHRAE tables | `docs/calculation-reference.md` |
| Why PsychroLib is vendored, and the interop trap | `docs/adr/0001`, `0003` |
| Why exports inline computed styles | `docs/adr/0004-export-styling.md` |
| Weather sources, citation, why no direct download | `docs/weather-data.md` |
| Hosting, environment variables, the CSP | `docs/deploying.md` |
| Colours, icons, chart hues — the design system | `docs/design-system.md` |
| What is planned next | `BACKLOG.md` |
| Why any of it is the way it is | `PLAN.md` (reference only) |
