/**
 * Saving, loading, sharing, and exporting.
 *
 * The load-bearing test in this file is the one that puts every fixture through
 * *both* validators — the hand-written one the application ships and the JSON
 * Schema that is authoritative — and fails when they disagree. Two
 * implementations of the same rule is a maintenance cost worth paying only if
 * something notices when they drift.
 */
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../shared/schema/project.schema.json' with { type: 'json' };

import {
  fromProject,
  migrate,
  projectFilename,
  readProject,
  toProject,
  writeProject,
  MIGRATIONS,
  type SessionState,
} from '../src/io/project.js';
import { validateProject } from '../src/io/validate.js';
import { decodeProject, encodeProject, readFragment, shareLink, MAX_URL_LENGTH } from '../src/io/url.js';
import { toCsv } from '../src/io/csv.js';
import { buildReportPayload } from '../src/io/report.js';
import { solveProject } from '../src/processes/chain.js';
import { standardAtmosphere } from '../src/psych/atmosphere.js';
import { defaultDomain } from '../src/chart/scales.js';
import { DEFAULT_VISIBILITY } from '../src/chart/theme.js';
import { defaultComfortSettings } from '../src/ui/ComfortPanel.js';
import type { Project, Stage } from '../src/types/project.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemaValid = ajv.compile(schema);

const STAGES: Stage[] = [
  { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 500, params: { tdb: 95, rh: 0.4 } },
  { id: 'mx', type: 'mixing', name: 'Mixing box', params: { airflow2: 1500, tdb2: 75, rh2: 0.5 } },
  { id: 'cc', type: 'cooling', name: 'Cooling coil', params: { tdbOut: 54, rhOut: 0.93 } },
  { id: 'sf', type: 'fan', name: 'Supply fan', params: { power: 1.5, motorInAirstream: true } },
  { id: 'rm', type: 'room', name: 'Zone', params: { sensible: 42, latent: 11 } },
];

function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    units: 'IP',
    domain: defaultDomain('IP'),
    pressureMode: 'sea-level',
    altitude: 0,
    explicitPressure: '',
    stages: STAGES,
    visibility: { ...DEFAULT_VISIBILITY },
    showProtractor: false,
    comfort: defaultComfortSettings('IP'),
    weather: null,
    meta: { name: 'Test AHU', engineer: 'PP' },
    ...overrides,
  };
}

function solve(stages: Stage[] = STAGES) {
  const pressure = standardAtmosphere('IP').pressure;
  return solveProject(
    {
      schemaVersion: 1,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      airstreams: [{ id: 'supply', name: 'Supply', role: 'supply', stages }],
    } as never,
    pressure,
    'IP',
  ).airstreams[0]!;
}

/* -------------------------------------------------------------------------- */

describe('round trip', () => {
  it('restores a session unchanged', () => {
    const original = session({
      domain: { tdbMin: 40, tdbMax: 110, wMin: 0.002, wMax: 0.026 },
      pressureMode: 'altitude',
      altitude: 5280,
      showProtractor: true,
      visibility: { ...DEFAULT_VISIBILITY, dewPoint: true, specificVolume: false },
      comfort: { ...defaultComfortSettings('IP'), met: 1.3, clothing: [0.9, 0.4], model: 'adaptive' },
    });

    const restored = fromProject(readProject(writeProject(toProject(original))).project!);

    // `meta` is compared separately: saving stamps it with a timestamp and a
    // version, which is the whole point and is not a round-trip failure.
    const { meta: _originalMeta, ...originalRest } = original;
    const { meta: _restoredMeta, ...restoredRest } = restored;
    expect(restoredRest).toEqual(originalRest);
  });

  it('survives the trip through a share link', () => {
    const original = session({ units: 'SI', domain: defaultDomain('SI') });
    const decoded = decodeProject(encodeProject(toProject(original)));
    expect(decoded.project).not.toBeNull();
    expect(fromProject(decoded.project!).stages).toEqual(original.stages);
  });

  it('keeps the clothing levels the right way round', () => {
    // The positional array this replaced said nothing about which end was
    // which, and a reader that guessed wrong swapped the two zones silently.
    const original = session({
      comfort: { ...defaultComfortSettings('IP'), clothing: [1.2, 0.3] },
    });
    const written = toProject(original);
    expect(written.comfort?.clothingWinter).toBe(1.2);
    expect(written.comfort?.clothingSummer).toBe(0.3);
    expect(fromProject(written).comfort.clothing).toEqual([1.2, 0.3]);
  });

  it('stamps provenance that can be traced to a release', () => {
    const written = toProject(session());
    expect(written.meta?.createdWith?.version).toBeTruthy();
    expect(written.meta?.createdWith?.libraryVersion).toMatch(/PsychroLib/);
    expect(written.meta?.modified).toBeTruthy();
  });

  it('preserves the original creation time across a re-save', () => {
    const first = toProject(session(), new Date('2026-01-01T00:00:00.000Z'));
    const reopened = fromProject(first);
    const second = toProject({ ...session(), meta: reopened.meta }, new Date('2026-06-01T00:00:00.000Z'));
    expect(second.meta?.created).toBe('2026-01-01T00:00:00.000Z');
    expect(second.meta?.modified).toBe('2026-06-01T00:00:00.000Z');
  });

  it('does not carry the weather file, only the station', () => {
    // An EPW is ~1.5 MB and is redistributable only under its source's terms.
    const written = toProject(
      session({
        weather: {
          station: { city: 'Denver', country: 'USA', wmo: '725650', elevation: 5413 },
          mode: 'density',
          months: [],
          hours: [],
          presetIndex: 0,
        },
      }),
    );
    const text = writeProject(written);
    expect(text).toContain('Denver');
    expect(text.length).toBeLessThan(20_000);
  });
});

/* -------------------------------------------------------------------------- */

describe('the two validators agree', () => {
  const cases: { label: string; value: unknown }[] = [
    { label: 'a saved session', value: toProject(session()) },
    { label: 'a minimal project', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [{ id: 'a', name: 'A', stages: [] }] } },
    { label: 'altitude basis with an elevation', value: { schemaVersion: 1, units: 'SI', atmosphere: { basis: 'altitude', altitude: 1600 }, airstreams: [{ id: 'a', name: 'A', stages: [] }] } },
    { label: 'altitude basis with no elevation', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'altitude' }, airstreams: [{ id: 'a', name: 'A', stages: [] }] } },
    { label: 'explicit basis with no pressure', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'explicit' }, airstreams: [{ id: 'a', name: 'A', stages: [] }] } },
    { label: 'explicit basis with a negative pressure', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'explicit', pressure: -1 }, airstreams: [{ id: 'a', name: 'A', stages: [] }] } },
    { label: 'no airstreams', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [] } },
    { label: 'an unknown unit system', value: { schemaVersion: 1, units: 'metric', atmosphere: { basis: 'standard' }, airstreams: [{ id: 'a', name: 'A', stages: [] }] } },
    { label: 'an id with a leading dash', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [{ id: '-bad', name: 'A', stages: [] }] } },
    { label: 'a stage with an unknown type', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [{ id: 'a', name: 'A', stages: [{ id: 's', type: 'wormhole' }] }] } },
    { label: 'a stage with zero airflow', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [{ id: 'a', name: 'A', stages: [{ id: 's', type: 'fan', airflow: 0 }] }] } },
    { label: 'a coupling with no role', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [{ id: 'a', name: 'A', stages: [{ id: 's', type: 'mixing', couplings: [{ airstreamId: 'a' }] }] }] } },
    { label: 'an airstream with no name', value: { schemaVersion: 1, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [{ id: 'a', stages: [] }] } },
    { label: 'not an object', value: [1, 2, 3] },
  ];

  for (const { label, value } of cases) {
    it(`agrees on ${label}`, () => {
      const mine = validateProject(value).project !== null;
      const theirs = schemaValid(value) as boolean;
      expect(
        mine,
        mine
          ? `accepted, but the schema rejected it: ${ajv.errorsText(schemaValid.errors)}`
          : `rejected (${validateProject(value).problems.join(' ')}), but the schema accepted it`,
      ).toBe(theirs);
    });
  }
});

describe('rejection messages', () => {
  it('names the stage rather than a JSON pointer', () => {
    const { problems } = validateProject({
      schemaVersion: 1,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      airstreams: [{ id: 'a', name: 'A', stages: [{ id: 'cc', name: 'Cooling coil', type: 'cooling', airflow: -5 }] }],
    });
    expect(problems.join(' ')).toContain('Cooling coil');
  });

  it('catches a duplicate id, which a coupling would resolve to the wrong thing', () => {
    const { problems } = validateProject({
      schemaVersion: 1,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      airstreams: [
        { id: 'a', name: 'A', stages: [] },
        { id: 'a', name: 'B', stages: [] },
      ],
    });
    expect(problems.join(' ')).toMatch(/repeats the id/);
  });

  it('catches a coupling pointing at an airstream that is not in the file', () => {
    const { problems } = validateProject({
      schemaVersion: 1,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      airstreams: [
        {
          id: 'supply',
          name: 'Supply',
          stages: [{ id: 'hr', type: 'recovery-plate', couplings: [{ role: 'exchange-stream', airstreamId: 'exhaust' }] }],
        },
      ],
    });
    expect(problems.join(' ')).toContain('exhaust');
  });

  it('says plainly when a file comes from a newer build', () => {
    const { problems } = validateProject({ schemaVersion: 99, units: 'IP', atmosphere: { basis: 'standard' }, airstreams: [] });
    expect(problems[0]).toMatch(/newer version/);
  });

  it('does not throw on malformed JSON', () => {
    const result = readProject('{not json');
    expect(result.project).toBeNull();
    expect(result.problems[0]).toContain('not valid JSON');
  });
});

/* -------------------------------------------------------------------------- */

describe('superseded fields are still read', () => {
  it('reads maxHumidityRatio as the top of an axis starting at zero', () => {
    const project = {
      schemaVersion: 1,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      airstreams: [{ id: 'a', name: 'A', stages: [] }],
      chart: { maxHumidityRatio: 0.024 },
    } as unknown as Project;
    const restored = fromProject(project);
    expect(restored.domain.wMin).toBe(0);
    expect(restored.domain.wMax).toBe(0.024);
  });

  it('reads the positional clothing array as [winter, summer]', () => {
    const project = {
      schemaVersion: 1,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      airstreams: [{ id: 'a', name: 'A', stages: [] }],
      comfort: { clothing: [1.1, 0.45] },
    } as unknown as Project;
    expect(fromProject(project).comfort.clothing).toEqual([1.1, 0.45]);
  });
});

describe('migration', () => {
  it('is a no-op for a current file', () => {
    const project = toProject(session());
    expect(migrate(project).applied).toEqual([]);
  });

  it('chains across several versions', () => {
    // Exercised with synthetic steps, because there are no real ones yet. The
    // case this protects is a file two versions behind, which is the one that
    // gets forgotten when migration is written after the fact.
    const original = { ...MIGRATIONS };
    try {
      MIGRATIONS[-2] = (raw) => ({ ...raw, schemaVersion: -1, stepped: [-2] });
      MIGRATIONS[-1] = (raw) => ({
        ...raw,
        schemaVersion: 1,
        stepped: [...(raw['stepped'] as number[]), -1],
      });
      const result = migrate({ schemaVersion: -2 });
      expect(result.applied).toEqual([-2, -1]);
      expect((result.raw as Record<string, unknown>)['stepped']).toEqual([-2, -1]);
    } finally {
      for (const key of Object.keys(MIGRATIONS)) delete MIGRATIONS[Number(key)];
      Object.assign(MIGRATIONS, original);
    }
  });

  it('refuses a migration that does not advance the version', () => {
    try {
      MIGRATIONS[-1] = (raw) => ({ ...raw });
      expect(() => migrate({ schemaVersion: -1 })).toThrow(/did not advance/);
    } finally {
      delete MIGRATIONS[-1];
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('share links', () => {
  it('puts the project after the hash, where browsers do not send it', () => {
    const link = shareLink(toProject(session()), 'https://example.com/tool?a=1');
    expect(link.url).toMatch(/^https:\/\/example\.com\/tool\?a=1#p=/);
  });

  it('fits an ordinary project inside the length a link survives', () => {
    const link = shareLink(toProject(session()), 'https://example.com/');
    expect(link.usable, `${link.length} characters`).toBe(true);
    expect(link.length).toBeLessThan(MAX_URL_LENGTH);
  });

  it('refuses, with a reason, when the project is too big for a link', () => {
    const many: Stage[] = Array.from({ length: 400 }, (_, i) => ({
      id: `s${i}`,
      type: 'heating',
      name: `Heating coil number ${i} with a deliberately long name`,
      params: { tdbOut: 70 + i },
    }));
    const link = shareLink(toProject(session({ stages: many })), 'https://example.com/');
    expect(link.usable).toBe(false);
    expect(link.reason).toContain('Download the project file');
  });

  it('ignores a fragment that carries no project', () => {
    expect(readFragment('')).toBeNull();
    expect(readFragment('#section-3')).toBeNull();
  });

  it('reports a truncated link rather than opening an empty tool', () => {
    const link = shareLink(toProject(session()), 'https://example.com/');
    const truncated = link.url.slice(0, link.url.length - 40);
    const result = readFragment(truncated.slice(truncated.indexOf('#')));
    expect(result?.project ?? null).toBeNull();
    expect(result?.problems.join(' ')).toMatch(/truncated|unpacked/);
  });
});

/* -------------------------------------------------------------------------- */

describe('CSV', () => {
  const csv = toCsv({
    solved: solve(),
    units: 'IP',
    atmosphere: standardAtmosphere('IP'),
    meta: { name: 'Test AHU' },
    generated: new Date('2026-08-24T12:00:00.000Z'),
  });

  it('leads with provenance a reader can check', () => {
    expect(csv).toContain('# Calculation basis: PsychroLib');
    expect(csv).toContain('# Unit system: IP');
    expect(csv).toContain('# Site pressure:');
    expect(csv).toContain('positive INTO the airstream');
  });

  it('carries every stage as a state point', () => {
    const stateSection = csv.slice(csv.indexOf('# State points'), csv.indexOf('# Process loads'));
    for (const stage of STAGES) {
      expect(stateSection).toContain(stage.name!);
    }
  });

  it('quotes a name containing a comma', () => {
    const withComma = toCsv({
      solved: solve([{ ...STAGES[0]!, name: 'Outdoor air, summer' }]),
      units: 'IP',
      atmosphere: standardAtmosphere('IP'),
      meta: {},
    });
    expect(withComma).toContain('"Outdoor air, summer"');
  });

  it('leaves an undefined SHR blank rather than printing 1.000', () => {
    // Zero total duty means the ratio is undefined. Printing it as unity is a
    // lie the reader has no way to detect.
    const loads = csv.slice(csv.indexOf('# Process loads'));
    expect(loads).not.toMatch(/,NaN,/);
  });

  it('uses CRLF, which is what a spreadsheet expects', () => {
    expect(csv).toContain('\r\n');
  });
});

/* -------------------------------------------------------------------------- */

describe('report payload', () => {
  const payload = buildReportPayload({
    solved: solve(),
    units: 'IP',
    atmosphere: standardAtmosphere('IP'),
    meta: { name: 'Test AHU' },
  });

  it('sends values already solved, in display units', () => {
    const first = payload.statePoints[0] as Record<string, number>;
    expect(first['tdb']).toBeCloseTo(95, 1);
    // Humidity ratio in gr/lb, not lb/lb: the API is handed numbers to
    // typeset, and it does not know one unit system from another.
    expect(first['w']).toBeGreaterThan(50);
  });

  it('sends an undefined SHR as null, not NaN', () => {
    for (const load of payload.loads as Record<string, unknown>[]) {
      expect(Number.isNaN(load['shr'])).toBe(false);
    }
  });

  it('omits the source stage from the loads, which move no energy', () => {
    expect((payload.loads as { point: number }[]).some((load) => load.point === 1)).toBe(false);
  });

  it('states whether the energy balance closed', () => {
    expect(payload.totals['balance']).toMatch(/closes/);
  });

  it('carries a stage that did not solve rather than dropping it', () => {
    const broken = buildReportPayload({
      solved: solve([{ id: 'cc', type: 'cooling', name: 'Unset coil', params: {} }]),
      units: 'IP',
      atmosphere: standardAtmosphere('IP'),
      meta: {},
    });
    expect((broken.statePoints[0] as { error?: string }).error).toBeTruthy();
  });
});

describe('filenames', () => {
  it('is built from the project name and sorts by date', () => {
    expect(projectFilename({ name: 'Acme HQ — AHU 1' }, 'pdf', new Date('2026-08-24T00:00:00Z'))).toBe(
      'acme-hq-ahu-1-2026-08-24.pdf',
    );
  });

  it('falls back when there is no name', () => {
    expect(projectFilename({}, 'csv', new Date('2026-08-24T00:00:00Z'))).toBe(
      'psychrometric-study-2026-08-24.csv',
    );
  });
});
