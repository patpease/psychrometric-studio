/**
 * The Pease Studio mark — four stacked bars stepping down to a bright rule.
 *
 * Drawn as inline SVG rather than loaded as an image so it inherits crisp
 * rendering at any size and can be recoloured per theme if that is ever wanted.
 * The wordmark itself is real HTML text next to it, not paths: that keeps it
 * selectable, accessible to screen readers, and free of embedded font data.
 */
export function BrandMark({ size = 30 }: { size?: number }): React.JSX.Element {
  // Bars are 132 × 124 in their own units; height follows from the aspect.
  const height = size;
  const width = (size * 132) / 124;

  return (
    <svg
      className="brand-mark"
      width={width}
      height={height}
      viewBox="0 0 132 124"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="132" height="26" rx="6" fill="#0F5F52" />
      <rect x="0" y="38" width="96" height="26" rx="6" fill="#4E8C82" />
      <rect x="0" y="76" width="68" height="26" rx="6" fill="#8AA8A2" />
      <rect x="0" y="112" width="132" height="12" rx="6" fill="#3FC98A" />
    </svg>
  );
}
