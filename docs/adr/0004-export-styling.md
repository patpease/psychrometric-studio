# ADR 0004 — Exports inline computed styles, resolved against a light palette

*2026-08-24. Accepted.*

## Context

The chart renderer emits SVG that depends on the page: `stroke="var(--family-rh)"`
as a presentation attribute, and class rules like `.gridlines line` and
`.comfort-zone-0 path` in `styles.css`. Both are resolved by the stylesheet.

Neither survives leaving the document. An SVG file opened on its own, or loaded
into an `<img>` to be rasterised for PNG or PDF, has no stylesheet and no custom
properties. The chart renders entirely in black — which looks enough like a
deliberate monochrome export that it can ship unnoticed.

Two further constraints:

- The palette follows `prefers-color-scheme`, so an export made during a
  dark-mode session would arrive in a report as pale lines on a black field.
- The chart is a hybrid: SVG furniture over a canvas carrying up to 8,760
  weather points. Whatever is exported has to composite both.

## Decision

**Clone the live SVG, mount the clone offscreen inside a `data-theme="light"`
container, and write every element's computed style back onto itself.**

Three consequences, each load-bearing:

1. **Computed styles are read from the clone, not the original.** That is the
   entire theme mechanism. Custom properties cascade, so redefining them on one
   container gives that subtree the light palette while the visible interface is
   untouched. `styles.css` gains one selector — `:root, [data-theme='light']` —
   and a `:not([data-theme='light'])` guard on the dark media query.

2. **The whole tree is read before any of it is written.** Half the stylesheet
   is descendant rules. Stripping a parent's class as each element is processed
   stops those rules matching for everything below it, and the children fall
   back to the initial value: opaque black.

3. **Presentation attributes are removed once inlined.** Inline style outranks
   them, so leaving `stroke="var(--family-rh)"` in place changes nothing about
   rendering — but it leaves an unresolvable `var()` in a file that claims to be
   standalone.

The weather layer is **re-drawn** into an offscreen canvas with the light ramp
and embedded as a data URI, rather than reusing the pixels on screen. Those
pixels carry the viewer's theme, and re-drawing costs one pass over a typed
array — cheaper than the compositing that reusing them would need anyway.

Fonts are **not** embedded. A chart carries a few dozen numeric labels, and
subsetting a font to carry them would add hundreds of kilobytes to every export.
The file names a system stack instead. Where exact typography matters, the PDF
path rasterises at 2× and the API sets its own type.

## Alternatives considered

**A second, export-only rendering path.** Rejected: two renderers disagree
eventually, and the one nobody looks at is the one that drifts. The renderer was
written as hand-authored SVG in Phase 1 specifically so that export could be a
DOM serialisation.

**Forcing the visible page to light while exporting.** Simpler, and it flashes
the whole interface for the duration. Also racy — an export that fails partway
leaves the user in the wrong theme.

**Shipping the stylesheet inside the SVG as a `<style>` element.** Works for a
file opened in a browser; does not work for `<img>` rasterisation in every
engine, and does nothing about `prefers-color-scheme` still applying.

## Consequences

- An export is ~165 KB of SVG for a chart with five line families. Every element
  carries a full style string. Acceptable; the PNG is larger anyway.
- Adding a styled property to the chart means adding it to `CARRIED` in
  `io/image.ts`, or it silently will not export. This is the one maintenance
  cost of the approach and there is no test that catches it automatically —
  compare an export against the screen when adding chart styling.
- The `[data-theme]` selectors were introduced for export. They turned out to be
  exactly what the appearance toggle needed, and it now uses them: `light` and
  `dark` are set on the document element, and removing the attribute hands the
  decision back to the media query.

  That toggle and this export path interact, and the interaction is the sort
  that looks fine while being wrong. With `data-theme="dark"` on `<html>` and
  the export clone inside a `data-theme="light"` container, the clone wins —
  custom properties inherit from the nearest ancestor that defines them, not by
  specificity. Verified in the browser rather than reasoned about, because
  getting it backwards would produce a valid dark-palette report from a user who
  never chose one.
