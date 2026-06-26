import { TASK_ROLE } from "../evolution-core/constants.js";

/**
 * Held-out internals never go to mutation prompts. This is the single
 * choke point a mutation-prompt builder should call before it ever lists
 * task text, hidden assertions, or per-task results to the model deciding
 * the next candidate solver.
 */
export function filterForMutationPrompt(tasks) {
  return tasks.filter((task) => task.role !== TASK_ROLE.HELD_OUT);
}

/**
 * Strips fields a mutation prompt should never see, even for a non-held-out
 * task: hidden assertions exist only to check a solver's output after the
 * fact, not to tell a generator what answer is expected.
 */
export function sanitizeTaskForMutationPrompt(task) {
  const { hiddenAssertions, ...safe } = task;
  return safe;
}

/**
 * Mutation prompts get aggregate results and a limited failure summary —
 * never the held-out evaluations, never hidden assertions, never raw traces.
 * `maxReasonLength` truncates each failure's reason so a verbose verification
 * log can't leak implementation-level detail into the generation step.
 */
export function summarizeFailuresForMutation(evaluations, tasksById, { maxReasonLength = 160 } = {}) {
  const summaries = [];
  for (const evaluation of evaluations) {
    const task = tasksById.get(evaluation.taskSpecId);
    if (!task || task.role === TASK_ROLE.HELD_OUT) continue;
    if (evaluation.passRate >= 1) continue;

    summaries.push({
      taskFamily: task.taskFamily,
      difficulty: task.difficulty,
      passRate: evaluation.passRate,
      criticalFailureRate: evaluation.criticalFailureRate,
      reason: (task.failureMode ?? "").slice(0, maxReasonLength)
    });
  }
  return summaries;
}
