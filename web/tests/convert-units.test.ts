/**
 * Switching unit systems must convert the project, not only its labels.
 *
 * The defect this guards against: the labels changed from °F to °C while the
 * stored values stayed put, so an entering condition of 95 °F was read as
 * 95 °C — off the chart, and solving to nonsense. The chart went blank and
 * nothing said why.
 */
import { describe, it, expect } from 'vitest';
import { convertStages, convertComfort, convertAltitude } from '../src/ui/convertProject.js';
import { solveProject } from '../src/processes/index.js';
import { DEFAULTS, powerAsDuty, type UnitSystem } from '../src/psych/units.js';
import type { Project, Stage } from '../src/types/project.js';

const IP_STAGES: Stage[] = [
  { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
  { id: 'mx', type: 'mixing', params: { airflow2: 1000, tdb2: 75, rh2: 0.5 } },
  { id: 'cc', type: 'cooling', params: { tdbOut: 55, rhOut: 0.92 } },
  { id: 'sf', type: 'fan', params: { power: 3, motorInAirstream: true } },
  { id: 'rm', type: 'room', params: { sensible: 40, latent: 10 } },
];

function project(stages: Stage[], units: UnitSystem): Project {
  return {
    schemaVersion: 1,
    units,
    atmosphere: { basis: 'standard' },
    airstreams: [{ id: 'supply', name: 'Supply', stages }],
  };
}

describe('converting stages between unit systems', () => {
  const si = convertStages(IP_STAGES, 'IP', 'SI');

  it('converts absolute temperatures', () => {
    // 95 °F is 35 °C; 55 °F is 12.78 °C.
    expect(si[0]!.params!.tdb).toBeCloseTo(35, 3);
    expect(si[1]!.params!.tdb2).toBeCloseTo(23.889, 2);
    expect(si[2]!.params!.tdbOut).toBeCloseTo(12.778, 2);
  });

  it('converts airflow on the stage and in parameters', () => {
    // 2000 CFM is 943.9 L/s.
    expect(si[0]!.airflow).toBeCloseTo(943.89, 1);
    expect(si[1]!.params!.airflow2).toBeCloseTo(471.95, 1);
  });

  it('converts duty', () => {
    // 40 MBH is 11.72 kW.
    expect(si[4]!.params!.sensible).toBeCloseTo(11.723, 2);
    expect(si[4]!.params!.latent).toBeCloseTo(2.931, 2);
  });

  it('converts fan shaft power from HP to kW', () => {
    // 3 HP is 2.237 kW — power, not duty, and a different factor.
    expect(si[3]!.params!.power).toBeCloseTo(2.237, 2);
  });

  it('leaves dimensionless values alone', () => {
    // Relative humidity is a fraction. Converting it would be meaningless.
    expect(si[0]!.params!.rh).toBe(0.4);
    expect(si[2]!.params!.rhOut).toBe(0.92);
    expect(si[3]!.params!.motorInAirstream).toBe(true);
  });

  it('round-trips back to the original values', () => {
    const back = convertStages(si, 'SI', 'IP');
    for (const [index, original] of IP_STAGES.entries()) {
      const returned = back[index]!;
      if (typeof original.airflow === 'number') {
        expect(returned.airflow, `stage ${index} airflow`).toBeCloseTo(original.airflow, 1);
      }
      for (const [key, value] of Object.entries(original.params ?? {})) {
        if (typeof value !== 'number') continue;
        expect(returned.params![key], `stage ${index} ${key}`).toBeCloseTo(value, 2);
      }
    }
  });

  it('solves to the same physical result in both systems', () => {
    // The real test: the same system, expressed either way, must describe the
    // same air. This is what the blank chart was failing.
    const ip = solveProject(project(IP_STAGES, 'IP'), DEFAULTS.IP.standardPressure, 'IP');
    const converted = solveProject(project(si, 'SI'), DEFAULTS.SI.standardPressure, 'SI');

    const ipStages = ip.airstreams[0]!.stages;
    const siStages = converted.airstreams[0]!.stages;

    for (const [index, stage] of ipStages.entries()) {
      expect(stage.error, `IP stage ${index}`).toBeUndefined();
      expect(siStages[index]!.error, `SI stage ${index}`).toBeUndefined();

      const ipState = stage.result!.state;
      const siState = siStages[index]!.result!.state;

      // Temperatures agree once converted...
      expect(((ipState.tdb - 32) * 5) / 9, `stage ${index} tdb`).toBeCloseTo(siState.tdb, 1);
      // ...and humidity ratio is dimensionless, so it agrees outright.
      expect(ipState.w, `stage ${index} w`).toBeCloseTo(siState.w, 4);
    }
  });

  it('keeps a converted system on the chart', () => {
    // The visible symptom of the bug: every state point outside the SI chart
    // domain, so the chart drew nothing.
    const [min, max] = DEFAULTS.SI.tdbRange;
    const solved = solveProject(project(si, 'SI'), DEFAULTS.SI.standardPressure, 'SI');
    for (const stage of solved.airstreams[0]!.stages) {
      const tdb = stage.result!.state.tdb;
      expect(tdb, `${stage.displayName} at ${tdb} °C`).toBeGreaterThan(min);
      expect(tdb).toBeLessThan(max);
    }
  });
});

describe('fan shaft power becomes a thermal duty', () => {
  it('IP: one horsepower is 2.544 MBH', () => {
    expect(powerAsDuty(1, 'IP')).toBeCloseTo(2.5444, 3);
  });

  it('SI: kilowatts are already the duty unit', () => {
    expect(powerAsDuty(1, 'SI')).toBe(1);
  });

  it('delivers the same heat either way', () => {
    // 3 HP in IP and its 2.237 kW equivalent in SI must warm the air equally.
    const ipDuty = powerAsDuty(3, 'IP');
    const siDuty = powerAsDuty(2.2371, 'SI');
    // MBH to kW.
    expect(ipDuty * 0.29307107).toBeCloseTo(siDuty, 3);
  });
});

describe('converting comfort inputs', () => {
  it('treats the radiant offset as a difference, not a temperature', () => {
    // 9 °F of offset is 5 °C of offset. Converting it as an absolute would give
    // −12.8 and invert the sense of the radiant environment.
    const converted = convertComfort(
      { mrtOffset: 9, adaptiveIndoor: 75, adaptivePrevailing: 68 },
      'IP',
      'SI',
    );
    expect(converted.mrtOffset).toBeCloseTo(5, 3);
    expect(converted.adaptiveIndoor).toBeCloseTo(23.889, 2);
    expect(converted.adaptivePrevailing).toBeCloseTo(20, 3);
  });

  it('round-trips to within the deliberate rounding', () => {
    // Converted values are rounded to three decimals so input boxes do not fill
    // with digits nobody typed. 74 °F becomes 23.333 °C and returns as 73.999 —
    // a thousandth of a degree, which is the price of that rounding and is
    // several orders below anything a designer works to.
    const original = { mrtOffset: 4, adaptiveIndoor: 74, adaptivePrevailing: 66 };
    const back = convertComfort(convertComfort(original, 'IP', 'SI'), 'SI', 'IP');
    expect(back.mrtOffset).toBeCloseTo(4, 2);
    expect(back.adaptiveIndoor).toBeCloseTo(74, 2);
    expect(back.adaptivePrevailing).toBeCloseTo(66, 2);
  });
});

describe('converting altitude', () => {
  it('converts feet to metres', () => {
    expect(convertAltitude(5280, 'IP', 'SI')).toBeCloseTo(1609.34, 1);
    expect(convertAltitude(1609.344, 'SI', 'IP')).toBeCloseTo(5280, 1);
  });
});
