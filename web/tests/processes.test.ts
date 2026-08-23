/**
 * Phase 2 gate: every process matches a hand calculation, and every chain
 * closes its energy balance.
 *
 * The hand calculations are worked in the comments so a reviewer can check the
 * arithmetic without running anything. Where a value comes from a published
 * source it is named.
 */
import { describe, it, expect } from 'vitest';
import {
  solveProject,
  checkEnergyBalance,
  systemTotals,
  splitDuty,
  applyDuty,
  moistureRate,
  MODELS,
} from '../src/processes/index.js';
import { fromTdbRh, fromTdbW } from '../src/psych/state.js';
import { DEFAULTS, massFlow as massFlowFrom, type UnitSystem } from '../src/psych/units.js';
import type { Project, Stage } from '../src/types/project.js';

const IP_PRESSURE = DEFAULTS.IP.standardPressure;
const SI_PRESSURE = DEFAULTS.SI.standardPressure;

function project(stages: Stage[], units: UnitSystem = 'IP', extra: Project['airstreams'] = []): Project {
  return {
    schemaVersion: 1,
    units,
    atmosphere: { basis: 'standard' },
    airstreams: [{ id: 'supply', name: 'Supply air', role: 'supply', stages }, ...extra],
  };
}

function solveOne(stages: Stage[], units: UnitSystem = 'IP') {
  const pressure = units === 'IP' ? IP_PRESSURE : SI_PRESSURE;
  return solveProject(project(stages, units), pressure, units);
}

/** Fail loudly with the stage's own message rather than on an undefined deref. */
function resultAt(solved: ReturnType<typeof solveOne>, index: number) {
  const stage = solved.airstreams[0]!.stages[index]!;
  if (stage.error) throw new Error(`stage ${index} (${stage.displayName}): ${stage.error}`);
  return stage.result!;
}

const OUTDOOR_AIR: Stage = {
  id: 'oa',
  type: 'source',
  name: 'Outdoor air',
  airflow: 2000,
  params: { tdb: 95, rh: 0.4 },
};

describe('duty splitting', () => {
  it('is exactly additive', () => {
    const a = fromTdbRh(80, 0.5, IP_PRESSURE, 'IP');
    const b = fromTdbRh(55, 0.9, IP_PRESSURE, 'IP');
    const split = splitDuty(a, b, 5000, 'IP');
    expect(split.sensible + split.latent).toBeCloseTo(split.total, 12);
  });

  it('reports pure sensible change as SHR = 1', () => {
    // Same humidity ratio, higher temperature: nothing latent happened.
    const a = fromTdbRh(70, 0.5, IP_PRESSURE, 'IP');
    const b = fromTdbW(90, a.w, IP_PRESSURE, 'IP');
    const split = splitDuty(a, b, 5000, 'IP');

    expect(split.latent).toBeCloseTo(0, 9);
    expect(split.shr).toBeCloseTo(1, 9);
  });

  it('reports an undefined ratio rather than 1 when there is no duty', () => {
    const a = fromTdbRh(70, 0.5, IP_PRESSURE, 'IP');
    expect(splitDuty(a, a, 5000, 'IP').shr).toBeNaN();
  });

  it('inverts: applying a split duty reproduces it', () => {
    const entering = fromTdbRh(80, 0.5, IP_PRESSURE, 'IP');
    const m = 5000;
    // Chosen to stay clear of saturation. A duty and SHR that would drive the
    // air past the saturation curve is clamped, and clamping deliberately
    // breaks this round trip — that case is asserted separately below.
    for (const [total, shr] of [
      [-30, 0.75],
      [-20, 0.6],
      [40, 1],
      [25, 0.85],
    ] as const) {
      const leaving = applyDuty(entering, m, total, shr, IP_PRESSURE, 'IP');
      const recovered = splitDuty(entering, leaving, m, 'IP');
      expect(recovered.total, `total for ${total}/${shr}`).toBeCloseTo(total, 6);
      expect(recovered.shr, `shr for ${total}/${shr}`).toBeCloseTo(shr, 6);
    }
  });
});

describe('entering air', () => {
  it('solves the declared condition and its mass flow', () => {
    const solved = solveOne([OUTDOOR_AIR]);
    const result = resultAt(solved, 0);

    expect(result.state.tdb).toBeCloseTo(95, 9);
    expect(result.state.rh).toBeCloseTo(0.4, 9);

    // m = CFM x 60 / v
    const expected = (2000 * 60) / result.state.v;
    expect(result.massFlow).toBeCloseTo(expected, 6);
    expect(result.airflow).toBe(2000);
  });

  it('refuses to start a chain without an airflow', () => {
    const solved = solveOne([{ id: 'oa', type: 'source', params: { tdb: 95, rh: 0.4 } }]);
    expect(solved.airstreams[0]!.stages[0]!.error).toMatch(/airflow is required/i);
  });

  it('names the missing field when the condition is underspecified', () => {
    const solved = solveOne([{ id: 'oa', type: 'source', airflow: 1000, params: { tdb: 95 } }]);
    expect(solved.airstreams[0]!.stages[0]!.error).toMatch(/dry bulb plus one of/i);
  });
});

describe('sensible heating', () => {
  it('holds humidity ratio and raises dry bulb', () => {
    const solved = solveOne([
      { id: 'ra', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.6 } },
      { id: 'hc', type: 'heating', params: { tdbOut: 85 } },
    ]);

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);

    expect(leaving.state.w).toBeCloseTo(entering.state.w, 12);
    expect(leaving.state.tdb).toBeCloseTo(85, 9);
    // Heating dry air lowers relative humidity.
    expect(leaving.state.rh).toBeLessThan(entering.state.rh);
    expect(leaving.duty.total).toBeGreaterThan(0);
    expect(leaving.duty.latent).toBeCloseTo(0, 9);
    expect(leaving.duty.shr).toBeCloseTo(1, 9);
    expect(leaving.moistureRate).toBe(0);
  });

  it('matches a hand calculation for capacity', () => {
    // 2000 CFM of 55 degF / 60% RH air. Specific volume is about 13.13 ft3/lb,
    // so m ~ 2000 x 60 / 13.13 ~ 9140 lb/h. A 100 MBH coil adds
    // 100000 / 9140 ~ 10.9 Btu/lb, and at cp ~ 0.243 Btu/lb-degF for this
    // humidity ratio that is a rise of roughly 45 degF, to about 100 degF.
    const solved = solveOne([
      { id: 'ra', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.6 } },
      { id: 'hc', type: 'heating', params: { power: 100 } },
    ]);

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);

    expect(leaving.duty.total).toBeCloseTo(100, 6);
    expect(leaving.state.tdb).toBeGreaterThan(95);
    expect(leaving.state.tdb).toBeLessThan(105);
    expect(leaving.state.w).toBeCloseTo(entering.state.w, 12);
  });

  it('warns when asked to cool', () => {
    const solved = solveOne([
      { id: 'ra', type: 'source', airflow: 2000, params: { tdb: 75, rh: 0.5 } },
      { id: 'hc', type: 'heating', params: { tdbOut: 60 } },
    ]);
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/cannot cool/i);
  });
});

describe('cooling with dehumidification', () => {
  it('honours the requested capacity and SHR', () => {
    // 2000 CFM of 95 degF / 40% RH. At 120 MBH the leaving state stays clear of
    // saturation only for SHR below about 0.65; 0.6 is comfortably achievable.
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'cc', type: 'cooling', params: { power: 120, shr: 0.6 } },
    ]);

    const leaving = resultAt(solved, 1);
    expect(leaving.duty.total).toBeCloseTo(-120, 6);
    expect(leaving.duty.shr).toBeCloseTo(0.6, 6);
    expect(leaving.duty.sensible).toBeLessThan(0);
    expect(leaving.duty.latent).toBeLessThan(0);
    // Dehumidifying removes water from the air.
    expect(leaving.moistureRate).toBeLessThan(0);
  });

  it('accepts leaving conditions directly', () => {
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'cc', type: 'cooling', params: { tdbOut: 55, rhOut: 0.92 } },
    ]);

    const leaving = resultAt(solved, 1);
    expect(leaving.state.tdb).toBeCloseTo(55, 9);
    expect(leaving.state.rh).toBeCloseTo(0.92, 9);
    expect(leaving.duty.total).toBeLessThan(0);
  });

  it('flags an implausibly dry off-coil condition', () => {
    // A coil that dehumidifies but leaves the air at 60% RH is not a real
    // selection. bh-psych stated this as advice; here it is evaluated.
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'cc', type: 'cooling', params: { tdbOut: 60, rhOut: 0.6 } },
    ]);
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/90–95% RH/);
  });

  it('does not flag a sensible-only coil for being dry', () => {
    // Above the entering dew point nothing condenses, so a low leaving RH is
    // expected and must not raise the dehumidification warning.
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'cc', type: 'cooling', params: { power: 30, shr: 1 } },
    ]);
    const leaving = resultAt(solved, 1);
    expect(leaving.duty.latent).toBeCloseTo(0, 6);
    expect(leaving.warnings.join(' ')).not.toMatch(/90–95% RH/);
  });

  it('clamps and warns rather than returning air past saturation', () => {
    const solved = solveOne([
      OUTDOOR_AIR,
      // Far more latent capacity than the air can give up.
      { id: 'cc', type: 'cooling', params: { power: 400, shr: 0.2 } },
    ]);
    const leaving = resultAt(solved, 1);
    expect(leaving.state.w).toBeLessThanOrEqual(leaving.state.wSaturation + 1e-12);
  });

  it('says so when clamping makes it deliver a different duty than requested', () => {
    // 120 MBH at SHR 0.7 on this air would land past the saturation curve. The
    // clamped coil then delivers MORE cooling than asked for. Reporting the
    // clamped number alone would show a coil silently exceeding its spec.
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'cc', type: 'cooling', params: { power: 120, shr: 0.7 } },
    ]);

    const leaving = resultAt(solved, 1);
    expect(Math.abs(leaving.duty.total)).toBeGreaterThan(120);
    expect(leaving.warnings.join(' ')).toMatch(/against the 120.0 requested/);
    expect(leaving.warnings.join(' ')).toMatch(/past saturation/);
  });

  it('warns when asked to heat', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'cc', type: 'cooling', params: { tdbOut: 75, rhOut: 0.4 } },
    ]);
    expect(resultAt(solved, 1).warnings.join(' ')).toMatch(/cannot heat/i);
  });
});

describe('mixing', () => {
  it('lands on the line between the streams, at the mass fraction', () => {
    // 2000 CFM outdoor at 95 degF / 40% RH mixed with 1000 CFM return at
    // 75 degF / 50% RH. Mixing is mass-weighted, and the two streams differ in
    // density, so the mix point is NOT two-thirds of the way by volume.
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'mx', type: 'mixing', params: { airflow2: 1000, tdb2: 75, rh2: 0.5 } },
    ]);

    const primary = resultAt(solved, 0);
    const mixed = resultAt(solved, 1);
    const second = mixed.auxiliary![0]!.state;

    const m1 = primary.massFlow;
    const m2 = massFlowFrom(1000, second.v, 'IP');
    const total = m1 + m2;

    expect(mixed.massFlow).toBeCloseTo(total, 6);
    expect(mixed.state.w).toBeCloseTo((m1 * primary.state.w + m2 * second.w) / total, 12);
    expect(mixed.state.h).toBeCloseTo((m1 * primary.state.h + m2 * second.h) / total, 6);

    // And it lies between the two streams.
    expect(mixed.state.tdb).toBeGreaterThan(second.tdb);
    expect(mixed.state.tdb).toBeLessThan(primary.state.tdb);
  });

  it('is adiabatic — it adds no duty', () => {
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'mx', type: 'mixing', params: { airflow2: 1000, tdb2: 75, rh2: 0.5 } },
    ]);
    expect(resultAt(solved, 1).duty.total).toBe(0);
  });

  it('takes its second stream from a coupled airstream', () => {
    const solved = solveProject(
      {
        schemaVersion: 1,
        units: 'IP',
        atmosphere: { basis: 'standard' },
        airstreams: [
          {
            id: 'supply',
            name: 'Supply air',
            stages: [
              OUTDOOR_AIR,
              {
                id: 'mx',
                type: 'mixing',
                params: { airflow2: 1000 },
                couplings: [{ role: 'second-stream', airstreamId: 'return' }],
              },
            ],
          },
          {
            id: 'return',
            name: 'Return air',
            role: 'return',
            stages: [{ id: 'ra', type: 'source', airflow: 1000, params: { tdb: 75, rh: 0.5 } }],
          },
        ],
      },
      IP_PRESSURE,
      'IP',
    );

    const mixed = solved.airstreams[0]!.stages[1]!;
    expect(mixed.error).toBeUndefined();
    expect(mixed.result!.auxiliary![0]!.state.tdb).toBeCloseTo(75, 9);
  });
});

describe('fan heat', () => {
  it('raises dry bulb at constant humidity ratio', () => {
    // Fan power is entered as **shaft power** — HP in IP — and the heat added
    // is derived from it. 2 HP is 5.089 MBH.
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'sf', type: 'fan', params: { power: 2 } },
    ]);

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);

    expect(leaving.state.w).toBeCloseTo(entering.state.w, 12);
    expect(leaving.state.tdb).toBeGreaterThan(entering.state.tdb);
    expect(leaving.duty.total).toBeCloseTo(2 * 2.5444336, 4);
    // A 2 HP fan on 2000 CFM is a couple of degrees, not ten.
    expect(leaving.state.tdb - entering.state.tdb).toBeGreaterThan(1);
    expect(leaving.state.tdb - entering.state.tdb).toBeLessThan(4);
  });

  it('converts horsepower to duty rather than treating it as duty', () => {
    // The distinction that matters: 2 "power" is 2 HP = 5.089 MBH, not 2 MBH.
    // Treating shaft power as a thermal duty understates fan heat 2.5-fold.
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'sf', type: 'fan', params: { power: 2 } },
    ]);
    expect(resultAt(solved, 1).duty.total).toBeGreaterThan(2);
  });

  it('delivers less heat when the motor is outside the airstream', () => {
    const inside = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'sf', type: 'fan', params: { power: 2, motorInAirstream: true } },
    ]);
    const outside = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'sf', type: 'fan', params: { power: 2, motorInAirstream: false, motorEfficiency: 0.9 } },
    ]);

    expect(resultAt(outside, 1).duty.total).toBeCloseTo(2 * 2.5444336 * 0.9, 4);
    expect(resultAt(outside, 1).duty.total).toBeLessThan(resultAt(inside, 1).duty.total);
  });

  it('SI fan power in kW is already a duty', () => {
    // No conversion factor in SI: a 1.5 kW fan delivers 1.5 kW to the air.
    const solved = solveOne(
      [
        { id: 'sa', type: 'source', airflow: 1000, params: { tdb: 13, rh: 0.9 } },
        { id: 'sf', type: 'fan', params: { power: 1.5 } },
      ],
      'SI',
    );
    expect(resultAt(solved, 1).duty.total).toBeCloseTo(1.5, 6);
  });
});

describe('steam humidification', () => {
  it('raises humidity ratio with only a small temperature rise', () => {
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 70, rh: 0.15 } },
      { id: 'hu', type: 'humidifier-steam', params: { rhOut: 0.4 } },
    ]);

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);

    expect(leaving.state.rh).toBeCloseTo(0.4, 6);
    expect(leaving.state.w).toBeGreaterThan(entering.state.w);
    expect(leaving.moistureRate).toBeGreaterThan(0);

    // Near-isothermal, but genuinely not isothermal: a small rise is expected,
    // and a model that produced exactly zero would be wrong.
    const rise = leaving.state.tdb - entering.state.tdb;
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(5);
  });

  it('honours the steam energy balance', () => {
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 70, rh: 0.15 } },
      { id: 'hu', type: 'humidifier-steam', params: { rhOut: 0.4, steamEnthalpy: 1150 } },
    ]);

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);

    // h2 = h1 + (W2 - W1) x h_steam
    const expected = entering.state.h + (leaving.state.w - entering.state.w) * 1150;
    expect(leaving.state.h).toBeCloseTo(expected, 6);
  });

  it('accepts a moisture rate directly', () => {
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 70, rh: 0.15 } },
      { id: 'hu', type: 'humidifier-steam', params: { moistureRate: 20 } },
    ]);
    expect(resultAt(solved, 1).moistureRate).toBeCloseTo(20, 6);
  });

  it('refuses a target below the entering condition', () => {
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 70, rh: 0.5 } },
      { id: 'hu', type: 'humidifier-steam', params: { rhOut: 0.3 } },
    ]);
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/already at or above/i);
  });
});

describe('adiabatic humidification', () => {
  it('follows the constant wet-bulb line', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'ec', type: 'humidifier-adiabatic', params: { effectiveness: 0.85 } },
    ]);

    const entering = resultAt(solved, 0);
    const leaving = resultAt(solved, 1);

    // The defining property.
    expect(leaving.state.twb).toBeCloseTo(entering.state.twb, 2);
    expect(leaving.state.tdb).toBeLessThan(entering.state.tdb);
    expect(leaving.state.w).toBeGreaterThan(entering.state.w);
  });

  it('achieves exactly the requested fraction of the wet-bulb depression', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'ec', type: 'humidifier-adiabatic', params: { effectiveness: 0.85 } },
    ]);

    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;
    const achieved = (entering.tdb - leaving.tdb) / (entering.tdb - entering.twb);
    expect(achieved).toBeCloseTo(0.85, 6);
  });

  it('never cools below the entering wet bulb', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'ec', type: 'humidifier-adiabatic', params: { effectiveness: 1 } },
    ]);

    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;
    expect(leaving.tdb).toBeGreaterThanOrEqual(entering.twb - 1e-6);
  });

  it('rejects an effectiveness above 1 as thermodynamically impossible', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'ec', type: 'humidifier-adiabatic', params: { effectiveness: 1.2 } },
    ]);
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/impossible/i);
  });

  it('is very nearly isenthalpic', () => {
    const solved = solveOne([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.2 } },
      { id: 'ec', type: 'humidifier-adiabatic', params: { effectiveness: 0.85 } },
    ]);
    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;
    // Constant wet bulb is not exactly constant enthalpy, but is within ~1%.
    expect(Math.abs(leaving.h - entering.h) / Math.abs(entering.h)).toBeLessThan(0.01);
  });
});

describe('room load', () => {
  it('picks up the load along the room sensible heat ratio line', () => {
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'rm', type: 'room', params: { sensible: 40, latent: 10 } },
    ]);

    const leaving = resultAt(solved, 1);
    expect(leaving.duty.total).toBeCloseTo(50, 6);
    expect(leaving.duty.sensible).toBeCloseTo(40, 6);
    expect(leaving.duty.latent).toBeCloseTo(10, 6);
    expect(leaving.duty.shr).toBeCloseTo(0.8, 9);
    expect(leaving.moistureRate).toBeGreaterThan(0);
  });

  it('passes the air through unchanged when there is no load', () => {
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'rm', type: 'room', params: { sensible: 0, latent: 0 } },
    ]);
    const entering = resultAt(solved, 0).state;
    const leaving = resultAt(solved, 1).state;
    expect(leaving.tdb).toBeCloseTo(entering.tdb, 12);
    expect(leaving.w).toBeCloseTo(entering.w, 12);
  });
});

describe('mass flow propagation', () => {
  it('conserves mass flow and re-derives airflow at each stage', () => {
    const solved = solveOne([
      { id: 'sa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.9 } },
      { id: 'hc', type: 'heating', params: { tdbOut: 90 } },
    ]);

    const entering = resultAt(solved, 0);
    const heating = resultAt(solved, 1);

    // Mass is conserved across a coil...
    expect(heating.massFlow).toBeCloseTo(entering.massFlow, 9);
    // ...but the air expands, so volumetric flow through the coil is computed
    // at the entering condition and equals the upstream figure here.
    expect(heating.airflow).toBeCloseTo(2000, 6);
  });

  it('adds mass flow at a mixing box and carries it downstream', () => {
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'mx', type: 'mixing', params: { airflow2: 1000, tdb2: 75, rh2: 0.5 } },
      { id: 'cc', type: 'cooling', params: { power: 60, shr: 0.75 } },
    ]);

    const mixed = resultAt(solved, 1);
    const cooling = resultAt(solved, 2);
    expect(cooling.massFlow).toBeCloseTo(mixed.massFlow, 9);
    expect(mixed.massFlow).toBeGreaterThan(resultAt(solved, 0).massFlow);
  });
});

describe('energy balance closes — the Phase 2 gate', () => {
  const cases: { name: string; stages: Stage[]; units: UnitSystem }[] = [
    {
      name: 'cool and reheat',
      units: 'IP',
      stages: [
        OUTDOOR_AIR,
        { id: 'cc', type: 'cooling', params: { power: 120, shr: 0.6 } },
        { id: 'rh', type: 'heating', params: { tdbOut: 65 } },
        { id: 'sf', type: 'fan', params: { power: 1.5 } },
        { id: 'rm', type: 'room', params: { sensible: 45, latent: 12 } },
      ],
    },
    {
      name: 'mixed air with humidification',
      units: 'IP',
      stages: [
        { id: 'oa', type: 'source', airflow: 800, params: { tdb: 10, rh: 0.6 } },
        { id: 'mx', type: 'mixing', params: { airflow2: 1600, tdb2: 72, rh2: 0.3 } },
        { id: 'hc', type: 'heating', params: { tdbOut: 95 } },
        { id: 'hu', type: 'humidifier-steam', params: { rhOut: 0.25 } },
        { id: 'rm', type: 'room', params: { sensible: -30, latent: 5 } },
      ],
    },
    {
      name: 'evaporative cooling, SI',
      units: 'SI',
      stages: [
        { id: 'oa', type: 'source', airflow: 1000, params: { tdb: 36, rh: 0.2 } },
        { id: 'ec', type: 'humidifier-adiabatic', params: { effectiveness: 0.85 } },
        { id: 'sf', type: 'fan', params: { power: 1.2 } },
        { id: 'rm', type: 'room', params: { sensible: 12, latent: 3 } },
      ],
    },
    {
      name: 'full chain, SI',
      units: 'SI',
      stages: [
        { id: 'oa', type: 'source', airflow: 1200, params: { tdb: 32, rh: 0.55 } },
        { id: 'mx', type: 'mixing', params: { airflow2: 900, tdb2: 24, rh2: 0.5 } },
        { id: 'cc', type: 'cooling', params: { power: 45, shr: 0.72 } },
        { id: 'sf', type: 'fan', params: { power: 1.5 } },
        { id: 'rm', type: 'room', params: { sensible: 20, latent: 6 } },
      ],
    },
  ];

  it.each(cases)('$name', ({ stages, units }) => {
    const solved = solveOne(stages, units);
    const stream = solved.airstreams[0]!;

    for (const stage of stream.stages) {
      expect(stage.error, `stage ${stage.displayName}`).toBeUndefined();
    }

    const balance = checkEnergyBalance(stream, units);
    expect(balance).not.toBeNull();
    expect(
      balance!.closes,
      `residual ${balance!.residual} on energy in ${balance!.energyIn}, ` +
        `duty ${balance!.dutyAdded}, out ${balance!.energyOut}`,
    ).toBe(true);
    expect(Math.abs(balance!.relativeResidual)).toBeLessThan(1e-9);
  });
});

describe('system totals', () => {
  it('separates cooling from heating and tracks moisture', () => {
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'cc', type: 'cooling', params: { power: 120, shr: 0.6 } },
      // Above the off-coil temperature, so this is genuinely reheat. Asking for
      // a lower temperature here would be a second cooling stage wearing a
      // heating coil's name, and would land in the cooling total.
      { id: 'rh', type: 'heating', params: { tdbOut: 65 } },
    ]);

    const totals = systemTotals(solved.airstreams[0]!);
    expect(totals.cooling).toBeCloseTo(-120, 6);
    expect(totals.heating).toBeGreaterThan(0);
    // Reheat after a cooling coil is energy spent undoing energy already spent.
    expect(totals.netDuty.total).toBeCloseTo(totals.cooling + totals.heating, 6);
    expect(totals.dehumidification).toBeLessThan(0);
  });
});

describe('failure handling', () => {
  it('reports the failing stage and stops, rather than inventing a state', () => {
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'bad', type: 'cooling', params: {} },
      { id: 'after', type: 'heating', params: { tdbOut: 80 } },
    ]);

    const stages = solved.airstreams[0]!.stages;
    expect(stages[0]!.result).toBeDefined();
    expect(stages[1]!.error).toMatch(/leaving conditions|capacity/i);
    expect(stages[2]!.error).toBeDefined();
    expect(stages[2]!.result).toBeUndefined();
  });

  it('reports an unknown stage type without failing the chain', () => {
    // A type this build does not know — as a project file written by a future
    // version would contain. Everything before it still solves.
    const solved = solveOne([
      OUTDOOR_AIR,
      { id: 'later', type: 'heat-pump-desuperheater' as never, params: {} },
    ]);
    expect(solved.airstreams[0]!.stages[0]!.result).toBeDefined();
    expect(solved.airstreams[0]!.stages[1]!.error).toMatch(/no model/i);
  });

  it('detects a circular coupling between airstreams', () => {
    const solved = solveProject(
      {
        schemaVersion: 1,
        units: 'IP',
        atmosphere: { basis: 'standard' },
        airstreams: [
          {
            id: 'a',
            name: 'A',
            stages: [
              { id: 'a1', type: 'source', airflow: 1000, params: { tdb: 80, rh: 0.5 } },
              {
                id: 'a2',
                type: 'mixing',
                params: { airflow2: 500 },
                couplings: [{ role: 'second-stream', airstreamId: 'b' }],
              },
            ],
          },
          {
            id: 'b',
            name: 'B',
            stages: [
              { id: 'b1', type: 'source', airflow: 1000, params: { tdb: 70, rh: 0.5 } },
              {
                id: 'b2',
                type: 'mixing',
                params: { airflow2: 500 },
                couplings: [{ role: 'second-stream', airstreamId: 'a' }],
              },
            ],
          },
        ],
      },
      IP_PRESSURE,
      'IP',
    );

    expect(solved.errors.join(' ')).toMatch(/circular coupling/i);
  });

  it('names a coupling to an airstream that does not exist', () => {
    const solved = solveProject(
      {
        schemaVersion: 1,
        units: 'IP',
        atmosphere: { basis: 'standard' },
        airstreams: [
          {
            id: 'a',
            name: 'A',
            stages: [
              { id: 'a1', type: 'source', airflow: 1000, params: { tdb: 80, rh: 0.5 } },
              {
                id: 'a2',
                type: 'mixing',
                params: { airflow2: 500 },
                couplings: [{ role: 'second-stream', airstreamId: 'ghost' }],
              },
            ],
          },
        ],
      },
      IP_PRESSURE,
      'IP',
    );
    expect(solved.errors.join(' ')).toMatch(/does not exist/i);
  });
});

describe('registry', () => {
  it('exposes the full Phase 2 core set', () => {
    for (const type of [
      'source',
      'mixing',
      'heating',
      'cooling',
      'fan',
      'room',
      'humidifier-steam',
      'humidifier-adiabatic',
    ] as const) {
      expect(MODELS[type], type).toBeDefined();
    }
  });

  it('models every stage type the schema declares', () => {
    // Phase 4 completed the set, so an unmodelled declared type would now be a
    // gap rather than a deferral.
    for (const type of [
      'desiccant',
      'recovery-wheel-enthalpy',
      'recovery-wheel-sensible',
      'recovery-plate',
      'recovery-runaround',
      'recovery-wraparound-precool',
      'recovery-wraparound-reheat',
      'evaporative-direct',
      'evaporative-indirect',
    ] as const) {
      expect(MODELS[type], type).toBeDefined();
    }
  });
});

describe('moisture rate units', () => {
  it('is per hour in both systems', () => {
    // IP mass flow is per hour and passes through; SI is per second and scales.
    expect(moistureRate(1000, 0.001, 'IP')).toBeCloseTo(1, 12);
    expect(moistureRate(1, 0.001, 'SI')).toBeCloseTo(3.6, 12);
  });
});
