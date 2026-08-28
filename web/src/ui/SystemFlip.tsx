/**
 * The folded corner that turns the chart over.
 *
 * A project holds more than one operating case on the same air handler, and the
 * metaphor for moving between them is a sheet of paper: the corner is lifted,
 * and behind it is the other page. The control says which case it will take you
 * to rather than which one you are on, because a corner is an invitation to go
 * somewhere — a label naming the current page would read as a title and never
 * be pressed.
 *
 * It is a real `<button>` with a real accessible name. The fold is decoration
 * drawn behind the label; everything a screen reader or a keyboard reaches is
 * ordinary. The visual page-turn is a separate concern layered on top of this
 * and is free to be absent.
 */
import { systemLabel } from '../types/project.js';
import type { SessionSystem } from '../io/project.js';

export interface SystemFlipProps {
  systems: readonly SessionSystem[];
  activeSystem: number;
  onFlip: (index: number) => void;
}

export function SystemFlip({
  systems,
  activeSystem,
  onFlip,
}: SystemFlipProps): React.JSX.Element | null {
  // With one case there is nothing behind the page, and a corner that turns to
  // the same drawing is a lie about what the tool holds.
  if (systems.length < 2) return null;

  const next = (activeSystem + 1) % systems.length;
  const here = systemLabel(systems[activeSystem]!, activeSystem);
  const there = systemLabel(systems[next]!, next);

  return (
    <button
      type="button"
      className="system-flip"
      onClick={() => onFlip(next)}
      aria-label={`Showing ${here}. Turn the page to ${there}.`}
      title={`Turn to ${there}`}
    >
      <span className="system-flip-fold" aria-hidden="true" />
      <span className="system-flip-label">{there}</span>
    </button>
  );
}
