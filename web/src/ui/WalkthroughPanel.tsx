/**
 * The walkthrough runner.
 *
 * Presentational by design: it renders a step and reports which step should be
 * current. Applying a step's system to the application is the App's job, for
 * the same reason the chart does not own the project — one place decides what
 * the state is, and everything else asks it to change.
 *
 * The questions are not a quiz. Every option carries a response, including the
 * right one, and a wrong answer explains the misconception rather than saying
 * "no". Two of the three distractors here are answers a competent engineer
 * gives — "add more airflow" is wrong in a way worth understanding, and that is
 * why it is offered.
 */
import { useState } from 'react';
import { Icon } from '../icons/Icon.js';
import { WALKTHROUGH, topicLabel } from '../education/index.js';
import { useEducation } from './Tooltip.js';

export interface WalkthroughPanelProps {
  step: number;
  onStep: (step: number) => void;
  onExit: () => void;
}

export function WalkthroughPanel({ step, onStep, onExit }: WalkthroughPanelProps): React.JSX.Element {
  const education = useEducation();
  const [chosen, setChosen] = useState<number | null>(null);

  const total = WALKTHROUGH.steps.length;
  const index = Math.min(Math.max(step, 0), total - 1);
  const current = WALKTHROUGH.steps[index]!;

  const go = (next: number): void => {
    setChosen(null);
    onStep(Math.min(Math.max(next, 0), total - 1));
  };

  return (
    <section className="walkthrough">
      <header className="wt-head">
        <Icon name={WALKTHROUGH.icon} size={32} />
        <div>
          <h2>{WALKTHROUGH.title}</h2>
          <p className="wt-progress">
            Step {index + 1} of {total} · {current.title}
          </p>
        </div>
        <button type="button" className="wt-exit" onClick={onExit} aria-label="Leave the walkthrough">
          ✕
        </button>
      </header>

      <div className="wt-bar" aria-hidden="true">
        <span style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      {current.body.map((paragraph) => (
        <p key={paragraph.slice(0, 40)} className="wt-body">
          {paragraph}
        </p>
      ))}

      {current.question && (
        <div className="wt-question">
          <p className="wt-prompt">{current.question.prompt}</p>
          <ul className="wt-options">
            {current.question.options.map((option, optionIndex) => {
              const isChosen = chosen === optionIndex;
              return (
                <li key={option.label}>
                  <button
                    type="button"
                    className={`wt-option${isChosen ? (option.correct ? ' correct' : ' incorrect') : ''}`}
                    onClick={() => setChosen(optionIndex)}
                    aria-pressed={isChosen}
                  >
                    {option.label}
                  </button>
                  {isChosen && <p className="wt-response">{option.response}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {current.concepts && current.concepts.length > 0 && (
        <p className="wt-concepts">
          {current.concepts.map((id) => {
            const label = topicLabel(id);
            if (!label) return null;
            return (
              <button key={id} type="button" className="term" onClick={() => education.openTopic(id)}>
                {label.title}
              </button>
            );
          })}
        </p>
      )}

      <div className="wt-nav">
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0}>
          Back
        </button>
        {index < total - 1 ? (
          <button type="button" className="primary" onClick={() => go(index + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="primary" onClick={onExit}>
            Finish
          </button>
        )}
      </div>
    </section>
  );
}
