/**
 * Validating a project file that arrived from outside.
 *
 * The JSON Schema in `shared/schema/` is authoritative and is what the tests
 * check against. This is a second, hand-written pass, and the duplication is
 * deliberate for two reasons.
 *
 * **Messages.** A schema validator says `/airstreams/0/stages/2/airflow must be
 * > 0`. Someone who has just had a file rejected needs to be told which stage,
 * by name, and what to do about it. That is worth writing by hand.
 *
 * **Weight.** Shipping a general-purpose validator to every visitor to parse
 * one small file is a poor trade for a tool that is otherwise a single page.
 *
 * The risk in having two implementations is that they disagree. That is exactly
 * what `tests/project-io.test.ts` exists to catch: every fixture is put through
 * both, and a verdict mismatch fails the suite.
 *
 * Nothing here throws. A bad file produces a list of problems, in the same
 * shape the solvers use, because a user who dragged in the wrong JSON needs a
 * sentence rather than a stack trace.
 */
import { SCHEMA_VERSION, type Project, type StageType } from '../types/project.js';

export interface ValidationResult {
  readonly project: Project | null;
  readonly problems: readonly string[];
}

const STAGE_TYPES: readonly StageType[] = [
  'source',
  'mixing',
  'cooling',
  'heating',
  'humidifier-steam',
  'humidifier-adiabatic',
  'fan',
  'room',
  'recovery-runaround',
  'recovery-wraparound-precool',
  'recovery-wraparound-reheat',
  'recovery-wheel-sensible',
  'recovery-wheel-enthalpy',
  'recovery-plate',
  'evaporative-direct',
  'evaporative-indirect',
  'desiccant',
];

const COUPLING_ROLES = ['second-stream', 'exchange-stream', 'secondary-stream', 'paired-leg'];
const AIRSTREAM_ROLES = ['supply', 'return', 'outdoor', 'exhaust', 'secondary', 'other'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64 && ID_PATTERN.test(value);
}

/**
 * Check a parsed value against the project format.
 *
 * Returns the value typed as a `Project` when it passes. It is the *same*
 * object, not a copy: rebuilding it would mean deciding what to do with
 * properties this build does not know about, and dropping them silently is how
 * a round trip through an older version quietly destroys work.
 */
export function validateProject(raw: unknown): ValidationResult {
  const problems: string[] = [];

  if (!isRecord(raw)) {
    return { project: null, problems: ['This file does not contain a JSON object.'] };
  }

  // Version first: everything below assumes the shape this version defines, so
  // checking fields before checking the version would produce a list of
  // confusing complaints about a file that is simply from the future.
  const version = raw['schemaVersion'];
  if (version !== SCHEMA_VERSION) {
    return {
      project: null,
      problems: [
        typeof version === 'number'
          ? `This project file is version ${version}; this build reads version ${SCHEMA_VERSION}. ` +
            (version > SCHEMA_VERSION
              ? 'It was written by a newer version of Psychrometric Studio — open it there, or export it again from a build that matches.'
              : 'No migration is available for it.')
          : 'This file has no "schemaVersion", so it is not a Psychrometric Studio project.',
      ],
    };
  }

  if (raw['units'] !== 'IP' && raw['units'] !== 'SI') {
    problems.push('"units" must be "IP" or "SI".');
  }

  const atmosphere = raw['atmosphere'];
  if (!isRecord(atmosphere)) {
    problems.push('"atmosphere" is missing.');
  } else {
    const basis = atmosphere['basis'];
    if (basis !== 'standard' && basis !== 'altitude' && basis !== 'explicit') {
      problems.push('"atmosphere.basis" must be "standard", "altitude", or "explicit".');
    } else if (basis === 'altitude' && typeof atmosphere['altitude'] !== 'number') {
      problems.push('Site pressure is set from elevation, but no elevation is recorded.');
    } else if (
      basis === 'explicit' &&
      (typeof atmosphere['pressure'] !== 'number' || atmosphere['pressure'] <= 0)
    ) {
      problems.push('Site pressure is set explicitly, but the recorded pressure is missing or not positive.');
    }
  }

  const airstreams = raw['airstreams'];
  if (!Array.isArray(airstreams) || airstreams.length === 0) {
    problems.push('A project needs at least one airstream.');
  } else {
    const seenStreamIds = new Set<string>();

    airstreams.forEach((stream, streamIndex) => {
      const where = `Airstream ${streamIndex + 1}`;
      if (!isRecord(stream)) {
        problems.push(`${where} is not an object.`);
        return;
      }
      if (!validId(stream['id'])) {
        problems.push(`${where} has a missing or invalid id.`);
      } else if (seenStreamIds.has(stream['id'])) {
        // Duplicate ids are worse than a missing one: couplings resolve by id,
        // so a duplicate silently connects a stage to the wrong stream.
        problems.push(`${where} repeats the id "${stream['id']}", which couplings resolve by.`);
      } else {
        seenStreamIds.add(stream['id']);
      }
      if (typeof stream['name'] !== 'string') {
        problems.push(`${where} has no name.`);
      }
      const role = stream['role'];
      if (role !== undefined && (typeof role !== 'string' || !AIRSTREAM_ROLES.includes(role))) {
        problems.push(`${where} has an unrecognised role "${String(role)}".`);
      }

      const stages = stream['stages'];
      if (!Array.isArray(stages)) {
        problems.push(`${where} has no stage list.`);
        return;
      }

      const seenStageIds = new Set<string>();
      stages.forEach((stage, stageIndex) => {
        const label = isRecord(stage) && typeof stage['name'] === 'string' ? `"${stage['name']}"` : `${stageIndex + 1}`;
        const stageWhere = `${where}, stage ${label}`;
        if (!isRecord(stage)) {
          problems.push(`${stageWhere} is not an object.`);
          return;
        }
        if (!validId(stage['id'])) {
          problems.push(`${stageWhere} has a missing or invalid id.`);
        } else if (seenStageIds.has(stage['id'])) {
          problems.push(`${stageWhere} repeats the id "${stage['id']}".`);
        } else {
          seenStageIds.add(stage['id']);
        }
        if (typeof stage['type'] !== 'string' || !STAGE_TYPES.includes(stage['type'] as StageType)) {
          // Not fatal on its own — the chain solver reports an unknown type
          // against that stage and still draws the rest — but it is worth
          // saying plainly at load time rather than as five stage errors.
          problems.push(
            `${stageWhere} has type "${String(stage['type'])}", which this build does not model.`,
          );
        }
        const airflow = stage['airflow'];
        if (airflow !== undefined && (typeof airflow !== 'number' || !(airflow > 0))) {
          problems.push(`${stageWhere} has an airflow that is not a positive number.`);
        }
        if (stage['params'] !== undefined && !isRecord(stage['params'])) {
          problems.push(`${stageWhere} has parameters that are not an object.`);
        }

        const couplings = stage['couplings'];
        if (couplings !== undefined) {
          if (!Array.isArray(couplings)) {
            problems.push(`${stageWhere} has couplings that are not a list.`);
          } else {
            couplings.forEach((coupling) => {
              if (!isRecord(coupling)) {
                problems.push(`${stageWhere} has a coupling that is not an object.`);
                return;
              }
              if (typeof coupling['role'] !== 'string' || !COUPLING_ROLES.includes(coupling['role'])) {
                problems.push(`${stageWhere} has a coupling with an unrecognised role.`);
              }
              if (!validId(coupling['airstreamId'])) {
                problems.push(`${stageWhere} has a coupling with no airstream id.`);
              }
              if (coupling['stageId'] !== undefined && !validId(coupling['stageId'])) {
                problems.push(`${stageWhere} has a coupling with an invalid stage id.`);
              }
            });
          }
        }
      });
    });

    // Couplings are checked for *resolvability* only after every id is known,
    // because a coupling may point forward to a stream declared later.
    airstreams.forEach((stream) => {
      if (!isRecord(stream) || !Array.isArray(stream['stages'])) return;
      for (const stage of stream['stages']) {
        if (!isRecord(stage) || !Array.isArray(stage['couplings'])) continue;
        for (const coupling of stage['couplings']) {
          if (!isRecord(coupling)) continue;
          const target = coupling['airstreamId'];
          if (typeof target === 'string' && !seenStreamIds.has(target)) {
            problems.push(
              `A stage refers to airstream "${target}", which is not in this file. ` +
                'The reference will not resolve and that stage will not solve.',
            );
          }
        }
      }
    });
  }

  return problems.length > 0 ? { project: null, problems } : { project: raw as unknown as Project, problems: [] };
}
