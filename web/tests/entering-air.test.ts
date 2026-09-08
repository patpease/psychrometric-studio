/**
 * The entering condition, and the one property that fixes its moisture.
 *
 * Dry bulb is always an input. Relative humidity, wet bulb and dew point are
 * three ways of naming the *same* second property, so a source stage carries
 * exactly one of them and the other two are results. Storing two is a
 * contradiction: the engine picks one by a fixed priority, and the other sits
 * in its field looking like an input while doing nothing.
 *
 * That is the bug these tests pin. Typing a wet bulb over a stage that already
 * held a relative humidity used to leave both behind — the results table went
 * on reporting the old wet bulb while the wet bulb box showed the new one.
 */
import { describe, it, expect } from 'vitest';
import { sourceModel } from '../src/processes/models/source.js';
import { withParams } from '../src/ui/stageFields.js';
import { fromProject, readProject, toProject, writeProject, blankSystem } from '../src/io/project.js';
import { defaultComfortSettings } from '../src/ui/ComfortPanel.js';
import { standardAtmosphere } from '../src/psych/atmosphere.js';
import type { UnitSystem } from '../src/psych/units.js';
import { convertStages } from '../src/ui/convertProject.js';
import type { SessionState } from '../src/io/project.js';
import type { Stage } from '../src/types/project.js';

const PRESSURE = standardAtmosphere('IP').pressure;

/** Solve a source stage's parameters straight through the model. */
function enteringState(params: Record<string, unknown>, units: UnitSystem = 'IP') {
  const pressure = units === 'IP' ? PRESSURE : standardAtmosphere('SI').pressure;
  const context = { pressure, units, airflow: 2000 };
  return sourceModel.apply(context as never, sourceModel.parseParams(params, units)).state;
}

function sourceStage(params: Record<string, number>): Stage {
  return { id: 'oa', type: 'source', airflow: 500, params };
}

function sessionWith(stages: Stage[]): SessionState {
  return {
    units: 'IP',
    pressureMode: 'sea-level',
    altitude: 0,
    explicitPressure: '',
    systems: [blankSystem('cooling', 'IP', stages)],
    activeSystem: 0,
    comfort: defaultComfortSettings('IP'),
    station: null,
    meta: { name: 'Entering air' },
  };
}

/* -------------------------------------------------------------------------- */

describe('solving the entering condition', () => {
  it('takes a wet bulb as the input when that is what is stored', () => {
    const state = enteringState({ tdb: 95, twb: 70 });
    expect(state.twb).toBeCloseTo(70, 2);
  });

  it('takes a dew point as the input when that is what is stored', () => {
    const state = enteringState({ tdb: 95, tdp: 60 });
    expect(state.tdp).toBeCloseTo(60, 2);
  });

  /**
   * The three properties have to agree with each other, not merely be
   * reported. Entering a wet bulb and reading back the relative humidity it
   * implies must land on the same state as entering that relative humidity.
   */
  it('gives the same state whichever of the three names it', () => {
    const fromTwb = enteringState({ tdb: 95, twb: 70 });
    const fromRh = enteringState({ tdb: 95, rh: fromTwb.rh });
    const fromTdp = enteringState({ tdb: 95, tdp: fromTwb.tdp });

    for (const state of [fromRh, fromTdp]) {
      expect(state.twb).toBeCloseTo(fromTwb.twb, 1);
      expect(state.w).toBeCloseTo(fromTwb.w, 6);
    }
  });
});

describe('writing the entering condition', () => {
  const withRh = sourceStage({ tdb: 95, rh: 0.4 });

  it('clears the relative humidity when a wet bulb is typed', () => {
    const next = withParams(withRh, { twb: 70 });
    expect(next.params).toEqual({ tdb: 95, twb: 70 });
    expect(enteringState(next.params!).twb).toBeCloseTo(70, 2);
  });

  it('clears the relative humidity when a dew point is typed', () => {
    const next = withParams(withRh, { tdp: 60 });
    expect(next.params).toEqual({ tdb: 95, tdp: 60 });
    expect(enteringState(next.params!).tdp).toBeCloseTo(60, 2);
  });

  it('clears a wet bulb when the relative humidity is typed back', () => {
    const viaTwb = withParams(withRh, { twb: 70 });
    expect(withParams(viaTwb, { rh: 0.5 }).params).toEqual({ tdb: 95, rh: 0.5 });
  });

  it('leaves the dry bulb alone, because it is always an input', () => {
    expect(withParams(withRh, { tdb: 90 }).params).toEqual({ tdb: 90, rh: 0.4 });
  });

  /**
   * Emptying a field means "I no longer specify this", not "discard the others
   * too". The stage is then under-specified, and the solver says so by name —
   * which is the honest outcome, not a state invented on the user's behalf.
   */
  it('clears only its own field when a value is removed', () => {
    const twoStep = withParams(withParams(withRh, { twb: 70 }), { twb: undefined });
    expect(twoStep.params).toEqual({ tdb: 95 });
    expect(() => enteringState(twoStep.params!)).toThrow(/dry bulb plus one/);
  });

  it('does not apply the rule to stages that have no such group', () => {
    const coil: Stage = { id: 'cc', type: 'cooling', params: { tdbOut: 54, rhOut: 0.93 } };
    expect(withParams(coil, { rhOut: 0.9 }).params).toEqual({ tdbOut: 54, rhOut: 0.9 });
  });

  /**
   * Two other paths write these parameters: choosing an ASHRAE design
   * condition, and dragging the state point around the chart. Both write dry
   * bulb and relative humidity together, and both would be defeated by a wet
   * bulb left over from manual entry — the point would simply refuse to move.
   */
  it('lets a dry bulb and relative humidity written together win outright', () => {
    const typed = withParams(sourceStage({ tdb: 95, twb: 70 }), { tdb: 91.4, rh: 0.42 });
    expect(typed.params).toEqual({ tdb: 91.4, rh: 0.42 });
  });
});

describe('reading a project that names its moisture twice', () => {
  /**
   * Files written while the bug was live carry both properties. The one the
   * solver used is kept, so the project opens to the numbers it has always
   * shown; the inert one is dropped rather than left on screen as an input.
   */
  it('keeps the property that decided the answer and drops the rest', () => {
    const legacy = sessionWith([sourceStage({ tdb: 95, rh: 0.4, twb: 70, tdp: 60 })]);
    const reopened = fromProject(readProject(writeProject(toProject(legacy))).project!);
    const stage = reopened.systems[0]!.stages[0]!;

    expect(stage.params).toEqual({ tdb: 95, rh: 0.4 });
  });

  it('carries a wet-bulb-defined source through save and load untouched', () => {
    const original = sessionWith([sourceStage({ tdb: 95, twb: 70 })]);
    const reopened = fromProject(readProject(writeProject(toProject(original))).project!);

    expect(reopened.systems[0]!.stages[0]!.params).toEqual({ tdb: 95, twb: 70 });
  });
});

describe('switching units with a wet bulb as the input', () => {
  /**
   * Wet bulb and dew point are temperatures and have to convert like the dry
   * bulb beside them. If they did not, a source defined by wet bulb would
   * quietly become a different condition the moment someone pressed SI —
   * which is exactly the failure the relative-humidity-only editor hid.
   */
  it('converts the wet bulb and lands on the same physical state', () => {
    const ip = sourceStage({ tdb: 95, twb: 70 });
    const [si] = convertStages([ip], 'IP', 'SI');

    expect(si!.params!['twb']).toBeCloseTo(21.11, 1);
    expect(si!.params!['tdb']).toBeCloseTo(35, 1);

    const inIp = enteringState(ip.params!);
    const inSi = enteringState(si!.params!, 'SI');

    // Same air, described twice: the humidity ratio is dimensionless either way.
    expect(inSi.w).toBeCloseTo(inIp.w, 4);
  });
});
