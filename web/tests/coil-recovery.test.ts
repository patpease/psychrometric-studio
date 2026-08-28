/**
 * Phase 4 gate: the no-ADP case and the recovery balance guards are proven.
 *
 * Both are degenerate-condition tests. The apparatus dew point does not always
 * exist, and a passive recovery circuit must conserve energy across two
 * airstreams; a model that returns a plausible number in either case is worse
 * than one that refuses.
 */
import { describe, it, expect } from 'vitest';
import { solveCoil, leavingFromAdp } from '../src/processes/coil.js';
import { solveSystem, MODELS } from '../src/processes/index.js';
import { fromTdbRh } from '../src/psych/state.js';
import { lib } from '../src/psych/psychrolib.js';
import { DEFAULTS, duty as dutyOf, type UnitSystem } from '../src/psych/units.js';
import type { Airstream, Stage } from '../src/types/project.js';

const IP = DEFAULTS.IP.standardPressure;
const SI = DEFAULTS.SI.standardPressure;

function solveOne(stages: Stage[], units: UnitSystem = 'IP', extra: Airstream[] = []) {
  const pressure = units === 'IP' ? IP : SI;
  return solveSystem(
    { airstreams: [{ id: 'supply', name: 'Supply', stages }, ...extra] },
    pressure,
    units,
  );
}

function resultAt(solved: ReturnType<typeof solveOne>, index: number, stream = 0) {
  const stage = solved.airstreams[stream]!.stages[index]!;
  if (stage.error) throw new Error(`stage ${index} (${stage.displayName}): ${stage.error}`);
  return stage.result!;
}

describe('apparatus dew point', () => {
  const entering = fromTdbRh(80, 0.5, IP, 'IP');

  it('lies on the saturation curve', () => {
    const leaving = fromTdbRh(55, 0.92, IP, 'IP');
    const coil = solveCoil(entering, leaving, IP, 'IP');

    expect(coil.adp).not.toBeNull();
    const wSat = lib('IP').GetSatHumRatio(coil.adp!, IP);
    expect(coil.adpState!.w).toBeCloseTo(wSat, 9);
    expect(coil.adpState!.rh).toBeCloseTo(1, 5);
  });

  it('is collinear with the entering and leaving states', () => {
    // The defining geometry: extending the process line reaches the ADP.
    const leaving = fromTdbRh(55, 0.92, IP, 'IP');
    const coil = solveCoil(entering, leaving, IP, 'IP');

    const processSlope = (entering.w - leaving.w) / (entering.tdb - leaving.tdb);
    const adpSlope = (entering.w - coil.adpState!.w) / (entering.tdb - coil.adp!);
    expect(adpSlope).toBeCloseTo(processSlope, 8);
  });

  it('sits below the leaving temperature', () => {
    const leaving = fromTdbRh(55, 0.92, IP, 'IP');
    const coil = solveCoil(entering, leaving, IP, 'IP');
    expect(coil.adp!).toBeLessThan(leaving.tdb);
  });

  it('gives the same bypass factor along temperature and humidity ratio', () => {
    // Both are linear in the line's parameter, so they agree to machine
    // precision. If they diverge, the ADP is not on the process line.
    const leaving = fromTdbRh(55, 0.92, IP, 'IP');
    const coil = solveCoil(entering, leaving, IP, 'IP');
    const adp = coil.adpState!;

    const byT = (leaving.tdb - coil.adp!) / (entering.tdb - coil.adp!);
    const byW = (leaving.w - adp.w) / (entering.w - adp.w);

    expect(coil.bypassFactor).toBeCloseTo(byT, 12);
    expect(byW).toBeCloseTo(byT, 8);
  });

  it('bypass factor along enthalpy differs slightly, and that is physics', () => {
    // Textbooks treat T, W, and h as interchangeable for bypass factor. Two of
    // them are exactly so; enthalpy is not, because
    // h = cp·T + W·(hg + cpv·T) carries a T·W cross term and so varies
    // bilinearly along a line that is straight in (T, W). The gap is about
    // 0.3% — immaterial in practice, but not zero, and worth knowing before
    // someone "fixes" a solver to make them match.
    const leaving = fromTdbRh(55, 0.92, IP, 'IP');
    const coil = solveCoil(entering, leaving, IP, 'IP');
    const adp = coil.adpState!;

    const byT = (leaving.tdb - coil.adp!) / (entering.tdb - coil.adp!);
    const byH = (leaving.h - adp.h) / (entering.h - adp.h);

    expect(byH).not.toBeCloseTo(byT, 6);
    expect(Math.abs(byH - byT) / byT).toBeLessThan(0.01);
  });

  it('reports a bypass factor between 0 and 1', () => {
    const leaving = fromTdbRh(55, 0.92, IP, 'IP');
    const coil = solveCoil(entering, leaving, IP, 'IP');
    expect(coil.bypassFactor!).toBeGreaterThan(0);
    expect(coil.bypassFactor!).toBeLessThan(1);
    expect(coil.contactFactor!).toBeCloseTo(1 - coil.bypassFactor!, 12);
  });

  it('inverts: ADP and bypass factor reproduce the leaving state', () => {
    const leaving = fromTdbRh(55, 0.92, IP, 'IP');
    const coil = solveCoil(entering, leaving, IP, 'IP');
    const rebuilt = leavingFromAdp(entering, coil.adp!, coil.bypassFactor!, IP, 'IP');

    expect(rebuilt.tdb).toBeCloseTo(leaving.tdb, 6);
    expect(rebuilt.w).toBeCloseTo(leaving.w, 9);
  });

  it('a purely sensible coil has its ADP at the entering dew point', () => {
    // With no moisture removed the process line is horizontal, and extending it
    // meets saturation exactly where the entering air would condense.
    const leaving = fromTdbRh(
      65,
      lib('IP').GetRelHumFromHumRatio(65, entering.w, IP),
      IP,
      'IP',
    );
    const coil = solveCoil(entering, leaving, IP, 'IP');
    expect(coil.adp!).toBeCloseTo(entering.tdp, 2);
  });

  it('works in SI', () => {
    const enteringSI = fromTdbRh(27, 0.5, SI, 'SI');
    const leavingSI = fromTdbRh(13, 0.92, SI, 'SI');
    const coil = solveCoil(enteringSI, leavingSI, SI, 'SI');

    expect(coil.adp).not.toBeNull();
    expect(coil.adp!).toBeLessThan(13);
    expect(coil.bypassFactor!).toBeGreaterThan(0);
    expect(coil.bypassFactor!).toBeLessThan(1);
  });
});

describe('the no-ADP guard — the Phase 4 gate', () => {
  const entering = fromTdbRh(80, 0.5, IP, 'IP');

  it('refuses when the process line never reaches saturation', () => {
    // Only 5 °F of cooling but a large moisture removal: the process line falls
    // faster than the saturation curve does, so extending it never meets the
    // curve. No real coil delivers this, and there is no apparatus dew point.
    // A naive solver returns its last guess here, which looks like an answer.
    const steep = fromTdbRh(75, 0.32, IP, 'IP');
    const coil = solveCoil(entering, steep, IP, 'IP');

    expect(coil.adp).toBeNull();
    expect(coil.bypassFactor).toBeNull();
    expect(coil.contactFactor).toBeNull();
    expect(coil.problem).toMatch(/never reaches the saturation curve/);
  });

  it('refuses when nothing happened', () => {
    const coil = solveCoil(entering, entering, IP, 'IP');
    expect(coil.adp).toBeNull();
    expect(coil.problem).toMatch(/no process line to extend/);
  });

  it('refuses when the air is heated rather than cooled', () => {
    const warmer = fromTdbRh(90, 0.4, IP, 'IP');
    const coil = solveCoil(entering, warmer, IP, 'IP');
    expect(coil.adp).toBeNull();
    expect(coil.problem).toMatch(/not a cooling process/);
  });

  it('never returns a number without a valid construction behind it', () => {
    // Sweep a range of leaving conditions; every one either produces a fully
    // consistent construction or none at all. There is no in-between.
    for (let tdbOut = 40; tdbOut <= 79; tdbOut += 1) {
      for (const rhOut of [0.5, 0.7, 0.9, 0.98]) {
        const leaving = fromTdbRh(tdbOut, rhOut, IP, 'IP');
        const coil = solveCoil(entering, leaving, IP, 'IP');

        if (coil.adp === null) {
          expect(coil.bypassFactor, `${tdbOut}/${rhOut}`).toBeNull();
          expect(coil.problem, `${tdbOut}/${rhOut}`).toBeTruthy();
          continue;
        }

        // A returned ADP must be on the saturation curve and on the line.
        const wSat = lib('IP').GetSatHumRatio(coil.adp, IP);
        expect(coil.adpState!.w, `${tdbOut}/${rhOut}`).toBeCloseTo(wSat, 9);
        expect(Number.isFinite(coil.bypassFactor!), `${tdbOut}/${rhOut}`).toBe(true);
      }
    }
  });
});

describe('cooling coil reports its construction', () => {
  it('exposes ADP and bypass factor alongside the duty', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 80, rh: 0.5 } },
      { id: 'cc', type: 'cooling', params: { tdbOut: 55, rhOut: 0.92 } },
    ]);
    const result = resultAt(solved, 1);
    expect(result.coil?.adp).not.toBeNull();
    expect(result.coil?.bypassFactor).toBeGreaterThan(0);
  });
});

describe('energy recovery', () => {
  const EXHAUST: Airstream[] = [
    {
      id: 'exhaust',
      name: 'Exhaust',
      role: 'exhaust',
      stages: [{ id: 'ra', type: 'source', airflow: 2000, params: { tdb: 75, rh: 0.5 } }],
    },
  ];

  const withWheel = (type: Stage['type'], params: Record<string, unknown>): Stage => ({
    id: 'hr',
    type,
    params,
    couplings: [{ role: 'exchange-stream', airstreamId: 'exhaust' }],
  });

  it('a sensible wheel moves temperature but not moisture', () => {
    const solved = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-wheel-sensible', { sensible: 0.75 }),
      ],
      'IP',
      EXHAUST,
    );

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);

    // 95 °F toward 75 °F at 75% effectiveness: 95 − 0.75 × 20 = 80 °F.
    expect(leaving.state.tdb).toBeCloseTo(80, 1);
    expect(leaving.state.w).toBeCloseTo(entering.state.w, 12);
    expect(leaving.moistureRate).toBe(0);
  });

  it('an enthalpy wheel moves both', () => {
    const solved = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-wheel-enthalpy', { sensible: 0.75, latent: 0.65 }),
      ],
      'IP',
      EXHAUST,
    );

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);
    const other = leaving.auxiliary![0]!.state;

    expect(leaving.state.tdb).toBeCloseTo(80, 1);
    expect(leaving.state.w).toBeCloseTo(entering.state.w - 0.65 * (entering.state.w - other.w), 9);
    expect(leaving.moistureRate).toBeLessThan(0);
  });

  it('refuses a latent effectiveness on a device that transfers no moisture', () => {
    const solved = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-plate', { sensible: 0.7, latent: 0.5 }),
      ],
      'IP',
      EXHAUST,
    );
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/transfers no moisture/);
  });

  it('refuses an effectiveness above 1', () => {
    const solved = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-wheel-sensible', { sensible: 1.4 }),
      ],
      'IP',
      EXHAUST,
    );
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/between 0 and 1/);
  });

  it('balances energy between the two airstreams', () => {
    // The guard: what one stream gives, the other receives. A recovery device
    // that fails this is inventing energy.
    const solved = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-wheel-enthalpy', { sensible: 0.75, latent: 0.65 }),
      ],
      'IP',
      EXHAUST,
    );

    const result = resultAt(solved, 1);
    const other = result.auxiliary![0]!.state;
    const otherLeaving = result.auxiliary![1]!.state;

    // The exhaust stream's own mass flow, which is **not** the supply's even
    // though both carry 2000 CFM: 2000 CFM of 95 °F air is 8,362 lb/h while
    // 2000 CFM of 75 °F air is 8,772 lb/h. Using the supply figure here leaves
    // a residual of a few per cent that looks like a solver defect and is
    // actually the difference in density.
    const exhaustMassFlow = solved.airstreams[1]!.terminalMassFlow!;
    const otherDuty = dutyOf(exhaustMassFlow, otherLeaving.h - other.h, 'IP');

    expect(result.duty.total + otherDuty).toBeCloseTo(0, 6);
    expect(result.warnings.join(' ')).not.toMatch(/does not balance/);
  });

  it('equal airflows are not equal mass flows', () => {
    // The reason the balance above has to be checked on mass, not volume.
    const solved = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-wheel-sensible', { sensible: 0.75 }),
      ],
      'IP',
      EXHAUST,
    );

    const supply = resultAt(solved, 0).massFlow;
    const exhaust = solved.airstreams[1]!.terminalMassFlow!;

    expect(supply).not.toBeCloseTo(exhaust, 0);
    // The cooler exhaust air is denser, so the same volume carries more mass.
    expect(exhaust).toBeGreaterThan(supply);
  });

  it('limits effectiveness by the smaller airflow', () => {
    // Half the exhaust air can only carry half the exchange. Using the supply
    // flow would credit the wheel with more than the exhaust had to give.
    const halfExhaust: Airstream[] = [
      {
        id: 'exhaust',
        name: 'Exhaust',
        stages: [{ id: 'ra', type: 'source', airflow: 1000, params: { tdb: 75, rh: 0.5 } }],
      },
    ];

    const equal = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-wheel-sensible', { sensible: 0.75 }),
      ],
      'IP',
      EXHAUST,
    );
    const unequal = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-wheel-sensible', { sensible: 0.75 }),
      ],
      'IP',
      halfExhaust,
    );

    // Less exhaust air means less recovery, so the supply leaves warmer.
    expect(resultAt(unequal, 1).state.tdb).toBeGreaterThan(resultAt(equal, 1).state.tdb);
    expect(resultAt(unequal, 1).note).toMatch(/limited by the smaller airflow/);
  });

  it('flags an optimistic effectiveness', () => {
    const solved = solveOne(
      [
        { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
        withWheel('recovery-runaround', { sensible: 0.8 }),
      ],
      'IP',
      EXHAUST,
    );
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/above the 65%/);
  });
});

describe('wrap-around coil — the paired legs must balance', () => {
  const chain = (precool: Record<string, unknown>): Stage[] => [
    { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 90, rh: 0.55 } },
    { id: 'pre', type: 'recovery-wraparound-precool', params: precool },
    { id: 'cc', type: 'cooling', params: { tdbOut: 52, rhOut: 0.95 } },
    {
      id: 're',
      type: 'recovery-wraparound-reheat',
      params: {},
      couplings: [{ role: 'paired-leg', airstreamId: 'supply', stageId: 'pre' }],
    },
  ];

  it('returns exactly the heat the pre-cool leg removed', () => {
    const solved = solveOne(chain({ deltaT: 8 }));
    const precool = resultAt(solved, 1);
    const reheat = resultAt(solved, 3);

    expect(reheat.duty.total).toBeCloseTo(-precool.duty.total, 9);
    expect(precool.duty.total).toBeLessThan(0);
    expect(reheat.duty.total).toBeGreaterThan(0);
    expect(reheat.warnings.join(' ')).not.toMatch(/do not balance/);
  });

  it('both legs are sensible only', () => {
    const solved = solveOne(chain({ deltaT: 8 }));
    for (const index of [1, 3]) {
      const result = resultAt(solved, index);
      expect(result.duty.latent, `stage ${index}`).toBeCloseTo(0, 9);
      expect(result.moistureRate, `stage ${index}`).toBe(0);
    }
  });

  it('deepens dehumidification for the same coil leaving temperature', () => {
    // The reason wrap-arounds exist: pre-cooling unloads the coil, and the
    // free reheat lifts the supply air off saturation without new energy.
    const withCircuit = solveOne(chain({ deltaT: 8 }));
    const without = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 90, rh: 0.55 } },
      { id: 'cc', type: 'cooling', params: { tdbOut: 52, rhOut: 0.95 } },
    ]);

    const supplyWith = resultAt(withCircuit, 3).state;
    const supplyWithout = resultAt(without, 1).state;

    // Same humidity ratio off the coil, but warmer and therefore drier air.
    expect(supplyWith.tdb).toBeGreaterThan(supplyWithout.tdb);
    expect(supplyWith.rh).toBeLessThan(supplyWithout.rh);
  });

  it('refuses a reheat leg with no pre-cool leg to mirror', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 90, rh: 0.55 } },
      { id: 're', type: 'recovery-wraparound-reheat', params: {} },
    ]);
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/pair this leg/i);
  });

  it('refuses a pairing that points forward in the chain', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 90, rh: 0.55 } },
      {
        id: 're',
        type: 'recovery-wraparound-reheat',
        params: {},
        couplings: [{ role: 'paired-leg', airstreamId: 'supply', stageId: 'pre' }],
      },
      { id: 'pre', type: 'recovery-wraparound-precool', params: { deltaT: 8 } },
    ]);
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/must come earlier/);
  });

  it('warns when the pre-cool leg condenses', () => {
    const solved = solveOne(chain({ deltaT: 30 }));
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/below its dew point/);
  });
});

describe('evaporative cooling', () => {
  it('direct follows the wet-bulb line', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'dec', type: 'evaporative-direct', params: { effectiveness: 0.85 } },
    ]);

    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;

    expect(leaving.twb).toBeCloseTo(entering.twb, 2);
    expect(leaving.tdb).toBeLessThan(entering.tdb);
    expect(leaving.w).toBeGreaterThan(entering.w);
  });

  it('indirect cools at constant humidity ratio', () => {
    // The defining property: the primary air never touches the water.
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'iec', type: 'evaporative-indirect', params: { effectiveness: 0.7 } },
    ]);

    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;

    expect(leaving.w).toBeCloseTo(entering.w, 12);
    expect(leaving.tdb).toBeLessThan(entering.tdb);
    expect(resultAt(solved, 1).moistureRate).toBe(0);
    expect(resultAt(solved, 1).duty.latent).toBeCloseTo(0, 9);
  });

  it('indirect cannot cool below the scavenger wet bulb', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'iec', type: 'evaporative-indirect', params: { effectiveness: 1, secondaryEffectiveness: 1 } },
    ]);
    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;
    expect(leaving.tdb).toBeGreaterThanOrEqual(entering.twb - 1e-6);
  });

  it('warns when there is little wet-bulb depression to work with', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 80, rh: 0.85 } },
      { id: 'dec', type: 'evaporative-direct', params: { effectiveness: 0.85 } },
    ]);
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/little evaporative cooling/);
  });
});

describe('desiccant — an idealisation that says so', () => {
  const chain = (params: Record<string, unknown>): Stage[] => [
    { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 85, rh: 0.7 } },
    { id: 'dw', type: 'desiccant', params },
  ];

  it('dries the air and warms it, at constant enthalpy', () => {
    const solved = solveOne(chain({ removal: 0.5 }));
    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;

    expect(leaving.w).toBeCloseTo(entering.w * 0.5, 9);
    expect(leaving.tdb).toBeGreaterThan(entering.tdb);
    expect(leaving.h).toBeCloseTo(entering.h, 6);
  });

  it('has zero total duty, being isenthalpic by construction', () => {
    const solved = solveOne(chain({ removal: 0.5 }));
    const result = resultAt(solved, 1);

    expect(result.duty.total).toBeCloseTo(0, 6);
    // Sensible gain and latent loss are equal and opposite.
    expect(result.duty.sensible).toBeGreaterThan(0);
    expect(result.duty.latent).toBeLessThan(0);
    expect(result.duty.sensible + result.duty.latent).toBeCloseTo(0, 6);
  });

  it('warns on every result that it is an idealisation', () => {
    const solved = solveOne(chain({ removal: 0.5 }));
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/idealised isenthalpic/);
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/manufacturer performance data/);
  });

  it('refuses to add moisture', () => {
    const solved = solveOne(chain({ wOut: 200 }));
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/cannot add it/);
  });
});

describe('the Phase 4 equipment set is registered', () => {
  it('models every planned stage type', () => {
    for (const type of [
      'recovery-wheel-sensible',
      'recovery-wheel-enthalpy',
      'recovery-plate',
      'recovery-runaround',
      'recovery-wraparound-precool',
      'recovery-wraparound-reheat',
      'evaporative-direct',
      'evaporative-indirect',
      'desiccant',
    ] as const) {
      expect(MODELS[type], type).toBeDefined();
    }
  });
});
