/**
 * The chains a new project opens with must close their own loop.
 *
 * Each starter mixes outdoor air with return air at a *declared* condition, and
 * then works that mixture around to the room. If the air leaving the room is
 * not the air the mixing box said was coming back, the example contradicts
 * itself — and it is the first psychrometrics most users of this tool will
 * read. That failure is silent on the chart: the drawing looks perfectly
 * plausible while teaching a system that cannot exist.
 *
 * So the closure is asserted rather than trusted. These tolerances are not
 * arbitrary: they are what the chains achieve today, and tightening the numbers
 * is welcome while loosening the bound should require an argument.
 */
import { describe, expect, it } from 'vitest';
import { solveSystem } from '../src/processes/chain.js';
import { standardAtmosphere } from '../src/psych/atmosphere.js';
import { STARTER_COOLING, STARTER_HEATING } from '../src/ui/starters.js';
import type { Stage } from '../src/types/project.js';

const PRESSURE = standardAtmosphere('IP').pressure;

function solve(stages: Stage[]) {
  const solved = solveSystem(
    { airstreams: [{ id: 'supply', name: 'Supply air', stages }] },
    PRESSURE,
    'IP',
  );
  return solved.airstreams[0]!;
}

/** What the mixing box says is coming back from the room. */
function declaredReturn(stages: Stage[]): { tdb: number; rh: number } {
  const mixing = stages.find((stage) => stage.type === 'mixing');
  const params = mixing?.params as { tdb2?: number; rh2?: number } | undefined;
  if (params?.tdb2 === undefined || params.rh2 === undefined) {
    throw new Error('the starter has no mixing box to close against');
  }
  return { tdb: params.tdb2, rh: params.rh2 };
}

describe.each([
  ['cooling', STARTER_COOLING, 0.7, 0.005],
  ['heating', STARTER_HEATING, 0.02, 0.0005],
])('the %s starter', (_name, stages, tdbTolerance, rhTolerance) => {
  const chain = solve(stages);

  it('solves every stage', () => {
    for (const stage of chain.stages) {
      expect(stage.error, `${stage.stage.id}: ${stage.error ?? ''}`).toBeUndefined();
      expect(stage.result).toBeDefined();
    }
  });

  it('closes its loop back to the declared return air', () => {
    const declared = declaredReturn(stages);
    const leaving = chain.terminal;
    expect(leaving).not.toBeNull();
    expect(Math.abs(leaving!.tdb - declared.tdb)).toBeLessThanOrEqual(tdbTolerance);
    expect(Math.abs(leaving!.rh - declared.rh)).toBeLessThanOrEqual(rhTolerance);
  });
});

describe('the two starters describe the same air handler', () => {
  it('moves the same air through the same equipment', () => {
    // The point of the second page is that one machine reads differently in
    // winter, not that it is a different machine. Airflows and the mixing split
    // therefore match, and only the conditions and the coil differ.
    const flowOf = (stages: Stage[]) => stages.find((s) => s.type === 'source')?.airflow;
    const returnFlowOf = (stages: Stage[]) =>
      (stages.find((s) => s.type === 'mixing')?.params as { airflow2?: number } | undefined)
        ?.airflow2;

    expect(flowOf(STARTER_HEATING)).toBe(flowOf(STARTER_COOLING));
    expect(returnFlowOf(STARTER_HEATING)).toBe(returnFlowOf(STARTER_COOLING));
  });

  it('carries the same occupancy through both cases', () => {
    // Same building, same people. Only the weather and the coil change, which
    // is the whole point of showing them as two pages of one system.
    const latentOf = (stages: Stage[]) =>
      (stages.find((s) => s.type === 'room')?.params as { latent?: number } | undefined)?.latent;
    expect(latentOf(STARTER_HEATING)).toBe(latentOf(STARTER_COOLING));
  });

  it('leaves the winter space to find its own humidity', () => {
    // There is no humidifier, because most buildings do not have one. The
    // chart is more useful for showing what that means: outdoor air at 5 °F is
    // nearly dry, and the space settles on whatever its occupants give off.
    expect(STARTER_HEATING.some((stage) => stage.type.startsWith('humidifier'))).toBe(false);

    const solved = solve(STARTER_HEATING);
    const mixed = solved.stages[1]!.result!.state;
    const room = solved.terminal!;
    // The only moisture added anywhere in the chain is the room's own.
    expect(room.w).toBeGreaterThan(mixed.w);
    // And it lands in the range winter dryness is actually complained about.
    expect(room.rh).toBeGreaterThan(0.25);
    expect(room.rh).toBeLessThan(0.33);
  });
});
