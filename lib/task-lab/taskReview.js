import { ALL_TASK_ROLES, TASK_REVIEW_STATUS } from "../evolution-core/constants.js";
import { validateTaskSpec } from "./qualityGates.js";

export function listPendingReview(repos, evolutionRunId) {
  return repos.taskSpecs.listPendingReview(evolutionRunId);
}

export function approveTask(repos, taskId, notes = "") {
  return repos.taskSpecs.setReviewStatus(taskId, TASK_REVIEW_STATUS.APPROVED, notes);
}

export function rejectTask(repos, taskId, reason) {
  if (!reason || !reason.trim()) {
    throw new Error("A rejection requires a reason, so a future reviewer knows why this task was dropped.");
  }
  return repos.taskSpecs.setReviewStatus(taskId, TASK_REVIEW_STATUS.REJECTED, reason);
}

/**
 * Edits run back through the same quality gate a new task would face —
 * an edit that turns a valid task vague or unverifiable is rejected exactly
 * as if it had been authored that way from the start.
 */
export function editTask(repos, taskId, updates) {
  const existing = repos.taskSpecs.getById(taskId);
  if (!existing) {
    throw new Error(`Unknown task spec: ${taskId}`);
  }

  const draft = { ...existing, ...updates };
  const { valid, errors } = validateTaskSpec(draft);
  if (!valid) {
    return { updated: null, errors };
  }

  const updated = repos.taskSpecs.update(taskId, updates);
  return { updated, errors: [] };
}

export function markRole(repos, taskId, role) {
  if (!ALL_TASK_ROLES.includes(role)) {
    throw new Error(`Unknown task role "${role}". Expected one of: ${ALL_TASK_ROLES.join(", ")}`);
  }
  return repos.taskSpecs.setRole(taskId, role);
}

export function listByRole(repos, evolutionRunId, role) {
  return repos.taskSpecs.listByRole(evolutionRunId, role);
}

/**
 * The review-UI gate before a task can enter a serious (non-exploratory)
 * run: it must be human-approved and must carry an explicit, non-empty
 * verification method. A task can pass the authoring-time quality gate and
 * still sit here pending review — those are different checks for different
 * moments.
 */
export function readinessForSeriousRun(task) {
  const reasons = [];
  if (task.reviewStatus !== TASK_REVIEW_STATUS.APPROVED) {
    reasons.push(`Task is not approved (status: ${task.reviewStatus}).`);
  }
  if (!task.verificationMethod || !task.verificationMethod.trim()) {
    reasons.push("Task has no objective verification method on record.");
  }
  return { ready: reasons.length === 0, reasons };
}
