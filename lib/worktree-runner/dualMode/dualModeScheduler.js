import { rankByQuality } from "../../evolution-core/scoring/qualityOrdering.js";
import { DEFAULT_DUAL_MODE } from "../constants.js";

/**
 * Decides which predicted (simulated) evaluations get spent on real
 * worktree verification this cycle.
 *
 * Two forces set the budget, and the larger one wins:
 *   - the percentage split (dualRealSplit * totalAttemptsPlanned), and
 *   - the configured minimum real-verification reserve, net of what's
 *     already been spent this run.
 * The reserve exists so a run can't coast entirely on cheap simulated
 * noise and never actually verify anything (see evolution-core's
 * hasMetRealVerificationReserve) — this scheduler is what actually
 * consumes that reserve by picking real-mode work, regardless of how thin
 * the split would otherwise make it.
 *
 * Within that budget, only the top-ranked predicted contenders (by
 * rankByQuality — same ordering used for the predictedLeader slot) are
 * promoted into real verification; the rest stay simulated-only this
 * cycle.
 */
export function selectRealVerificationCandidates({
  predictedEvaluations,
  totalAttemptsPlanned,
  dualRealSplit = DEFAULT_DUAL_MODE.DUAL_REAL_SPLIT,
  minRealVerificationReserve = DEFAULT_DUAL_MODE.MIN_REAL_VERIFICATION_RESERVE,
  realEvaluationsCompletedSoFar = 0,
  rankFn = rankByQuality
}) {
  const reserveRemaining = Math.max(0, minRealVerificationReserve - realEvaluationsCompletedSoFar);
  const splitCount = Math.round(totalAttemptsPlanned * dualRealSplit);
  const realAttemptBudget = Math.max(splitCount, reserveRemaining);

  const ranked = rankFn(predictedEvaluations);
  const selected = ranked.slice(0, Math.min(realAttemptBudget, ranked.length));

  return { selected, realAttemptBudget, reserveRemaining, splitCount };
}
