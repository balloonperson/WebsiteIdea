import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";
import { toJsonColumn, fromJsonColumn } from "../util/json.js";
import { nowIso } from "../util/time.js";

function decorate(row) {
  if (!row) return row;
  return { ...row, filesInvolved: fromJsonColumn(row.filesInvolved, []) };
}

export function createRepoKnowledgeRepository(db) {
  return {
    create({
      evolutionRunId,
      repoCommitHash,
      subjectScope,
      taskFamily,
      filesInvolved = [],
      claimText,
      verificationMethod,
      sourceTraceId = null,
      confidence,
      status = "claimed"
    }) {
      const stmt = db.prepare(`
        INSERT INTO repo_knowledge_entries (
          evolution_run_id, repo_commit_hash, subject_scope, task_family, files_involved,
          claim_text, verification_method, source_trace_id, confidence, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        evolutionRunId,
        repoCommitHash,
        subjectScope,
        taskFamily,
        toJsonColumn(filesInvolved),
        claimText,
        verificationMethod,
        sourceTraceId,
        confidence,
        status
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM repo_knowledge_entries WHERE id = ?").get(id);
      return decorate(rowToCamel(row));
    },

    listByRun(evolutionRunId, { status } = {}) {
      if (status) {
        const rows = db
          .prepare("SELECT * FROM repo_knowledge_entries WHERE evolution_run_id = ? AND status = ? ORDER BY id ASC")
          .all(evolutionRunId, status);
        return rowsToCamel(rows).map(decorate);
      }
      const rows = db
        .prepare("SELECT * FROM repo_knowledge_entries WHERE evolution_run_id = ? ORDER BY id ASC")
        .all(evolutionRunId);
      return rowsToCamel(rows).map(decorate);
    },

    listByScope({ repoCommitHash, subjectScope, taskFamily }) {
      const rows = db
        .prepare(
          "SELECT * FROM repo_knowledge_entries WHERE repo_commit_hash = ? AND subject_scope = ? AND task_family = ? ORDER BY id ASC"
        )
        .all(repoCommitHash, subjectScope, taskFamily);
      return rowsToCamel(rows).map(decorate);
    },

    updateStatus(id, status, { supersededByEntryId = null } = {}) {
      db.prepare(
        "UPDATE repo_knowledge_entries SET status = ?, superseded_by_entry_id = COALESCE(?, superseded_by_entry_id), updated_at = ? WHERE id = ?"
      ).run(status, supersededByEntryId, nowIso(), id);
      return this.getById(id);
    }
  };
}
