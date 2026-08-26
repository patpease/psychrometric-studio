/**
 * The education panel: what the selected component is, and what to check.
 *
 * It sits below the system chain in the left column, and its header follows the
 * selection — icon, name, and thermodynamic classification of whatever is
 * selected. With nothing selected it becomes a reference to the chart itself,
 * because an empty panel beside a full chart is a wasted third of the screen.
 *
 * ## Declared against observed
 *
 * The `moves` list is content: what this process *should* do to each property.
 * Beside it, where the stage has solved, is what it actually did. Two columns,
 * one from the writing and one from the solver, and a disagreement between them
 * is visible without anyone having to go looking for it. This is what the plan
 * meant by promoting `moves` from documentation into behaviour.
 */
import { useState } from 'react';
import { Icon } from '../icons/Icon.js';
import {
  CONCEPT_GROUPS,
  observedMoves,
  topicFor,
  topicLabel,
  type EducationEntry,
  type ConceptEntry,
  type Move,
  type MoveProperty,
  type ObservedMove,
} from '../education/index.js';
import type { MoistAirState } from '../psych/state.js';
import type { StageResult } from '../processes/types.js';
import type { UnitSystem } from '../psych/units.js';
import { useEducation } from './Tooltip.js';
import { formatTemperature, formatHumidityRatio, formatEnthalpy, formatRelativeHumidity } from './format.js';

const PROPERTY_LABELS: Record<MoveProperty, string> = {
  tdb: 'Dry bulb',
  w: 'Humidity ratio',
  h: 'Enthalpy',
  rh: 'Relative humidity',
  twb: 'Wet bulb',
  tdp: 'Dew point',
  v: 'Specific volume',
  slope: 'Line slope',
};

/** Each property links to its own concept entry, where one exists. */
const PROPERTY_TOPICS: Partial<Record<MoveProperty, string>> = {
  tdb: 'dry-bulb',
  w: 'humidity-ratio',
  h: 'enthalpy',
  rh: 'relative-humidity',
  twb: 'wet-bulb',
  tdp: 'dew-point',
  v: 'specific-volume',
  slope: 'shr',
};

const DIRECTION_GLYPH: Record<string, string> = {
  up: '↑',
  down: '↓',
  constant: '—',
  input: '·',
  conditional: '↓?',
  'set-by-load': '∠',
  between: '↔',
};

const DIRECTION_WORD: Record<string, string> = {
  up: 'rises',
  down: 'falls',
  constant: 'holds constant',
  input: 'is an input',
  conditional: 'may fall',
  'set-by-load': 'is set by the load',
  between: 'moves toward the other stream',
};

function formatProperty(property: MoveProperty, value: number, units: UnitSystem): string {
  switch (property) {
    case 'w':
      return formatHumidityRatio(value, units, true);
    case 'h':
      return formatEnthalpy(value, units, true);
    case 'rh':
      return formatRelativeHumidity(value, true);
    case 'v':
      return value.toFixed(2);
    default:
      return formatTemperature(value, units, true);
  }
}

function MovesTable({
  moves,
  observed,
  units,
}: {
  moves: readonly Move[];
  observed: readonly ObservedMove[];
  units: UnitSystem;
}): React.JSX.Element {
  const education = useEducation();
  const byProperty = new Map(observed.map((move) => [move.property, move]));

  return (
    <table className="moves">
      <thead>
        <tr>
          <th scope="col">Property</th>
          <th scope="col">Should</th>
          <th scope="col">Did</th>
        </tr>
      </thead>
      <tbody>
        {moves.map((move) => {
          const actual = byProperty.get(move.property);
          const topic = PROPERTY_TOPICS[move.property];
          // "Constant" declared and "constant" observed agree; anything else
          // that disagrees is worth marking, not hiding.
          const disagrees =
            actual !== undefined &&
            (move.direction === 'up' || move.direction === 'down' || move.direction === 'constant') &&
            actual.direction !== move.direction;

          return (
            <tr key={move.property} className={disagrees ? 'moves-disagree' : undefined}>
              <th scope="row">
                {topic ? (
                  <button type="button" className="term" onClick={() => education.openTopic(topic)}>
                    {PROPERTY_LABELS[move.property]}
                  </button>
                ) : (
                  PROPERTY_LABELS[move.property]
                )}
              </th>
              <td>
                <span className="move-glyph" aria-hidden="true">
                  {DIRECTION_GLYPH[move.direction] ?? '·'}
                </span>
                <span className="visually-hidden">{DIRECTION_WORD[move.direction]}</span>
                {move.qualifier && <em className="move-qualifier">{move.qualifier}</em>}
              </td>
              <td>
                {actual ? (
                  <span className={`move-actual move-${actual.direction}`}>
                    {actual.direction === 'constant'
                      ? 'no change'
                      : formatProperty(move.property, actual.to, units)}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SeeAlso({ ids }: { ids: readonly string[] }): React.JSX.Element | null {
  const education = useEducation();
  const links = ids.map((id) => ({ id, label: topicLabel(id) })).filter((link) => link.label);
  if (links.length === 0) return null;

  return (
    <div className="see-also">
      <h4>See also</h4>
      <ul>
        {links.map(({ id, label }) => (
          <li key={id}>
            <button type="button" className="term" onClick={() => education.openTopic(id)}>
              {label!.title}
            </button>
            <span className="see-also-kind">{label!.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EquipmentBody({
  entry,
  result,
  entering,
  advisory,
  units,
}: {
  entry: EducationEntry;
  result: StageResult | undefined;
  entering: MoistAirState | null;
  advisory: string | null;
  units: UnitSystem;
}): React.JSX.Element {
  const observed = result ? observedMoves(entering, result.state, units) : [];

  return (
    <>
      <p className="edu-text">{entry.text}</p>

      {/* A stage with nothing to say about movement says nothing — see the
          `source` entry, which is a declared state rather than a process. */}
      {entry.moves.length > 0 && (
        <>
          <h4>What moves</h4>
          <MovesTable moves={entry.moves} observed={observed} units={units} />
        </>
      )}

      <h4>What to check</h4>
      <p className="edu-check">{entry.check}</p>
      {advisory && (
        <p className="edu-advisory">
          <strong>On this stage:</strong> {advisory}
        </p>
      )}

      {entry.typical && entry.typical.length > 0 && (
        <>
          <h4>Typical values</h4>
          <dl className="readout edu-typical">
            {entry.typical.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {entry.seeAlso && <SeeAlso ids={entry.seeAlso} />}
    </>
  );
}

function ConceptBody({ entry }: { entry: ConceptEntry }): React.JSX.Element {
  return (
    <>
      <p className="edu-summary">{entry.summary}</p>
      {entry.text && <p className="edu-text">{entry.text}</p>}
      {entry.practice && (
        <>
          <h4>In practice</h4>
          <p className="edu-check">{entry.practice}</p>
        </>
      )}
      {entry.seeAlso && <SeeAlso ids={entry.seeAlso} />}
    </>
  );
}

/** The reference index, shown when nothing is selected. */
function ConceptIndex(): React.JSX.Element {
  const education = useEducation();

  return (
    <>
      <p className="edu-text">
        Select a component above to read what it does and what to check about it.
        In the meantime, here is the chart’s own vocabulary — and every underlined
        term anywhere in the tool opens its entry here.
      </p>
      {CONCEPT_GROUPS.map((group) => (
        <div key={group.label} className="concept-group">
          <h4>{group.label}</h4>
          <ul className="concept-list">
            {group.ids.map((id) => {
              const label = topicLabel(id);
              if (!label) return null;
              return (
                <li key={id}>
                  <button type="button" className="term" onClick={() => education.openTopic(id)}>
                    {label.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export interface EducationPanelProps {
  /** The topic on show: a stage type, a concept id, or null for the index. */
  topicId: string | null;
  /** Set when the topic is a selected stage, so the entry can be evaluated. */
  result?: StageResult | undefined;
  entering?: MoistAirState | null;
  advisory?: string | null;
  units: UnitSystem;
  /** Shown when the panel is displaying a topic the user navigated to. */
  onBack?: (() => void) | undefined;
}

export function EducationPanel({
  topicId,
  result,
  entering = null,
  advisory = null,
  units,
  onBack,
}: EducationPanelProps): React.JSX.Element {
  const topic = topicId ? topicFor(topicId) : null;

  const title = topic ? topic.entry.title : 'Reading the chart';
  const kind =
    topic?.sort === 'equipment' ? topic.entry.kind : topic?.sort === 'concept' ? 'Concept' : 'Reference';
  const icon =
    topic?.sort === 'equipment'
      ? topic.entry.icon
      : topic?.sort === 'concept'
        ? (topic.entry.icon ?? 'state-point')
        : 'state-point';

  return (
    <section className="education-panel">
      {/* The header *is* the icon: it changes with the selection, which is what
          makes the panel feel attached to the chain rather than beside it. */}
      <header className="edu-head">
        <Icon name={icon} size={40} className="edu-icon" />
        <div>
          <h2>{title}</h2>
          <p className="edu-kind">{kind}</p>
        </div>
      </header>

      {onBack && (
        <button type="button" className="edu-back" onClick={onBack}>
          ← Back to the selected component
        </button>
      )}

      {!topic && <ConceptIndex />}
      {topic?.sort === 'equipment' && (
        <EquipmentBody
          entry={topic.entry}
          result={result}
          entering={entering}
          advisory={advisory}
          units={units}
        />
      )}
      {topic?.sort === 'concept' && <ConceptBody entry={topic.entry} />}
    </section>
  );
}
