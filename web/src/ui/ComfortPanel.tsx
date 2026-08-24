/**
 * Thermal comfort controls and results.
 *
 * Applicability limits are shown as prominently as the numbers themselves. A
 * PMV computed at 3 met looks exactly as authoritative as one computed at 1.2,
 * and only one of them is inside the standard.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  comfortZones,
  evaluateComfort,
  evaluateAdaptive,
  runningMeanOutdoor,
  PMV_LIMITS,
  type ComfortZone,
} from '../comfort/index.js';
import { dailyMeansBefore, warmestDay, type WeatherHour } from '../weather/epw.js';
import { comfortZoneLegend } from '../chart/ComfortOverlay.js';
import { AdaptiveChart, adaptiveRange } from './AdaptiveChart.js';
import { LABELS, type UnitSystem } from '../psych/units.js';
import { formatTemperature } from './format.js';

export type ComfortModel = 'off' | 'pmv' | 'adaptive';

export interface ComfortSettingsState {
  model: ComfortModel;
  met: number;
  airSpeed: number;
  mrtOffset: number;
  clothing: [number, number];
  /** Indoor operative temperature for the adaptive model, app units. */
  adaptiveIndoor: number;
  /** Prevailing mean outdoor temperature, app units. */
  adaptivePrevailing: number;
}

export function defaultComfortSettings(units: UnitSystem): ComfortSettingsState {
  return {
    model: 'pmv',
    met: 1.1,
    airSpeed: 0.1,
    mrtOffset: 0,
    clothing: [1.0, 0.5],
    adaptiveIndoor: units === 'IP' ? 75 : 24,
    adaptivePrevailing: units === 'IP' ? 68 : 20,
  };
}

export interface ComfortPanelProps {
  settings: ComfortSettingsState;
  onChange: (settings: ComfortSettingsState) => void;
  units: UnitSystem;
  pressure: number;
  zones: readonly ComfortZone[];
  /** The condition under the cursor, evaluated against the comfort model. */
  sample: { tdb: number; rh: number } | null;
  /**
   * The loaded weather file, if there is one.
   *
   * Only the adaptive model uses it, and only to derive the prevailing mean
   * outdoor temperature from real daily means rather than a typed guess.
   */
  weather?: { hours: readonly WeatherHour[]; station: string } | null;
}

/** Air speed is stored in m/s; IP convention displays feet per minute. */
function airSpeedToDisplay(ms: number, units: UnitSystem): number {
  return units === 'IP' ? ms * 196.85 : ms;
}

function airSpeedFromDisplay(value: number, units: UnitSystem): number {
  return units === 'IP' ? value / 196.85 : value;
}

/** Month names, for a picker that reads as a date rather than as two numbers. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Derive the prevailing mean outdoor temperature from the loaded weather file.
 *
 * The adaptive model's only climate input is a running mean of the daily mean
 * outdoor temperatures preceding the day being assessed. Typing that number
 * from memory is guesswork; an EPW carries all 8,760 hours it is made of.
 *
 * ## Why it is offered rather than applied
 *
 * The derived value is shown continuously and written to the setting only when
 * the user asks. Silently overwriting a typed number the moment a weather file
 * loads would take a deliberate input away without saying so — and the typed
 * value is legitimate: a designer may be working to a figure from a standard or
 * a client brief rather than to a typical year.
 *
 * ## Why the date is not saved
 *
 * The day being assessed lives in component state, not in the project file. Its
 * input — the EPW — is not stored either (an EPW is ~1.5 MB and redistributable
 * only under its source's terms), so a saved date would reopen pointing at a
 * file that is no longer loaded. What *is* saved is the resulting temperature,
 * which is the number the model actually uses.
 */
function PrevailingFromWeather({
  hours,
  station,
  units,
  current,
  onApply,
}: {
  hours: readonly WeatherHour[];
  station: string;
  units: UnitSystem;
  current: number;
  onApply: (value: number) => void;
}): React.JSX.Element | null {
  /**
   * ASHRAE 55 permits either form. The weighted mean is preferred because it
   * lets recent weather dominate, which is what occupants adapt to; alpha = 1
   * collapses the same code path to the simple arithmetic mean.
   */
  const [alpha, setAlpha] = useState(0.8);
  const [date, setDate] = useState<{ month: number; day: number } | null>(null);

  /**
   * Open on the warmest day.
   *
   * A naturally ventilated building is judged on whether it stays acceptable
   * when the weather is at its worst, so the warmest day asks the question that
   * matters. Recomputed when the file changes, and when the unit system does —
   * the hours are re-expressed on a unit switch, so a mean taken before it
   * would be a Fahrenheit number labelled Celsius.
   */
  useEffect(() => {
    const warmest = warmestDay(hours);
    setDate(warmest ? { month: warmest.month, day: warmest.day } : null);
  }, [hours]);

  const derived = useMemo(() => {
    if (!date) return null;
    const means = dailyMeansBefore(hours, date.month, date.day, 30);
    if (means.length === 0) return null;
    const value = runningMeanOutdoor(means, alpha);
    return Number.isFinite(value) ? value : null;
  }, [hours, date, alpha]);

  if (hours.length === 0 || !date) return null;

  // Days available for the chosen month, taken from the file rather than from a
  // calendar: a partial year should not offer a day it has no hours for.
  const daysInMonth = [
    ...new Set(hours.filter((hour) => hour.month === date.month).map((hour) => hour.day)),
  ].sort((a, b) => a - b);

  const inUse = derived !== null && Math.abs(derived - current) < 0.05;

  return (
    <div className="prevailing">
      <h4>From the weather file</h4>
      <p className="comfort-note">
        The 30 days before the day you are assessing, from {station}.
      </p>

      <div className="prevailing-date">
        <select
          aria-label="Month"
          value={date.month}
          onChange={(event) => {
            const month = Number.parseInt(event.target.value, 10);
            const available = hours.filter((hour) => hour.month === month).map((hour) => hour.day);
            // Keep the day if the new month has it, or fall back to its first.
            const day = available.includes(date.day) ? date.day : Math.min(...available);
            setDate({ month, day });
          }}
        >
          {[...new Set(hours.map((hour) => hour.month))]
            .sort((a, b) => a - b)
            .map((month) => (
              <option key={month} value={month}>
                {MONTHS[month - 1]}
              </option>
            ))}
        </select>
        <select
          aria-label="Day"
          value={date.day}
          onChange={(event) => setDate({ ...date, day: Number.parseInt(event.target.value, 10) })}
        >
          {daysInMonth.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
        <select
          aria-label="Averaging"
          value={alpha}
          onChange={(event) => setAlpha(Number.parseFloat(event.target.value))}
        >
          <option value={0.8}>Weighted, α = 0.8</option>
          <option value={0.9}>Weighted, α = 0.9</option>
          <option value={0.6}>Weighted, α = 0.6</option>
          <option value={1}>Simple 30-day mean</option>
        </select>
      </div>

      {derived === null ? (
        <p className="comfort-limit">
          There are not enough days before this one in the file to take a running
          mean.
        </p>
      ) : (
        <div className="prevailing-result">
          <strong>{formatTemperature(derived, units, true)}</strong>
          {inUse ? (
            <span className="prevailing-inuse">in use</span>
          ) : (
            <button type="button" onClick={() => onApply(Number(derived.toFixed(1)))}>
              Use this
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ComfortPanel({
  settings,
  onChange,
  units,
  zones,
  sample,
  weather = null,
}: ComfortPanelProps): React.JSX.Element {
  const set = <K extends keyof ComfortSettingsState>(
    key: K,
    value: ComfortSettingsState[K],
  ): void => onChange({ ...settings, [key]: value });

  const legend = comfortZoneLegend(zones);
  const zoneProblems = zones.flatMap((zone) => zone.problems);

  const cursorResult = useMemo(() => {
    if (!sample || settings.model !== 'pmv') return null;
    return evaluateComfort(
      {
        tdb: sample.tdb,
        mrtOffset: settings.mrtOffset,
        rh: sample.rh,
        airSpeed: settings.airSpeed,
        met: settings.met,
        clo: settings.clothing[1],
      },
      units,
    );
  }, [sample, settings, units]);

  const adaptive = useMemo(
    () =>
      evaluateAdaptive(
        {
          indoor: settings.adaptiveIndoor,
          prevailing: settings.adaptivePrevailing,
          airSpeed: settings.airSpeed,
        },
        units,
      ),
    [settings, units],
  );

  const [rangeLow, rangeHigh] = adaptiveRange(units);
  const speedUnit = units === 'IP' ? 'fpm' : 'm/s';

  return (
    <section className="comfort-panel">


      <div className="field">
        <label htmlFor="comfort-model">Model</label>
        <select
          id="comfort-model"
          value={settings.model}
          onChange={(event) => set('model', event.target.value as ComfortModel)}
        >
          <option value="off">Off</option>
          <option value="pmv">PMV / PPD (ASHRAE 55)</option>
          <option value="adaptive">Adaptive (ASHRAE 55)</option>
        </select>
      </div>

      {settings.model === 'pmv' && (
        <>
          <div className="field">
            <label htmlFor="comfort-met">Metabolic rate (met)</label>
            <input
              id="comfort-met"
              type="number"
              step={0.1}
              min={0.7}
              max={4}
              value={settings.met}
              onChange={(event) => set('met', Number.parseFloat(event.target.value) || 1.1)}
            />
          </div>

          <div className="field">
            <label htmlFor="comfort-air">Air speed ({speedUnit})</label>
            <input
              id="comfort-air"
              type="number"
              step={units === 'IP' ? 5 : 0.05}
              min={0}
              value={Number(airSpeedToDisplay(settings.airSpeed, units).toFixed(2))}
              onChange={(event) =>
                set(
                  'airSpeed',
                  Math.max(0, airSpeedFromDisplay(Number.parseFloat(event.target.value) || 0, units)),
                )
              }
            />
          </div>

          <div className="field">
            <label htmlFor="comfort-mrt">MRT − dry bulb ({LABELS[units].temperature})</label>
            <input
              id="comfort-mrt"
              type="number"
              step={1}
              value={settings.mrtOffset}
              onChange={(event) => set('mrtOffset', Number.parseFloat(event.target.value) || 0)}
            />
          </div>

          <div className="field">
            <label htmlFor="comfort-clo-winter">Winter clothing (clo)</label>
            <input
              id="comfort-clo-winter"
              type="number"
              step={0.1}
              min={0}
              max={1.5}
              value={settings.clothing[0]}
              onChange={(event) =>
                set('clothing', [Number.parseFloat(event.target.value) || 1, settings.clothing[1]])
              }
            />
          </div>

          <div className="field">
            <label htmlFor="comfort-clo-summer">Summer clothing (clo)</label>
            <input
              id="comfort-clo-summer"
              type="number"
              step={0.1}
              min={0}
              max={1.5}
              value={settings.clothing[1]}
              onChange={(event) =>
                set('clothing', [settings.clothing[0], Number.parseFloat(event.target.value) || 0.5])
              }
            />
          </div>

          <ul className="comfort-legend">
            {legend.map((entry) => (
              <li key={entry.label}>
                <span className={`comfort-swatch ${entry.className}`} />
                {entry.label}
                {entry.empty && <span className="comfort-empty"> — none</span>}
              </li>
            ))}
          </ul>

          {settings.airSpeed > PMV_LIMITS.stillAirSpeed && (
            <p className="comfort-note">
              Above {PMV_LIMITS.stillAirSpeed} m/s the zone includes the cooling effect of air
              movement, per ASHRAE 55 Appendix H. The standard requires occupants to have
              control of that air movement.
            </p>
          )}

          {zoneProblems.map((problem) => (
            <p key={problem} className="comfort-limit">
              {problem}
            </p>
          ))}

          {cursorResult && (
            <>
              <h3>At the cursor</h3>
              <dl className="readout">
                <dt>PMV</dt>
                <dd>{cursorResult.pmv.toFixed(2)}</dd>
                <dt>PPD</dt>
                <dd>{cursorResult.ppd.toFixed(1)} %</dd>
                <dt>Verdict</dt>
                <dd className={cursorResult.comfortable ? 'verdict-ok' : 'verdict-no'}>
                  {cursorResult.comfortable ? 'Within ±0.5' : 'Outside ±0.5'}
                </dd>
              </dl>
              <p className="comfort-note">
                Evaluated at {settings.clothing[1].toFixed(1)} clo.
              </p>
              {cursorResult.limits.map((limit) => (
                <p key={limit} className="comfort-limit">
                  {limit}
                </p>
              ))}
            </>
          )}
        </>
      )}

      {settings.model === 'adaptive' && (
        <>
          <p className="comfort-note">
            The adaptive model applies <strong>only</strong> to naturally conditioned spaces
            where occupants control operable openings and can adapt their clothing. It is not
            valid in a mechanically cooled building.
          </p>

          {weather && <PrevailingFromWeather
            hours={weather.hours}
            station={weather.station}
            units={units}
            current={settings.adaptivePrevailing}
            onApply={(value) => set('adaptivePrevailing', value)}
          />}

          <div className="field">
            <label htmlFor="adaptive-outdoor">
              Prevailing outdoor ({LABELS[units].temperature})
            </label>
            <input
              id="adaptive-outdoor"
              type="number"
              step={1}
              value={settings.adaptivePrevailing}
              onChange={(event) =>
                set('adaptivePrevailing', Number.parseFloat(event.target.value) || 0)
              }
            />
          </div>

          <div className="field">
            <label htmlFor="adaptive-indoor">
              Indoor operative ({LABELS[units].temperature})
            </label>
            <input
              id="adaptive-indoor"
              type="number"
              step={1}
              value={settings.adaptiveIndoor}
              onChange={(event) =>
                set('adaptiveIndoor', Number.parseFloat(event.target.value) || 0)
              }
            />
          </div>

          <p className="comfort-note">
            Valid for a prevailing outdoor temperature of{' '}
            {formatTemperature(rangeLow, units, true)} to {formatTemperature(rangeHigh, units, true)}.
          </p>

          <AdaptiveChart
            units={units}
            indoor={settings.adaptiveIndoor}
            prevailing={settings.adaptivePrevailing}
            result={adaptive}
          />

          {adaptive.comfort !== null ? (
            <dl className="readout">
              <dt>Neutral</dt>
              <dd>{formatTemperature(adaptive.comfort, units, true)}</dd>
              <dt>80% band</dt>
              <dd>
                {formatTemperature(adaptive.band80![0], units)}–
                {formatTemperature(adaptive.band80![1], units, true)}
              </dd>
              <dt>90% band</dt>
              <dd>
                {formatTemperature(adaptive.band90![0], units)}–
                {formatTemperature(adaptive.band90![1], units, true)}
              </dd>
              <dt>Verdict</dt>
              <dd className={adaptive.acceptable80 ? 'verdict-ok' : 'verdict-no'}>
                {adaptive.acceptable90
                  ? 'Within 90%'
                  : adaptive.acceptable80
                    ? 'Within 80%'
                    : 'Outside both bands'}
              </dd>
            </dl>
          ) : (
            <p className="muted">No adaptive criterion at this outdoor temperature.</p>
          )}

          {adaptive.limits.map((limit) => (
            <p key={limit} className="comfort-limit">
              {limit}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

/** Build the zones for the current settings. Exported so App can share them. */
export function buildZones(
  settings: ComfortSettingsState,
  pressure: number,
  units: UnitSystem,
): ComfortZone[] {
  if (settings.model !== 'pmv') return [];
  return comfortZones(
    {
      met: settings.met,
      airSpeed: settings.airSpeed,
      mrtOffset: settings.mrtOffset,
      pressure,
      units,
    },
    [
      { clo: settings.clothing[0], label: `Winter · ${settings.clothing[0].toFixed(1)} clo` },
      { clo: settings.clothing[1], label: `Summer · ${settings.clothing[1].toFixed(1)} clo` },
    ],
  );
}
