/**
 * Tooltips, and the terms that carry them.
 *
 * A tooltip here is never new text. It is the `summary` line from the concept
 * registry, which is the same sentence the education panel opens with — so the
 * definition a user meets in passing and the one they get when they stop to
 * read cannot contradict each other.
 *
 * ## Why not the `title` attribute
 *
 * `title` is invisible to touch, appears after an unhelpfully long delay, and
 * cannot be styled or read by most screen readers in a useful way. These render
 * a real popup on hover *and* keyboard focus, wired with `aria-describedby` so
 * the definition is announced rather than merely drawn.
 *
 * ## Why the popup is positioned in JavaScript
 *
 * The obvious implementation — `position: absolute` inside a relatively
 * positioned wrapper — is clipped. Both side panels scroll, so they establish
 * an overflow context, and a 16rem popup inside a 21.5rem panel loses its right
 * two hundred pixels to it. This was not a hypothetical: it shipped that way
 * for an hour and was caught by measuring `getBoundingClientRect` against the
 * panel, not by looking at it.
 *
 * `position: fixed` escapes the clip, at the cost of having to place the popup
 * by hand — and having to flip it above the term when it would fall off the
 * bottom of the window.
 *
 * A term is also a control: clicking it opens the full entry in the education
 * panel. That is the whole navigation model — every term in the interface is a
 * door into the reference.
 */
import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import { tooltipFor } from '../education/index.js';

/** Lets any term, anywhere in the tree, open its entry in the panel. */
export const EducationContext = createContext<{ openTopic: (id: string) => void } | null>(null);

export function useEducation(): { openTopic: (id: string) => void } {
  return useContext(EducationContext) ?? { openTopic: () => undefined };
}

/** Kept in step with `.tooltip`'s `max-width`, and with the gap below the term. */
const MAX_WIDTH = 256;
const GAP = 6;
const EDGE = 8;

export interface TipProps {
  /** Text to show. Overrides the concept registry when given. */
  text?: string;
  /** Concept id — the tooltip is that concept's one-line summary. */
  topic?: string;
  children: React.ReactNode;
  className?: string;
}

interface Position {
  top: number;
  left: number;
}

/**
 * A term with a definition attached.
 *
 * Renders as a button because it does something when activated. Making it a
 * span with a hover handler would leave it unreachable by keyboard, which for
 * an educational feature is close to defeating the point.
 */
export function Term({ text, topic, children, className }: TipProps): React.JSX.Element {
  const tipId = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const education = useEducation();

  const body = text ?? (topic ? tooltipFor(topic) : undefined);

  const open = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setPosition({
      top: anchor.bottom + GAP,
      // Clamped to the window, not to the panel: a tooltip overhanging the
      // chart is normal and readable, whereas one cut off at the panel edge is
      // neither.
      left: Math.min(Math.max(EDGE, anchor.left), window.innerWidth - MAX_WIDTH - EDGE),
    });
  }, []);

  const close = useCallback(() => setPosition(null), []);

  /**
   * Flip above the term when the popup would fall off the bottom.
   *
   * Height is not knowable until the text has wrapped, so this measures after
   * layout and corrects. The correction is guarded on actually being needed, or
   * it would loop.
   */
  useLayoutEffect(() => {
    if (!position || !tipRef.current || !anchorRef.current) return;
    const tip = tipRef.current.getBoundingClientRect();
    if (tip.bottom <= window.innerHeight - EDGE) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const flipped = anchor.top - tip.height - GAP;
    if (flipped < EDGE || flipped === position.top) return;
    setPosition({ ...position, top: flipped });
  }, [position]);

  // A term with no definition behind it should not pretend to be interactive.
  if (!body) return <span className={className}>{children}</span>;

  return (
    <span className="term-wrap">
      <button
        ref={anchorRef}
        type="button"
        className={`term${className ? ` ${className}` : ''}`}
        aria-describedby={position ? tipId : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={() => topic && education.openTopic(topic)}
      >
        {children}
      </button>
      {position && (
        <span
          ref={tipRef}
          className="tooltip"
          id={tipId}
          role="tooltip"
          style={{ top: `${position.top}px`, left: `${position.left}px` }}
        >
          {body}
          {topic && <span className="tooltip-more">Click to read more</span>}
        </span>
      )}
    </span>
  );
}

/**
 * A standalone "?" affordance, for places where the label itself must stay
 * plain — a form field's own text, most often, where underlining a word inside
 * it would compete with the input beside it.
 */
export function InfoTip({ text, topic }: { text?: string; topic?: string }): React.JSX.Element {
  return (
    <Term
      {...(text !== undefined ? { text } : {})}
      {...(topic !== undefined ? { topic } : {})}
      className="infotip"
    >
      <span aria-hidden="true">?</span>
      <span className="visually-hidden">What is this?</span>
    </Term>
  );
}
