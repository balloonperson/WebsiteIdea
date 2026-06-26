import { ALL_TASK_DIFFICULTIES, ALL_TASK_FILE_SCOPES } from "../evolution-core/constants.js";

const MIN_PROMPT_LENGTH = 20;
const VAGUE_PATTERNS = [
  /^(fix it|make it work|improve|clean ?up|do better|optimi[sz]e)\.?$/i,
  /\btodo\b/i,
  /\b(something|somehow|stuff|things)\b/i
];

/**
 * Rejects a task as vague when it gives the solver nothing concrete to
 * anchor on: too short, a bare imperative with no object, or hedge words
 * that mean the author hasn't actually decided what "done" looks like.
 */
function isVague(promptText) {
  const trimmed = (promptText ?? "").trim();
  if (trimmed.length < MIN_PROMPT_LENGTH) return true;
  return VAGUE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Rejects a task as impossible when its own fields contradict each other —
 * the only thing checkable without running the solver. A file required to
 * be touched but also forbidden, or empty required behavior with no
 * verification method, can never be satisfied.
 */
function findImpossibilities(task) {
  const errors = [];
  const required = new Set((task.expectedTouchedAreas ?? []).map((a) => a.trim().toLowerCase()));
  const forbidden = new Set((task.forbiddenBehavior ?? []).map((b) => b.trim().toLowerCase()));
  for (const area of required) {
    if (forbidden.has(area)) {
      errors.push(`Area "${area}" appears in both expectedTouchedAreas and forbiddenBehavior.`);
    }
  }
  return errors;
}

export function validateTaskSpec(task) {
  const errors = [];

  if (isVague(task.prompt)) {
    errors.push("Task text is too vague to act on — give a concrete, specific instruction.");
  }

  if (!task.taskFamily || !task.taskFamily.trim()) {
    errors.push("Task family is required.");
  }

  if (!task.subjectBoundary || !task.subjectBoundary.trim()) {
    errors.push("Subject boundary is required so the task can't drift outside the repo-subject pair.");
  }

  if (!task.verificationMethod || !task.verificationMethod.trim()) {
    errors.push("Task has no verification strategy — every task must say how it will be checked.");
  }

  if (!Array.isArray(task.expectedTouchedAreas) || task.expectedTouchedAreas.length === 0) {
    errors.push("Task must declare at least one expected touched area.");
  }

  if (task.difficulty && !ALL_TASK_DIFFICULTIES.includes(task.difficulty)) {
    errors.push(`Unknown difficulty "${task.difficulty}".`);
  }

  if (task.fileScope && !ALL_TASK_FILE_SCOPES.includes(task.fileScope)) {
    errors.push(`Unknown file scope "${task.fileScope}".`);
  }

  errors.push(...findImpossibilities(task));

  return { valid: errors.length === 0, errors };
}

export function validateTaskSpecs(tasks) {
  return tasks.map((task) => ({ task, result: validateTaskSpec(task) }));
}
