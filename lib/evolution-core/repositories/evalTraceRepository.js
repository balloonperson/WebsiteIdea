import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";

export function createEvalTraceRepository(db) {
  return {
    create({
      candidateEvaluationId,
      repeatIndex,
      runnerMode,
      score,
      passed,
      criticalFailure = false,
      tokensIn = 0,
      tokensOut = 0,
      costUsd = 0,
      durationMs = null,
      rawLogRef = null
    }) {
      const stmt = db.prepare(`
        INSERT INTO eval_traces (
          candidate_evaluation_id, repeat_index, runner_mode, score, passed, critical_failure,
          tokens_in, tokens_out, cost_usd, duration_ms, raw_log_ref
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        candidateEvaluationId,
        repeatIndex,
        runnerMode,
        score,
        passed ? 1 : 0,
        criticalFailure ? 1 : 0,
        tokensIn,
        tokensOut,
        costUsd,
        durationMs,
        rawLogRef
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM eval_traces WHERE id = ?").get(id);
      return decorate(rowToCamel(row));
    },

    listByEvaluation(candidateEvaluationId) {
      const rows = db
        .prepare("SELECT * FROM eval_traces WHERE candidate_evaluation_id = ? ORDER BY repeat_index ASC")
        .all(candidateEvaluationId);
      return rowsToCamel(rows).map(decorate);
    }
  };
}

function decorate(row) {
  if (!row) return row;
  return {
    ...row,
    passed: Boolean(row.passed),
    criticalFailure: Boolean(row.criticalFailure)
  };
}
