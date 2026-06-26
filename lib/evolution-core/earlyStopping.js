import { RUNNER_MODES } from "./constants.js";

/**
 * In Dual mode, a run can't stop early just because simulated cycles
 * stopped improving — it must spend at least `minRealVerificationReserve`
 * real-worktree evaluations first. Otherwise a run could coast entirely on
 * cheap simulated noise and never actually verify anything.
 */
export function hasMetRealVerificationReserve(run, realEvaluationsCompleted) {
  if (run.runnerMode !== RUNNER_MODES.DUAL) return true;
  return realEvaluationsCompleted >= run.minRealVerificationReserve;
}

/**
 * @param {object} run - EvolutionRun row
 * @param {object} state
 * @param {Array<{correctnessImprovementPct: number|null}>} state.cycleMetricsHistory
 * @param {number} state.totalSpendUsd
 * @param {number} state.realEvaluationsCompleted
 */
export function checkEarlyStopping(run, { cycleMetricsHistory = [], totalSpendUsd = 0, realEvaluationsCompleted = 0 }) {
  if (run.hardRunBudgetUsd != null && totalSpendUsd >= run.hardRunBudgetUsd) {
    return { shouldStop: true, reason: "hard-run-budget-exhausted" };
  }

  if (run.maxCycles != null && run.currentCycle >= run.maxCycles) {
    return { shouldStop: true, reason: "max-cycles-reached" };
  }

  const window = run.noImprovementWindow;
  if (window && cycleMetricsHistory.length >= window) {
    const recent = cycleMetricsHistory.slice(-window);
    const anyImprovement = recent.some((m) => (m.correctnessImprovementPct ?? 0) > 0);
    if (!anyImprovement) {
      if (!hasMetRealVerificationReserve(run, realEvaluationsCompleted)) {
        return { shouldStop: false, reason: "blocked-pending-real-verification-reserve" };
      }
      return { shouldStop: true, reason: `no-significant-improvement-in-${window}-cycles` };
    }
  }

  return { shouldStop: false, reason: null };
}
