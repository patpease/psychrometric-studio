import { useEffect, useState } from 'react';

/**
 * The width below which the tool is a tab bar and one screen at a time.
 *
 * The same number as the `@media (max-width: 860px)` rules in styles.css and
 * the table in docs/design-system.md — the three must agree, and a custom
 * property cannot carry it into a media query, so it is written three times.
 * 860 is where the side-by-side layout already gave up and stacked.
 */
export const COMPACT_LAYOUT = '(max-width: 860px)';

/** A finger rather than a mouse. Width says nothing about which one it is. */
export const COARSE_POINTER = '(pointer: coarse)';

/**
 * Whether a media query matches, kept current.
 *
 * False where there is no `matchMedia` at all — the node test environment and
 * the server — which is the desk layout, the one the rest of the app assumes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}
