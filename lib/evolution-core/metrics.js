import { KNOWLEDGE_STATUS } from "./constants.js";

function pctChange(before, after) {
  if (before == null || after == null) return null;
  if (before === 0) return after === 0 ? 0 : null; // % change from a zero baseline is undefined, not infinite.
  return ((after - before) / Math.abs(before)) * 100;
}

/**
 * Admin-facing per-cycle metrics. `previous`/`current` are the metric
 * snapshots of the run's currentChampion evaluation before/after this
 * cycle (null if no champion existed yet). `championKnowledgeLinks` is the
 * set of knowledge/exploit-card records the current champion's solver was
 * built on, used to compute confidence debt.
 */
export function computeCycleMetrics({ previous, current, championKnowledgeLinks = [], explorationWasteUsd, previousExplorationWasteUsd }) {
  return {
    correctnessImprovementPct: pctChange(previous?.meanScore, current?.meanScore),
    tokenUsageChangePct: pctChange(previous?.totalTokensIn, current?.totalTokensIn),
    outputTokenChangePct: pctChange(previous?.totalTokensOut, current?.totalTokensOut),
    costChangePct: pctChange(previous?.totalCostUsd, current?.totalCostUsd),
    explorationWasteChangePct: pctChange(previousExplorationWasteUsd, explorationWasteUsd),
    passRateChangePct: pctChange(previous?.passRate, current?.passRate),
    varianceIndicator: current?.variance ?? null,
    confidenceDebt: championKnowledgeLinks.filter(
      (entry) => entry.status === KNOWLEDGE_STATUS.CLAIMED || entry.status === KNOWLEDGE_STATUS.PREDICTED
    ).length
  };
}

/**
 * Cost/tokens spent on this cycle's evaluations that did NOT become the
 * new currentChampion. This is the budget that bought no adopted
 * improvement — distinct from cost spent on the champion itself.
 */
export function computeExplorationWaste({ evaluationsThisCycle, championEvaluationId }) {
  return evaluationsThisCycle
    .filter((evaluation) => evaluation.id !== championEvaluationId)
    .reduce((total, evaluation) => total + evaluation.totalCostUsd, 0);
}
