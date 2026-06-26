import { DEFAULTS } from "../constants.js";

/**
 * Stage 1: correctness gate. A candidate evaluation must clear a minimum
 * pass rate / critical-failure ceiling on its own task, AND every active
 * regression case for its solver must still pass. Regression failures are
 * always fatal here regardless of how well the primary task scored —
 * a faster solver that breaks a previously-fixed case is not progress.
 */
export function evaluateCorrectnessGate(
  evaluation,
  regressionEvaluations = [],
  { minPassRate = DEFAULTS.MIN_PASS_RATE, maxCriticalFailureRate = DEFAULTS.MAX_CRITICAL_FAILURE_RATE } = {}
) {
  const reasons = [];

  if (evaluation.passRate < minPassRate) {
    reasons.push(`pass rate ${evaluation.passRate} is below minimum ${minPassRate}`);
  }
  if (evaluation.criticalFailureRate > maxCriticalFailureRate) {
    reasons.push(`critical failure rate ${evaluation.criticalFailureRate} exceeds maximum ${maxCriticalFailureRate}`);
  }

  const failedRegressions = regressionEvaluations.filter((r) => r.passRate < minPassRate);
  if (failedRegressions.length > 0) {
    reasons.push(`${failedRegressions.length} regression case(s) failed`);
  }

  return { passed: reasons.length === 0, reasons };
}
