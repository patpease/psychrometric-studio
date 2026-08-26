/**
 * Solved state points, stage duties, and system totals.
 *
 * The energy-balance line is shown rather than hidden. It is the check that
 * catches a process model creating or destroying energy — the class of bug that
 * produces a plausible chart and a wrong coil selection — and an engineer is
 * entitled to see that the tool passes its own test on their system.
 */
import type { SolvedAirstream } from '../processes/chain.js';
import { checkEnergyBalance, systemTotals } from '../processes/chain.js';
import { LABELS, type UnitSystem } from '../psych/units.js';
import {
  formatEnthalpy,
  formatHumidityRatio,
  formatRelativeHumidity,
  formatTemperature,
} from './format.js';

export interface ResultsPanelProps {
  solved: SolvedAirstream;
  units: UnitSystem;
  selected: number | null;
  onSelect: (index: number | null) => void;
}

function fmt(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function ResultsPanel({
  solved,
  units,
  selected,
  onSelect,
}: ResultsPanelProps): React.JSX.Element {
  const stages = solved.stages.filter((stage) => stage.result);
  const totals = systemTotals(solved);
  const balance = checkEnergyBalance(solved, units);
  const dutyUnit = LABELS[units].duty;

  if (stages.length === 0) {
    return (
      <section>
        <h2>Results</h2>
        <p className="muted">Add equipment to the system to see solved state points.</p>
      </section>
    );
  }

  return (
    <>
      <section>
        <h2>State points</h2>
        <div className="table-scroll">
          <table className="results">
            <thead>
              <tr>
                <th />
                <th>Tdb</th>
                <th>Twb</th>
                <th>RH</th>
                <th>W</th>
                <th>h</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage, position) => (
                <tr
                  key={stage.stage.id}
                  className={selected === stage.index ? 'selected' : ''}
                  onClick={() => onSelect(selected === stage.index ? null : stage.index)}
                >
                  <th scope="row">
                    <span className="row-number">{position + 1}</span>
                    {stage.displayName}
                  </th>
                  <td>{formatTemperature(stage.result!.state.tdb, units)}</td>
                  <td>{formatTemperature(stage.result!.state.twb, units)}</td>
                  <td>{formatRelativeHumidity(stage.result!.state.rh)}</td>
                  <td>{formatHumidityRatio(stage.result!.state.w, units)}</td>
                  <td>{formatEnthalpy(stage.result!.state.h, units)}</td>
                </tr>
              ))}
            </tbody>
            {/*
              Units belong under the column they qualify, not in a sentence
              beside the table. As a paragraph outside the scroll container they
              sat against the left edge — under the stage names, which have no
              unit — and did not move when the table scrolled. In the foot they
              line up with both the data and the headings above them.
            */}
            <tfoot>
              <tr>
                <th scope="row" />
                <td>{LABELS[units].temperature}</td>
                <td>{LABELS[units].temperature}</td>
                <td>{LABELS[units].relativeHumidity}</td>
                <td>{LABELS[units].humidityRatio}</td>
                <td>{LABELS[units].enthalpy}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section>
        <h2>Duties</h2>
        <div className="table-scroll">
          <table className="results">
            <thead>
              <tr>
                <th />
                <th>Total</th>
                <th>Sens.</th>
                <th>Lat.</th>
                <th>SHR</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage, position) => {
                const { duty } = stage.result!;
                if (position === 0) return null;
                return (
                  <tr
                    key={stage.stage.id}
                    className={selected === stage.index ? 'selected' : ''}
                    onClick={() => onSelect(selected === stage.index ? null : stage.index)}
                  >
                    <th scope="row">
                      <span className="row-number">{position + 1}</span>
                      {stage.displayName}
                    </th>
                    <td>{fmt(duty.total)}</td>
                    <td>{fmt(duty.sensible)}</td>
                    <td>{fmt(duty.latent)}</td>
                    <td>{Number.isFinite(duty.shr) ? duty.shr.toFixed(2) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="table-units">{dutyUnit} · positive into the airstream</p>
      </section>

      <section>
        <h2>Totals</h2>
        <dl className="readout">
          <dt>Total cooling</dt>
          <dd>
            {fmt(totals.cooling)} {dutyUnit}
          </dd>
          <dt>Total heating</dt>
          <dd>
            {fmt(totals.heating)} {dutyUnit}
          </dd>
          <dt>Humidification</dt>
          <dd>
            {fmt(totals.humidification)} {LABELS[units].moistureRate}
          </dd>
          <dt>Dehumidification</dt>
          <dd>
            {fmt(totals.dehumidification)} {LABELS[units].moistureRate}
          </dd>
        </dl>

        {balance && (
          <p className={`balance${balance.closes ? '' : ' failed'}`}>
            {balance.closes
              ? 'Energy balance closes.'
              : `Energy balance does not close — residual ${fmt(balance.residual, 3)} ${dutyUnit}. ` +
                'This is a defect in the tool, not in your system; please report it.'}
          </p>
        )}
      </section>
    </>
  );
}
