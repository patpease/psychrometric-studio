# Backlog

v1.0 shipped 2026-08-24. This is what is known to be open, and it is a living
file — `PLAN.md` is the historical record and should not grow further.

## Carried from v1.0

Each of these was a deliberate deferral, not an oversight.

- **Only the supply airstream is editable.** Multi-airstream files are valid,
  and their other streams survive a round trip untouched, but the editor shows
  the first one. Recovery stages currently take the other stream's condition as
  typed fields, which works and is not how anyone thinks about it.
- **One walkthrough.** *Sizing a cooling coil*, eight steps. Further ones are
  content in `education/walkthrough.ts`, not engine work — the runner takes any
  number.
- **Oblique chart projection.** The schema has `projection: 'rectangular' |
  'oblique'` and only the first is implemented. Real ASHRAE charts are oblique.
- **The PDF report service is not deployed.** Code complete and tested; three
  settings to stand up, in `docs/deploying.md`. The easy one to miss is widening
  `connect-src` in `web/public/_headers`.
- **No `og:url` or canonical tag** until a custom domain is settled.

## v1.1 — review and adjust

The current intent. Nothing here is specified yet; these are the areas.

### Text

Every user-facing string worth a second reading now that the tool has been used
rather than only built. Content lives in three places:

- `education/equipment.ts` and `concepts.ts` — the panel and every tooltip. A
  concept's `summary` is *both* its tooltip and its opening line, deliberately,
  so there is one definition of each term.
- `education/checks.ts` — the design-check messages. These are the ones to be
  most careful with: each is worded as a question rather than a verdict, and the
  tests enforce that none fires on the default system in either unit system.
- `ui/stageFields.ts` — field labels and help text.

### Graph

Candidates, roughly in order of how much they would change the tool:

- Oblique projection (above).
- Labelling that survives zoom — line labels currently sit at fixed positions on
  their curves and can collide when panned.
- The SHR protractor as a draggable construction rather than a corner scale.
- Process-line annotation: duty and SHR on the line itself, for export.

### Validation

There is a distinction worth keeping sharp here, and the codebase already makes
it:

- **Engine warnings** (`StageResult.warnings`) — the calculation had to adjust
  something. Amber.
- **Design checks** (`education/checks.ts`) — an opinion about the engineering.
  Blue, and worded as a question.

Anything added should land in one of those two, not a third category. Open
ground: cross-stage checks (the chain as a whole rather than one stage), a
project-level review pass, and checking the room load line against the actual
supply point rather than only the room's own RH.

### Diagrams

The new work. See `docs/design-system.md` for the tokens and the icon rules, and
the note there about implementing with `var(--…)` rather than literals — a
diagram with baked-in hex values looks correct until someone switches to dark
mode or exports a report.

Forty-three of the sixty icons are drawn and unused. They are a system-diagram
vocabulary that already exists.

## Standing constraints

Not backlog items — things any change has to keep true.

- The tool works with no network after first load. No fonts, no analytics, no
  third-party requests. This is what makes the CSP tight enough to be worth
  having and "nothing is uploaded" true rather than aspirational.
- Every export carries the app version, calculation basis, site pressure, and
  unit system.
- The disclaimer appears on every output. The tool models idealised processes
  and at least one ships as an explicit idealisation.
