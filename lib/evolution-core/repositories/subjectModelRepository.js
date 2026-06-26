import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";
import { nowIso } from "../util/time.js";

export function createSubjectModelRepository(db) {
  return {
    create({
      evolutionRunId,
      targetModel,
      repoCommitHash,
      subjectScope,
      taskFamily,
      claimText,
      verificationMethod,
      sourceTraceId = null,
      confidence,
      status = "claimed"
    }) {
      const stmt = db.prepare(`
        INSERT INTO subject_model_entries (
          evolution_run_id, target_model, repo_commit_hash, subject_scope, task_family,
          claim_text, verification_method, source_trace_id, confidence, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        evolutionRunId,
        targetModel,
        repoCommitHash,
        subjectScope,
        taskFamily,
        claimText,
        verificationMethod,
        sourceTraceId,
        confidence,
        status
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM subject_model_entries WHERE id = ?").get(id);
      return rowToCamel(row);
    },

    listByRun(evolutionRunId, { status } = {}) {
      if (status) {
        const rows = db
          .prepare("SELECT * FROM subject_model_entries WHERE evolution_run_id = ? AND status = ? ORDER BY id ASC")
          .all(evolutionRunId, status);
        return rowsToCamel(rows);
      }
      const rows = db
        .prepare("SELECT * FROM subject_model_entries WHERE evolution_run_id = ? ORDER BY id ASC")
        .all(evolutionRunId);
      return rowsToCamel(rows);
    },

    listByScope({ targetModel, subjectScope, taskFamily }) {
      const rows = db
        .prepare(
          "SELECT * FROM subject_model_entries WHERE target_model = ? AND subject_scope = ? AND task_family = ? ORDER BY id ASC"
        )
        .all(targetModel, subjectScope, taskFamily);
      return rowsToCamel(rows);
    },

    updateStatus(id, status, { supersededByEntryId = null } = {}) {
      db.prepare(
        "UPDATE subject_model_entries SET status = ?, superseded_by_entry_id = COALESCE(?, superseded_by_entry_id), updated_at = ? WHERE id = ?"
      ).run(status, supersededByEntryId, nowIso(), id);
      return this.getById(id);
    }
  };
}
