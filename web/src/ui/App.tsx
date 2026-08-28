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
import { Collapsible } from './Collapsible.js';
import { EducationPanel } from './EducationPanel.js';
import { WalkthroughPanel } from './WalkthroughPanel.js';
import { EducationContext } from './Tooltip.js';
import { Icon } from '../icons/Icon.js';
import { useTheme, type ThemeChoice } from './theme.js';
import { runCheck, WALKTHROUGH } from '../education/index.js';
import { ExportPanel } from './ExportPanel.js';
import { AboutPanel } from './AboutPanel.js';
import { setRescue } from '../io/rescue.js';
import {
  blankSystem,
  fromProject,
  readProject,
  toProject,
  writeProject,
  type SessionState,
  type SessionSystem,
} from '../io/project.js';
import { readFragment } from '../io/url.js';
import type { ProjectMeta } from '../types/project.js';
import { WeatherPanel, initialWeatherState, type WeatherState } from './WeatherPanel.js';
import { WeatherLayer } from '../chart/WeatherLayer.js';
import { convertHoursTo, describeLocation } from '../weather/epw.js';
import { convertAltitude, convertComfort, convertStages } from './convertProject.js';
import {
  ComfortPanel,
  buildZones,
  defaultComfortSettings,
  type ComfortSettingsState,
} from './ComfortPanel.js';
import { ResultsPanel } from './ResultsPanel.js';
import { solveSystem } from '../processes/chain.js';
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

import type { PressureMode } from '../io/project.js';
import type { EpwFile } from '../weather/epw.js';
import { STARTER_COOLING, STARTER_HEATING } from './starters.js';
import { SystemFlip } from './SystemFlip.js';
import type { DesignDayKind } from '../weather/ddy.js';

/** Selection and highlighting, per system. Session-only; never saved. */
interface SystemUiState {
  selectedStage: number | null;
  selectedDesignDay: DesignDayKind | null;
}

const EMPTY_UI: SystemUiState = { selectedStage: null, selectedDesignDay: null };

/**
 * The two cases a new project opens with.
 *
 * Both are built rather than left empty: a heating case that starts blank
 * teaches nothing on the first flip, and the point of the second page is to
 * show that the same equipment reads differently in winter.
 */
function starterSystems(units: UnitSystem): SessionSystem[] {
  const cooling = blankSystem('cooling', units, [...STARTER_COOLING]);
  const heating = blankSystem('heating', units, [...STARTER_HEATING]);
  return [cooling, heating];
}

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
  const [pressureMode, setPressureMode] = useState<PressureMode>('sea-level');
  const [altitude, setAltitude] = useState(0);
  const [explicitPressure, setExplicitPressure] = useState('');
  const [comfort, setComfort] = useState<ComfortSettingsState>(() => defaultComfortSettings('IP'));

  /**
   * The operating cases, and which one is on screen.
   *
   * A project holds a cooling case and a heating case. They are separate
   * definitions of the same physical system, not two views of one — each has
   * its own equipment chain, its own chart view, and its own weather filter.
   * Everything below that is shared sits outside this array: one site, one set
   * of occupants, one weather file.
   */
  const [systems, setSystems] = useState<SessionSystem[]>(() => starterSystems('IP'));
  const [activeSystem, setActiveSystem] = useState(0);
  const current = systems[activeSystem] ?? systems[0]!;
  const { stages, domain, visibility, showProtractor } = current;

  /** The loaded weather file. Shared: both cases read the same year. */
  const [weatherFile, setWeatherFile] = useState<EpwFile | null>(null);
  /** Selection and highlight, per system, kept out of the saved project. */
  const [systemUi, setSystemUi] = useState<Record<string, SystemUiState>>({});
  const ui = systemUi[current.id] ?? EMPTY_UI;
  const selectedStage = ui.selectedStage;

  /**
   * Which case a write lands on, in a ref rather than a closure.
   *
   * This is deliberate and load-bearing. The setters below used to be plain
   * `useState` setters, whose identity never changes, so callers could hold on
   * to one forever — several do, with an empty dependency array. Rebuilding
   * them on every flip would leave those callers holding a setter bound to
   * whichever case was open when they were created, and writes would land on
   * the wrong page: a click that never registers, or worse, a drag on the
   * heating chart that silently edits the cooling chain.
   *
   * Reading the target through a ref keeps the setters' identity stable, so
   * that whole class of bug cannot come back the next time someone writes a
   * callback here. The tradeoff is the usual one for refs — these must not be
   * read during render, only inside an event or an updater.
   */
  const activeRef = useRef(activeSystem);
  activeRef.current = activeSystem;
  const activeIdRef = useRef(current.id);
  activeIdRef.current = current.id;

  /**
   * Setters that write through to the active system.
   *
   * These keep the signatures the rest of the component already uses, including
   * functional updates, so that moving four pieces of state into the systems
   * array did not become forty edits at the call sites — each of which would
   * have been a chance to write to the wrong case.
   */
  const patchActive = useCallback((patch: (system: SessionSystem) => SessionSystem): void => {
    setSystems((previous) =>
      previous.map((system, index) => (index === activeRef.current ? patch(system) : system)),
    );
  }, []);

  const setStages = useCallback(
    (value: React.SetStateAction<Stage[]>): void => {
      patchActive((system) => ({
        ...system,
        stages: typeof value === 'function' ? value(system.stages) : value,
      }));
    },
    [patchActive],
  );

  const setDomain = useCallback(
    (value: React.SetStateAction<ChartDomain>): void => {
      patchActive((system) => ({
        ...system,
        domain: typeof value === 'function' ? value(system.domain) : value,
      }));
    },
    [patchActive],
  );

  const setVisibility = useCallback(
    (value: React.SetStateAction<Record<FamilyKey, boolean>>): void => {
      patchActive((system) => ({
        ...system,
        visibility: typeof value === 'function' ? value(system.visibility) : value,
      }));
    },
    [patchActive],
  );

  const setShowProtractor = useCallback(
    (value: React.SetStateAction<boolean>): void => {
      patchActive((system) => ({
        ...system,
        showProtractor: typeof value === 'function' ? value(system.showProtractor) : value,
      }));
    },
    [patchActive],
  );

  const setSelectedStage = useCallback((value: React.SetStateAction<number | null>): void => {
    const id = activeIdRef.current;
    setSystemUi((previous) => {
      const entry = previous[id] ?? EMPTY_UI;
      return {
        ...previous,
        [id]: {
          ...entry,
          selectedStage: typeof value === 'function' ? value(entry.selectedStage) : value,
        },
      };
    });
  }, []);

  /**
   * The weather panel still sees one object, assembled from the shared file and
   * this system's filter. Splitting it here rather than in the panel keeps the
   * panel unaware that there is more than one system to filter for.
   */
  const weather: WeatherState = useMemo(
    () => ({
      file: weatherFile,
      mode: current.weather.mode ?? 'off',
      filter: {
        months: current.weather.months ?? [],
        hours: current.weather.hours ?? [],
      },
      presetIndex: current.weather.presetIndex ?? 0,
      selectedDesignDay: ui.selectedDesignDay,
    }),
    [weatherFile, current.weather, ui.selectedDesignDay],
  );

  /**
   * Put an updated weather state back where its parts belong.
   *
   * The file goes to the shared slot, the hour filter to this system, and the
   * highlighted design day to the session-only record. The functional form
   * reads from this render's assembled state rather than from an updater
   * queue: every caller passes a whole object built from what it can see, and
   * none of them queue two updates in one tick.
   */
  const setWeather = useCallback(
    (value: React.SetStateAction<WeatherState>): void => {
      const next = typeof value === 'function' ? value(weather) : value;
      if (next.file !== weatherFile) setWeatherFile(next.file);
      patchActive((system) => ({
        ...system,
        weather: {
          mode: next.mode,
          months: [...next.filter.months],
          hours: [...next.filter.hours],
          presetIndex: next.presetIndex,
        },
      }));
      setSystemUi((previous) => {
        const entry = previous[current.id] ?? EMPTY_UI;
        return {
          ...previous,
          [current.id]: { ...entry, selectedDesignDay: next.selectedDesignDay },
        };
      });
    },
    [weather, weatherFile, patchActive, current.id],
  );
  /**
   * A topic the user navigated to by clicking a term, which overrides the
   * selected component until they go back. Without it, opening "bypass factor"
   * from the cooling-coil entry would immediately be overwritten by the
   * selection that is still active.
   */
  const [topicOverride, setTopicOverride] = useState<string | null>(null);
  const [walkthroughStep, setWalkthroughStep] = useState<number | null>(null);
  const [meta, setMeta] = useState<ProjectMeta>({});
  /** Problems from opening a project or a share link, shown until dismissed. */
  const [loadProblems, setLoadProblems] = useState<readonly string[]>([]);
  const chartRef = useRef<SVGSVGElement | null>(null);

  /**
   * Light or dark, and who chose it.
   *
   * `resolved` is what the interface is actually painting. The canvas layer
   * needs it as a boolean because a canvas cannot read `var(--…)` — it has to
   * be told which palette applies, and kept in step both when the user presses
   * the toggle and when the system preference changes underneath an unset one.
   */
  const theme = useTheme();
  const dark = theme.resolved === 'dark';

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
  /**
   * Switch unit systems, converting the project rather than only its labels.
   *
   * Every stored number is in one system's units. Changing the labels without
   * changing the values reads 95 °F as 95 °C — off the chart entirely, and
   * solving to nonsense. Everything the project holds converts together: stage
   * parameters, airflows, site altitude, and the comfort inputs.
   */
  const switchUnits = (next: UnitSystem): void => {
    const from = units;
    if (from === next) return;

    // Every system converts, not just the one on screen. Converting only the
    // active case would leave the other one holding °F values under an SI
    // label — numbers that still solve, and are wrong by a factor nobody would
    // notice until the chart was read.
    setSystems((current) =>
      current.map((system) => ({
        ...system,
        stages: convertStages(system.stages, from, next),
        domain: defaultDomain(next),
      })),
    );
    setComfort((current) => convertComfort(current, from, next));
    // Weather hours are stored in the display system too, so they convert with
    // everything else rather than being silently reinterpreted.
    setWeatherFile((current) => (current ? convertHoursTo(current, next) : current));
    setAltitude((current) => convertAltitude(current, from, next));
    setExplicitPressure((current) => {
      const parsed = Number.parseFloat(current);
      if (!Number.isFinite(parsed)) return current;
      // psia ↔ kPa. The field is in display units, not canonical.
      return String(Number((next === 'SI' ? parsed * 6.89476 : parsed / 6.89476).toFixed(3)));
    });

    setUnits(next);
  };

  /**
   * Apply a walkthrough step to the application.
   *
   * Steps are authored in IP and carry the *complete* chain rather than a diff,
   * so stepping backwards restores a step exactly and there is no accumulated
   * state to get wrong. Converting through `convertStages` — the same function
   * the unit toggle uses — means there is one answer to "what is 95 °F in SI",
   * not two that can drift.
   */
  useEffect(() => {
    if (walkthroughStep === null) return;
    const step = WALKTHROUGH.steps[walkthroughStep];
    if (!step) return;

    const declared = [...step.stages];
    setStages(units === 'IP' ? declared : convertStages(declared, 'IP', units));
    setSelectedStage(step.focus ?? null);
    setTopicOverride(null);
    if (step.showProtractor !== undefined) setShowProtractor(step.showProtractor);
    if (step.show) {
      setVisibility((current) => {
        const next = { ...current };
        for (const family of step.show!) next[family] = true;
        return next;
      });
    }
  }, [walkthroughStep, units]);

  /**
   * The whole chain re-solves on every edit. It is a handful of closed-form
   * evaluations per stage, so this is cheaper than tracking which stages went
   * stale — and it means a change can never leave a downstream state showing a
   * value from before the edit.
   */
  const solved = useMemo(
    () =>
      solveSystem(
        { airstreams: [{ id: 'supply', name: 'Supply air', role: 'supply', stages }] },
        atmosphere.pressure,
        units,
      ),
    [stages, units, atmosphere.pressure],
  );

  const supply = solved.airstreams[0]!;

  /**
   * The live design check for every stage.
   *
   * Evaluated here because a rule needs the *entering* condition and mass flow,
   * which are the previous stage's outputs. Recomputing the lot on every edit
   * costs a handful of comparisons and removes any chance of a note surviving
   * the change that made it wrong.
   */
  const advisories = useMemo(
    () =>
      supply.stages.map((solvedStage, index) => {
        const previous = index > 0 ? supply.stages[index - 1]?.result : undefined;
        return runCheck(
          solvedStage.stage.type,
          solvedStage.stage,
          solvedStage.result,
          previous?.state ?? null,
          previous?.massFlow ?? null,
          units,
        );
      }),
    [supply, units],
  );

  const selectedSolved = selectedStage !== null ? supply.stages[selectedStage] : undefined;
  const enteringSolved =
    selectedStage !== null && selectedStage > 0 ? supply.stages[selectedStage - 1]?.result : undefined;

  /** What the education panel is showing: a clicked term wins over the selection. */
  const topicId = topicOverride ?? selectedSolved?.stage.type ?? null;

  /**
   * Comfort zones rebuild whenever any input changes. Each zone is about a
   * hundred bisections of a closed-form model, which is comfortably inside a
   * frame — and recomputing wholesale removes any possibility of a zone drawn
   * for last frame's clothing level.
   */
  const zones = useMemo(
    () => buildZones(comfort, atmosphere.pressure, units),
    [comfort, atmosphere.pressure, units],
  );

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

  /**
   * Turn to another operating case.
   *
   * The hover readout is cleared because it describes a point on the page being
   * turned away from; carrying it across would label the new chart with the old
   * chart's numbers. Selection is *not* cleared — it is kept per system, so
   * turning back finds the component you were reading.
   */
  const flipTo = useCallback((index: number): void => {
    setActiveSystem(index);
    setTopicOverride(null);
  }, []);

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

  /**
   * Everything that survives being saved, in one object.
   *
   * Assembled rather than stored, so there is no second copy of the session to
   * fall out of step with the first. The type lives in `io/project.ts`, which
   * is what couples the App and the file format through one declaration.
   */
  const session: SessionState = useMemo(
    () => ({
      units,
      pressureMode,
      altitude,
      explicitPressure,
      systems,
      activeSystem,
      comfort,
      station: weatherFile
        ? {
            city: weatherFile.location.city,
            state: weatherFile.location.state,
            country: weatherFile.location.country,
            wmo: weatherFile.location.wmo,
            elevation: weatherFile.location.elevation,
          }
        : null,
      meta,
    }),
    [
      units,
      pressureMode,
      altitude,
      explicitPressure,
      systems,
      activeSystem,
      comfort,
      weatherFile,
      meta,
    ],
  );

  /**
   * Adopt a project, from a file or from a link.
   *
   * Everything the file names is replaced wholesale; anything it does not name
   * falls back to a default rather than keeping whatever happened to be on
   * screen. Merging would produce a session that is neither the file the user
   * opened nor the one they had.
   */
  const applyProject = useCallback((text: string): void => {
    const result = readProject(text);
    if (!result.project) {
      setLoadProblems(result.problems);
      return;
    }

    const next = fromProject(result.project);
    setUnits(next.units);
    setPressureMode(next.pressureMode);
    setAltitude(next.altitude);
    setExplicitPressure(next.explicitPressure);
    setSystems(next.systems);
    setActiveSystem(next.activeSystem);
    setComfort(next.comfort);
    setMeta(next.meta);
    // Session state, deliberately reset: a reopened project starts with nothing
    // selected, no design day lit, and no walkthrough running.
    setSystemUi({});
    setTopicOverride(null);
    setWalkthroughStep(null);

    const notes: string[] = [];
    if (result.migrated.length > 0) {
      notes.push(
        `This project was written by an older version and has been upgraded ` +
          `(from schema ${result.migrated.join(', then ')}). Save it to keep the upgrade.`,
      );
    }
    // The weather file is named but never carried — see the schema. Saying so
    // is the difference between "the overlay is missing" and "the overlay needs
    // its file back".
    if (next.station?.city) {
      const station = [next.station.city, next.station.country].filter(Boolean).join(', ');
      notes.push(
        `This project used weather data for ${station}. Weather files are not ` +
          'stored in a project — load the EPW again to restore the overlay.',
      );
    }
    setLoadProblems(notes);
  }, []);

  /**
   * Open a project carried in the URL fragment, once, on first load.
   *
   * The fragment is cleared afterwards so that a later reload does not undo
   * whatever the user has done since — a share link should open a project, not
   * become a permanent reset button.
   */
  useEffect(() => {
    const result = readFragment(window.location.hash);
    if (!result) return;

    if (result.project) {
      applyProject(JSON.stringify(result.project));
    } else {
      setLoadProblems(result.problems);
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [applyProject]);

  /**
   * Keep the crash screen supplied with a project it can hand back.
   *
   * Written from an effect rather than during render, so the stored session is
   * always one that has successfully drawn — see `io/rescue.ts`.
   *
   * **Deliberately no cleanup.** Clearing the holder on unmount is the reflex,
   * and it defeats the entire feature: React unmounts this tree the moment the
   * error boundary catches, so the rescue would be wiped exactly when the crash
   * screen needs it. Found by crashing the app on purpose and pressing the
   * button, which returned nothing.
   */
  useEffect(() => {
    setRescue(() => writeProject(toProject(session)));
  }, [session]);

  /** Selecting a component means "tell me about this", so it wins. */
  const selectStage = useCallback((index: number | null) => {
    setSelectedStage(index);
    setTopicOverride(null);
  }, []);

  return (
    <EducationContext.Provider value={{ openTopic: setTopicOverride }}>
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
        <div className="header-toggles">
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

          {/* Two buttons for three states: no stored preference follows the
              operating system, and pressing either pins it. See ui/theme.ts. */}
          <div className="unit-toggle theme-toggle" role="group" aria-label="Appearance">
            {([
              { choice: 'light' as ThemeChoice, icon: 'sun', label: 'Light' },
              { choice: 'dark' as ThemeChoice, icon: 'moon', label: 'Dark' },
            ]).map(({ choice, icon, label }) => (
              <button
                key={choice}
                type="button"
                className={theme.resolved === choice ? 'active' : ''}
                onClick={() => theme.setPreference(choice)}
                aria-pressed={theme.resolved === choice}
                title={`${label} appearance`}
              >
                <Icon name={icon} size={17} title={`${label} appearance`} />
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="app-body">
        <aside className="panel panel-left">
          {walkthroughStep !== null ? (
            <WalkthroughPanel
              step={walkthroughStep}
              onStep={setWalkthroughStep}
              onExit={() => setWalkthroughStep(null)}
            />
          ) : (
            <button
              type="button"
              className="wt-start"
              onClick={() => setWalkthroughStep(0)}
            >
              <Icon name={WALKTHROUGH.icon} size={26} />
              <span>
                <strong>{WALKTHROUGH.title}</strong>
                <em>Guided walkthrough · {WALKTHROUGH.steps.length} steps</em>
              </span>
            </button>
          )}

          <ChainEditor
            airstreamId="supply"
            stages={stages}
            solved={supply.stages}
            units={units}
            selected={selectedStage}
            onSelect={selectStage}
            onChange={setStages}
            advisories={advisories}
            designDays={weather.file?.design?.days ?? []}
          />

          {/* The education section sits below the system, and its header
              follows the selection — see EducationPanel. */}
          <EducationPanel
            topicId={topicId}
            result={selectedSolved?.result}
            entering={enteringSolved?.state ?? null}
            advisory={selectedStage !== null ? (advisories[selectedStage] ?? null) : null}
            units={units}
            onBack={
              topicOverride && selectedStage !== null ? () => setTopicOverride(null) : undefined
            }
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
          <SystemFlip systems={systems} activeSystem={activeSystem} onFlip={flipTo} />
          <WeatherLayer
            hours={weather.file?.hours ?? []}
            mode={weather.mode}
            domain={domain}
            width={size.width}
            height={size.height}
            dark={dark}
          />
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
            onSelectStage={selectStage}
            onDragState={dragSource}
            comfortZones={zones}
            designDays={weather.file?.design?.days ?? []}
            selectedDesignDay={weather.selectedDesignDay}
            onSelectDesignDay={(kind) => setWeather((current) => ({ ...current, selectedDesignDay: kind }))}
            exportRef={chartRef}
          />
          <p className="chart-hint">Scroll to zoom · drag to pan</p>
        </div>

        <aside className="panel panel-right">
          {loadProblems.length > 0 && (
            <div className="load-notice">
              {loadProblems.map((problem) => (
                <p key={problem}>{problem}</p>
              ))}
              <button type="button" className="reset" onClick={() => setLoadProblems([])}>
                Dismiss
              </button>
            </div>
          )}

          <Collapsible title="Save, share, export" defaultOpen={false}>
            <ExportPanel
              session={session}
              solved={supply}
              units={units}
              atmosphere={atmosphere}
              domain={domain}
              chartRef={chartRef}
              weather={{ hours: weather.file?.hours ?? [], mode: weather.mode }}
              onMetaChange={setMeta}
              onOpen={applyProject}
            />
          </Collapsible>

          <Collapsible
            title="Weather data"
            defaultOpen={false}
            badge={weather.file ? `${weather.file.hours.length.toLocaleString()} h` : undefined}
          >
            <WeatherPanel
              state={weather}
              onChange={(next) => {
                /*
                 * Adopt the station's elevation the moment a file arrives.
                 *
                 * Every hour's humidity ratio is computed at that hour's own
                 * station pressure, so a chart still drawn for sea level puts
                 * every plotted point off the relative-humidity lines it
                 * belongs to. That was previously a button someone had to
                 * find and press, which made the correct reading the optional
                 * one. Site pressure remains editable — the panel says where
                 * the number came from.
                 */
                if (next.file && next.file !== weather.file) {
                  setPressureMode('altitude');
                  setAltitude(Math.round(next.file.location.elevation));
                }
                setWeather(next);
              }}
              units={units}
              zones={zones}
              dark={dark}
            />
          </Collapsible>

          <Collapsible title="Thermal comfort" defaultOpen>
            <ComfortPanel
            settings={comfort}
            onChange={setComfort}
            units={units}
            pressure={atmosphere.pressure}
              zones={zones}
              sample={hover ? { tdb: hover.tdb, rh: hover.rh } : null}
              weather={
                weather.file && weather.file.hours.length > 0
                  ? {
                      hours: weather.file.hours,
                      station: describeLocation(weather.file.location) || 'the loaded file',
                    }
                  : null
              }
            />
          </Collapsible>

          <Collapsible title="Results" defaultOpen>
            <ResultsPanel
              solved={supply}
              units={units}
              selected={selectedStage}
              onSelect={selectStage}
            />
          </Collapsible>

          <Collapsible title="Condition at cursor" defaultOpen>
            <section>
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
          </Collapsible>

          <Collapsible title="Site pressure" defaultOpen={false}>
            <section>
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

            {weather.file && pressureMode === 'altitude' && (
              <p className="comfort-note">
                Set from {describeLocation(weather.file.location) || 'the loaded weather file'}.
                Each hour’s humidity ratio is computed at that hour’s own station
                pressure, so matching the chart to the site keeps the plotted
                points on the relative-humidity lines they belong to. Change it
                above if you are designing for somewhere else.
              </p>
            )}
            </section>
          </Collapsible>

          <Collapsible title="Chart lines" defaultOpen={false}>
            <section>
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
          </Collapsible>

          <Collapsible title="About this tool" defaultOpen={false}>
            <AboutPanel />
          </Collapsible>

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
    </EducationContext.Provider>
  );
}
