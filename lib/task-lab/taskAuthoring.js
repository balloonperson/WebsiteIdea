import { TASK_ORIGIN, TASK_REVIEW_STATUS, TASK_ROLE } from "../evolution-core/constants.js";
import { validateTaskSpec } from "./qualityGates.js";
import { enforceDiversity } from "./diversity.js";

/**
 * "Add Task": a human writes the task text (and optionally the rest of the
 * spec) by hand. Rejected outright on a quality-gate failure — there is no
 * partial save for an invalid task.
 */
export function addTask(repos, evolutionRunId, taskInput) {
  const draft = {
    role: TASK_ROLE.TRAINING,
    reviewStatus: TASK_REVIEW_STATUS.PENDING,
    ...taskInput,
    origin: TASK_ORIGIN.USER_ADDED
  };

  const { valid, errors } = validateTaskSpec(draft);
  if (!valid) {
    return { created: null, errors };
  }

  const created = repos.taskSpecs.create({ evolutionRunId, ...draft });
  return { created, errors: [] };
}

function createTaggedTaskSet(repos, evolutionRunId, drafts, { enforceDiversity: shouldEnforceDiversity = true, diversityOptions } = {}) {
  const validations = drafts.map((task) => ({ task, result: validateTaskSpec(task) }));
  const valid = validations.filter((v) => v.result.valid).map((v) => v.task);
  const rejected = validations.filter((v) => !v.result.valid).map((v) => ({ task: v.task, errors: v.result.errors }));

  let toCreate = valid;
  if (shouldEnforceDiversity) {
    const existing = repos.taskSpecs.listByRun(evolutionRunId);
    const { accepted, rejected: diversityRejected } = enforceDiversity(existing, valid, diversityOptions);
    toCreate = accepted;
    rejected.push(...diversityRejected.map(({ task, reason }) => ({ task, errors: [reason] })));
  }

  const created = toCreate.map((draft) => repos.taskSpecs.create({ evolutionRunId, ...draft }));
  return { created, rejected };
}

/**
 * "Manual Task Set": the user defines the entire sample set in one shot,
 * including which cases are training vs. held-out vs. regression. Each item
 * must declare its own role explicitly — there is no inferred default,
 * since silently defaulting a held-out case to training would leak it into
 * mutation prompts.
 */
export function createManualTaskSet(repos, evolutionRunId, taskInputs, options = {}) {
  const drafts = taskInputs.map((input) => {
    if (!input.role) {
      throw new Error("Every task in a manual task set must declare a role (training, held-out, or regression).");
    }
    return { reviewStatus: TASK_REVIEW_STATUS.PENDING, ...input, origin: TASK_ORIGIN.MANUAL_SET };
  });

  return createTaggedTaskSet(repos, evolutionRunId, drafts, options);
}

/**
 * Imported task sets follow the same validation and diversity path as a
 * manual set, but are tagged with the 'imported' origin so provenance shows
 * these came from outside this repo-subject pair's own evolution run.
 */
export function importTaskSet(repos, evolutionRunId, taskInputs, options = {}) {
  const drafts = taskInputs.map((input) => ({
    role: TASK_ROLE.TRAINING,
    reviewStatus: TASK_REVIEW_STATUS.PENDING,
    ...input,
    origin: TASK_ORIGIN.IMPORTED
  }));

  return createTaggedTaskSet(repos, evolutionRunId, drafts, options);
}
