# Psychrometric Studio

A web-hosted psychrometric chart, process-analysis, and thermal-comfort tool.
Draw an air-handling system, solve it, check it against ASHRAE 55 comfort, and
count a year of real weather against the result.

Everything is computed in the browser. No account, no upload, and nothing kept
after the tab closes.

> **For engineering analysis and education.** All results must be reviewed and
> independently verified by a qualified engineer before being used for design,
> procurement, or construction.

**Version 0.1.**

---

## What it does

### The chart

A live psychrometric chart in **IP or SI**, with every line family — saturation,
relative humidity, wet bulb, enthalpy, specific volume, dew point — drawn from
computed properties rather than from a background image, so it stays correct at
any site pressure. Scroll to zoom, drag to pan, hover anywhere for a full
readout of the air at that point. An optional SHR protractor is available for
reading process slopes off the chart directly.

Site pressure can be taken as standard, derived from elevation, or entered
outright. Loading a weather file sets it from the station's elevation.

### Systems

Build a chain of equipment and the tool solves it stage by stage, each one
taking the leaving state of the one before it. **Seventeen equipment types**:

| | |
|---|---|
| **Air** | entering air, mixing box, fan, room / zone |
| **Coils** | cooling, heating |
| **Humidification** | steam, adiabatic |
| **Energy recovery** | sensible wheel, enthalpy wheel, plate exchanger, run-around coil, wrap-around pre-cool and reheat |
| **Evaporative** | direct, indirect |
| **Dehumidification** | desiccant wheel |

Cooling coils report apparatus dew point, bypass factor, and sensible heat
ratio. Recovery devices and mixing boxes couple to other airstreams by
reference, so a wheel exchanges with the stream it actually serves. Duties are
accounted per stage and totalled, and the tool states plainly whether the energy
balance closes.

### Two operating cases

A system reads differently in summer and winter. A project holds **two operating
cases on the same air handler**, reached by the turned corner at the top-left of
the chart. Each carries its own equipment chain, its own chart view, and its own
weather filter; the site, the occupants, and the weather file are shared. Saving
a project saves both.

### Thermal comfort

ASHRAE Standard 55-2023, evaluated live: **PMV and PPD** with the standard's own
SET-based correction, or the **adaptive model** with an exponentially weighted
running mean of outdoor temperature. Comfort zones are drawn on the chart as
polygons — a winter zone and a summer zone together — and rebuilt whenever any
input changes.

### Weather

Import an **EPW** file, or paste a Climate.OneBuilding archive URL and the tool
fetches it. All 8,760 hours can be drawn as a scatter or as a density map, and
filtered by month and hour of day — occupied hours, cooling season, heating
season, or any set you choose.

**Hours-in-zone** counts how much of the year falls inside the comfort zone, and
where the rest of it sits: warmer, cooler, more humid, drier.

**Design days** are read from the `.ddy` in the same archive: heating 99.6%,
and the three ASHRAE cooling conditions — dry bulb, dehumidification, and
enthalpy. They plot on the chart and can be applied to an outdoor-air intake
directly.

### Teaching layer

The tool explains itself as you use it. A **component reference** follows what
is selected and explains what that equipment does and what to check about it.
**Thirty chart concepts** are defined once and reused as both tooltip and
reference entry, and every underlined term anywhere in the interface opens its
entry. **Live design checks** flag a system that will not work as drawn, and a
**guided walkthrough** builds a cooling coil selection in eight steps.

Both starter systems close their own loop: the air leaving the room is exactly
the air the mixing box declares is coming back. A test fails if either stops
doing so — an opening example that contradicts itself teaches the wrong thing on
first contact.

### Getting work out

Project files (JSON), share links that carry the whole project in the URL, CSV
of state points and duties, and **PNG** and **SVG** of the chart. An optional
PDF report is available when the report service is deployed.

---

## What it is built on

### Calculations

| | |
|---|---|
| Moist-air properties | [PsychroLib](https://github.com/psychrometrics/psychrolib) 2.5.0, following the ASHRAE Handbook — Fundamentals |
| Thermal comfort | [jsthermalcomfort](https://github.com/FedericoTartarini/jsthermalcomfort) 1.4.0, the JavaScript port of `pythermalcomfort` |
| Weather archives | [fflate](https://github.com/101arrowz/fflate) 0.8.3 |
| Interface | [React](https://react.dev) 19 |

All four are MIT. PsychroLib is **vendored rather than installed**, and CI
checks its SHA-256 against a recorded value, so the calculation basis stamped on
an export cannot drift from the code that produced it — see
[ADR 0001](docs/adr/0001-vendor-psychrolib.md).

Every process model is closed-form or a bounded iteration; nothing is
interpolated from a table, and nothing is fitted. Where results knowingly
diverge from the printed ASHRAE tables, the divergence is documented in
[docs/calculation-reference.md](docs/calculation-reference.md) — read §3 before
reporting a discrepancy as a bug.

### Standards

- **ASHRAE Handbook — Fundamentals** — moist-air property relations
- **ASHRAE Standard 55-2023** — thermal comfort, PMV/PPD and adaptive
- **EnergyPlus weather format (EPW)** and `SizingPeriod:DesignDay` from IDF

ASHRAE standards are copyrighted. This project implements published equations
and reproduces neither the tables nor the text of any standard.

### Shape of the thing

A single-page application with no backend for anything that calculates. The one
server-side route is `/api/weather`, which relays weather archives from
Climate.OneBuilding because that host sends no CORS header; it validates the
host against a single-entry allowlist before fetching anything.

An optional FastAPI service renders PDF reports. It **lays out; it never
calculates** — every number in a report is computed in the browser and sent
already solved, because a service that re-derived duties from state points would
drift from the chart on screen, and the report would be the thing that was
wrong.

The project file format is defined by
[a JSON Schema](shared/schema/project.schema.json), which is authoritative, and
carries a migration path: files written by older versions open and are upgraded.
It stores what the user **declared**, never what the solver worked out — so
reopening a project at a different site pressure re-solves rather than carrying
yesterday's answers forward under today's assumptions.

**536 tests** cover the engine, including a reference gate against published
ASHRAE values.

---

## Layout

```
web/       Vite + TypeScript front end — owns every interactive calculation
  src/psych/     unit-aware state engine over PsychroLib
  src/chart/     scales, line families, SVG renderer, process overlay
  src/processes/ process models, chain solver, duty accounting
  src/comfort/   ASHRAE 55 PMV/PPD, comfort polygon, adaptive model
  src/weather/   EPW and DDY parsing, density binning, hours-in-zone
  src/education/ equipment and concept content, live design checks, walkthrough
  src/icons/     equipment SVGs and the build-time generator
  src/io/        project files, share links, CSV, SVG/PNG export, report client
  src/config/    branding and legal text (single source of truth)
  src/types/     project file types, mirroring the JSON Schema
  worker/        the Cloudflare Worker entry point and weather relay
  vendor/        vendored PsychroLib + provenance
  tests/         engine validation, including the ASHRAE reference gate
api/       FastAPI — PDF reports and the CI comfort oracle. Deliberately thin.
             It lays out; it never calculates.
shared/schema/   project.schema.json — authoritative project file format
docs/            calculation reference and architecture decisions
scripts/         vendoring and verification
```

New to the codebase? Read [CLAUDE.md](CLAUDE.md) — it is the orientation.
[BACKLOG.md](BACKLOG.md) is what is open.

## Getting started

```bash
cd web && npm install
```

Start the dev server:

```bash
cd web && npm run dev
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

Serve the production shape locally — the built site and the weather relay
together, in the real Workers runtime:

```bash
cd web && npm run preview:worker
```

## Deploying

Cloudflare Workers, via Workers Builds: root directory `web`, build
`npm run build`, deploy `npx wrangler deploy`. `wrangler.jsonc` declares the
static assets and the Worker entry point.

Run `npm run preview:worker` before deploying. A green build is not evidence
that the deployed shape works — twice it has not been, and that command is what
closes the gap.

Leave `VITE_API_URL` unset and the tool ships without the PDF report, which is
the default configuration. Full instructions, the content security policy, and
what changes when you add the report service are in
[docs/deploying.md](docs/deploying.md).

### Running the report service

```bash
cd api && python -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/python -m uvicorn app.main:app --port 8000
```

The web application works without it. The PDF button appears only once
`/health` answers, so the export is never a promise the tool cannot keep. Two
environment variables matter in deployment: `VITE_API_URL` at build time for the
front end, and `PSYCHRO_ALLOWED_ORIGINS` on the service, which must name the
deployed front end or the browser will refuse the request.

## Design notes worth reading before contributing

- **[docs/calculation-reference.md](docs/calculation-reference.md)** — what is
  computed, and where it knowingly diverges from the printed ASHRAE tables.
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
   computed in the browser and sent already solved.
6. **A design check must stay silent on a good design.** Rules in
   `src/education/checks.ts` are tested against the systems the tool opens with,
   in *both* unit systems. A rule that fires there has taught the user to ignore
   every rule. Thresholds are declared in kelvin and converted; never compare a
   Fahrenheit delta against a Celsius limit.

### Editing the content

Equipment entries live in `src/education/equipment.ts`, chart concepts in
`concepts.ts`, and the walkthrough in `walkthrough.ts` — all plain TypeScript,
no application code involved. A concept's `summary` is its tooltip *and* the
first line of its panel entry, so there is one definition of each term rather
than two that can drift.

The systems a new project opens with are in `src/ui/starters.ts`, and
`tests/starter.test.ts` checks that both still close their loop.

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

Psychrometric Studio is **MIT** — see [LICENSE](LICENSE).

The libraries that ship in the bundle are all MIT. Their copyright and
permission notices are collected into
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and served by the application
at `/third-party-notices.txt`, because a minified bundle strips comments and the
deployed page is the distribution most people will ever see. The file is
**generated** — run `npm run build:notices` after changing a runtime dependency
rather than editing it.

Branding is **Pease Studio**, confined to `web/src/config/branding.ts` and the
image assets under `web/public/brand/`. Swapping or genericising the identity is
a change to that one file and those files.
