# Psychrometric Studio

A psychrometric chart that solves an air-handling chain, checks it against
ASHRAE 55 comfort, and counts a year of weather against it. Everything runs in
the browser: no account, no upload, nothing kept. Live at
`psychrometric-studio.pages.dev`; source is MIT.

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
api/                 FastAPI PDF report service. Optional; not deployed in v1.
shared/schema/       project.schema.json — authoritative project file format
```

## Verifying a change

```bash
cd web && npm run typecheck && npm test && npm run build
```

**A green suite is not evidence the browser works.** This project has been
bitten by exactly that (see `docs/adr/0003-umd-interop.md`): tests passed while
the app failed to boot, because vitest did CJS interop that Vite's ESM pipeline
would not. For anything user-visible, open it. `npm run dev` serves on 5183.

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
