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

**Phase 2 complete** — an interactive psychrometric chart plus a solved
equipment chain: mixing, coils, humidifiers, fan heat, and room loads, with
duties, system totals, and a verified energy balance. Thermal comfort is
Phase 3. See [PLAN.md](PLAN.md) for the full roadmap.

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Repo, project schema, CI, unit system, state engine | ✅ done |
| 1 | Chart engine — all line families, both unit systems, zoom/pan/hover | ✅ done |
| 2 | State points and core process chain | ✅ done |
| 3 | Comfort module — PMV/PPD, comfort polygon, adaptive | next |
| 4 | Coil detail, energy recovery, advanced processes | |
| 5 | EPW import, scatter, density bins, hours-in-zone | |
| 6 | Education — walkthrough engine and content | |
| 7 | Export and IO — JSON, URL, CSV, PNG, SVG, PDF | |
| 8 | Deploy, docs, polish | |

## Layout

```
web/       Vite + TypeScript front end — owns every interactive calculation
  src/psych/     unit-aware state engine over PsychroLib
  src/chart/     scales, line families, SVG renderer, process overlay
  src/processes/ process models, chain solver, duty accounting
  src/config/    branding and legal text (single source of truth)
  src/types/     project file types, mirroring the JSON Schema
  vendor/        vendored PsychroLib + provenance
  tests/         engine validation, including the ASHRAE reference gate
api/       FastAPI — PDF reports and the CI comfort oracle. Deliberately thin.
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

Three rules that the tests enforce and that are easy to break by accident:

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

## Licensing

PsychroLib is MIT — see `web/vendor/psychrolib.LICENSE.txt`. ASHRAE standards
are copyrighted; this project implements published equations and does not
reproduce tables or text.

Branding is **Pease Studio**, confined to `web/src/config/branding.ts`, the mark
in `web/src/ui/BrandMark.tsx`, and the app icon at `web/public/icon.svg`. The
identity artwork was supplied as raster images and reproduced as SVG; drop the
original files into `web/public/` to swap them back.
