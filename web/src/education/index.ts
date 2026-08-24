/**
 * The education module's public surface.
 *
 * Two registries sit behind one lookup: equipment entries keyed by stage type,
 * and concept entries keyed by term. A `seeAlso` link may point at either, so
 * resolving them through a single function is what lets the content cross-refer
 * freely — "bypass factor" can link to "cooling coil" and back without either
 * file knowing which registry the other lives in.
 */
import type { StageType } from '../types/project.js';
import type { MoistAirState } from '../psych/state.js';
import type { StageResult } from '../processes/types.js';
import type { UnitSystem } from '../psych/units.js';
import type { Stage } from '../types/project.js';
import { EQUIPMENT } from './equipment.js';
import { CONCEPTS, type ConceptEntry } from './concepts.js';
import type { EducationEntry } from './types.js';

export type { EducationEntry, Move, MoveProperty, ObservedMove, CheckContext, CheckRule } from './types.js';
export type { ConceptEntry } from './concepts.js';
export { EQUIPMENT, educationFor } from './equipment.js';
export { CONCEPTS, CONCEPT_GROUPS, CONCEPT_ORDER, tooltipFor } from './concepts.js';
export { observedMoves, kelvinAs } from './checks.js';
export { WALKTHROUGH, type WalkthroughStep, type Walkthrough } from './walkthrough.js';

/** A topic is either a piece of equipment or a concept. */
export type Topic =
  | { readonly sort: 'equipment'; readonly entry: EducationEntry }
  | { readonly sort: 'concept'; readonly entry: ConceptEntry };

/** Resolve an id against both registries. Concepts win on a name clash. */
export function topicFor(id: string): Topic | null {
  const concept = CONCEPTS[id];
  if (concept) return { sort: 'concept', entry: concept };

  const equipment = (EQUIPMENT as Record<string, EducationEntry | undefined>)[id];
  if (equipment) return { sort: 'equipment', entry: equipment };

  return null;
}

/** Title and one-line summary for a link, whichever registry it comes from. */
export function topicLabel(id: string): { title: string; summary: string } | null {
  const topic = topicFor(id);
  if (!topic) return null;
  if (topic.sort === 'concept') {
    return { title: topic.entry.title, summary: topic.entry.summary };
  }
  // An equipment entry has no one-liner of its own; its classification is the
  // most useful thing to show in a link — "Adiabatic mixing" tells a reader
  // what kind of thing they are about to open.
  return { title: topic.entry.title, summary: topic.entry.kind };
}

/**
 * Evaluate the design check for a solved stage.
 *
 * Returns `null` when the stage passes, has no rule, or did not solve. A stage
 * that failed to solve already shows its error; adding advice about a state
 * that does not exist would be noise on top of a problem.
 */
export function runCheck(
  type: StageType,
  stage: Stage,
  result: StageResult | undefined,
  entering: MoistAirState | null,
  enteringMassFlow: number | null,
  units: UnitSystem,
): string | null {
  if (!result) return null;
  const rule = EQUIPMENT[type]?.rule;
  if (!rule) return null;

  try {
    return rule({ stage, result, entering, enteringMassFlow, units });
  } catch {
    // A rule that throws must never take the panel down with it. The advice is
    // the least important thing on screen; the solved result is the most.
    return null;
  }
}
