/**
 * Asking for feedback, without handing the address to a crawler.
 *
 * The primary action opens the reader's own mail client, pre-addressed and
 * pre-subjected. Nothing about the address exists in the markup until they
 * press it — see `config/contact.ts` for what that buys and what it does not.
 *
 * The second action is not decoration. `mailto:` is a dead end for anyone
 * reading in a browser with no mail client registered, and they are the people
 * most likely to give up rather than hunt for another way. Copying the address
 * gives them one, and revealing it gives it to the person whose clipboard is
 * blocked as well.
 */
import { useState } from 'react';
import { APP_VERSION } from '../config/branding.js';
import { feedbackAddress, feedbackMailto } from '../config/contact.js';
import type { UnitSystem } from '../psych/units.js';

export interface FeedbackPanelProps {
  units: UnitSystem;
}

export function FeedbackPanel({ units }: FeedbackPanelProps): React.JSX.Element {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reveal = async (): Promise<void> => {
    const address = feedbackAddress();
    setRevealed(address);
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // A blocked or absent clipboard is not a failure worth reporting: the
      // address is on screen now, which is what was actually wanted.
      setCopied(false);
    }
  };

  return (
    <section className="feedback">
      <h3>Feedback</h3>
      <p className="comfort-note">
        Found a number you cannot reconcile, a process that behaves oddly, or
        something missing? Please say so — it is a small tool and every report is
        read.
      </p>

      <button
        type="button"
        className="reset"
        onClick={() => {
          window.location.href = feedbackMailto(APP_VERSION, units);
        }}
      >
        Write to Pease Studio
      </button>

      {revealed === null ? (
        <button type="button" className="feedback-alt" onClick={reveal}>
          or copy the address
        </button>
      ) : (
        <p className="comfort-note feedback-address">
          <code>{revealed}</code>
          {copied && <span className="feedback-copied"> — copied</span>}
        </p>
      )}
    </section>
  );
}
