import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";

export function createCandidateEvaluationRepository(db) {
  return {
    create({
      evolutionRunId,
      candidateSolverId,
      taskSpecId,
      cycle,
      runnerMode,
      repeatCount,
      meanScore,
      minScore,
      passRate,
      variance,
      criticalFailureRate,
      meanTokensIn,
      meanTokensOut,
      meanCostUsd,
      costVariance,
      totalTokensIn,
      totalTokensOut,
      totalCostUsd,
      status = "completed"
    }) {
      const stmt = db.prepare(`
        INSERT INTO candidate_evaluations (
          evolution_run_id, candidate_solver_id, task_spec_id, cycle, runner_mode, repeat_count,
          mean_score, min_score, pass_rate, variance, critical_failure_rate,
          mean_tokens_in, mean_tokens_out, mean_cost_usd, cost_variance,
          total_tokens_in, total_tokens_out, total_cost_usd, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        evolutionRunId,
        candidateSolverId,
        taskSpecId,
        cycle,
        runnerMode,
        repeatCount,
        meanScore,
        minScore,
        passRate,
        variance,
        criticalFailureRate,
        meanTokensIn,
        meanTokensOut,
        meanCostUsd,
        costVariance,
        totalTokensIn,
        totalTokensOut,
        totalCostUsd,
        status
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM candidate_evaluations WHERE id = ?").get(id);
      return rowToCamel(row);
    },

    listBySolver(candidateSolverId) {
      const rows = db
        .prepare("SELECT * FROM candidate_evaluations WHERE candidate_solver_id = ? ORDER BY cycle ASC, id ASC")
        .all(candidateSolverId);
      return rowsToCamel(rows);
    },

    listByRunAndCycle(evolutionRunId, cycle) {
      const rows = db
        .prepare("SELECT * FROM candidate_evaluations WHERE evolution_run_id = ? AND cycle = ? ORDER BY id ASC")
        .all(evolutionRunId, cycle);
      return rowsToCamel(rows);
    },

    listByRun(evolutionRunId) {
      const rows = db
        .prepare("SELECT * FROM candidate_evaluations WHERE evolution_run_id = ? ORDER BY cycle ASC, id ASC")
        .all(evolutionRunId);
      return rowsToCamel(rows);
    },

    listBySolverAndTask(candidateSolverId, taskSpecId) {
      const rows = db
        .prepare("SELECT * FROM candidate_evaluations WHERE candidate_solver_id = ? AND task_spec_id = ? ORDER BY id ASC")
        .all(candidateSolverId, taskSpecId);
      return rowsToCamel(rows);
    }
  };
}
