# Psychrometric Studio — Project Plan

A web-hosted psychrometric chart, process-analysis, and thermal-comfort tool.
Calculations per ASHRAE Handbook — Fundamentals (via psychrolib) and
ASHRAE Standard 55-2023 (via jsthermalcomfort / pythermalcomfort).

**Status:** planning · **Date:** 2026-08-22

---

## 1. Goals

1. A complete, accurate, interactive psychrometric chart — every standard line
   family, both unit systems, arbitrary altitude/pressure.
2. Model real air-handling processes as a chain, solve every state point, and
   report loads.
3. Overlay an ASHRAE 55 comfort zone computed live from clo/met/air speed,
   in the manner of the CBE Thermal Comfort Tool.
4. Teach. Guided walkthroughs and worked examples that drive the chart, so a
   graduate engineer learns *why* the process moves the way it does.
5. Be reachable from a browser with no install and no login.

## 2. Confirmed scope

| Decision | Choice |
|---|---|
| Architecture | Hybrid — JS front end + Python API |
| Comfort models | PMV/PPD + comfort-zone polygon; adaptive model |
| Processes | Core set, coil detail (ADP/BF), energy recovery, advanced (evap/desiccant/DOAS) |
| Education | Guided walkthroughs + worked examples |
| Units | IP primary, SI toggle; calculations run natively in the selected system |
| Hosting | Public, open, no accounts |
| Weather data | EPW import with 8,760-hour scatter; bin density heatmap + hours-in-zone stats |
| Output | JSON project file, branded PDF report, PNG + vector SVG/PDF, shareable URL, CSV |

**Explicitly out of scope for v1** (deferred, not rejected): local discomfort
indices (ankle draft, vertical gradient, floor temperature, radiant asymmetry);
EN 16798 / ISO 7730 comfort criteria; SET as a *reported index*; standard
envelope library (datacenter TC9.9, cleanroom, archive); user-drawn custom
envelopes.

> **Correction, Phase 3.** This section previously listed "SET and the
> elevated-air-speed cooling effect" as out of scope, and warned that the tool
> could not assess designs relying on air movement above 0.2 m/s. **That is not
> the case.** `jsthermalcomfort`'s ASHRAE variant of PMV applies the SET-based
> cooling effect of ASHRAE 55 Appendix H internally, so raising air speed widens
> the comfort zone toward warmer temperatures exactly as the standard intends.
> Ceiling fans, natural ventilation, and personal comfort systems are all
> assessable. What remains out of scope is *reporting SET itself* as a separate
> index — the underlying model is present either way.

### 2.1 What ports from bh-psych

The existing tool is ~1,600 lines and much of its thinking survives the rewrite
even though none of its Python does. Port the *design*, not the code:

| bh-psych | Destination | Note |
|---|---|---|
| `core/psychro.py` — `State`, unit-aware solve, saturation clamp | `web/src/psych/state.ts` | Direct structural port. Keep the clamp-and-warn behaviour. |
| `core/equipment.py` — `Equipment.apply(entering, upstream_m, pressure, units) → StageResult` | `web/src/processes/` | Maps almost one-to-one onto a TS interface. Keep `StageResult`'s duty split (`q_total` / `q_sensible` / `q_latent` / `moisture`) and the `_split_duty` technique of computing sensible heat at constant W. |
| `core/education.py` — `EDUCATION` dict | `web/src/education/content/` | **Highest-value asset in the repo.** Content converts to MDX; the *schema* (`title`, `kind`, `moves`, `text`, `check`) should be preserved exactly. |
| `tests/test_core.py` | `web/tests/` + `api/tests/` | Reference values port directly and become the Phase 0 gate. |
| `core/chart.py`, `core/export_chart.py` | superseded | Plotly and matplotlib both replaced by the SVG/Canvas renderer (§5.1). |
| `core/report.py` — ReportLab pipeline | `api/app/report.py` | Extend rather than rewrite; this is the main thing keeping a Python backend. |
| `app.py` — Dash UI | superseded | Replaced by the React front end. |

The `moves` field deserves particular emphasis: it encodes, per process, which properties
rise, fall, or hold constant. That is exactly the data an interactive tool needs
to animate a process line and to drive a "what changed?" readout — it was
underused as static text in Dash.

---

## 3. Architecture

### 3.1 The split

The front end owns everything interactive. The API owns everything that needs a
server-side library or produces a document.

**Front end — Vite + TypeScript + React, static bundle**
- `psychrolib` (npm, MIT) — all moist-air property calculations
- `jsthermalcomfort` (npm) — PMV/PPD and adaptive, evaluated live
- D3 scales + hand-authored SVG for the chart (see §5.1)
- EPW parsing and binning (8,760 rows parses in single-digit milliseconds in JS)
- Project JSON, URL state, CSV, PNG and SVG export

**API — FastAPI (Python 3.12), stateless, no database**
- `report.py` — branded multi-page PDF via ReportLab
- `chart_render.py` — server-side vector chart for print-quality PDF embedding
- `comfort_oracle.py` — `pythermalcomfort` endpoints used by the test suite as
  the reference implementation, not by the live UI

### 3.2 An honest note on the hybrid choice

The backend is **deliberately thin**. Once psychrolib.js and jsthermalcomfort
run in the browser, almost nothing *must* run on a server — EPW parsing,
comfort polygons, and the process solver are all fast enough client-side, and
keeping them there is what makes the chart feel instant when dragging a slider.

What genuinely earns a server: PDF generation (ReportLab has no good JS
equivalent at this quality), and `pythermalcomfort` as a validation oracle in CI.

Consequences to design for:

- **The app must work with the API down.** Everything except PDF export
  degrades gracefully. The front end is deployable as a pure static site.
- **No user data touches the server.** EPW files and project state stay in the
  browser. The PDF endpoint receives a project payload, renders, returns, and
  retains nothing. This keeps the "no accounts, no database" promise honest and
  sidesteps GDPR entirely.
- If after Phase 3 the API still only renders PDFs, consider collapsing to a
  pure static site plus a single serverless function. Revisit at that gate.

### 3.3 Repository layout

```
psychro-studio/
├── web/                          Vite + TypeScript front end
│   ├── src/
│   │   ├── psych/                unit-aware State engine over psychrolib
│   │   │   ├── units.ts          unit system definitions, labels, conversions
│   │   │   ├── state.ts          State object — solve from any valid pair
│   │   │   └── atmosphere.ts     altitude → pressure
│   │   ├── chart/
│   │   │   ├── scales.ts         Tdb/W → pixel, rectangular + oblique modes
│   │   │   ├── families.ts       saturation, RH, Twb, h, v, Tdp line generation
│   │   │   ├── protractor.ts     SHR scale
│   │   │   ├── render.tsx        SVG renderer
│   │   │   └── interact.ts       hover readout, click-to-place, drag points
│   │   ├── processes/
│   │   │   ├── models/           one module per process type
│   │   │   ├── chain.ts          ordered solver, mass-flow propagation
│   │   │   └── loads.ts          sensible/latent/total duty, SHR
│   │   ├── comfort/
│   │   │   ├── pmv.ts            jsthermalcomfort wrapper
│   │   │   ├── polygon.ts        comfort-zone boundary solver
│   │   │   └── adaptive.ts       adaptive model + running mean outdoor temp
│   │   ├── weather/
│   │   │   ├── epw.ts            EPW parser
│   │   │   ├── bins.ts           2D density grid
│   │   │   └── stats.ts          hours-in-zone against any polygon
│   │   ├── education/
│   │   │   ├── content/          MDX per process + per walkthrough
│   │   │   └── walkthrough.ts    step engine that drives app state
│   │   ├── io/                   project JSON, URL codec, CSV, raster/vector export
│   │   └── ui/
│   └── tests/
├── api/                          FastAPI
│   ├── app/{main,report,chart_render,comfort_oracle}.py
│   └── tests/
├── shared/schema/project.schema.json    single source of truth for the file format
├── docs/                         calculation reference, validation results, ADRs
└── .github/workflows/            CI: unit, validation, visual regression, deploy
```

---

## 4. Calculation specification

All property calls route through psychrolib. Nothing is re-derived by hand
unless psychrolib lacks it, and every such case is listed below.

### 4.1 State engine

A `State` is fully determined by dry-bulb temperature, humidity ratio, and
barometric pressure. Every other property derives from those three. Users may
enter any of these pairs, each resolved to (Tdb, W) before solving:

| Entered | Resolution |
|---|---|
| Tdb + RH | `GetHumRatioFromRelHum` |
| Tdb + Twb | `GetHumRatioFromTWetBulb` |
| Tdb + Tdp | `GetHumRatioFromTDewPoint` |
| Tdb + W | direct |
| Tdb + h | invert the enthalpy relation (§4.3) |
| Twb + RH | bisection on Tdb |
| h + W | invert for Tdb |

Then solve: RH, Twb, Tdp, h, v, ρ, and vapour pressure. **W is clamped to
`GetSatHumRatio(Tdb, P)`** and the clamp raises a user-visible warning — carry
this behaviour over from bh-psych, it is the single most common source of
confusing results.

Pressure comes from site altitude via `GetStandardAtmPressure`, or is entered
directly. It is shown in the UI and stamped on every export.

### 4.2 Units

IP is primary. Calculations run **natively** in the selected system rather than
converting at the boundary, matching bh-psych. Two traps to encode in tests:

- psychrolib SI enthalpy is **J/kg**, not kJ/kg. Display divides by 1000.
- Humidity ratio is stored as lb/lb or kg/kg but displayed as gr/lb or g/kg.
  Store canonical, format at the edge — never the reverse.

| Quantity | IP | SI |
|---|---|---|
| Temperature | °F | °C |
| Humidity ratio | gr/lb (stored lb/lb) | g/kg (stored kg/kg) |
| Enthalpy | Btu/lb | kJ/kg (psychrolib returns J/kg) |
| Specific volume | ft³/lb | m³/kg |
| Pressure | psia | Pa (display kPa) |
| Airflow | CFM | L/s |
| Mass flow | lb/h | kg/s |
| Duty | MBH | kW |

### 4.3 Chart line families

Plotted on rectangular Tdb (x) versus W (y) axes, with an optional oblique mode
that skews the enthalpy axis for a traditional ASHRAE chart appearance.

- **Saturation curve** — `W = GetSatHumRatio(T, P)` swept across the Tdb range.
- **Relative humidity** — `W = GetHumRatioFromRelHum(T, rh, P)` for rh at 10%
  intervals; user-configurable.
- **Constant wet bulb** — for each Twb, sweep Tdb from Twb upward,
  `W = GetHumRatioFromTWetBulb(Tdb, Twb, P)`. *(bh-psych never drew these —
  they are required here.)*
- **Constant enthalpy** — ~~hand-derived inverse~~ **not required.** PsychroLib
  2.5.0 provides `GetHumRatioFromEnthalpyAndTDryBulb(h, Tdb)`, which is exactly
  W as a function of Tdb along a fixed enthalpy. *(Corrected in Phase 0 — the
  original plan assumed this had to be derived by hand.)*
- **Constant specific volume** — invert `GetMoistAirVolume`. Algebraic inverse
  preferred; bisection fallback with a documented tolerance. **This is now the
  only hand-derived inverse in the calculation path**, and therefore the one
  place an arithmetic slip could silently distort the chart. Round-trip it
  against `GetMoistAirVolume` to 1e-9 across the domain.
- **Constant dew point** — horizontal lines. Tdp maps one-to-one to W at fixed
  pressure, so these are constant-W lines labelled in Tdp.
- **SHR protractor** — reference point 80 °F / 50% RH (IP) or 24 °C / 50% (SI);
  ray slope is Δh/ΔW for each sensible heat ratio from 0 to 1.

Line families recompute whenever pressure or unit system changes. Cache by
`(units, pressure, ranges)`.

### 4.4 Process models

Every process takes an entering state and parameters, and returns a leaving
state plus a duty breakdown. Mass flow at each stage is
`m = airflow ÷ specific volume of the entering state`; stages without an
airflow entry inherit upstream mass flow. **Sign convention: duty positive into
the airstream, so cooling reads negative.** Both rules carry over from bh-psych.

**Core set**
- *Mixing* — `W_mix = (m₁W₁ + m₂W₂)/(m₁+m₂)`, same for h; Tdb from (h, W).
  The mix point lies on the straight line between the two states, divided in
  inverse proportion to mass flow.
- *Sensible heating / cooling* — W constant, `q = m(h₂ − h₁)`.
- *Cooling with dehumidification* — see coil detail below.
- *Steam humidification* — energy balance `h₂ = h₁ + (W₂ − W₁)·h_steam`. Tdb
  rises slightly; the process is near-vertical, not vertical, and the tool
  should show that it is not.
- *Adiabatic / evaporative humidification* — constant wet bulb (constant
  enthalpy to a good approximation). Effectiveness `ε = (T₁ − T₂)/(T₁ − Twb₁)`.
- *Fan heat* — `Δh = P_fan / m`, all motor heat to the air when the motor sits
  in the airstream; a toggle for out-of-airstream motors.
- *Room / zone* — supply-to-room line with slope set by
  `SHR = q_sensible / q_total`.
- *Power-defined solving* — for coils, humidifier, and fan the user may specify
  duty instead of a leaving condition, and the solver finds the leaving state.

**Coil detail (apparatus dew point)**
- Apparatus dew point is the intersection of the extended process line with the
  saturation curve. Find it by Brent's method on the saturation curve, not by
  stepping.
- Bypass factor `BF = (T₂ − T_adp)/(T₁ − T_adp)`; contact factor `= 1 − BF`.
- Given duty and SHR, solve for ADP; given ADP and BF, solve for the leaving
  state. Support both directions.
- **Guard the degenerate case:** when the process line does not intersect
  saturation, no ADP exists. Detect it and explain it rather than returning a
  bad number — this is a teaching moment, and it is where naive implementations
  produce nonsense.

**Energy recovery**
- Sensible wheel / plate HX — `ε_sens = (T₁ − T₂)/(T₁ − T₃)`.
- Enthalpy wheel — separate sensible and latent effectiveness,
  `ε_lat = (W₁ − W₂)/(W₁ − W₃)`; optionally a single total effectiveness on h.
- Run-around coil — sensible only, effectiveness-based, both legs solved.
- Wrap-around coil — added as a linked pair; the reheat leg's ΔT mirrors the
  pre-cool leg so the passive circuit balances. Carry over from bh-psych.
- Enforce the energy balance across both airstreams and flag any violation.

**Advanced**
- *Direct evaporative (DEC)* — constant Twb, effectiveness on the wet-bulb
  depression.
- *Indirect evaporative (IEC)* — primary air cooled at constant W; effectiveness
  referenced to the secondary airstream wet bulb. Requires modelling the
  secondary stream, so the data model must allow a second airstream — decide
  this in Phase 0, because retrofitting a second stream into a single serial
  chain is expensive.
- *Desiccant dehumidification* — **the model must be chosen deliberately; this
  is the least standardised process in the set.** Three options, in increasing
  fidelity:
  1. Isenthalpic approximation — adsorption follows a constant-enthalpy line.
     Simple, roughly right, and defensible for teaching.
  2. Effectiveness model on W with a specified regeneration temperature.
  3. Characteristic potentials (F1/F2, Banks/Jurinak) — the standard analytical
     treatment for rotary desiccant wheels, and what a real design study needs.

  **Recommendation:** ship (1) in Phase 4 clearly labelled as an idealisation,
  and plan (3) as a follow-on. Do not silently present (1) as a design result.
- *DOAS* — a configuration of the above, not a new process: dedicated outdoor
  air path with its own chain, terminal units on the room side.

### 4.5 Loads

For each process: sensible, latent, and total duty, plus SHR. For the system:
total cooling, total heating, total humidification, reheat penalty. Latent
calculations use `h_fg` at the relevant condition rather than a fixed constant
where accuracy matters; bh-psych's fixed constants (1054 Btu/lb room latent,
1150 Btu/lb saturated steam) are fine as defaults but should be exposed.

---

## 5. Chart rendering

### 5.1 Why hand-authored SVG rather than Plotly

A psychrometric chart is not a plot of data — it is a coordinate system with
curved gridlines, a clipped domain bounded by the saturation curve, rotated
labels that must follow their curves, and filled overlay polygons. Plotly and
Chart.js both fight every one of those. D3 supplies the scales and path
generation; the rest is SVG authored directly. This also makes vector export
trivial: serialise the live DOM.

Canvas layer underneath for the 8,760-point EPW scatter and density heatmap —
SVG at that node count is too slow to pan smoothly. Hybrid: Canvas for data,
SVG for chart furniture and overlays.

### 5.2 Interaction

- Hover anywhere: live readout of all properties at the cursor.
- Click to place a state point; drag to move it, with the process chain
  re-solving live.
- Zoom and pan, with line families re-tessellating at the new scale.
- Toggle each line family independently.
- Point labels with collision avoidance.

---

## 6. Comfort module

### 6.1 Inputs

Air temperature, mean radiant temperature (or globe temperature with air speed
and diameter, converted), relative humidity, air speed, metabolic rate,
clothing insulation, and barometric pressure inherited from the chart.

### 6.2 PMV / PPD

Via `jsthermalcomfort`, ASHRAE 55-2023 formulation. Report PMV, PPD, and the
resulting compliance verdict. Applicability limits are enforced and shown, not
hidden: met 1.0–2.0, clo 0–1.5, air speed ≤ 0.2 m/s for the still-air method.
Outside those ranges the tool says so rather than extrapolating.

### 6.3 Comfort-zone polygon — the algorithm

For fixed clo, met, air speed, and MRT (default MRT = Tdb):

1. Sweep relative humidity from 0% to 100% in steps (2% is smooth enough).
2. At each RH, solve for the dry-bulb temperature where **PMV = −0.5** (cool
   boundary) and where **PMV = +0.5** (warm boundary), by bisection or Brent.
   PMV is monotonic in temperature over the relevant range, so bisection is
   safe and fast.
3. Convert each (Tdb, RH) boundary point to (Tdb, W) for plotting.
4. Clip the top of the polygon at **W = 0.012 kg_water/kg_dry_air**, the
   ASHRAE 55-2023 upper humidity limit. **55-2023 specifies no lower humidity
   limit** — do not draw one.
5. Close the polygon and fill.

Draw two zones by default — winter (1.0 clo) and summer (0.5 clo) — with live
recomputation as sliders move. When MRT ≠ Tdb, plot against **operative
temperature** on the x-axis and label the axis accordingly, as the CBE tool does.

Performance: roughly 100 boundary solves per zone, each a handful of PMV
evaluations. Well under one frame. No server round-trip, which is precisely why
this belongs client-side.

### 6.4 Designing for SET later

Deferred, but the seam matters. The elevated-air-speed cooling effect shifts the
whole comfort zone left by a computed ΔT. Build the polygon generator to accept
a **temperature offset parameter** now, defaulted to zero. Adding SET later then
means computing the offset, not rewriting the boundary solver.

### 6.5 Adaptive model

- Comfort temperature: `t_comf = 0.31 · t_pma_out + 17.8` (°C).
- 80% acceptability band `± 3.5 K`; 90% band `± 2.5 K`.
- Valid for prevailing mean outdoor temperature 10–33.5 °C, naturally
  conditioned spaces with occupant-controlled openings, met 1.0–1.3, and
  occupants free to adapt clothing. **The tool must enforce and display these
  limits** — the adaptive model is the most frequently misapplied part of
  Standard 55.
- Prevailing mean outdoor temperature comes from the EPW import as an
  exponentially weighted running mean of daily mean outdoor temperature.
- Rendered as its own chart — indoor operative temperature versus prevailing
  mean outdoor temperature — not as a psychrometric overlay, since humidity and
  personal factors do not enter the model.

---

## 7. Education module

Guided walkthroughs plus worked examples. Two layers:

**Layer 1 — contextual.** Hovering any line family or property shows what it is
and why it matters. Adding a process opens a panel describing what physically
happens, which properties change and which hold constant, and typical design
values. This is bh-psych's `education.py` content, made interactive.

Preserve its content schema exactly — it is already the right shape:

| Field | Role | Interactive upgrade |
|---|---|---|
| `title` | Process name | — |
| `kind` | Thermodynamic classification ("Adiabatic mixing", "Isothermal humidification") | Groups processes in the picker |
| `moves` | Per-property direction: up, down, constant, or "set by RSHR" | **Drives the animation and the "what changed?" readout.** Was static text in Dash; here it becomes behaviour. |
| `text` | What physically happens | Panel body |
| `check` | The sanity check a senior engineer would make | **Surface as a live check.** "Off-coil air typically leaves at 90–95% RH" can be evaluated against the solved state and flagged when violated — turning static advice into an actual review of the user's design. |

Promoting `check` from prose to an evaluated rule is the single highest-leverage
change available in the port, and it is what separates this from a chart that
merely draws what it is told.

**Layer 2 — guided walkthroughs.** Scripted, multi-step scenarios that drive
application state as the user advances. Each step can set inputs, highlight
chart regions, pose a question, and reveal an explanation. Candidate set:

1. Reading the chart — find every property of one state point.
2. Sizing a cooling coil — from room load to supply condition to coil duty,
   introducing SHR and the protractor.
3. Apparatus dew point and bypass factor — why a real coil never reaches ADP.
4. Why reheat costs energy — visible as the area between two process lines.
5. Mixing outdoor and return air — where the mix point lands and why.
6. What an enthalpy wheel actually saves — sensible against latent recovery.
7. Evaporative cooling and the wet-bulb limit — why climate decides.
8. Reading the comfort zone — what clo and met really do to it.

Content lives in MDX so writing a walkthrough does not require touching
application code. Budget realistically: **the content authoring is a larger
effort than the walkthrough engine.** Ship the engine plus two walkthroughs,
then add content steadily.

---

## 8. Weather data

- **EPW parsing** in the browser. Extract dry-bulb, dew point, RH, pressure,
  wind speed, and solar for all 8,760 hours. Validate the header and report
  station name, location, and elevation; offer to adopt the file's elevation as
  the chart pressure.
- **Scatter** of all 8,760 points on the Canvas layer, filterable by month,
  hour-of-day, and occupied-period schedule.
- **Bin density heatmap** — 2D grid over (Tdb, W), hours per cell, sequential
  colour scale with a legend in hours.
- **Hours-in-zone statistics** — count and percentage of hours falling inside
  the comfort polygon or any drawn region, broken down by the active filters.
  This is what turns the chart from a drawing into a screening tool.
- Do not bundle EPW files. Users supply their own; link to the DOE/Climate.OneBuilding
  sources.

---

## 9. Persistence and export

| Output | Where | Notes |
|---|---|---|
| Project JSON | Client | Full system definition, chart settings, comfort inputs, metadata. Versioned against `shared/schema/project.schema.json`. Migration path from day one. |
| Shareable URL | Client | Compressed state in the fragment. Falls back to "too large — download the project file" above the URL length limit, which EPW data will exceed. |
| CSV | Client | All solved state points and process loads. |
| PNG | Client | Canvas + SVG composited. |
| SVG / vector PDF | Client | Serialise the live SVG; embed fonts. |
| Branded PDF report | API | ReportLab. Chart, state-point table, process summary, loads, project metadata, calculation basis, and version stamp. |

Every export carries the app version, calculation basis, barometric pressure,
and unit system. bh-psych got this right and it is worth preserving — a report
that cannot be traced to the release that produced it is a liability.

---

## 10. Validation

Accuracy is the product. Testing is not an afterthought here.

1. **Property validation** — psychrolib.js against ASHRAE Fundamentals Ch. 1
   Tables 1–3, in both unit systems. **Tolerances are non-uniform and must be:**
   PsychroLib omits the water-vapour enhancement factor, so saturated humidity
   ratio diverges from Table 2 by up to 2% and saturated enthalpy by up to 3%,
   while saturation vapour pressure matches Table 3 to 0.03%. Documented in
   `docs/calculation-reference.md` §3. *(Established in Phase 0.)*
2. **Cross-implementation** — psychrolib.js against psychrolib Python, and
   jsthermalcomfort against pythermalcomfort, over a generated grid. This is
   what `comfort_oracle.py` exists for. Any divergence beyond tolerance fails CI.
3. **Comfort validation** — PMV against ASHRAE 55 Normative Appendix B tables
   and ISO 7730 Annex D.
4. **Inverse-function round trips** — every hand-derived inverse round-trips
   through psychrolib to 1e-9. Note that **no assertion anywhere may be tighter
   than PsychroLib's own convergence tolerance** (±0.001 °C on wet bulb,
   ≈4e-7 kg/kg on any humidity ratio derived through one). See §14.
5. **Process solver** — hand calculations for each process type, and energy
   balance closure across every chain. Port bh-psych's `tests/test_core.py`.
6. **Visual regression** — snapshot the rendered chart; catch silent geometry
   breakage.
7. **Degenerate cases** — supersaturation clamping, no-ADP coils, zero mass
   flow, sub-freezing states, high altitude.

---

## 11. Phased delivery

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Repo, project schema, CI, unit system, State engine | ✅ **Complete** — 101 tests passing; see §14 |
| 1 | Chart engine — all line families, both unit systems, altitude, zoom/pan/hover | ✅ **Complete** — matches ASHRAE Chart No. 1 at 80/67; see §15 |
| 2 | State points and core process chain, loads, drag interaction | ✅ **Complete** — balance closes on four chains; see §16 |
| 3 | Comfort module — PMV/PPD, polygon, adaptive chart | ✅ **Complete** — zone boundaries match published ASHRAE 55; see §17 |
| 4 | Coil detail, energy recovery, advanced processes | No-ADP and balance guards proven |
| 5 | EPW import, scatter, density bins, hours-in-zone | 8,760 points pan at 60 fps |
| 6 | Education — walkthrough engine + first two walkthroughs | A new engineer completes one unaided |
| 7 | Export and IO — JSON, URL, CSV, PNG, SVG, PDF API | Round-trip save/load fidelity |
| 8 | Deploy, docs, calculation reference, polish | Public URL live |

Phases 1–3 are the core product. Phase 3's gate — *matching the CBE tool for
identical inputs* — is the single most valuable test in the plan, and it is
worth reaching early.

---

## 12. Licensing and attribution

- `psychrolib` — MIT. Attribution required; note the ASHRAE Fundamentals basis.
- `jsthermalcomfort` / `pythermalcomfort` — confirm licence terms before
  bundling.
- CBE `comfort_tool` — reference for behaviour and appearance only. **Do not
  copy code without checking its licence.**
- PsychPlotter — architectural reference. Same caution.
- ASHRAE standards are copyrighted. Implement the equations; do not reproduce
  tables or text.

---

## 13. Resolved decisions

*Closed 2026-08-22.*

1. **Branding — resolved to Pease Studio (2026-08-22).** All branded surfaces
   (PDF report header/footer, app chrome, export stamps) read from a single
   branding config, `web/src/config/branding.ts`. The identity is **Pease
   Studio**, strapline *Tools for building performance*; the stacked-bar mark is
   `web/src/ui/BrandMark.tsx` and the app icon is `web/public/icon.svg`, both
   reproduced as SVG from the supplied artwork.

   One naming call was made: the project is "Psychrometric Studio", which under
   this identity reads "Pease Studio Psychrometric Studio". The *displayed* app
   name is therefore **Psychrometrics**; the project name in the docs is
   unchanged. It is one string in the branding config if you want it different.

   The open question about publishing an engineering calculator publicly under a
   firm's name — professional indemnity, disclaimer language — still stands, and
   is now more pointed rather than less. The disclaimer (decision 4) is in place.
2. **Desiccant — isenthalpic idealisation.** Adsorption follows a constant-
   enthalpy line. Ships in Phase 4 **explicitly labelled as an idealisation** in
   the UI and on every export; the Banks/Jurinak F1/F2 characteristic-potential
   model remains the documented follow-on for design-grade work.
3. **Second airstream — first class in the data model.** An `Airstream` is a
   named chain of stages; a `Project` holds one or more. Stages may reference a
   secondary stream by id (mixing box, energy recovery, IEC). Decided in Phase 0
   precisely so it never needs retrofitting.
4. **Disclaimer — required.** Explicit "review and independently verify all
   results" language is shown in the app and stamped on every export (PDF, PNG,
   SVG, CSV). Single source of truth in the branding config alongside the
   version and calculation basis.


---

## 14. Phase 0 outcome

*Completed 2026-08-22. 101 tests passing, type check clean.*

Delivered: repository and CI, the project JSON Schema with multi-airstream
support, the unit system, the atmosphere module, and the moist-air state engine
with all seven input pairs and saturation clamping.

Four findings changed the plan rather than merely implementing it:

1. **The npm `psychrolib` package is a third-party republish.** Published from
   `nicfv/psychrolib-npm`, with a package version (`1.1.1`) that tracks the
   wrapper repo rather than the library (2.5.0). The shipped file is
   byte-identical to upstream — verified by diff — so this is a traceability
   problem, not a trust one. Resolved by vendoring from upstream with a pinned
   SHA-256 that CI verifies on every build. See ADR 0001.

2. **PsychroLib carries global mutable unit state.** It exports a singleton whose
   `SetUnitSystem` flips a module global; bh-psych wrapped every call in a
   threading lock for exactly this reason. Resolved by constructing two
   instances from the singleton's own constructor, each pinned to one system,
   and never calling `SetUnitSystem` again. This also makes side-by-side IP/SI
   evaluation possible, which the unit toggle and dual-unit CSV export need.
   See ADR 0002.

3. **The enthalpy inverse already exists upstream.** §4.3 assumed
   `W = f(h, Tdb)` had to be hand-derived; PsychroLib 2.5.0 provides
   `GetHumRatioFromEnthalpyAndTDryBulb`. Constant specific volume is now the
   only hand-derived inverse in the calculation path.

4. **The application has a precision floor, and it is not machine epsilon.**
   PsychroLib's wet-bulb and dew-point routines are iterative, stopping at
   ±0.001 °C (±0.0018 °F). Any humidity ratio obtained through a wet bulb
   carries ≈4e-7 kg/kg; any dry bulb recovered from a wet-bulb pair carries
   ≈4e-4 degrees. Negligible for engineering, but binding on every test and
   solver downstream — exported as `CONVERGENCE_TOLERANCE` and documented in
   `docs/calculation-reference.md` §4.

5. **Node tests and the browser disagreed about the vendored UMD module, silently.**
   Vitest's transform performed CommonJS interop and produced a default export;
   Vite's browser ESM pipeline served the raw file and found no export at all.
   **101 tests passed against an application that could not boot.** Resolved by
   consuming the vendored file through a local `vendor/` package with
   `optimizeDeps.include` and `build.commonjsOptions.include` — Vite pre-bundles
   neither symlinked dependencies nor CommonJS outside `node_modules` by default.
   The vendored file remains byte-identical.

   The wider lesson for later phases: **a green test suite is not evidence the
   browser works.** Every phase gate that touches module loading, rendering, or
   the DOM needs a browser check, not only `npm test`.

Findings 1, 3, and 4 all point the same direction: the divergence between this
tool and a printed ASHRAE chart is real, bounded, and now written down. An
engineer who spots a 0.5% difference near the saturation curve has a document to
read rather than a bug to file.

### Carried into Phase 1

- Derive and round-trip the constant specific-volume inverse (§4.3).
- Chart line families must respect the precision floor when tessellating.
- The desiccant idealisation label (decision 2) needs a UI treatment designed
  alongside the process panel, not bolted on at Phase 4.


---

## 15. Phase 1 outcome

*Completed 2026-08-22. 202 tests passing, type check clean, production build green.*

Delivered: the chart coordinate system, all six line families with exact
clipping to the saturation curve, the SHR protractor, an SVG renderer, and
hover/zoom/pan interaction — in both unit systems, at any site pressure.

### The gate

Cursor positioned by **(Tdb, W) only** — 80 °F, 0.0112 lb/lb — with every other
property computed independently:

| Property | Computed | ASHRAE Chart No. 1 |
|---|---|---|
| Wet bulb | 67.0 °F | 67 °F |
| Dew point | 60.4 °F | ~60.3 °F |
| Relative humidity | 51.2 % | ~51 % |
| Enthalpy | 31.48 Btu/lb | ~31.4 Btu/lb |
| Specific volume | 13.850 ft³/lb | 13.85 ft³/lb |

80 °F DB / 67 °F WB is the standard AHRI coil-rating condition; all five derived
properties agree. The same air was then read in SI and cross-checked property by
property.

### Findings

1. **The specific-volume inverse needed no new physics.** `GetMoistAirVolume` is
   exactly linear in W about the dry-air volume, and `GetDryAirVolume` is already
   in PsychroLib — so the inverse is `W = (v / v_dry − 1) / 1.607858`, a
   rearrangement rather than a re-derivation. The molar-mass constant is
   *measured back out of the library* in the test suite rather than trusted, so
   it cannot drift from the vendored source. Round-trips to better than 1e-9
   across both systems and three altitudes.

2. **Enthalpy does not convert between unit systems, and users will report this
   as a bug.** IP enthalpy is referenced to 0 °F, SI to 0 °C, so the scales are
   offset as well as scaled: the same air reads 31.48 Btu/lb and 55.39 kJ/kg,
   where a naive conversion predicts 73.2. The 17.8 kJ/kg gap is exactly the
   datum shift. Only enthalpy *differences* are system-independent — which is
   all any duty calculation uses, so no result is affected. Pinned in tests and
   documented in `docs/calculation-reference.md` §5.

3. **A stale hover state across a unit switch produced confidently wrong
   readings.** Toggling IP→SI left the previously solved state in place, so IP
   values rendered through SI formatters: "0.03 kJ/kg", "13.85 m³/kg". Fixed by
   discarding the hover state whenever units or pressure change — the cursor has
   not moved, so there is no correct value to show — plus a guard that refuses to
   format a state through another system's formatters.

4. **Batched wheel events collapsed the zoom.** Eight wheel events arriving in
   one task all read the same domain from a ref, so the zoom advanced by one
   step instead of eight. Fixed by making `onDomainChange` take an updater and
   resolving the focus point against whichever domain is current when the update
   runs.

5. **The oblique projection is deferred, not approximated.** Printed ASHRAE
   charts use oblique coordinates where the enthalpy axis is skewed and dry-bulb
   lines are not quite vertical. That changes *which lines are straight*, so it
   is a real projection rather than a shear. Rectangular Tdb–W is what
   PsychPlotter, the CBE tool, and essentially all software use. The
   `ChartProjection` type has one member today so the decision surfaces in review
   rather than being quietly forgotten.

### Carried into Phase 2

- Label collision avoidance is currently a fixed per-family offset, tuned so
  wet-bulb and enthalpy labels clear each other on the saturation curve. Process
  points and their labels will need real collision handling.
- `shrForSlope` already exists and is tested; Phase 2's room load line should use
  it rather than re-deriving the relation.
- The protractor is drawn at a fixed size in the upper-left. Once process lines
  exist, it should become draggable so it can be aligned against one.


---

## 16. Phase 2 outcome

*Completed 2026-08-22. 249 tests passing, type check clean, verified in browser.*

Delivered: the eight core process models, the chain solver with mass-flow
propagation and cross-stream couplings, duty accounting, the equipment-chain
editor, the process overlay on the chart, a results panel, and drag interaction.

### The gate

**Energy balance closes on four independent chains** — cool-and-reheat, mixed
air with humidification, evaporative cooling, and a full mixed-air chain — in
both unit systems, to a relative residual below 1e-9. Mixing makes this a real
test rather than a tautology: mass flow changes mid-chain, so the second stream
has to be counted as energy in at its own mass flow or the sum does not close.

Every process is also checked against a hand calculation, with the arithmetic
worked in the test comments.

### Findings

1. **A clamped coil silently delivered more than it was asked for.** Requesting
   120 MBH at SHR 0.7 on 95 °F / 40% air drives the leaving state past the
   saturation curve. The state clamps correctly — but the *duty* then no longer
   matches the request, and the coil quietly delivered 131 MBH. The stage now
   compares delivered against requested and says so, naming the SHR as the
   thing to change. Three of the first test failures were this, not arithmetic.

2. **Only entering-air points are draggable, and that is psychrometrics rather
   than a limitation.** A source is an input — two free variables the user
   chose. Every downstream point is an *output*. Dragging one would force the
   tool to silently pick which parameter to invert (the coil's leaving
   temperature? its capacity? its SHR?), and any choice would put words in the
   engineer's mouth. Downstream states are edited through their parameters,
   where the intent is explicit. Recorded in `ProcessOverlay`.

3. **Adiabatic humidification cannot be drawn as a straight line.** It follows
   the constant wet-bulb line, which is curved; a straight chord cuts below it
   and implies the air was drier on the way than it was. The overlay traces the
   actual wet-bulb path. Cooling is drawn straight, which is conventional — the
   true bend toward the apparatus dew point is the Phase 4 construction.

4. **Two duty conventions had to be pinned down.** Sensible duty is defined
   through *enthalpy at the entering humidity ratio*, not `m·cp·ΔT`: it keeps
   the split consistent with the total to machine precision and works unchanged
   in Btu/lb and J/kg. And moisture rate is reported per hour in both systems,
   even though SI mass flow is per second, because a humidifier rate quoted per
   second is useless to a designer. Both carried over from bh-psych.

5. **Reheating to a temperature below the off-coil condition is a second
   cooling stage wearing a heating coil's name.** It surfaced as a test failure
   where the "cooling total" exceeded the coil capacity. The solver is right to
   report it as negative duty; the lesson is that stage *names* carry no
   physical meaning and the totals must follow the sign, which they do.

### Carried into Phase 3

- The chain solver orders airstreams topologically and reports cycles rather
  than looping. Wrap-around coils (Phase 4) genuinely close a loop and will need
  simultaneous solution — the error message already says so.
- `splitDuty` / `applyDuty` are exact inverses and tested as such; the coil ADP
  construction should build on them rather than introduce a third path.
- The comfort polygon needs the same "recompute everything on every edit"
  treatment the chain got: it is cheap enough, and it removes a whole class of
  stale-state bug.


---

## 17. Phase 3 outcome

*Completed 2026-08-22. 283 tests passing, type check clean, verified in browser.*

Delivered: PMV/PPD per ASHRAE 55, the comfort-zone polygon on the psychrometric
chart, the adaptive model with its own chart, applicability limits surfaced
throughout, and comfort controls in the panel.

### The gate

Zone boundaries at 50% RH, 1.1 met, still air, MRT = air temperature:

| Zone | Computed | Published ASHRAE 55 |
|---|---|---|
| Winter, 1.0 clo | 20.3–24.5 °C (68.6–76.0 °F) | ≈ 20–24 °C (68–75 °F) |
| Summer, 0.5 clo | 23.9–26.9 °C (75.0–80.4 °F) | ≈ 23–26 °C (74–79 °F) |

The library's own documented reference case reproduces exactly (PMV 0.08,
PPD 5.1 at 25 °C / 50% / 1.2 met / 0.5 clo), and the drawn polygon is separately
checked against the raw boundary solver so the two cannot drift apart.

### Findings

1. **The elevated-air-speed cooling effect was already available, and Phase 1's
   note about it was wrong.** The ASHRAE variant of PMV applies Appendix H's
   SET-based cooling effect internally: at 27 °C, raising air speed from 0.1 to
   0.8 m/s moves PMV from +0.53 to −0.53, and the drawn zone widens toward
   warmer temperatures. §2 has been corrected rather than left standing.

2. **`round_output` defaults to true and would have broken the polygon
   silently.** It quantises PMV to two decimal places, which turns the boundary
   bisection into a staircase that cannot converge on ±0.5. The zone would have
   come out lumpy rather than absent — a failure that looks like a rendering
   artefact rather than a numerical one.

3. **`JSON.stringify(NaN)` prints `null`, and that nearly shipped a bug.** The
   adaptive model signals an out-of-range outdoor temperature with **NaN**, but
   inspecting its output as JSON shows `null`. A `value === null` guard —
   which is what that observation invites — never fires, and "NaN °F" reaches
   the interface. Only a finiteness check holds. Caught by a test that asserted
   `toBeNull()`.

4. **jsthermalcomfort 1.4.0 ships a declaration file that does not parse.**
   `pet_steady.d.ts` contains `(: [number, number, number]) => …`, a parameter
   with no name. `skipLibCheck` suppresses semantic errors in declaration files
   but not syntax errors, so the build failed on a function this application
   never calls. Resolved with local typings mapped through `paths`, which also
   replaces the package's `any`-typed signatures with real ones — worth having,
   since `pmv_ppd_ashrae(tdb: any, …)` offers no protection against passing
   relative humidity as a fraction where a percentage is required.

5. **The comfort zone is drawn against dry bulb, not operative temperature.**
   The CBE tool switches its x-axis to operative temperature when the radiant
   temperature differs from the air temperature. This chart cannot: relative
   humidity, wet bulb, enthalpy, and specific volume are all defined against
   dry bulb, and re-labelling the axis would silently invalidate every one of
   them. The radiant offset is carried as a parameter instead.

### Carried into Phase 4

- `comfortZone` returns an empty polygon with a stated reason rather than
  throwing. The coil ADP construction should do the same for the no-intersection
  case, which is the equivalent degenerate condition.
- The adaptive chart needs real weather to be useful. Phase 5's EPW import
  should feed `runningMeanOutdoor`, which is written and tested but currently
  has no data source.
- Comfort inputs are not yet in the project schema's `comfort` block, so they do
  not survive save/load. Wire that up in Phase 7.
