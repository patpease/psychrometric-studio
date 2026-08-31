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
  blankSystem,
  type SessionSystem,
} from '../src/io/project.js';
import { validateProject } from '../src/io/validate.js';
import { SCHEMA_VERSION, systemLabel } from '../src/types/project.js';
import { decodeProject, encodeProject, readFragment, shareLink, MAX_URL_LENGTH } from '../src/io/url.js';
import { toCsv, toCombinedCsv } from '../src/io/csv.js';
import { buildReportPayload } from '../src/io/report.js';
import { solveSystem } from '../src/processes/chain.js';
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

/** A session holding one cooling case, which is what most of these assert on. */
function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    units: 'IP',
    pressureMode: 'sea-level',
    altitude: 0,
    explicitPressure: '',
    systems: [blankSystem('cooling', 'IP', STAGES)],
    activeSystem: 0,
    comfort: defaultComfortSettings('IP'),
    station: null,
    meta: { name: 'Test AHU', engineer: 'PP' },
    ...overrides,
  };
}

/** Apply overrides to the one system a `session()` fixture holds. */
function withSystem(
  overrides: Partial<SessionSystem>,
  rest: Partial<SessionState> = {},
): SessionState {
  const base = session(rest);
  return { ...base, systems: [{ ...base.systems[0]!, ...overrides }] };
}

function solve(stages: Stage[] = STAGES) {
  const pressure = standardAtmosphere('IP').pressure;
  return solveSystem(
    { airstreams: [{ id: 'supply', name: 'Supply', role: 'supply', stages }] },
    pressure,
    'IP',
  ).airstreams[0]!;
}

/* -------------------------------------------------------------------------- */

describe('round trip', () => {
  it('restores a session unchanged', () => {
    const original = withSystem(
      {
        domain: { tdbMin: 40, tdbMax: 110, wMin: 0.002, wMax: 0.026 },
        showProtractor: true,
        visibility: { ...DEFAULT_VISIBILITY, dewPoint: true, specificVolume: false },
      },
      {
        pressureMode: 'altitude',
        altitude: 5280,
        comfort: { ...defaultComfortSettings('IP'), met: 1.3, clothing: [0.9, 0.4], model: 'adaptive' },
      },
    );

    const restored = fromProject(readProject(writeProject(toProject(original))).project!);

    // `meta` is compared separately: saving stamps it with a timestamp and a
    // version, which is the whole point and is not a round-trip failure.
    const { meta: _originalMeta, ...originalRest } = original;
    const { meta: _restoredMeta, ...restoredRest } = restored;
    expect(restoredRest).toEqual(originalRest);
  });

  it('survives the trip through a share link', () => {
    const original = withSystem({ domain: defaultDomain('SI') }, { units: 'SI' });
    const decoded = decodeProject(encodeProject(toProject(original)));
    expect(decoded.project).not.toBeNull();
    expect(fromProject(decoded.project!).systems[0]!.stages).toEqual(
      original.systems[0]!.stages,
    );
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
        station: { city: 'Denver', country: 'USA', wmo: '725650', elevation: 5413 },
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
      schemaVersion: SCHEMA_VERSION,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      systems: [
        {
          id: 'cooling',
          role: 'cooling',
          airstreams: [
            {
              id: 'a',
              name: 'A',
              stages: [{ id: 'cc', name: 'Cooling coil', type: 'cooling', airflow: -5 }],
            },
          ],
        },
      ],
    });
    expect(problems.join(' ')).toContain('Cooling coil');
  });

  it('catches a duplicate id, which a coupling would resolve to the wrong thing', () => {
    const { problems } = validateProject({
      schemaVersion: SCHEMA_VERSION,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      systems: [
        {
          id: 'cooling',
          role: 'cooling',
          airstreams: [
            { id: 'a', name: 'A', stages: [] },
            { id: 'a', name: 'B', stages: [] },
          ],
        },
      ],
    });
    expect(problems.join(' ')).toMatch(/repeats the id/);
  });

  it('catches a coupling pointing at an airstream that is not in the file', () => {
    const { problems } = validateProject({
      schemaVersion: SCHEMA_VERSION,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      systems: [
        {
          id: 'cooling',
          role: 'cooling',
          airstreams: [
            {
              id: 'supply',
              name: 'Supply',
              stages: [
                {
                  id: 'hr',
                  type: 'recovery-plate',
                  couplings: [{ role: 'exchange-stream', airstreamId: 'exhaust' }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(problems.join(' ')).toContain('exhaust');
  });

  it('does not resolve a coupling against another system', () => {
    // Airstream ids are scoped to their system. Heating naming a stream
    // "exhaust" must not satisfy a coupling written in the cooling case, or a
    // recovery device would silently exchange heat with the wrong duct.
    const { problems } = validateProject({
      schemaVersion: SCHEMA_VERSION,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      systems: [
        {
          id: 'cooling',
          role: 'cooling',
          airstreams: [
            {
              id: 'supply',
              name: 'Supply',
              stages: [
                {
                  id: 'hr',
                  type: 'recovery-plate',
                  couplings: [{ role: 'exchange-stream', airstreamId: 'exhaust' }],
                },
              ],
            },
          ],
        },
        {
          id: 'heating',
          role: 'heating',
          airstreams: [{ id: 'exhaust', name: 'Exhaust', stages: [] }],
        },
      ],
    });
    expect(problems.join(' ')).toContain('exhaust');
  });

  it('says plainly when a file comes from a newer build', () => {
    const { problems } = validateProject({ schemaVersion: 99, units: 'IP', atmosphere: { basis: 'standard' }, systems: [] });
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
  /** A v1 file, read the way a real one arrives: through the migration. */
  function openV1(extra: Record<string, unknown>): ReturnType<typeof fromProject> {
    const raw = {
      schemaVersion: 1,
      units: 'IP',
      atmosphere: { basis: 'standard' },
      airstreams: [{ id: 'a', name: 'A', stages: [] }],
      ...extra,
    };
    return fromProject(migrate(raw).raw as Project);
  }

  it('reads maxHumidityRatio as the top of an axis starting at zero', () => {
    const restored = openV1({ chart: { maxHumidityRatio: 0.024 } });
    expect(restored.systems[0]!.domain.wMin).toBe(0);
    expect(restored.systems[0]!.domain.wMax).toBe(0.024);
  });

  it('reads the positional clothing array as [winter, summer]', () => {
    expect(openV1({ comfort: { clothing: [1.1, 0.45] } }).comfort.clothing).toEqual([1.1, 0.45]);
  });
});

describe('migration', () => {
  it('is a no-op for a current file', () => {
    const project = toProject(session());
    expect(migrate(project).applied).toEqual([]);
  });

  it('chains across several versions', () => {
    // Two synthetic steps that hand off to the real v1→v2 one, so the chain
    // under test ends where a genuine old file would. The case this protects is
    // a file several versions behind — the one that gets forgotten when
    // migration is written after the fact.
    const original = { ...MIGRATIONS };
    try {
      MIGRATIONS[-2] = (raw) => ({ ...raw, schemaVersion: -1, stepped: [-2] });
      MIGRATIONS[-1] = (raw) => ({
        ...raw,
        schemaVersion: 1,
        stepped: [...(raw['stepped'] as number[]), -1],
      });
      const result = migrate({ schemaVersion: -2 });
      // The trailing 1 is the real migration: a chain does not stop at the last
      // synthetic step, it runs until the file is current.
      expect(result.applied).toEqual([-2, -1, 1]);
      expect((result.raw as Record<string, unknown>)['stepped']).toEqual([-2, -1]);
      expect((result.raw as Record<string, unknown>)['schemaVersion']).toBe(SCHEMA_VERSION);
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
    const link = shareLink(toProject(withSystem({ stages: many })), 'https://example.com/');
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

/* -------------------------------------------------------------------------- */

describe('two systems', () => {
  const HEATING: Stage[] = [
    { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 500, params: { tdb: 5, rh: 0.6 } },
    { id: 'hc', type: 'heating', name: 'Heating coil', params: { tdbOut: 92 } },
  ];

  function paired(): SessionState {
    const base = session();
    return {
      ...base,
      systems: [base.systems[0]!, blankSystem('heating', 'IP', HEATING)],
    };
  }

  it('saves both, not just the one on screen', () => {
    const written = toProject(paired());
    expect(written.systems).toHaveLength(2);
    expect(written.systems[1]!.airstreams[0]!.stages).toEqual(HEATING);
  });

  it('round-trips both chains independently', () => {
    const restored = fromProject(readProject(writeProject(toProject(paired()))).project!);
    expect(restored.systems).toHaveLength(2);
    expect(restored.systems[0]!.stages).toEqual(STAGES);
    expect(restored.systems[1]!.stages).toEqual(HEATING);
    expect(restored.systems[0]!.role).toBe('cooling');
    expect(restored.systems[1]!.role).toBe('heating');
  });

  it('remembers which system was open', () => {
    const written = toProject({ ...paired(), activeSystem: 1 });
    expect(fromProject(written).activeSystem).toBe(1);
  });

  it('clamps an active index that points past the end', () => {
    // A hand-edited file can name a system that is not there, and every site
    // that reaches for the active case would otherwise read undefined.
    const written = { ...toProject(paired()), activeSystem: 7 };
    expect(fromProject(written).activeSystem).toBe(1);
  });

  it('keeps each system on its own chart view', () => {
    const wide = { tdbMin: 0, tdbMax: 120, wMin: 0, wMax: 0.03 };
    const source = paired();
    const written = toProject({
      ...source,
      systems: [source.systems[0]!, { ...source.systems[1]!, domain: wide }],
    });
    const restored = fromProject(written);
    expect(restored.systems[1]!.domain).toEqual(wide);
    expect(restored.systems[0]!.domain).not.toEqual(wide);
  });

  it('writes a label only when it is not the default for the role', () => {
    // A file that spells out "Heating" pins today's wording forever. A renamed
    // system still keeps the name its author chose.
    const source = paired();
    expect(toProject(source).systems[1]!.label).toBeUndefined();

    const renamed = {
      ...source,
      systems: [source.systems[0]!, { ...source.systems[1]!, label: 'Morning warm-up' }],
    };
    expect(toProject(renamed).systems[1]!.label).toBe('Morning warm-up');
    expect(fromProject(toProject(renamed)).systems[1]!.label).toBe('Morning warm-up');
  });

  it('still fits in a share link with both systems', () => {
    // A second system was the obvious thing to push a link past the cap. It
    // does not, because the two chains compress against each other: the pair
    // costs a little over a hundred characters more than the one.
    const one = shareLink(toProject(session()), 'https://example.com/');
    const two = shareLink(toProject(paired()), 'https://example.com/');
    expect(two.usable).toBe(true);
    expect(two.length - one.length).toBeLessThan(400);
  });

  it('leaves an unnamed system to be called by its position', () => {
    // The default name is positional, so it is resolved where it is shown
    // rather than stored. Storing it would go stale the moment the systems
    // were reordered — the name would follow the case, not the position.
    const restored = fromProject(toProject(paired()));
    expect(restored.systems[1]!.label).toBe('');
    expect(systemLabel(restored.systems[1]!, 1)).toBe('System Mode 2');
    expect(systemLabel(restored.systems[0]!, 0)).toBe('System Mode 1');
  });

  it('lets a name its author wrote override the position', () => {
    const source = paired();
    const renamed = {
      ...source,
      systems: [source.systems[0]!, { ...source.systems[1]!, label: 'Morning warm-up' }],
    };
    expect(systemLabel(fromProject(toProject(renamed)).systems[1]!, 1)).toBe('Morning warm-up');
  });
});

describe('opening a version 1 file', () => {
  /** A project as the previous release wrote one. */
  const V1 = {
    schemaVersion: 1,
    units: 'IP',
    meta: { name: 'Old project', client: 'Acme' },
    atmosphere: { basis: 'altitude', altitude: 5280 },
    airstreams: [{ id: 'supply', name: 'Supply air', role: 'supply', stages: STAGES }],
    chart: { tdbRange: [40, 110], humidityRatioRange: [0, 0.026] },
    comfort: { model: 'pmv', clothingWinter: 1.0, clothingSummer: 0.5 },
    weather: {
      station: { city: 'Denver', country: 'USA', wmo: '725650' },
      mode: 'density',
      months: [6, 7, 8],
      hours: [],
      presetIndex: 2,
    },
  };

  const opened = readProject(JSON.stringify(V1));

  it('opens, and says it was upgraded', () => {
    expect(opened.problems).toEqual([]);
    expect(opened.project).not.toBeNull();
    expect(opened.migrated).toEqual([1]);
  });

  it('becomes a single cooling system', () => {
    const restored = fromProject(opened.project!);
    expect(restored.systems).toHaveLength(1);
    expect(restored.systems[0]!.role).toBe('cooling');
    expect(restored.systems[0]!.stages).toEqual(STAGES);
  });

  it('keeps the chart view the file was saved with', () => {
    const domain = fromProject(opened.project!).systems[0]!.domain;
    expect(domain.tdbMin).toBe(40);
    expect(domain.tdbMax).toBe(110);
    expect(domain.wMax).toBe(0.026);
  });

  it('splits the old weather object into station and filter', () => {
    // v1 kept the station and the hour filter in one place. They now live at
    // different levels, because every system reads the same file but looks at
    // different hours — so this is a split rather than a move.
    const restored = fromProject(opened.project!);
    expect(restored.station?.city).toBe('Denver');
    expect(restored.systems[0]!.weather.months).toEqual([6, 7, 8]);
    expect(restored.systems[0]!.weather.mode).toBe('density');
    expect(restored.systems[0]!.weather.presetIndex).toBe(2);
  });

  it('keeps everything that was already project-wide', () => {
    const restored = fromProject(opened.project!);
    expect(restored.meta.name).toBe('Old project');
    expect(restored.meta.client).toBe('Acme');
    expect(restored.altitude).toBe(5280);
    expect(restored.comfort.clothing).toEqual([1.0, 0.5]);
  });

  it('re-saves as a current file that validates', () => {
    const resaved = toProject(fromProject(opened.project!));
    expect(resaved.schemaVersion).toBe(SCHEMA_VERSION);
    expect(schemaValid(resaved), ajv.errorsText(schemaValid.errors)).toBe(true);
    expect(readProject(writeProject(resaved)).migrated).toEqual([]);
  });

  it('carries a v1 file with no weather at all', () => {
    const bare = { ...V1, weather: undefined };
    const restored = fromProject(readProject(JSON.stringify(bare)).project!);
    expect(restored.station).toBeNull();
    expect(restored.systems[0]!.weather.mode).toBe('off');
  });
});

/* -------------------------------------------------------------------------- */

describe('export filenames', () => {
  const AUG = new Date('2026-08-24T00:00:00Z');

  it('names the operating case on an export that holds only one', () => {
    // Two charts from one project are otherwise the same filename twice: the
    // second either overwrites the first, or does not and leaves two files
    // with no way to tell which case each one shows.
    expect(
      projectFilename({ name: 'Acme HQ' }, 'png', { qualifier: 'System Mode 2', now: AUG }),
    ).toBe('acme-hq-system-mode-2-2026-08-24.png');
  });

  it('carries a renamed case into the filename', () => {
    expect(
      projectFilename({ name: 'Acme HQ' }, 'csv', { qualifier: 'Morning warm-up', now: AUG }),
    ).toBe('acme-hq-morning-warm-up-2026-08-24.csv');
  });

  it('leaves a project file unqualified, because it holds every case', () => {
    expect(projectFilename({ name: 'Acme HQ' }, 'json', { now: AUG })).toBe(
      'acme-hq-2026-08-24.json',
    );
  });

  it('still accepts a bare date, as the older callers pass', () => {
    expect(projectFilename({ name: 'Acme HQ' }, 'pdf', AUG)).toBe('acme-hq-2026-08-24.pdf');
  });
});

/* -------------------------------------------------------------------------- */

describe('CSV columns line up with their headings', () => {
  /**
   * The existing CSV tests check that provenance, names, quoting and line
   * endings are right, and none of them would notice if a column moved without
   * its heading. That is the one CSV defect a reader cannot catch: every number
   * is present and plausible, just filed under the wrong name — a dew point
   * read as a relative humidity is 66 instead of 40, and nothing looks wrong.
   */
  const airstream = solve();
  const csv = toCsv({
    solved: airstream,
    units: 'IP',
    atmosphere: standardAtmosphere('IP'),
    meta: { name: 'Test AHU' },
    generated: new Date('2026-08-24T12:00:00.000Z'),
  });

  const section = csv.slice(csv.indexOf('# State points'), csv.indexOf('# Process loads'));
  const rows = section.split('\r\n').filter((line) => line && !line.startsWith('#'));
  const header = rows[0]!.split(',');
  const first = rows[1]!.split(',');
  const state = airstream.stages[0]!.result!.state;

  /** The value filed under the one heading that starts with `label`. */
  function underHeading(label: string): string {
    const index = header.findIndex((cell) => cell.startsWith(label));
    expect(index, `no "${label}" column in: ${header.join(' | ')}`).toBeGreaterThan(-1);
    return first[index]!;
  }

  it('files each state property under its own heading', () => {
    expect(Number(underHeading('Dry bulb'))).toBeCloseTo(state.tdb, 2);
    expect(Number(underHeading('Wet bulb'))).toBeCloseTo(state.twb, 2);
    expect(Number(underHeading('Relative humidity'))).toBeCloseTo(state.rh * 100, 1);
    expect(Number(underHeading('Dew point'))).toBeCloseTo(state.tdp, 2);
  });

  it('orders dew point after relative humidity, as the panel does', () => {
    const rh = header.findIndex((cell) => cell.startsWith('Relative humidity'));
    const tdp = header.findIndex((cell) => cell.startsWith('Dew point'));
    expect(tdp).toBe(rh + 1);
  });

  it('gives every heading a value and every value a heading', () => {
    // Guards the lookup above: a row shorter than its header would let
    // `underHeading` read undefined and quietly pass.
    expect(first).toHaveLength(header.length);
  });
});

/* -------------------------------------------------------------------------- */

describe('the combined schedule', () => {
  const HEATING: Stage[] = [
    { id: 'oa', type: 'source', name: 'Winter outdoor air', airflow: 500, params: { tdb: 5, rh: 0.6 } },
    { id: 'hc', type: 'heating', name: 'Heating coil', params: { tdbOut: 75 } },
  ];

  const combined = toCombinedCsv({
    cases: [
      { label: 'System Mode 1', solved: solve() },
      { label: 'System Mode 2', solved: solve(HEATING) },
    ],
    units: 'IP',
    atmosphere: standardAtmosphere('IP'),
    meta: { name: 'Test AHU' },
    generated: new Date('2026-08-24T12:00:00.000Z'),
  });

  it('states the provenance once, because it is true of the whole file', () => {
    // One project, one unit system, one site pressure, one build. Repeating it
    // per case invites two copies that disagree.
    const occurrences = combined.split('# Calculation basis:').length - 1;
    expect(occurrences).toBe(1);
  });

  it('names the cases it contains', () => {
    expect(combined).toContain('# Operating cases: System Mode 1, System Mode 2');
  });

  it('carries every case, each under its own banner', () => {
    expect(combined).toContain('# ===== System Mode 1 =====');
    expect(combined).toContain('# ===== System Mode 2 =====');
    for (const stage of STAGES) expect(combined).toContain(stage.name!);
    expect(combined).toContain('Winter outdoor air');
  });

  it('emits each case through the same generator the single export uses', () => {
    // The per-case block must be byte-identical to a single-case export's, or
    // two exports of one project disagree about the same numbers.
    const single = toCsv({
      solved: solve(HEATING),
      units: 'IP',
      atmosphere: standardAtmosphere('IP'),
      meta: { name: 'Test AHU' },
      generated: new Date('2026-08-24T12:00:00.000Z'),
    });
    const singleBody = single.slice(single.indexOf('# State points'));
    const combinedTail = combined.slice(combined.indexOf('# ===== System Mode 2 ====='));
    for (const line of singleBody.split('\r\n').filter(Boolean)) {
      expect(combinedTail, `missing from the combined file: ${line}`).toContain(line);
    }
  });

  it('sets the totals against each other, which is why the file exists', () => {
    const comparison = combined.slice(combined.indexOf('# Comparison'));
    expect(comparison).toContain('Quantity,System Mode 1,System Mode 2,Unit');
    // The cooling case cools and the heating case heats; a comparison that did
    // not distinguish them would be reading one case twice.
    const cooling = comparison.split('\r\n').find((l) => l.startsWith('Total cooling'))!;
    const heating = comparison.split('\r\n').find((l) => l.startsWith('Total heating'))!;
    const [, coolA, coolB] = cooling.split(',');
    const [, heatA, heatB] = heating.split(',');
    expect(Number(coolA)).toBeLessThan(0);
    expect(Number(coolB)).toBe(0);
    expect(Number(heatB)).toBeGreaterThan(0);
    expect(Number(heatA)).toBeGreaterThanOrEqual(0);
  });

  it('uses CRLF throughout, as the single-case export does', () => {
    expect(combined.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });
});
