# Design system

This is a description of what the tool already uses, not an aspiration. Every
value below is live in `web/src/ui/styles.css`, `web/src/config/branding.ts`, or
the icon set — and where the two ever disagree, the code is right and this file
is stale.

It exists so that anything drawn *about* the tool — a diagram, a canvas mockup,
a slide — comes out looking like the tool rather than near it.

## Two palettes, one mechanism

Colours are CSS custom properties, and the palette is declared in **three**
places:

| Block | Serves |
|---|---|
| `:root, [data-theme='light']` | The light palette, and anything forced light |
| `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }` | A viewer whose system asks for dark |
| `[data-theme='dark']` | A viewer who *pressed* the moon on a light system |

Nothing in the renderer knows which is active; it emits `var(--family-rh)` and
the cascade resolves it. The two dark blocks are byte-identical by necessity —
plain CSS cannot share one declaration block between a media query and a bare
selector — and `web/tests/theme.test.ts` asserts they stay token-for-token
equal. **Add a colour to all three or exports and forced themes fall back to an
initial value**, which for `fill` is opaque black.

The `[data-theme="light"]` half of the first selector is not decoration: chart
export mounts a hidden clone inside a light container so a report never carries
the viewer's theme (ADR 0004). Custom properties inherit from the nearest
ancestor that defines them, so that clone wins even when `<html>` carries an
explicit `data-theme="dark"` — verified, because it is exactly the kind of
interaction that looks fine and is not.

### Surface and ink

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#f6f7f9` | `#10151b` | Page behind the panels |
| `--surface` | `#ffffff` | `#171e26` | Panels, cards, tooltips |
| `--border` | `#d9dee5` | `#2a3543` | Every hairline |
| `--ink` | `#14202b` | `#e6ecf3` | Body text |
| `--ink-muted` | `#5d6b7a` | `#93a1b1` | Labels, captions, secondary |
| `--accent` | `#0F5F52` | `#3FC98A` | Identity green; primary actions |
| `--accent-bright` | `#3FC98A` | `#6FE0AC` | Rules, highlights |

The accent **inverts** between themes: the identity green is too dark to read on
a dark surface, so the bright green from the mark's bottom rule takes the accent
role. Do not hard-code `#0F5F52` anywhere.

### Chart line families — categorical, not a ramp

Five families overlap on one chart, so the hues are chosen to stay
distinguishable from each other. A sequential scale would make neighbouring
families read as related, which they are not.

| Family | Light | Dark |
|---|---|---|
| Saturation (100% RH) | `#16324f` | `#cfe0f0` |
| Relative humidity | `#2f7fd1` | `#6cb0ee` |
| Wet bulb | `#0f8a7a` | `#45c7b3` |
| Enthalpy | `#c2610a` | `#f0a355` |
| Specific volume | `#7a4bbd` | `#b18bea` |
| Dew point | `#8a94a1` | `#8d99a8` |

Weight and dash carry as much meaning as hue: saturation is 2.25 px solid
because it is a boundary, not a gridline; wet bulb is `4 3` dashed; enthalpy is
`6 3`; specific volume is `2 3`. A diagram reusing these colours should reuse
the dash patterns too.

### Status

| Token | Meaning | Light |
|---|---|---|
| `--process` / `--process-selected` | The solved chain; the selected stage | `#1F7A6B` / `#C2610A` |
| `--note` | **Advice**, not a fault | `#2F6FA8` |
| `--warn` | The engine adjusted something | `#B4690E` |
| `--danger` | It did not solve | `#B3261E` |
| `--ok-ink` | Inside limits | `#1F6E4E` |

The separation of `--note` from `--warn` is deliberate and worth preserving. A
design check is an opinion about the engineering; a warning is the calculation
reporting that it had to clamp something. Sharing one colour trains the reader
to dismiss both.

## Icons

Sixty-two SVGs in `web/src/icons/svg/`, compiled to a TypeScript module at build
time by `scripts/build-icons.mjs`. Seventeen are mapped to stage types in
`icons/map.ts`; `sun` and `moon` drive the appearance toggle; the remaining
forty-three — chillers, boilers, VAV boxes, terminal units, diffusers — are
drawn and unused, and are a ready-made vocabulary for system diagrams.

Icons are not only for equipment. `sun` and `moon` sit in the header beside the
unit switch and inherit the button's colour through `currentColor`, which is why
the active state needs no rule of its own.

**Rules a new icon must follow**, because the generator or the tests will
otherwise reject it:

- `0 0 48 48` viewBox, `width`/`height` 48. Enforced by the generator.
- Outline stroke `#0B2B28`. **Replaced with `currentColor` at build time**, which
  is what lets one icon serve both themes. Never author `currentColor` directly.
- Accent strokes from exactly three colours, and they carry meaning:
  - `#2F9BD6` blue — water, moisture, cooling, the supply side
  - `#3ECF8E` green — air movement, the primary path
  - `#E2842F` orange — heat, exhaust, the return side
- Stroke width 3 for primary geometry, 2.4–2.8 for detail. Round caps and joins.
- No fills except small solid dots. Everything reads as a line drawing.

The six `process-*` icons are a different thing: a chart axis with a direction
arrow, for the concept entries rather than for equipment.

## Type and spacing

System font stack throughout; nothing is loaded over the network, which is what
lets the content security policy stay tight. Exports name a stack rather than
the resolved family, so a file opened elsewhere degrades in a controlled order.

Panels run small: `0.75rem` body, `0.7rem` labels, `0.62–0.68rem` for uppercase
section headers with `0.05em` letter-spacing. Chart labels are `9–11px`
absolute, because they must hold their size against zoom. Radii are 4px for
controls, 6px for cards. Panel gutters are `0.55–0.6rem`.

## Using this with Claude Design

`/design` produces a multi-artboard canvas as an Artifact. It starts from
whatever you give it, so give it this file — a canvas seeded with the real
tokens produces diagrams that drop into the app, and one seeded with a
description produces something that looks approximately right and matches
nothing.

A practical order:

1. Point it at this file and the icon set, and ask for the diagram type you
   want as artboards — a system schematic, a load breakdown, a process sequence.
2. Iterate on the canvas until the visual language is settled.
3. Implement in the app as inline SVG, reading `var(--…)` rather than literals,
   so the result themes and exports like everything else.

Step 3 is the one that gets skipped. A diagram with baked-in hex values looks
correct until someone switches to dark mode or exports a report.
