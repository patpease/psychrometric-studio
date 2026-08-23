/**
 * The chain solver.
 *
 * An airstream is an ordered list of stages; each takes the leaving state of
 * the previous one. A project may hold several airstreams, and a stage may
 * reference another stream through a coupling — which means the streams have a
 * dependency order, resolved here.
 *
 * Solving never throws for a bad stage. A chain that fails halfway is still
 * worth showing up to the point it failed, with the error attached to the stage
 * that caused it: an engineer debugging a system needs to see how far it got.
 */
import type { MoistAirState } from '../psych/state.js';
import type { UnitSystem } from '../psych/units.js';
import { duty as dutyFromEnthalpy } from '../psych/units.js';
import type { Airstream, Project, Stage } from '../types/project.js';
import { MODELS } from './registry.js';
import type { CouplingRole } from '../types/project.js';
import { ProcessError, type DutySplit, type StageResult } from './types.js';

/** What a solved airstream exposes to stages in other airstreams. */
interface ResolvedAirstream {
  terminal: MoistAirState | null;
  terminalResult: StageResult | undefined;
  terminalMassFlow: number | null;
  byStage: Map<string, MoistAirState>;
  resultByStage: Map<string, StageResult>;
  massFlowByStage: Map<string, number>;
}

/** A stage after solving — either a result or the reason there isn't one. */
export interface SolvedStage {
  readonly stage: Stage;
  readonly displayName: string;
  readonly index: number;
  readonly result?: StageResult;
  readonly error?: string;
}

export interface SolvedAirstream {
  readonly airstream: Airstream;
  readonly stages: readonly SolvedStage[];
  /** The final leaving state, or `null` if the chain never got that far. */
  readonly terminal: MoistAirState | null;
  readonly terminalMassFlow: number | null;
}

export interface SolvedProject {
  readonly airstreams: readonly SolvedAirstream[];
  readonly units: UnitSystem;
  readonly pressure: number;
  /** Problems with the project as a whole, rather than with one stage. */
  readonly errors: readonly string[];
}

/**
 * Order the airstreams so that every coupled stream is solved before the stream
 * that references it.
 *
 * A cycle is reported rather than left to loop or to silently use a stale
 * state. Passive circuits that genuinely close a loop — the paired legs of a
 * wrap-around coil — arrive in Phase 4 and will need solving simultaneously,
 * not sequentially; this function's job is to make that distinction visible
 * instead of producing a plausible wrong answer.
 */
function orderAirstreams(airstreams: readonly Airstream[]): {
  order: Airstream[];
  errors: string[];
} {
  const byId = new Map(airstreams.map((stream) => [stream.id, stream]));
  const dependencies = new Map<string, Set<string>>();

  for (const stream of airstreams) {
    const deps = new Set<string>();
    for (const stage of stream.stages) {
      for (const coupling of stage.couplings ?? []) {
        if (coupling.airstreamId !== stream.id) deps.add(coupling.airstreamId);
      }
    }
    dependencies.set(stream.id, deps);
  }

  const order: Airstream[] = [];
  const solved = new Set<string>();
  const errors: string[] = [];

  let progressed = true;
  while (progressed && order.length < airstreams.length) {
    progressed = false;
    for (const stream of airstreams) {
      if (solved.has(stream.id)) continue;
      const deps = dependencies.get(stream.id) ?? new Set();
      const ready = [...deps].every((id) => solved.has(id) || !byId.has(id));
      if (ready) {
        order.push(stream);
        solved.add(stream.id);
        progressed = true;
      }
    }
  }

  if (order.length < airstreams.length) {
    const stuck = airstreams.filter((stream) => !solved.has(stream.id)).map((s) => s.name);
    errors.push(
      `Circular coupling between airstreams: ${stuck.join(', ')}. Streams that ` +
        'depend on each other must be solved together, which this solver does not ' +
        'yet do.',
    );
    // Solve what can be solved rather than abandoning the project entirely.
    for (const stream of airstreams) if (!solved.has(stream.id)) order.push(stream);
  }

  // Unknown coupling targets are worth naming explicitly; the stage would
  // otherwise fail with a vague "needs a second stream".
  for (const stream of airstreams) {
    for (const id of dependencies.get(stream.id) ?? []) {
      if (!byId.has(id)) {
        errors.push(`"${stream.name}" is coupled to airstream "${id}", which does not exist.`);
      }
    }
  }

  return { order, errors };
}

function solveAirstream(
  airstream: Airstream,
  pressure: number,
  units: UnitSystem,
  resolved: Map<string, ResolvedAirstream>,
  localResults: Map<string, StageResult>,
  localMassFlow: Map<string, number>,
): SolvedAirstream {
  const stages: SolvedStage[] = [];
  let entering: MoistAirState | null = null;
  let massFlow: number | null = null;
  const byStage = new Map<string, MoistAirState>();

  airstream.stages.forEach((stage, index) => {
    const model = MODELS[stage.type];
    const displayName = stage.name ?? model?.displayName ?? stage.type;

    if (!model) {
      stages.push({
        stage,
        index,
        displayName,
        error: `No model for stage type "${stage.type}". It may belong to a later phase.`,
      });
      return;
    }

    // Resolve coupled states before solving, so a missing one fails clearly.
    const couplings: Partial<Record<CouplingRole, MoistAirState>> = {};
    const couplingResults: Partial<Record<CouplingRole, StageResult>> = {};
    const couplingMassFlow: Partial<Record<CouplingRole, number>> = {};
    let couplingError: string | undefined;

    for (const coupling of stage.couplings ?? []) {
      // A coupling may point at this same airstream — the two legs of a
      // wrap-around coil do — in which case the target is whatever has been
      // solved so far in this pass rather than a finished airstream.
      const sameStream = coupling.airstreamId === airstream.id;
      const target = resolved.get(coupling.airstreamId);

      if (!sameStream && !target) {
        couplingError = `Coupled airstream "${coupling.airstreamId}" has not been solved.`;
        break;
      }

      let state: MoistAirState | undefined;
      let result: StageResult | undefined;
      let flow: number | undefined;

      if (sameStream) {
        if (!coupling.stageId) {
          couplingError =
            'A coupling within the same airstream must name the stage it pairs with.';
          break;
        }
        result = localResults.get(coupling.stageId);
        state = result?.state;
        flow = localMassFlow.get(coupling.stageId);
        if (!result) {
          couplingError =
            `Stage "${coupling.stageId}" has not been solved yet. A paired stage ` +
            'must come earlier in the chain than the stage that references it.';
          break;
        }
      } else {
        state = coupling.stageId
          ? target!.byStage.get(coupling.stageId)
          : (target!.terminal ?? undefined);
        result = coupling.stageId ? target!.resultByStage.get(coupling.stageId) : target!.terminalResult;
        flow = coupling.stageId
          ? target!.massFlowByStage.get(coupling.stageId)
          : (target!.terminalMassFlow ?? undefined);
        if (!state) {
          couplingError = coupling.stageId
            ? `Stage "${coupling.stageId}" in airstream "${coupling.airstreamId}" produced no state.`
            : `Airstream "${coupling.airstreamId}" produced no final state.`;
          break;
        }
      }

      if (!state) {
        couplingError = `Coupling "${coupling.role}" resolved to no state.`;
        break;
      }

      couplings[coupling.role] = state;
      if (result) couplingResults[coupling.role] = result;
      if (flow !== undefined) couplingMassFlow[coupling.role] = flow;
    }

    if (couplingError) {
      stages.push({ stage, index, displayName, error: couplingError });
      entering = null;
      massFlow = null;
      return;
    }

    try {
      const params = model.parseParams(stage.params, units);
      const result = model.apply(
        {
          entering,
          upstreamMassFlow: massFlow,
          pressure,
          units,
          airflow: stage.airflow,
          couplings,
          couplingResults,
          couplingMassFlow,
        },
        params,
      );

      stages.push({ stage, index, displayName, result });
      entering = result.state;
      massFlow = result.massFlow;
      byStage.set(stage.id, result.state);
      localResults.set(stage.id, result);
      localMassFlow.set(stage.id, result.massFlow);
    } catch (error) {
      const message =
        error instanceof ProcessError || error instanceof Error
          ? error.message
          : 'Unknown error solving this stage.';
      stages.push({ stage, index, displayName, error: message });
      // Downstream stages cannot be solved without an entering state, and
      // guessing one would produce numbers that look real.
      entering = null;
      massFlow = null;
    }
  });

  return {
    airstream,
    stages,
    terminal: entering,
    terminalMassFlow: massFlow,
  };
}

/** Solve every airstream in a project. */
export function solveProject(
  project: Project,
  pressure: number,
  units: UnitSystem,
): SolvedProject {
  const { order, errors } = orderAirstreams(project.airstreams);
  const resolved = new Map<string, ResolvedAirstream>();
  const results = new Map<string, SolvedAirstream>();

  for (const airstream of order) {
    // Within-stream couplings — the two legs of a wrap-around coil — read from
    // these as the chain is solved, so they are built per airstream.
    const localResults = new Map<string, StageResult>();
    const localMassFlow = new Map<string, number>();

    const solved = solveAirstream(airstream, pressure, units, resolved, localResults, localMassFlow);
    results.set(airstream.id, solved);

    const byStage = new Map<string, MoistAirState>();
    const resultByStage = new Map<string, StageResult>();
    const massFlowByStage = new Map<string, number>();
    let terminalResult: StageResult | undefined;

    for (const stage of solved.stages) {
      if (!stage.result) continue;
      byStage.set(stage.stage.id, stage.result.state);
      resultByStage.set(stage.stage.id, stage.result);
      massFlowByStage.set(stage.stage.id, stage.result.massFlow);
      terminalResult = stage.result;
    }

    resolved.set(airstream.id, {
      terminal: solved.terminal,
      terminalResult,
      terminalMassFlow: solved.terminalMassFlow,
      byStage,
      resultByStage,
      massFlowByStage,
    });
  }

  return {
    // Return in the project's own order, not the solve order — the UI should
    // show the airstreams where the user put them.
    airstreams: project.airstreams.map((stream) => results.get(stream.id)!).filter(Boolean),
    units,
    pressure,
    errors,
  };
}

/* -------------------------------------------------------------------------- *
 * Energy balance — the Phase 2 gate
 * -------------------------------------------------------------------------- */

export interface EnergyBalance {
  /** Energy entering with all source and mixed-in airstreams, MBH | kW. */
  readonly energyIn: number;
  /** Net duty added by all stages, MBH | kW. */
  readonly dutyAdded: number;
  /** Energy leaving with the terminal airstream, MBH | kW. */
  readonly energyOut: number;
  /** `energyOut − (energyIn + dutyAdded)`. Should be zero. */
  readonly residual: number;
  /** Residual as a fraction of the larger of energy in or out. */
  readonly relativeResidual: number;
  readonly closes: boolean;
}

/**
 * Check that an airstream conserves energy.
 *
 * Every joule leaving with the air must have arrived either with an entering
 * airstream or through a stage's duty:
 *
 *     m_out · h_out  =  Σ (m · h) entering  +  Σ duty
 *
 * Mixing makes this non-trivial — mass flow changes mid-chain, so a naïve
 * `Σ duty` comparison against the end states would not close. The second stream
 * is counted as energy in, at its own mass flow.
 *
 * A residual that fails to close means a process model is creating or
 * destroying energy, which is exactly the class of bug that produces a
 * plausible-looking chart and a wrong coil selection.
 */
export function checkEnergyBalance(
  solved: SolvedAirstream,
  units: UnitSystem,
  tolerance = 1e-6,
): EnergyBalance | null {
  const stages = solved.stages.filter((stage) => stage.result);
  if (stages.length === 0 || !solved.terminal || solved.terminalMassFlow === null) return null;

  let energyIn = 0;
  let dutyAdded = 0;

  for (const [position, stage] of stages.entries()) {
    const result = stage.result!;

    if (position === 0) {
      // The source brings its own air in.
      energyIn += dutyFromEnthalpy(result.massFlow, result.state.h, units);
    }

    dutyAdded += result.duty.total;

    // A mixing box adds a second airstream: its energy enters here, carried by
    // the mass flow the stage gained.
    for (const auxiliary of result.auxiliary ?? []) {
      const upstream = position > 0 ? stages[position - 1]!.result!.massFlow : 0;
      const added = result.massFlow - upstream;
      if (added > 0) {
        energyIn += dutyFromEnthalpy(added, auxiliary.state.h, units);
      }
    }
  }

  const energyOut = dutyFromEnthalpy(solved.terminalMassFlow, solved.terminal.h, units);
  const residual = energyOut - (energyIn + dutyAdded);
  const scale = Math.max(Math.abs(energyIn), Math.abs(energyOut), 1e-12);

  return {
    energyIn,
    dutyAdded,
    energyOut,
    residual,
    relativeResidual: residual / scale,
    closes: Math.abs(residual / scale) <= tolerance,
  };
}

/** Totals across a whole solved airstream, for the summary panel. */
export interface SystemTotals {
  readonly cooling: number;
  readonly heating: number;
  readonly humidification: number;
  readonly dehumidification: number;
  readonly netDuty: DutySplit;
}

export function systemTotals(solved: SolvedAirstream): SystemTotals {
  let cooling = 0;
  let heating = 0;
  let humidification = 0;
  let dehumidification = 0;
  let total = 0;
  let sensible = 0;
  let latent = 0;

  for (const stage of solved.stages) {
    const result = stage.result;
    if (!result) continue;

    // Skip the source: bringing air in is not a duty on the system.
    if (stage.index === 0 && result.duty.total === 0) continue;

    if (result.duty.total < 0) cooling += result.duty.total;
    if (result.duty.total > 0) heating += result.duty.total;
    if (result.moistureRate > 0) humidification += result.moistureRate;
    if (result.moistureRate < 0) dehumidification += result.moistureRate;

    total += result.duty.total;
    sensible += result.duty.sensible;
    latent += result.duty.latent;
  }

  return {
    cooling,
    heating,
    humidification,
    dehumidification,
    netDuty: {
      total,
      sensible,
      latent,
      shr: total === 0 ? Number.NaN : sensible / total,
    },
  };
}
