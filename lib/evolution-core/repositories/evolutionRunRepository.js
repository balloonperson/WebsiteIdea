import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";
import { nowIso } from "../util/time.js";
import { DEFAULTS, RUN_STATUS, RUNNER_MODES } from "../constants.js";

export function createEvolutionRunRepository(db) {
  return {
    create({
      repoIdentifier,
      repoCommitHash,
      subject,
      targetModel,
      optimizationMode,
      runnerMode = RUNNER_MODES.DUAL,
      dualSimulatedSplit = DEFAULTS.DUAL_SIMULATED_SPLIT,
      dualRealSplit = DEFAULTS.DUAL_REAL_SPLIT,
      noiseRepeatCount = DEFAULTS.NOISE_REPEAT_COUNT,
      hardRunBudgetUsd = null,
      maxCycles = null,
      noImprovementWindow = DEFAULTS.NO_IMPROVEMENT_WINDOW,
      minRealVerificationReserve = DEFAULTS.MIN_REAL_VERIFICATION_RESERVE
    }) {
      const stmt = db.prepare(`
        INSERT INTO evolution_runs (
          repo_identifier, repo_commit_hash, subject, target_model, optimization_mode,
          runner_mode, dual_simulated_split, dual_real_split, noise_repeat_count,
          hard_run_budget_usd, max_cycles, no_improvement_window, min_real_verification_reserve
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        repoIdentifier,
        repoCommitHash,
        subject,
        targetModel,
        optimizationMode,
        runnerMode,
        dualSimulatedSplit,
        dualRealSplit,
        noiseRepeatCount,
        hardRunBudgetUsd,
        maxCycles,
        noImprovementWindow,
        minRealVerificationReserve
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM evolution_runs WHERE id = ?").get(id);
      return rowToCamel(row);
    },

    listAll() {
      const rows = db.prepare("SELECT * FROM evolution_runs ORDER BY created_at DESC").all();
      return rowsToCamel(rows);
    },

    incrementCycle(id) {
      db.prepare(
        "UPDATE evolution_runs SET current_cycle = current_cycle + 1, updated_at = ? WHERE id = ?"
      ).run(nowIso(), id);
      return this.getById(id);
    },

    updateStatus(id, status, { stoppedReason = null } = {}) {
      if (!Object.values(RUN_STATUS).includes(status)) {
        throw new Error(`Invalid run status: ${status}`);
      }
      const completedAt =
        status === RUN_STATUS.COMPLETED || status === RUN_STATUS.STOPPED || status === RUN_STATUS.FAILED
          ? nowIso()
          : null;
      db.prepare(
        "UPDATE evolution_runs SET status = ?, stopped_reason = ?, completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ?"
      ).run(status, stoppedReason, completedAt, nowIso(), id);
      return this.getById(id);
    }
  };
}
