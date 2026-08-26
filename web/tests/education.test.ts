/**
 * Tests for the education module.
 *
 * The content is prose, so most of it cannot be asserted. What *can* be
 * asserted is everything structural — that every stage type has an entry, that
 * every cross-reference resolves, that every icon is either real or explicitly
 * pending — plus the one behavioural claim the module makes: that the design
 * checks fire when they should and stay silent when they should not.
 *
 * The silence half matters more than the firing half. A rule that fires on the
 * tool's own default system has taught the user to ignore it by the second
 * minute, so that is asserted first.
 */
import { describe, it, expect } from 'vitest';
import { AVAILABLE_STAGE_TYPES } from '../src/processes/registry.js';
import { solveProject } from '../src/processes/chain.js';
import { standardAtmosphere } from '../src/psych/atmosphere.js';
import { fromTdbRh } from '../src/psych/state.js';
import { ICON_SOURCES, ICON_NAMES } from '../src/icons/generated.js';
import { STAGE_ICONS, PENDING_ICONS, iconExists } from '../src/icons/map.js';
import { EQUIPMENT } from '../src/education/equipment.js';
import { CONCEPTS, CONCEPT_GROUPS } from '../src/education/concepts.js';
import { WALKTHROUGH } from '../src/education/walkthrough.js';
import { topicFor, topicLabel, runCheck, observedMoves } from '../src/education/index.js';
import type { Stage, StageType } from '../src/types/project.js';
import type { StageResult } from '../src/processes/types.js';
import type { UnitSystem } from '../src/psych/units.js';

const IP_PRESSURE = standardAtmosphere('IP').pressure;

function solve(stages: Stage[], units: UnitSystem = 'IP') {
  const pressure = units === 'IP' ? IP_PRESSURE : standardAtmosphere('SI').pressure;
  return solveProject(
    {
      schemaVersion: 1,
      units,
      atmosphere: { basis: 'standard' },
      airstreams: [{ id: 'supply', name: 'Supply', role: 'supply', stages }],
    } as never,
    pressure,
    units,
  ).airstreams[0]!.stages;
}

/** The system the tool opens with, and the one the walkthrough builds. */
const STARTER: Stage[] = [
  { id: 'oa', type: 'source', name: 'Outdoor air', airflow: 500, params: { tdb: 95, rh: 0.4 } },
  { id: 'mx', type: 'mixing', name: 'Mixing box', params: { airflow2: 1500, tdb2: 75, rh2: 0.5 } },
  { id: 'cc', type: 'cooling', name: 'Cooling coil', params: { tdbOut: 54, rhOut: 0.93 } },
  { id: 'sf', type: 'fan', name: 'Supply fan', params: { power: 1.5, motorInAirstream: true } },
  { id: 'rm', type: 'room', name: 'Zone', params: { sensible: 42, latent: 11 } },
];

/** Run every stage's check against a solved chain, as the App does. */
function checksFor(stages: Stage[], units: UnitSystem = 'IP'): (string | null)[] {
  const solved = solve(stages, units);
  return solved.map((entry, index) => {
    const previous = index > 0 ? solved[index - 1]?.result : undefined;
    return runCheck(
      entry.stage.type,
      entry.stage,
      entry.result,
      previous?.state ?? null,
      previous?.massFlow ?? null,
      units,
    );
  });
}

describe('content coverage', () => {
  it('has an entry for every stage type a user can add', () => {
    for (const type of AVAILABLE_STAGE_TYPES) {
      expect(EQUIPMENT[type], `no education entry for ${type}`).toBeDefined();
      expect(EQUIPMENT[type]!.text.length).toBeGreaterThan(80);
      expect(EQUIPMENT[type]!.check.length).toBeGreaterThan(60);
    }
  });

  it('says what every *process* moves', () => {
    // A source is a declared state, not a process: there is no entering
    // condition to compare against, so it has nothing to move and the panel
    // omits the section entirely. Everything that acts on air must describe
    // what it does to it.
    for (const type of AVAILABLE_STAGE_TYPES) {
      if (type === 'source') continue;
      expect(EQUIPMENT[type]!.moves.length, `${type} describes no movement`).toBeGreaterThan(0);
    }
    expect(EQUIPMENT.source.moves).toEqual([]);
  });

  it('resolves every see-also cross-reference', () => {
    const unresolved: string[] = [];
    for (const entry of Object.values(EQUIPMENT)) {
      for (const id of entry.seeAlso ?? []) {
        if (!topicFor(id)) unresolved.push(`${entry.id} → ${id}`);
      }
    }
    for (const concept of Object.values(CONCEPTS)) {
      for (const id of concept.seeAlso ?? []) {
        if (!topicFor(id)) unresolved.push(`${concept.id} → ${id}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('lists only real concepts in the index groups', () => {
    for (const group of CONCEPT_GROUPS) {
      for (const id of group.ids) {
        expect(CONCEPTS[id], `${group.label} lists unknown concept ${id}`).toBeDefined();
      }
    }
  });

  it('keeps every tooltip to a single sentence', () => {
    // The tooltip is read in passing. Two sentences is a paragraph, and a
    // paragraph in a popup is text nobody reads.
    for (const concept of Object.values(CONCEPTS)) {
      const sentences = concept.summary.split(/[.!?](\s|$)/).filter((part) => part.trim().length > 2);
      expect(sentences.length, `${concept.id}: "${concept.summary}"`).toBeLessThanOrEqual(1);
      expect(concept.summary.length, concept.id).toBeLessThanOrEqual(180);
    }
  });

  it('gives every concept referenced by a walkthrough step', () => {
    for (const step of WALKTHROUGH.steps) {
      for (const id of step.concepts ?? []) {
        expect(topicLabel(id), `step ${step.id} → ${id}`).not.toBeNull();
      }
    }
  });
});

describe('icons', () => {
  it('maps every stage type to an icon name', () => {
    for (const type of AVAILABLE_STAGE_TYPES) {
      expect(STAGE_ICONS[type], `no icon mapped for ${type}`).toBeTruthy();
    }
  });

  it('resolves every mapped icon to real artwork or a declared pending one', () => {
    // The point of this test is that a mapping typo cannot hide behind the
    // placeholder. A name is allowed to be missing only if someone wrote down
    // that it is missing and why.
    const undeclared = Object.entries(STAGE_ICONS)
      .filter(([, name]) => !iconExists(name) && !(name in PENDING_ICONS))
      .map(([type, name]) => `${type} → ${name}`);
    expect(undeclared).toEqual([]);
  });

  it('has real artwork for every stage type, with nothing left pending', () => {
    const placeholders = Object.values(STAGE_ICONS).filter((name) => !iconExists(name));
    expect(placeholders).toEqual([]);
    expect(Object.keys(PENDING_ICONS).filter((name) => !iconExists(name))).toEqual([]);
  });

  it('draws the six late arrivals on the same canvas as the rest', () => {
    // Supplied separately from the original set, so worth checking they match
    // it: same 48x48 grid, same outline colour handed to CSS. The generator
    // enforces the viewBox and would have refused a mismatched one, but it
    // cannot tell a correct icon from an empty one.
    for (const name of [
      'outdoor-air',
      'room-zone',
      'sensible-wheel',
      'wraparound-precool',
      'wraparound-reheat',
      'indirect-evaporative',
    ]) {
      const body = ICON_SOURCES[name];
      expect(body, `${name} is not in the generated set`).toBeTruthy();
      expect(body!.length, `${name} looks empty`).toBeGreaterThan(60);
      expect(body, `${name} keeps a hard-coded outline colour`).toContain('currentColor');
    }
  });

  it('recolours the artwork outline so one icon serves both themes', () => {
    // The supplied SVGs draw their outline in a near-black green. Left alone it
    // is invisible on the dark theme, so the generator hands it to CSS.
    const withInk = ICON_NAMES.filter((name) => /#0B2B28/i.test(ICON_SOURCES[name]!));
    expect(withInk).toEqual([]);
    expect(ICON_SOURCES['cooling-coil']).toContain('currentColor');
  });

  it('strips the outer svg wrapper so the component owns sizing', () => {
    for (const name of ICON_NAMES) {
      expect(ICON_SOURCES[name], name).not.toContain('<svg');
    }
  });
});

describe('design checks stay quiet on a good design', () => {
  it('reports nothing on the system the tool opens with', () => {
    const notes = checksFor(STARTER);
    const fired = notes
      .map((note, index) => (note ? `${STARTER[index]!.type}: ${note}` : null))
      .filter(Boolean);
    expect(fired).toEqual([]);
  });

  it('reports nothing on that same system in SI', () => {
    // Thresholds are in kelvin and converted for display. A rule comparing a
    // Fahrenheit delta against a Celsius limit is wrong in one system of two,
    // and this is the test that catches it.
    const si: Stage[] = [
      { id: 'oa', type: 'source', airflow: 236, params: { tdb: 35, rh: 0.4 } },
      { id: 'mx', type: 'mixing', params: { airflow2: 708, tdb2: 23.9, rh2: 0.5 } },
      { id: 'cc', type: 'cooling', params: { tdbOut: 12.2, rhOut: 0.93 } },
      { id: 'sf', type: 'fan', params: { power: 1.12, motorInAirstream: true } },
      { id: 'rm', type: 'room', params: { sensible: 12.3, latent: 3.2 } },
    ];
    const fired = checksFor(si, 'SI').filter(Boolean);
    expect(fired).toEqual([]);
  });

  it('closes the loop it claims to close', () => {
    // The walkthrough tells the reader the zone lands back where they started.
    // If the airflows drift, that sentence becomes a lie, so it is pinned.
    const solved = solve(STARTER);
    const room = solved[4]!.result!;
    expect(room.state.tdb).toBeCloseTo(75.67, 1);
    expect(room.state.rh).toBeCloseTo(0.497, 2);
  });
});

describe('design checks fire when they should', () => {
  it('questions a dehumidifying coil that leaves air well below saturation', () => {
    const stages: Stage[] = [
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 85, rh: 0.6 } },
      { id: 'cc', type: 'cooling', params: { tdbOut: 60, rhOut: 0.6 } },
    ];
    expect(checksFor(stages)[1]).toMatch(/90–95%/);
  });

  it('warns that heating alone leaves winter air very dry', () => {
    const stages: Stage[] = [
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 20, rh: 0.6 } },
      { id: 'hc', type: 'heating', params: { tdbOut: 75 } },
    ];
    expect(checksFor(stages)[1]).toMatch(/RH/);
  });

  it('flags an evaporative cooler in a climate that cannot support it', () => {
    // 80 °F at 85% RH leaves barely three degrees of wet-bulb depression.
    const stages: Stage[] = [
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 80, rh: 0.85 } },
      { id: 'ev', type: 'evaporative-direct', params: { effectiveness: 0.85 } },
    ];
    expect(checksFor(stages)[1]).toMatch(/climate question/);
  });

  it('challenges a recovery effectiveness above the achievable band', () => {
    const stages: Stage[] = [
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 10, rh: 0.6 } },
      {
        id: 'hr',
        type: 'recovery-plate',
        params: { sensible: 0.92, tdb3: 72, rh3: 0.4, airflow3: 2000 },
      },
    ];
    expect(checksFor(stages)[1]).toMatch(/certified rating/);
  });

  it('always says the desiccant model is an idealisation', () => {
    // Not a failure condition — a standing caveat, because the model itself is
    // an approximation and the user is entitled to know that every time.
    const stages: Stage[] = [
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 85, rh: 0.6 } },
      { id: 'dw', type: 'desiccant', params: { removal: 0.5 } },
    ];
    expect(checksFor(stages)[1]).toMatch(/isenthalpic idealisation/);
  });

  it('asks about a mixture with very little outdoor air, by mass not volume', () => {
    const stages: Stage[] = [
      { id: 'oa', type: 'source', airflow: 100, params: { tdb: 95, rh: 0.4 } },
      { id: 'mx', type: 'mixing', params: { airflow2: 3000, tdb2: 75, rh2: 0.5 } },
    ];
    expect(checksFor(stages)[1]).toMatch(/ventilation rate/);
  });

  it('never throws, whatever a rule is handed', () => {
    // A rule is the least important thing on screen. If one breaks it must not
    // take the panel — or the solved result beside it — down with it.
    const broken = { state: null } as unknown as StageResult;
    for (const type of AVAILABLE_STAGE_TYPES) {
      expect(() =>
        runCheck(type as StageType, { id: 'x', type } as Stage, broken, null, null, 'IP'),
      ).not.toThrow();
    }
  });
});

describe('observed movement', () => {
  it('reports humidity ratio as unchanged across a heating coil', () => {
    const solved = solve([
      { id: 'oa', type: 'source', airflow: 2000, params: { tdb: 55, rh: 0.5 } },
      { id: 'hc', type: 'heating', params: { tdbOut: 75 } },
    ]);
    const moves = observedMoves(solved[0]!.result!.state, solved[1]!.result!.state, 'IP');
    const byProperty = new Map(moves.map((move) => [move.property, move]));
    expect(byProperty.get('w')!.direction).toBe('constant');
    expect(byProperty.get('tdb')!.direction).toBe('up');
    expect(byProperty.get('rh')!.direction).toBe('down');
  });

  it('returns nothing for a source stage, which has no entering state', () => {
    expect(observedMoves(null, fromTdbRh(75, 0.5, IP_PRESSURE, 'IP'), 'IP')).toEqual([]);
  });
});

describe('the walkthrough', () => {
  it('carries the complete chain at every step, never a diff', () => {
    // Steps are cumulative by construction so that stepping backwards restores
    // a step exactly. A step that carried only its own new stage would depend
    // on the order the user moved through, which is not a guarantee worth
    // making.
    let previous = 0;
    for (const step of WALKTHROUGH.steps) {
      expect(step.stages.length, step.id).toBeGreaterThanOrEqual(previous);
      previous = step.stages.length;
    }
    expect(WALKTHROUGH.steps[WALKTHROUGH.steps.length - 1]!.stages).toHaveLength(5);
  });

  it('solves cleanly at every step', () => {
    for (const step of WALKTHROUGH.steps) {
      const solved = solve([...step.stages]);
      const errors = solved.filter((entry) => entry.error).map((entry) => `${step.id}: ${entry.error}`);
      expect(errors).toEqual([]);
    }
  });

  it('gives every question exactly one correct answer, and a response to each', () => {
    for (const step of WALKTHROUGH.steps) {
      if (!step.question) continue;
      const correct = step.question.options.filter((option) => option.correct);
      expect(correct, `${step.id} has ${correct.length} correct answers`).toHaveLength(1);
      for (const option of step.question.options) {
        // A wrong answer that just says "no" teaches nothing; every option
        // explains itself.
        expect(option.response.length, `${step.id}: ${option.label}`).toBeGreaterThan(60);
      }
    }
  });

  it('focuses a stage that exists at that step', () => {
    for (const step of WALKTHROUGH.steps) {
      if (step.focus === undefined) continue;
      expect(step.focus, step.id).toBeLessThan(step.stages.length);
    }
  });
});
