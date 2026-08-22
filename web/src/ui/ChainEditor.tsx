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
import { AVAILABLE_STAGE_TYPES, displayNameFor } from '../processes/registry.js';
import type { UnitSystem } from '../psych/units.js';
import {
  STAGE_FIELDS,
  fromFieldValue,
  toFieldValue,
  unitLabelFor,
  type ParamField,
} from './stageFields.js';
import { LABELS } from '../psych/units.js';

export interface ChainEditorProps {
  stages: readonly Stage[];
  solved: readonly SolvedStage[];
  units: UnitSystem;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onChange: (stages: Stage[]) => void;
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
      return { ...base, params: { power: 2, motorInAirstream: true } };
    case 'room':
      return { ...base, params: { sensible: 40, latent: 10 } };
    default:
      return base;
  }
}

function Field({
  field,
  stage,
  units,
  onChange,
}: {
  field: ParamField;
  stage: Stage;
  units: UnitSystem;
  onChange: (key: string, value: number | boolean | undefined) => void;
}): React.JSX.Element {
  const raw = (stage.params ?? {})[field.key];
  const unit = unitLabelFor(field, units);
  const id = `${stage.id}-${field.key}`;

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

  return (
    <div className="param">
      <label htmlFor={id}>
        {field.label}
        {unit && <span className="param-unit">{unit}</span>}
      </label>
      <input
        id={id}
        type="number"
        step={field.step ?? 1}
        placeholder={field.placeholder ?? '—'}
        value={toFieldValue(raw, field)}
        onChange={(event) => onChange(field.key, fromFieldValue(event.target.value, field))}
      />
      {field.help && <p className="param-help">{field.help}</p>}
    </div>
  );
}

export function ChainEditor({
  stages,
  solved,
  units,
  selected,
  onSelect,
  onChange,
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
    onChange([...stages, newStage(type, stages.length)]);
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
                <span className="stage-name">{stage.name ?? displayNameFor(stage.type)}</span>
                {result?.error && <span className="stage-badge error">!</span>}
                {!result?.error && (result?.result?.warnings.length ?? 0) > 0 && (
                  <span className="stage-badge warn">!</span>
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
          {AVAILABLE_STAGE_TYPES.map((type) => (
            <option key={type} value={type}>
              {displayNameFor(type)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
