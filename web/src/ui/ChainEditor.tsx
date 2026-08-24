/**
 * The equipment chain editor.
 *
 * A stage is a card; stages are ordered and the air flows down the list. Every
 * parameter renders as an optional field, because most stages can be defined
 * more than one way and the solver already explains, by name, what a given
 * stage still needs. Forcing a mode choice up front would make the common case
 * — paste in what you have — harder than it should be.
 */
import type { Stage, StageType } from '../types/project.js';
import type { SolvedStage } from '../processes/chain.js';
import { STAGE_GROUPS, displayNameFor } from '../processes/registry.js';
import type { UnitSystem } from '../psych/units.js';
import {
  STAGE_FIELDS,
  formatDerived,
  fromFieldValue,
  toFieldValue,
  unitLabelFor,
  type ParamField,
} from './stageFields.js';
import type { StageResult } from '../processes/types.js';
import { LABELS } from '../psych/units.js';
import { Icon } from '../icons/Icon.js';
import { iconForStage } from '../icons/map.js';
import { InfoTip } from './Tooltip.js';

/**
 * Which concept a parameter field explains.
 *
 * Resolved from the field's **key and kind**, not from its label. Label text is
 * written for humans and gets reworded; a match on "Sensible effectiveness"
 * would break the first time someone shortens it to "Sensible". Key and kind
 * are structural, so this mapping only changes when the field itself does.
 *
 * Note `sensible` and `latent`, which mean two different things depending on
 * the stage: fractions on a recovery device, loads on a room. The kind
 * distinguishes them, which is why it is part of the test.
 */
function topicForField(field: ParamField): string | undefined {
  const { key, kind, unit } = field;

  if (key.startsWith('twb')) return 'wet-bulb';
  if (key.startsWith('tdp')) return 'dew-point';
  if (key.startsWith('tdb')) return 'dry-bulb';
  if (key.startsWith('rh') && kind === 'percent') return 'relative-humidity';
  if (key.startsWith('airflow')) return 'specific-volume';
  if (key === 'shr') return 'shr';
  if (key === 'moistureRate') return 'humidity-ratio';
  if (key === 'deltaT') return 'sensible-heat';
  if (key === 'effectiveness' || key === 'secondaryEffectiveness') return 'effectiveness';
  if (key === 'sensible') return kind === 'percent' ? 'effectiveness' : 'sensible-heat';
  if (key === 'latent') return kind === 'percent' ? 'effectiveness' : 'latent-heat';

  return unit === 'enthalpy' ? 'enthalpy' : undefined;
}

export interface ChainEditorProps {
  /** Id of the airstream being edited, for within-stream couplings. */
  airstreamId: string;
  stages: readonly Stage[];
  solved: readonly SolvedStage[];
  units: UnitSystem;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onChange: (stages: Stage[]) => void;
  /**
   * The live design check for each stage, by index, or `null` where it passes.
   *
   * Computed by the App rather than here, because the rule needs the *entering*
   * state and mass flow — which belong to the stage before this one, and are
   * the chain's business, not the editor's.
   */
  advisories?: readonly (string | null)[];
}

function newStage(type: StageType, index: number): Stage {
  const base: Stage = { id: `${type}-${Date.now().toString(36)}-${index}`, type, params: {} };

  // Sensible starting values, so a newly added stage solves rather than
  // immediately erroring. They are visible and editable, not hidden defaults.
  switch (type) {
    case 'source':
      return { ...base, airflow: 2000, params: { tdb: 95, rh: 0.4 } };
    case 'mixing':
      return { ...base, params: { airflow2: 1000, tdb2: 75, rh2: 0.5 } };
    case 'cooling':
      return { ...base, params: { tdbOut: 55, rhOut: 0.92 } };
    case 'heating':
      return { ...base, params: { tdbOut: 75 } };
    case 'humidifier-steam':
      return { ...base, params: { rhOut: 0.4 } };
    case 'humidifier-adiabatic':
      return { ...base, params: { effectiveness: 0.85 } };
    case 'fan':
      // Shaft power: HP in IP, kW in SI. A typical 2000 CFM fan is 1-2 HP.
      return { ...base, params: { power: 1.5, motorInAirstream: true } };
    case 'room':
      return { ...base, params: { sensible: 40, latent: 10 } };
    case 'recovery-wheel-sensible':
    case 'recovery-plate':
      return { ...base, params: { sensible: 0.7, tdb3: 75, rh3: 0.5, airflow3: 2000 } };
    case 'recovery-wheel-enthalpy':
      return {
        ...base,
        params: { sensible: 0.75, latent: 0.65, tdb3: 75, rh3: 0.5, airflow3: 2000 },
      };
    case 'recovery-runaround':
      return { ...base, params: { sensible: 0.55, tdb3: 75, rh3: 0.5, airflow3: 2000 } };
    case 'recovery-wraparound-precool':
      return { ...base, params: { deltaT: 8 } };
    case 'recovery-wraparound-reheat':
      // Pairs with the nearest pre-cool leg above it; the editor wires the
      // coupling when the stage is added.
      return { ...base, params: {} };
    case 'evaporative-direct':
      return { ...base, params: { effectiveness: 0.85 } };
    case 'evaporative-indirect':
      return { ...base, params: { effectiveness: 0.7, secondaryEffectiveness: 0.85 } };
    case 'desiccant':
      return { ...base, params: { removal: 0.5 } };
    default:
      return base;
  }
}

function Field({
  field,
  stage,
  units,
  result,
  onChange,
}: {
  field: ParamField;
  stage: Stage;
  units: UnitSystem;
  result?: StageResult | undefined;
  onChange: (key: string, value: number | boolean | undefined) => void;
}): React.JSX.Element {
  const raw = (stage.params ?? {})[field.key];
  const unit = unitLabelFor(field, units);
  const id = `${stage.id}-${field.key}`;

  /**
   * When the user defined the stage the other way — a capacity instead of a
   * leaving temperature, say — show what this field works out to.
   *
   * It appears as a placeholder rather than a value, so the field still reads
   * as unset. Filling it in would make the tool look like it had made a choice
   * on the engineer's behalf.
   */
  const isSet = typeof raw === 'number' && Number.isFinite(raw);
  const derived = !isSet && result && field.derive ? field.derive(result) : undefined;
  const hasDerived = typeof derived === 'number' && Number.isFinite(derived);

  if (field.kind === 'boolean') {
    return (
      <div className="param param-boolean">
        <label htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={raw !== false}
            onChange={(event) => onChange(field.key, event.target.checked)}
          />
          {field.label}
        </label>
        {field.help && <p className="param-help">{field.help}</p>}
      </div>
    );
  }

  const topic = topicForField(field);

  return (
    <div className={`param${hasDerived ? ' param-derived' : ''}`}>
      {/* The tooltip trigger sits *outside* the label. A `<button>` inside a
          `<label for=…>` is invalid — the spec allows only the labelled
          control as an interactive descendant — and screen readers announce
          the button's text as part of the field's name. */}
      <span className="param-label">
        <label htmlFor={id}>
          {field.label}
          {unit && <span className="param-unit">{unit}</span>}
        </label>
        {topic && <InfoTip topic={topic} />}
      </span>
      <input
        id={id}
        type="number"
        step={field.step ?? 1}
        placeholder={hasDerived ? formatDerived(derived, field) : (field.placeholder ?? '—')}
        value={toFieldValue(raw, field)}
        onChange={(event) => onChange(field.key, fromFieldValue(event.target.value, field))}
      />
      {hasDerived && <p className="param-derived-note">calculated</p>}
      {field.help && <p className="param-help">{field.help}</p>}
    </div>
  );
}

export function ChainEditor({
  airstreamId,
  stages,
  solved,
  units,
  selected,
  onSelect,
  onChange,
  advisories = [],
}: ChainEditorProps): React.JSX.Element {
  const update = (index: number, next: Stage): void => {
    const copy = [...stages];
    copy[index] = next;
    onChange(copy);
  };

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    const copy = [...stages];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved!);
    onChange(copy);
    onSelect(target);
  };

  const remove = (index: number): void => {
    onChange(stages.filter((_, i) => i !== index));
    onSelect(null);
  };

  const add = (type: StageType): void => {
    const created = newStage(type, stages.length);

    // A reheat leg is meaningless without the pre-cool leg it mirrors, so wire
    // the pairing to the most recent unpaired pre-cool leg above it. Leaving
    // the user to discover the coupling would mean adding a stage that always
    // errors on arrival.
    if (type === 'recovery-wraparound-reheat') {
      const alreadyPaired = new Set(
        stages.flatMap((stage) =>
          (stage.couplings ?? [])
            .filter((coupling) => coupling.role === 'paired-leg')
            .map((coupling) => coupling.stageId),
        ),
      );
      const partner = [...stages]
        .reverse()
        .find(
          (stage) =>
            stage.type === 'recovery-wraparound-precool' && !alreadyPaired.has(stage.id),
        );
      if (partner) {
        created.couplings = [
          { role: 'paired-leg', airstreamId: airstreamId, stageId: partner.id },
        ];
      }
    }

    onChange([...stages, created]);
    onSelect(stages.length);
  };

  return (
    <div className="chain-editor">
      <h2>System</h2>

      <ol className="chain">
        {stages.map((stage, index) => {
          const meta = STAGE_FIELDS[stage.type];
          const result = solved[index];
          const isSelected = selected === index;
          const isFirst = index === 0;
          const advisory = advisories[index] ?? null;

          return (
            <li
              key={stage.id}
              className={`stage${isSelected ? ' selected' : ''}${result?.error ? ' errored' : ''}`}
            >
              <button
                type="button"
                className="stage-head"
                onClick={() => onSelect(isSelected ? null : index)}
                aria-expanded={isSelected}
              >
                <span className="stage-number">{index + 1}</span>
                <Icon name={iconForStage(stage.type)} size={22} className="stage-icon" />
                <span className="stage-name">{stage.name ?? displayNameFor(stage.type)}</span>
                {result?.error && <span className="stage-badge error">!</span>}
                {!result?.error && (result?.result?.warnings.length ?? 0) > 0 && (
                  <span className="stage-badge warn">!</span>
                )}
                {/* A design note is advice, not a fault, and is marked as such.
                    Sharing the warning badge would train the user to read a
                    review comment as an error and dismiss both. */}
                {!result?.error && advisory && (
                  <span className="stage-badge note" title="Design note">
                    i
                  </span>
                )}
              </button>

              {isSelected && (
                <div className="stage-body">
                  {meta && <p className="stage-summary">{meta.summary}</p>}
                  {meta?.alternatives && <p className="stage-alt">{meta.alternatives}</p>}

                  <div className="param">
                    <label htmlFor={`${stage.id}-airflow`}>
                      Airflow
                      <span className="param-unit">{LABELS[units].airflow}</span>
                    </label>
                    <input
                      id={`${stage.id}-airflow`}
                      type="number"
                      step={50}
                      placeholder={isFirst ? 'required' : 'inherits upstream'}
                      value={stage.airflow ?? ''}
                      onChange={(event) => {
                        const value = Number.parseFloat(event.target.value);
                        const next = { ...stage };
                        if (Number.isFinite(value) && value > 0) next.airflow = value;
                        else delete next.airflow;
                        update(index, next);
                      }}
                    />
                  </div>

                  {meta?.fields.map((field) => (
                    <Field
                      key={field.key}
                      field={field}
                      stage={stage}
                      units={units}
                      result={result?.result}
                      onChange={(key, value) => {
                        const params = { ...(stage.params ?? {}) };
                        if (value === undefined) delete params[key];
                        else params[key] = value;
                        update(index, { ...stage, params });
                      }}
                    />
                  ))}

                  {result?.error && <p className="stage-error">{result.error}</p>}

                  {result?.result?.warnings.map((warning) => (
                    <p key={warning} className="stage-warning">
                      {warning}
                    </p>
                  ))}

                  {advisory && (
                    <p className="stage-advisory">
                      <strong>Worth a look:</strong> {advisory}
                    </p>
                  )}

                  <div className="stage-actions">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>
                      Move up
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === stages.length - 1}
                    >
                      Move down
                    </button>
                    <button type="button" className="danger" onClick={() => remove(index)}>
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="chain-add">
        <label htmlFor="add-stage">Add equipment</label>
        <select
          id="add-stage"
          value=""
          onChange={(event) => {
            if (event.target.value) add(event.target.value as StageType);
          }}
        >
          <option value="">Choose…</option>
          {/* Grouped: seventeen equipment types in one flat list is a wall. */}
          {STAGE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.types.map((type) => (
                <option key={type} value={type}>
                  {displayNameFor(type)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
