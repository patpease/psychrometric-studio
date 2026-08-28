/**
 * Weather file import, filtering, and hours-in-zone statistics.
 *
 * Files come from Climate.OneBuilding.org, which the panel links to and cites.
 * There is no direct download: that host sends no CORS header, so a browser
 * cannot fetch from it — see `docs/weather-data.md` for why that is a property
 * of the host rather than of this tool.
 */
import { useRef, useState } from 'react';
import {
  readWeatherFile,
  describeLocation,
  type EpwFile,
} from '../weather/epw.js';
import {
  applyFilter,
  zoneStatistics,
  HOUR_PRESETS,
  ALL_HOURS,
  type HourFilter,
} from '../weather/bins.js';
import { densityLegend, type WeatherMode } from '../chart/WeatherLayer.js';
import type { ComfortZone } from '../comfort/polygon.js';
import { LABELS, type UnitSystem } from '../psych/units.js';
import {
  RELAY_PATH,
  RELAY_NOT_DEPLOYED,
  archiveNameFrom,
  isArchiveResponse,
} from '../weather/proxy.js';
import type { DesignDayKind } from '../weather/ddy.js';
import { formatTemperature } from './format.js';

export interface WeatherState {
  file: EpwFile | null;
  mode: WeatherMode;
  filter: HourFilter;
  presetIndex: number;
  /** The design condition highlighted on the chart, if any. */
  selectedDesignDay: DesignDayKind | null;
}

export const initialWeatherState: WeatherState = {
  file: null,
  mode: 'off',
  filter: ALL_HOURS,
  presetIndex: 0,
  selectedDesignDay: null,
};

export interface WeatherPanelProps {
  state: WeatherState;
  onChange: (state: WeatherState) => void;
  units: UnitSystem;
  zones: readonly ComfortZone[];
  dark: boolean;
}

export function WeatherPanel({
  state,
  onChange,
  units,
  zones,
  dark,
}: WeatherPanelProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [url, setUrl] = useState('');
  const [urlProblem, setUrlProblem] = useState<string | null>(null);

  /**
   * Fetch an archive by address.
   *
   * Climate.OneBuilding sends no CORS header, so the browser cannot read a
   * response from it directly — this goes through a relay on our own origin.
   * See `weather/proxy.ts` for why, and for why the relay will fetch from
   * exactly one host.
   *
   * Once the bytes arrive the path rejoins the dropped-file one: the archive is
   * unzipped and parsed in the browser exactly as before, so "the file is not
   * stored" stays true whichever way it got here.
   */
  const loadFromUrl = async (): Promise<void> => {
    setUrlProblem(null);
    setReading(true);
    try {
      const response = await fetch(`${RELAY_PATH}?url=${encodeURIComponent(url.trim())}`);

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { message?: string } | null;
        setUrlProblem(detail?.message ?? `The file could not be fetched (${response.status}).`);
        return;
      }

      /*
       * A 200 is not proof the relay answered.
       *
       * A single-page deployment serves index.html for any path it does not
       * recognise, so a *missing* relay replies 200 with HTML rather than 404.
       * Trusting the status code hands that HTML to the unzipper, which fails
       * with "this .zip could not be opened" — blaming the archive for a
       * deployment problem, and sending whoever reads it looking in exactly the
       * wrong place. Observed on a live deployment, not imagined.
       */
      if (!isArchiveResponse(response.headers.get('content-type'))) {
        setUrlProblem(RELAY_NOT_DEPLOYED);
        return;
      }

      const blob = await response.blob();
      await load(new File([blob], archiveNameFrom(url), { type: 'application/zip' }));
      setUrl('');
    } catch {
      setUrlProblem('The file could not be fetched. Download it and drop it in instead.');
    } finally {
      setReading(false);
    }
  };

  const load = async (file: File): Promise<void> => {
    setReading(true);
    try {
      const parsed = await readWeatherFile(file, units);
      onChange({
        ...state,
        file: parsed,
        mode: parsed.hours.length > 0 ? 'density' : 'off',
      });
    } finally {
      setReading(false);
    }
  };

  const filtered = state.file ? applyFilter(state.file.hours, state.filter) : [];
  const stats = zones
    .filter((zone) => zone.points.length >= 3)
    .map((zone) => zoneStatistics(filtered, zone.points, zone.label));

  return (
    <section className="weather-panel">
      {!state.file && (
        <>
          <div
            className={`dropzone${dragging ? ' over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void load(file);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
          >
            {reading ? 'Reading…' : 'Drop an EPW or ZIP here, or click to choose'}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".epw,.zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file);
            }}
          />

          <div className="weather-url">
            <label htmlFor="weather-url">Or paste a link to a .zip</label>
            <div className="weather-url-row">
              <input
                id="weather-url"
                type="url"
                placeholder="https://climate.onebuilding.org/…/….zip"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && url.trim()) void loadFromUrl();
                }}
              />
              <button type="button" onClick={() => void loadFromUrl()} disabled={!url.trim() || reading}>
                Fetch
              </button>
            </div>
          </div>

          {urlProblem && <p className="comfort-limit">{urlProblem}</p>}

          <p className="comfort-note">
            <a href="https://climate.onebuilding.org/" target="_blank" rel="noreferrer noopener">
              Climate.OneBuilding.org
            </a>{' '}
            is recommended for weather files, either add a .zip or directly
            link. File is not stored, data is extracted in the browser.
          </p>
        </>
      )}

      {state.file && (
        <>
          <dl className="readout">
            <dt>Station</dt>
            <dd>{describeLocation(state.file.location) || '—'}</dd>
            <dt>Elevation</dt>
            <dd>
              {state.file.location.elevation.toFixed(0)} {LABELS[units].altitude}
            </dd>
          </dl>

          {/*
            A complete year needs no announcement — 8,760 is what everyone
            expects, and saying so is a line of noise on every load. A short
            year is the case worth interrupting for, because every statistic
            below is then drawn from less than a year and is not an annual
            figure.
          */}
          {state.file.hours.length < 8760 && (
            <p className="comfort-limit">
              Only {state.file.hours.length.toLocaleString()} of 8,760 hours were
              read. Statistics below are still valid for the hours present, but
              they are not annual totals.
            </p>
          )}

          {state.file.design && state.file.design.days.length > 0 && (
            <>
              <h3>ASHRAE design conditions</h3>
              <p className="comfort-note">
                From the <code>.ddy</code> in the archive. These are the rare
                hours plant is sized against — not the typical year the overlay
                above draws. Select one to find it on the chart.
              </p>
              <ul className="design-day-list">
                {state.file.design.days.map((day) => {
                  const isSelected = state.selectedDesignDay === day.kind;
                  return (
                    <li key={day.kind}>
                      <button
                        type="button"
                        className={`design-day-row${isSelected ? ' selected' : ''}`}
                        onClick={() =>
                          onChange({
                            ...state,
                            selectedDesignDay: isSelected ? null : day.kind,
                          })
                        }
                        aria-pressed={isSelected}
                      >
                        <span className="design-day-tag-chip">{day.tag}</span>
                        <span className="design-day-name">{day.label}</span>
                        <span className="design-day-values">
                          {formatTemperature(day.state.tdb, units)} DB
                          {'  ·  '}
                          {formatTemperature(day.state.twb, units)} WB
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {state.file.design?.problems.map((problem) => (
            <p key={problem} className="comfort-note">
              {problem}
            </p>
          ))}

          {state.file.problems.map((problem) => (
            <p key={problem} className="comfort-limit">
              {problem}
            </p>
          ))}

          <div className="field">
            <label htmlFor="weather-mode">Show as</label>
            <select
              id="weather-mode"
              value={state.mode}
              onChange={(event) => onChange({ ...state, mode: event.target.value as WeatherMode })}
            >
              <option value="off">Off</option>
              <option value="scatter">Every hour</option>
              <option value="density">Hours per cell</option>
            </select>
          </div>

          {state.mode === 'density' && (
            <div className="density-legend">
              <span>fewer</span>
              {densityLegend(dark).map((colour) => (
                <span key={colour} className="density-swatch" style={{ background: colour }} />
              ))}
              <span>more</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="weather-filter">Period</label>
            <select
              id="weather-filter"
              value={state.presetIndex}
              onChange={(event) => {
                const index = Number.parseInt(event.target.value, 10);
                onChange({
                  ...state,
                  presetIndex: index,
                  filter: HOUR_PRESETS[index]?.filter ?? ALL_HOURS,
                });
              }}
            >
              {HOUR_PRESETS.map((preset, index) => (
                <option key={preset.label} value={index}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <p className="comfort-note">
            {filtered.length.toLocaleString()} hours shown.
          </p>

          {stats.length > 0 && (
            <>
              <h3>Hours in the comfort zone</h3>
              {stats.map((stat) => (
                <div key={stat.label} className="zone-stat">
                  <div className="zone-stat-head">
                    <span>{stat.label}</span>
                    <strong>{(stat.fraction * 100).toFixed(1)}%</strong>
                  </div>
                  <div className="zone-stat-bar">
                    <span style={{ width: `${stat.fraction * 100}%` }} />
                  </div>
                  <p className="zone-stat-detail">
                    {stat.hoursInside.toLocaleString()} of{' '}
                    {stat.hoursTotal.toLocaleString()} hours inside ·{' '}
                    {stat.hoursWarmer.toLocaleString()} too warm ·{' '}
                    {stat.hoursCooler.toLocaleString()} too cool ·{' '}
                    {stat.hoursMoreHumid.toLocaleString()} too humid
                  </p>
                </div>
              ))}
              <p className="comfort-note">
                Comfort hours are outside conditions and are indicators of the
                overall harshness of the climates.
              </p>
            </>
          )}

          <button
            type="button"
            className="reset"
            onClick={() => onChange({ ...initialWeatherState })}
          >
            Remove weather file
          </button>

        </>
      )}
    </section>
  );
}

/** The citation, for exports and the about panel. */
export const TMYX_CITATION =
  'Lawrie, Linda K, Drury B Crawley. 2026. Development of Global Typical ' +
  'Meteorological Years (TMYx). https://climate.onebuilding.org/';
