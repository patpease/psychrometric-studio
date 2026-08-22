/**
 * Application shell for Phase 1: the chart, its controls, and a live readout.
 *
 * Process chains, comfort overlays, and weather data all arrive later; the
 * layout reserves the right-hand column for them so that adding a panel does
 * not become a re-layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from '../chart/render.js';
import { useChartInteraction } from '../chart/interact.js';
import {
  defaultDomain,
  domainLimits,
  type ChartDomain,
} from '../chart/scales.js';
import { FAMILY_STYLES, DEFAULT_VISIBILITY, DRAW_ORDER } from '../chart/theme.js';
import type { FamilyKey } from '../chart/families.js';
import {
  atmosphereFromAltitude,
  atmosphereFromPressure,
  standardAtmosphere,
  describeBasis,
  type Atmosphere,
} from '../psych/atmosphere.js';
import { LABELS, type UnitSystem } from '../psych/units.js';
import { fromTdbW, saturationHumidityRatio } from '../psych/state.js';
import { CALCULATION_BASIS } from '../psych/psychrolib.js';
import { BRAND, APP_VERSION, DISCLAIMER_SHORT } from '../config/branding.js';
import { ChainEditor } from './ChainEditor.js';
import { ResultsPanel } from './ResultsPanel.js';
import { solveProject } from '../processes/chain.js';
import type { Stage } from '../types/project.js';
import {
  formatTemperature,
  formatHumidityRatio,
  formatEnthalpy,
  formatSpecificVolume,
  formatDensity,
  formatRelativeHumidity,
  formatPressure,
  formatVapourPressure,
} from './format.js';

type PressureMode = 'sea-level' | 'altitude' | 'explicit';

/**
 * The system shown on first load: a single-zone cooling application with
 * outdoor and return air mixed, a coil, fan heat, and a space load. It exists
 * so the tool opens showing what it does rather than an empty chart.
 */
const STARTER_SYSTEM: Stage[] = [
  { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 800, params: { tdb: 95, rh: 0.4 } },
  {
    id: 'mx',
    type: 'mixing',
    name: 'Mixing box',
    params: { airflow2: 1600, tdb2: 75, rh2: 0.5 },
  },
  { id: 'cc', type: 'cooling', name: 'Cooling coil', params: { tdbOut: 54, rhOut: 0.93 } },
  { id: 'sf', type: 'fan', name: 'Supply fan', params: { power: 2, motorInAirstream: true } },
  { id: 'rm', type: 'room', name: 'Zone', params: { sensible: 42, latent: 11 } },
];

/** Track the element's size so the chart fills the space it is given. */
function useElementSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

export function App(): React.JSX.Element {
  const [units, setUnits] = useState<UnitSystem>('IP');
  const [domain, setDomain] = useState<ChartDomain>(() => defaultDomain('IP'));
  const [pressureMode, setPressureMode] = useState<PressureMode>('sea-level');
  const [altitude, setAltitude] = useState(0);
  const [explicitPressure, setExplicitPressure] = useState('');
  const [visibility, setVisibility] = useState<Record<FamilyKey, boolean>>(DEFAULT_VISIBILITY);
  const [showProtractor, setShowProtractor] = useState(false);
  const [stages, setStages] = useState<Stage[]>(() => STARTER_SYSTEM);
  const [selectedStage, setSelectedStage] = useState<number | null>(null);

  const [sizeRef, size] = useElementSize();
  const limits = useMemo(() => domainLimits(units), [units]);

  const atmosphere: Atmosphere = useMemo(() => {
    switch (pressureMode) {
      case 'altitude':
        return atmosphereFromAltitude(altitude, units);
      case 'explicit': {
        const parsed = Number.parseFloat(explicitPressure);
        // An unparseable or non-positive entry falls back to standard rather
        // than throwing mid-render; the field shows what was typed either way.
        if (!Number.isFinite(parsed) || parsed <= 0) return standardAtmosphere(units);
        return atmosphereFromPressure(units === 'IP' ? parsed : parsed * 1000, units);
      }
      default:
        return standardAtmosphere(units);
    }
  }, [pressureMode, altitude, explicitPressure, units]);

  /** Switching units re-frames the chart; the two domains are not comparable. */
  const switchUnits = (next: UnitSystem): void => {
    setUnits(next);
    setDomain(defaultDomain(next));
  };

  /**
   * The whole chain re-solves on every edit. It is a handful of closed-form
   * evaluations per stage, so this is cheaper than tracking which stages went
   * stale — and it means a change can never leave a downstream state showing a
   * value from before the edit.
   */
  const solved = useMemo(
    () =>
      solveProject(
        {
          schemaVersion: 1,
          units,
          atmosphere: { basis: 'standard' },
          airstreams: [{ id: 'supply', name: 'Supply air', role: 'supply', stages }],
        },
        atmosphere.pressure,
        units,
      ),
    [stages, units, atmosphere.pressure],
  );

  const supply = solved.airstreams[0]!;

  /**
   * Drag an entering-air point to a new condition.
   *
   * The dragged position is written back as dry bulb and relative humidity,
   * which is how the state is stored — so the chain re-solves from the user's
   * declared intent rather than from a pair of pixel coordinates. Dragging above
   * the saturation curve is refused outright: there is no such air.
   */
  const dragSource = useCallback(
    (index: number, tdb: number, w: number) => {
      setStages((current) => {
        const stage = current[index];
        if (!stage || stage.type !== 'source') return current;

        const wSat = saturationHumidityRatio(tdb, atmosphere.pressure, units);
        if (w > wSat || w < 0) return current;

        const state = fromTdbW(tdb, w, atmosphere.pressure, units);
        const copy = [...current];
        copy[index] = {
          ...stage,
          params: { ...(stage.params ?? {}), tdb: Number(tdb.toFixed(2)), rh: state.rh },
        };
        return copy;
      });
    },
    [atmosphere.pressure, units],
  );

  const interaction = useChartInteraction({
    domain,
    limits,
    pressure: atmosphere.pressure,
    units,
    width: size.width,
    height: size.height,
    onDomainChange: setDomain,
  });

  // Guard against ever formatting a state through the wrong unit system's
  // formatters, independently of the clearing logic in the interaction hook.
  const hover = interaction.hover?.units === units ? interaction.hover : null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          {/* Two sources so the tile follows the theme; the browser picks one
              and never downloads the other. */}
          <picture>
            <source srcSet={BRAND.icon.dark} media="(prefers-color-scheme: dark)" />
            <img className="brand-icon" src={BRAND.icon.light} alt="" width={38} height={38} />
          </picture>
          <div className="brand-text">
            <span className="brand-org">{BRAND.organisation}</span>
            <h1>{BRAND.appName}</h1>
            <span className="brand-tagline">{BRAND.tagline}</span>
          </div>
        </div>
        <div className="unit-toggle" role="group" aria-label="Unit system">
          {(['IP', 'SI'] as UnitSystem[]).map((system) => (
            <button
              key={system}
              type="button"
              className={units === system ? 'active' : ''}
              onClick={() => switchUnits(system)}
              aria-pressed={units === system}
            >
              {system}
            </button>
          ))}
        </div>
      </header>

      <main className="app-body">
        <aside className="panel panel-left">
          <ChainEditor
            stages={stages}
            solved={supply.stages}
            units={units}
            selected={selectedStage}
            onSelect={setSelectedStage}
            onChange={setStages}
          />
        </aside>

        <div
          className={`chart-pane${interaction.panning ? ' panning' : ''}`}
          ref={(node) => {
            interaction.containerRef.current = node;
            sizeRef.current = node;
          }}
          onPointerMove={interaction.onPointerMove}
          onPointerDown={interaction.onPointerDown}
          onPointerUp={interaction.onPointerUp}
          onPointerLeave={interaction.onPointerLeave}
        >
          <Chart
            domain={domain}
            pressure={atmosphere.pressure}
            units={units}
            width={size.width}
            height={size.height}
            visibility={visibility}
            showProtractor={showProtractor}
            hover={hover}
            solved={supply}
            selectedStage={selectedStage}
            onSelectStage={setSelectedStage}
            onDragState={dragSource}
          />
          <p className="chart-hint">Scroll to zoom · drag to pan</p>
        </div>

        <aside className="panel panel-right">
          <ResultsPanel
            solved={supply}
            units={units}
            selected={selectedStage}
            onSelect={setSelectedStage}
          />

          <section>
            <h2>Condition at cursor</h2>
            {hover ? (
              <dl className="readout">
                <dt>Dry bulb</dt>
                <dd>{formatTemperature(hover.tdb, units, true)}</dd>
                <dt>Wet bulb</dt>
                <dd>{formatTemperature(hover.twb, units, true)}</dd>
                <dt>Dew point</dt>
                <dd>{formatTemperature(hover.tdp, units, true)}</dd>
                <dt>Relative humidity</dt>
                <dd>{formatRelativeHumidity(hover.rh, true)}</dd>
                <dt>Humidity ratio</dt>
                <dd>{formatHumidityRatio(hover.w, units, true)}</dd>
                <dt>Enthalpy</dt>
                <dd>{formatEnthalpy(hover.h, units, true)}</dd>
                <dt>Specific volume</dt>
                <dd>{formatSpecificVolume(hover.v, units, true)}</dd>
                <dt>Density</dt>
                <dd>{formatDensity(hover.density, units, true)}</dd>
                <dt>Vapour pressure</dt>
                <dd>{formatVapourPressure(hover.vapourPressure, units, true)}</dd>
              </dl>
            ) : (
              <p className="muted">
                Move the pointer over the chart. Readings stop at the saturation curve — there is
                no air above it to describe.
              </p>
            )}
          </section>

          <section>
            <h2>Site pressure</h2>
            <div className="field">
              <label htmlFor="pressure-mode">Basis</label>
              <select
                id="pressure-mode"
                value={pressureMode}
                onChange={(e) => setPressureMode(e.target.value as PressureMode)}
              >
                <option value="sea-level">Sea level (standard)</option>
                <option value="altitude">From site elevation</option>
                <option value="explicit">Entered directly</option>
              </select>
            </div>

            {pressureMode === 'altitude' && (
              <div className="field">
                <label htmlFor="altitude">Elevation ({LABELS[units].altitude})</label>
                <input
                  id="altitude"
                  type="number"
                  value={altitude}
                  step={units === 'IP' ? 100 : 50}
                  onChange={(e) => setAltitude(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
            )}

            {pressureMode === 'explicit' && (
              <div className="field">
                <label htmlFor="pressure">
                  Pressure ({units === 'IP' ? 'psia' : 'kPa'})
                </label>
                <input
                  id="pressure"
                  type="number"
                  value={explicitPressure}
                  placeholder={units === 'IP' ? '14.696' : '101.325'}
                  step={units === 'IP' ? 0.1 : 0.5}
                  onChange={(e) => setExplicitPressure(e.target.value)}
                />
              </div>
            )}

            <p className="basis">
              {describeBasis(atmosphere, (p) => formatPressure(p, units, true))}
            </p>
          </section>

          <section>
            <h2>Chart lines</h2>
            <ul className="family-toggles">
              {DRAW_ORDER.slice()
                .reverse()
                .map((family) => (
                  <li key={family}>
                    <label>
                      <input
                        type="checkbox"
                        checked={visibility[family]}
                        onChange={(e) =>
                          setVisibility((current) => ({ ...current, [family]: e.target.checked }))
                        }
                      />
                      <span
                        className="swatch"
                        style={{
                          background: FAMILY_STYLES[family].colour,
                          height: Math.max(2, FAMILY_STYLES[family].width),
                        }}
                      />
                      {FAMILY_STYLES[family].displayName}
                    </label>
                  </li>
                ))}
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={showProtractor}
                    onChange={(e) => setShowProtractor(e.target.checked)}
                  />
                  <span className="swatch swatch-plain" />
                  SHR protractor
                </label>
              </li>
            </ul>
            <button type="button" className="reset" onClick={() => setDomain(defaultDomain(units))}>
              Reset view
            </button>
          </section>

          <footer className="panel-footer">
            <p>
              {CALCULATION_BASIS.library} {CALCULATION_BASIS.version} — {CALCULATION_BASIS.reference}
            </p>
            <p>Version {APP_VERSION}</p>
            <p className="disclaimer">{DISCLAIMER_SHORT}</p>
          </footer>
        </aside>
      </main>
    </div>
  );
}
