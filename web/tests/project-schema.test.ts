/**
 * The project file format.
 *
 * The JSON Schema is authoritative — it validates files written by any version
 * of the app, including ones this build has never seen. These tests assert that
 * the TypeScript types and the schema agree, and in particular that a
 * multi-airstream project (energy recovery, indirect evaporative) is
 * expressible, since that was decided in Phase 0 specifically to avoid a
 * retrofit later.
 *
 * @see PLAN.md §13 decision 3
 */
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../shared/schema/project.schema.json' with { type: 'json' };
import { emptyProject, SCHEMA_VERSION, type Project } from '../src/types/project.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function expectValid(project: unknown, label: string): void {
  const ok = validate(project);
  expect(ok, `${label}: ${ajv.errorsText(validate.errors, { separator: '\n  ' })}`).toBe(true);
}

describe('empty project', () => {
  it('validates', () => {
    expectValid(emptyProject('IP'), 'empty IP project');
    expectValid(emptyProject('SI'), 'empty SI project');
  });

  it('declares the current schema version', () => {
    expect(emptyProject().schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('single-airstream project', () => {
  const project: Project = {
    schemaVersion: 1,
    units: 'IP',
    meta: { name: 'Test AHU', engineer: 'PP' },
    atmosphere: { basis: 'altitude', altitude: 5280 },
    airstreams: [
      {
        id: 'supply',
        name: 'Supply air',
        role: 'supply',
        stages: [
          { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 2000, params: { tdb: 95, rh: 0.4 } },
          { id: 'cc', type: 'cooling', name: 'Cooling coil', params: { power: 60, shr: 0.75 } },
          { id: 'sf', type: 'fan', name: 'Supply fan', params: { power: 1.5 } },
          { id: 'zone', type: 'room', name: 'Zone', params: { sensible: 40, latent: 10 } },
        ],
      },
    ],
    chart: {
      projection: 'rectangular',
      families: { relativeHumidity: true, wetBulb: true, enthalpy: true, specificVolume: false },
    },
  };

  it('validates', () => {
    expectValid(project, 'single-airstream project');
  });
});

describe('multi-airstream project with cross-stream coupling', () => {
  const project: Project = {
    schemaVersion: 1,
    units: 'SI',
    atmosphere: { basis: 'standard' },
    airstreams: [
      {
        id: 'supply',
        name: 'Supply air',
        role: 'supply',
        stages: [
          { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 1000, params: { tdb: 32, rh: 0.5 } },
          {
            id: 'wheel',
            type: 'recovery-wheel-enthalpy',
            name: 'Enthalpy wheel',
            params: { effectivenessSensible: 0.75, effectivenessLatent: 0.68 },
            couplings: [{ role: 'exchange-stream', airstreamId: 'exhaust', stageId: 'ra' }],
          },
          {
            id: 'mix',
            type: 'mixing',
            name: 'Mixing box',
            couplings: [{ role: 'second-stream', airstreamId: 'exhaust' }],
          },
          { id: 'cc', type: 'cooling', name: 'Cooling coil', params: { tdbOut: 13, rhOut: 0.93 } },
        ],
      },
      {
        id: 'exhaust',
        name: 'Exhaust air',
        role: 'exhaust',
        stages: [
          { id: 'ra', type: 'source', name: 'Return air', airflow: 900, params: { tdb: 24, rh: 0.5 } },
        ],
      },
    ],
  };

  it('validates a two-stream system', () => {
    expectValid(project, 'multi-airstream project');
  });

  it('expresses every coupling role the process set needs', () => {
    const roles = ['second-stream', 'exchange-stream', 'secondary-stream', 'paired-leg'];
    for (const role of roles) {
      const withRole = structuredClone(project) as Project;
      withRole.airstreams[0]!.stages[1]!.couplings = [
        { role: role as never, airstreamId: 'exhaust' },
      ];
      expectValid(withRole, `coupling role ${role}`);
    }
  });
});

describe('schema rejects malformed projects', () => {
  it('rejects an unknown schema version', () => {
    const bad = { ...emptyProject(), schemaVersion: 2 };
    expect(validate(bad)).toBe(false);
  });

  it('rejects a missing atmosphere', () => {
    const bad = structuredClone(emptyProject()) as unknown as Record<string, unknown>;
    delete bad.atmosphere;
    expect(validate(bad)).toBe(false);
  });

  it('requires altitude when the basis is altitude', () => {
    const bad = { ...emptyProject(), atmosphere: { basis: 'altitude' } };
    expect(validate(bad)).toBe(false);
  });

  it('requires pressure when the basis is explicit', () => {
    const bad = { ...emptyProject(), atmosphere: { basis: 'explicit' } };
    expect(validate(bad)).toBe(false);
  });

  it('rejects an empty airstream list', () => {
    const bad = { ...emptyProject(), airstreams: [] };
    expect(validate(bad)).toBe(false);
  });

  it('rejects an unknown stage type', () => {
    const bad = structuredClone(emptyProject()) as Project;
    bad.airstreams[0]!.stages = [{ id: 'x', type: 'teleporter' as never }];
    expect(validate(bad)).toBe(false);
  });

  it('rejects an id with illegal characters', () => {
    const bad = structuredClone(emptyProject()) as Project;
    bad.airstreams[0]!.id = 'has spaces';
    expect(validate(bad)).toBe(false);
  });

  it('rejects an air speed below zero', () => {
    const bad = { ...emptyProject(), comfort: { airSpeed: -0.1 } };
    expect(validate(bad)).toBe(false);
  });
});

describe('comfort settings', () => {
  it('accepts the v1 PMV configuration', () => {
    const project = {
      ...emptyProject(),
      comfort: {
        model: 'pmv' as const,
        metabolicRate: 1.1,
        clothing: [0.5, 1.0],
        airSpeed: 0.1,
        meanRadiantTemperatureOffset: 0,
        temperatureOffset: 0,
      },
    };
    expectValid(project, 'PMV comfort settings');
  });

  it('reserves temperatureOffset for the SET cooling effect', () => {
    // Non-zero must validate even though v1 never sets it, so that a file
    // written by a later build with SET support still loads here.
    const project = { ...emptyProject(), comfort: { temperatureOffset: -1.8 } };
    expectValid(project, 'reserved SET offset');
  });
});
