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
  /** Offer to adopt the file's site elevation as the chart pressure. */
  onAdoptElevation: (elevation: number) => void;
}

export function WeatherPanel({
  state,
  onChange,
  units,
  zones,
  dark,
  onAdoptElevation,
}: WeatherPanelProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

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

          <p className="comfort-note">
            Download a weather file from{' '}
            <a href="https://climate.onebuilding.org/" target="_blank" rel="noreferrer noopener">
              Climate.OneBuilding.org
            </a>
            , then drop the ZIP straight in — it will be opened for you. Nothing
            is uploaded; the file is read in your browser.
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
            <dt>Hours read</dt>
            <dd>{state.file.hours.length.toLocaleString()}</dd>
          </dl>

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

          <button
            type="button"
            className="reset"
            onClick={() => onAdoptElevation(state.file!.location.elevation)}
          >
            Use this elevation for the chart
          </button>
          <p className="comfort-note">
            Each hour’s humidity ratio is computed at that hour’s own station
            pressure. Matching the chart to the site keeps the plotted points on
            the relative-humidity lines they belong to.
          </p>

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
                Counted against the still-air comfort zone for the clothing and
                activity set above. It says what the outdoor climate does, not
                what the building does with it.
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

          <p className="citation">
            Weather data: Lawrie, Linda K, Drury B Crawley. 2026.{' '}
            <em>Development of Global Typical Meteorological Years (TMYx)</em>.{' '}
            <a href="https://climate.onebuilding.org/" target="_blank" rel="noreferrer noopener">
              climate.onebuilding.org
            </a>
          </p>
        </>
      )}
    </section>
  );
}

/** The citation, for exports and the about panel. */
export const TMYX_CITATION =
  'Lawrie, Linda K, Drury B Crawley. 2026. Development of Global Typical ' +
  'Meteorological Years (TMYx). https://climate.onebuilding.org/';
