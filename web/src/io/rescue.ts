/**
 * The last known-good project, kept where a crash can still reach it.
 *
 * An error boundary has to sit *above* the tree it protects, so it cannot read
 * that tree's state through props or context — by the time it renders, the
 * component holding the session has been unmounted. A module-scoped holder is
 * the narrow exception where a global is the right answer rather than a lazy
 * one.
 *
 * It is written from an effect, not during render. That timing is deliberate:
 * an effect only runs after a render commits, so what is stored is always a
 * session that successfully drew at least once. A crash on the *next* render
 * therefore hands back the last state that was known to work, rather than the
 * one that just failed.
 *
 * The writer must **not** clear this on unmount. React unmounts the tree when
 * the boundary catches, so an effect cleanup that nulls the holder wipes the
 * rescue at precisely the moment it is wanted. This is not hypothetical — it is
 * how the first version behaved, and the button silently did nothing.
 */
type Rescue = () => string;

let current: Rescue | null = null;

export function setRescue(rescue: Rescue | null): void {
  current = rescue;
}

/** The last good project as text, or `null` if there is nothing to offer. */
export function rescueProject(): string | null {
  if (!current) return null;
  try {
    return current();
  } catch {
    // A rescue that throws is worse than no rescue: it turns a recoverable
    // crash screen into a second crash.
    return null;
  }
}
