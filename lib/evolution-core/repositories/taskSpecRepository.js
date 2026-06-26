import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";
import { toJsonColumn, fromJsonColumn } from "../util/json.js";
import { TASK_DIFFICULTY, TASK_FILE_SCOPE, TASK_ORIGIN, TASK_REVIEW_STATUS, TASK_ROLE } from "../constants.js";

function decorate(row) {
  if (!row) return row;
  return {
    ...row,
    expectedCriteria: fromJsonColumn(row.expectedCriteria, []),
    requiredBehavior: fromJsonColumn(row.requiredBehavior, []),
    forbiddenBehavior: fromJsonColumn(row.forbiddenBehavior, []),
    expectedTouchedAreas: fromJsonColumn(row.expectedTouchedAreas, []),
    hiddenAssertions: fromJsonColumn(row.hiddenAssertions, []),
    failureSeverityRules: fromJsonColumn(row.failureSeverityRules, {}),
    isHeldOut: Boolean(row.isHeldOut)
  };
}

// role drives is_held_out, the column the evolution engine's promotion
// gates read directly — keeping them derived in one place means a Task Lab
// caller can never set role to 'held-out' while leaving is_held_out false.
function roleImpliesHeldOut(role) {
  return role === TASK_ROLE.HELD_OUT;
}

export function createTaskSpecRepository(db) {
  return {
    create({
      evolutionRunId = null,
      subject,
      taskFamily,
      prompt,
      expectedCriteria = [],
      isHeldOut = false,
      source = "manual",
      repoEvidence = "",
      subjectBoundary = "",
      difficulty = TASK_DIFFICULTY.MEDIUM,
      requiredBehavior = [],
      forbiddenBehavior = [],
      expectedTouchedAreas = [],
      verificationMethod = "",
      hiddenAssertions = [],
      failureSeverityRules = {},
      failureMode = "",
      fileScope = TASK_FILE_SCOPE.SINGLE,
      origin = TASK_ORIGIN.USER_ADDED,
      role = TASK_ROLE.TRAINING,
      reviewStatus = TASK_REVIEW_STATUS.PENDING,
      reviewNotes = ""
    }) {
      const resolvedIsHeldOut = isHeldOut || roleImpliesHeldOut(role);
      const stmt = db.prepare(`
        INSERT INTO task_specs (
          evolution_run_id, subject, task_family, prompt, expected_criteria, is_held_out, source,
          repo_evidence, subject_boundary, difficulty, required_behavior, forbidden_behavior,
          expected_touched_areas, verification_method, hidden_assertions, failure_severity_rules,
          failure_mode, file_scope, origin, role, review_status, review_notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        evolutionRunId,
        subject,
        taskFamily,
        prompt,
        toJsonColumn(expectedCriteria),
        resolvedIsHeldOut ? 1 : 0,
        source,
        repoEvidence,
        subjectBoundary,
        difficulty,
        toJsonColumn(requiredBehavior),
        toJsonColumn(forbiddenBehavior),
        toJsonColumn(expectedTouchedAreas),
        verificationMethod,
        toJsonColumn(hiddenAssertions),
        toJsonColumn(failureSeverityRules),
        failureMode,
        fileScope,
        origin,
        role,
        reviewStatus,
        reviewNotes
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM task_specs WHERE id = ?").get(id);
      return decorate(rowToCamel(row));
    },

    listByRun(evolutionRunId, { heldOut } = {}) {
      if (heldOut === undefined) {
        const rows = db
          .prepare("SELECT * FROM task_specs WHERE evolution_run_id = ? ORDER BY created_at ASC")
          .all(evolutionRunId);
        return rowsToCamel(rows).map(decorate);
      }
      const rows = db
        .prepare("SELECT * FROM task_specs WHERE evolution_run_id = ? AND is_held_out = ? ORDER BY created_at ASC")
        .all(evolutionRunId, heldOut ? 1 : 0);
      return rowsToCamel(rows).map(decorate);
    },

    listByRole(evolutionRunId, role) {
      const rows = db
        .prepare("SELECT * FROM task_specs WHERE evolution_run_id = ? AND role = ? ORDER BY created_at ASC")
        .all(evolutionRunId, role);
      return rowsToCamel(rows).map(decorate);
    },

    listPendingReview(evolutionRunId) {
      const rows = db
        .prepare("SELECT * FROM task_specs WHERE evolution_run_id = ? AND review_status = 'pending' ORDER BY created_at ASC")
        .all(evolutionRunId);
      return rowsToCamel(rows).map(decorate);
    },

    update(id, fields) {
      const existing = this.getById(id);
      if (!existing) return null;

      const next = { ...existing, ...fields };
      const nextRole = fields.role ?? existing.role;
      const nextIsHeldOut = fields.isHeldOut ?? (roleImpliesHeldOut(nextRole) || existing.isHeldOut);

      const stmt = db.prepare(`
        UPDATE task_specs SET
          subject = ?, task_family = ?, prompt = ?, expected_criteria = ?, is_held_out = ?,
          repo_evidence = ?, subject_boundary = ?, difficulty = ?, required_behavior = ?,
          forbidden_behavior = ?, expected_touched_areas = ?, verification_method = ?,
          hidden_assertions = ?, failure_severity_rules = ?, failure_mode = ?, file_scope = ?,
          origin = ?, role = ?, review_status = ?, review_notes = ?
        WHERE id = ?
      `);
      stmt.run(
        next.subject,
        next.taskFamily,
        next.prompt,
        toJsonColumn(next.expectedCriteria),
        roleImpliesHeldOut(nextRole) || nextIsHeldOut ? 1 : 0,
        next.repoEvidence,
        next.subjectBoundary,
        next.difficulty,
        toJsonColumn(next.requiredBehavior),
        toJsonColumn(next.forbiddenBehavior),
        toJsonColumn(next.expectedTouchedAreas),
        next.verificationMethod,
        toJsonColumn(next.hiddenAssertions),
        toJsonColumn(next.failureSeverityRules),
        next.failureMode,
        next.fileScope,
        next.origin,
        nextRole,
        next.reviewStatus,
        next.reviewNotes,
        id
      );
      return this.getById(id);
    },

    setReviewStatus(id, reviewStatus, reviewNotes = "") {
      db.prepare("UPDATE task_specs SET review_status = ?, review_notes = ? WHERE id = ?").run(
        reviewStatus,
        reviewNotes,
        id
      );
      return this.getById(id);
    },

    setRole(id, role) {
      db.prepare("UPDATE task_specs SET role = ?, is_held_out = ? WHERE id = ?").run(
        role,
        roleImpliesHeldOut(role) ? 1 : 0,
        id
      );
      return this.getById(id);
    },

    remove(id) {
      db.prepare("DELETE FROM task_specs WHERE id = ?").run(id);
    }
  };
}
