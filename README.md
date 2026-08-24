# Psychrometric Studio

A web-hosted psychrometric chart, process-analysis, and thermal-comfort tool.

Property calculations follow the ASHRAE Handbook — Fundamentals via
[PsychroLib](https://github.com/psychrometrics/psychrolib); comfort calculations
follow ASHRAE Standard 55-2023.

> **For engineering analysis and education.** All results must be reviewed and
> independently verified by a qualified engineer before being used for design,
> procurement, or construction.

---

## Status

**Phase 7 complete** — an interactive psychrometric chart, seventeen equipment
types solved as a chain with verified energy balance, ASHRAE 55 thermal comfort,
EPW weather import with density mapping and hours-in-zone statistics, a teaching
layer (tooltips, a component reference that follows the selection, live design
checks, one guided walkthrough), and export: project files, share links, CSV,
PNG, SVG, and a branded PDF report. Deployment is Phase 8. See
[PLAN.md](PLAN.md) for the full roadmap.

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Repo, project schema, CI, unit system, state engine | ✅ done |
| 1 | Chart engine — all line families, both unit systems, zoom/pan/hover | ✅ done |
| 2 | State points and core process chain | ✅ done |
| 3 | Comfort module — PMV/PPD, comfort polygon, adaptive | ✅ done |
| 4 | Coil detail, energy recovery, advanced processes | ✅ done |
| 5 | EPW import, scatter, density bins, hours-in-zone | ✅ done |
| 6 | Education — tooltips, component panel, live checks, one walkthrough | ✅ done |
| 7 | Export and IO — JSON, URL, CSV, PNG, SVG, PDF | ✅ done |
| 8 | Deploy, docs, polish | next |

## Layout

```
web/       Vite + TypeScript front end — owns every interactive calculation
  src/psych/     unit-aware state engine over PsychroLib
  src/chart/     scales, line families, SVG renderer, process overlay
  src/processes/ process models, chain solver, duty accounting
  src/comfort/   ASHRAE 55 PMV/PPD, comfort polygon, adaptive model
  src/weather/   EPW parsing, density binning, hours-in-zone
  src/education/ equipment and concept content, live design checks, walkthrough
  src/icons/     equipment SVGs and the build-time generator
  src/io/        project files, share links, CSV, SVG/PNG export, report client
  src/config/    branding and legal text (single source of truth)
  src/types/     project file types, mirroring the JSON Schema
  vendor/        vendored PsychroLib + provenance
  tests/         engine validation, including the ASHRAE reference gate
api/       FastAPI — PDF reports and the CI comfort oracle. Deliberately thin.
             It lays out; it never calculates.
shared/schema/   project.schema.json — authoritative project file format
docs/            calculation reference and architecture decisions
scripts/         vendoring and verification
```

## Getting started

```bash
cd web && npm install
```

Run the validation gate:

```bash
cd web && npm test
```

Type check:

```bash
cd web && npm run typecheck
```

Verify the vendored calculation basis has not drifted:

```bash
cd web && npm run verify:vendor
```

Start the dev server:

```bash
cd web && npm run dev
```

## Design notes worth reading before contributing

- **[docs/calculation-reference.md](docs/calculation-reference.md)** — what is
  computed, and where it knowingly diverges from the printed ASHRAE tables.
  Read §3 before reporting a discrepancy as a bug.
- **[ADR 0001](docs/adr/0001-vendor-psychrolib.md)** — why PsychroLib is
  vendored rather than installed from npm.
- **[ADR 0002](docs/adr/0002-dual-instance-unit-systems.md)** — why there are
  two PsychroLib instances and why nothing may call `SetUnitSystem`.
- **[docs/weather-data.md](docs/weather-data.md)** — where weather files come
  from, how to cite them, and why there is no direct-download button.
- **[ADR 0003](docs/adr/0003-umd-interop.md)** — why a green test suite is not
  evidence that the browser works, and what was done about it.
- **[ADR 0004](docs/adr/0004-export-styling.md)** — why exports inline computed
  styles, and the two ways of getting that wrong that produce a valid file.

Six rules that the tests enforce and that are easy to break by accident:

1. **Never import `vendor/psychrolib.js` directly.** Go through
   `src/psych/psychrolib.ts` and `lib(units)`.
2. **Store canonical, convert at the edge.** Humidity ratio lives in lb/lb or
   kg/kg; enthalpy in Btu/lb or **J/kg**. Display conversion belongs in
   `units.ts` and nowhere else.
3. **Do not assert precision finer than `CONVERGENCE_TOLERANCE`.** Wet-bulb
   values are iterative and good to ±0.001 °C. Tighter assertions fail for
   reasons that have nothing to do with your change.
4. **Enthalpy is not comparable across unit systems.** The IP and SI datums
   differ (0 °F vs 0 °C). Only enthalpy *differences* convert. See
   [calculation-reference §5](docs/calculation-reference.md).
5. **The API lays out; it does not calculate.** Every number in a report is
   computed in the browser and sent already solved. A service that re-derived
   duties from state points would drift from the chart on screen, and the report
   would be the thing that was wrong.
6. **A design check must stay silent on a good design.** Rules in
   `src/education/checks.ts` are tested against the system the tool opens with,
   in *both* unit systems. A rule that fires there has taught the user to ignore
   every rule. Thresholds are declared in kelvin and converted; never compare a
   Fahrenheit delta against a Celsius limit.

### Running the report service

```bash
cd api && python -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/python -m uvicorn app.main:app --port 8000
```

The web application works without it. The PDF button appears only once
`/health` answers, so the export is never a promise the tool cannot keep. Two
environment variables matter in deployment: `VITE_API_URL` at build time for the
front end, and `PSYCHRO_ALLOWED_ORIGINS` on the service, which must name the
deployed front end or the browser will refuse the request.

### Editing the content

Equipment entries live in `src/education/equipment.ts`, chart concepts in
`concepts.ts`, and the walkthrough in `walkthrough.ts` — all plain TypeScript,
no application code involved. A concept's `summary` is its tooltip *and* the
first line of its panel entry, so there is one definition of each term rather
than two that can drift.

### Adding an icon

Drop the SVG into `src/icons/svg/` and run `npm run build:icons`. It must be a
`0 0 48 48` canvas; the generator enforces that and replaces the `#0B2B28`
outline with `currentColor` so it works in both themes. Map it to a stage type
in `src/icons/map.ts`. A mapped name with no artwork renders as a dashed
placeholder and must be listed in `PENDING_ICONS`, which is how the tests tell
a deliberate gap from a typo.

## Weather data

Weather files come from [Climate.OneBuilding.org](https://climate.onebuilding.org/).
Cite the TMYx data set as:

> Lawrie, Linda K, Drury B Crawley. 2026. *Development of Global Typical
> Meteorological Years (TMYx)*.

## Licensing

PsychroLib is MIT — see `web/vendor/psychrolib.LICENSE.txt`. ASHRAE standards
are copyrighted; this project implements published equations and does not
reproduce tables or text.

Branding is **Pease Studio**, confined to `web/src/config/branding.ts`, the mark
in `web/src/ui/BrandMark.tsx`, and the app icon at `web/public/icon.svg`. The
identity artwork was supplied as raster images and reproduced as SVG; drop the
original files into `web/public/` to swap them back.
