import { TASK_ROLE } from "../evolution-core/constants.js";

const DEFAULT_MIN_PASS_RATE = 0.8;

/**
 * Turns a meaningful candidate failure into a permanent regression case.
 * The task itself is not cloned — it's the same TaskSpec the candidate
 * failed on, now tracked in regression_cases and reclassified so the
 * review UI shows it for what it now is.
 */
export function promoteFailureToRegression(repos, { evolutionRunId, taskSpecId, reason, addedAtCycle, severity = "critical" }) {
  if (!reason || !reason.trim()) {
    throw new Error("A regression case requires a reason describing what failed.");
  }

  const regressionCase = repos.regressionCases.create({ evolutionRunId, taskSpecId, reason, addedAtCycle, severity });
  repos.taskSpecs.setRole(taskSpecId, TASK_ROLE.REGRESSION);
  return regressionCase;
}

/**
 * Runs the regression bank against one solver: every active regression
 * case must have a recorded evaluation for that solver, and that
 * evaluation must clear minPassRate with zero critical failures. A
 * regression case with no evaluation yet for this solver counts as not
 * passed — silence is not a pass.
 */
export function evaluateRegressionBank(repos, { evolutionRunId, candidateSolverId, minPassRate = DEFAULT_MIN_PASS_RATE }) {
  const activeCases = repos.regressionCases.listActiveByRun(evolutionRunId);

  const results = activeCases.map((regressionCase) => {
    const evaluations = repos.candidateEvaluations.listBySolverAndTask(candidateSolverId, regressionCase.taskSpecId);
    const latest = evaluations[evaluations.length - 1] ?? null;
    const passed = Boolean(latest) && latest.passRate >= minPassRate && latest.criticalFailureRate === 0;

    return {
      regressionCaseId: regressionCase.id,
      taskSpecId: regressionCase.taskSpecId,
      severity: regressionCase.severity,
      evaluated: Boolean(latest),
      passed,
      passRate: latest?.passRate ?? null,
      criticalFailureRate: latest?.criticalFailureRate ?? null
    };
  });

  return {
    candidateSolverId,
    totalCases: results.length,
    passedAll: results.every((r) => r.passed),
    results
  };
}

/**
 * Export-time summary: did the final solver pass the regression bank.
 * Shaped to drop straight into exportRunToJson's output for whichever
 * solver a run names as its champion.
 */
export function regressionBankExportSummary(repos, { evolutionRunId, candidateSolverId, minPassRate = DEFAULT_MIN_PASS_RATE }) {
  if (!candidateSolverId) {
    return { evaluated: false, totalCases: repos.regressionCases.listActiveByRun(evolutionRunId).length, passedAll: null, results: [] };
  }
  const report = evaluateRegressionBank(repos, { evolutionRunId, candidateSolverId, minPassRate });
  return { evaluated: true, ...report };
}
