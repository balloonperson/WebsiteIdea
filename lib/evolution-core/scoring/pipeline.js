import { evaluateCorrectnessGate } from "./correctnessGate.js";
import { evaluatePromotionGate } from "./promotionGate.js";
import { evaluateSignificance } from "./significance.js";

/**
 * Runs stages 1-3 for a single CandidateEvaluation against an optional
 * incumbent baseline (the evaluation currently holding the slot it's
 * competing for). Stages 4 (quality ordering) and 5 (efficiency ordering)
 * operate across *sets* of evaluations and live in championSlots.js, which
 * picks the best challenger before it ever reaches this pipeline.
 */
export function runScoringPipeline({ evaluation, regressionEvaluations = [], baselineEvaluation = null, thresholds = {} }) {
  const correctness = evaluateCorrectnessGate(evaluation, regressionEvaluations, thresholds.correctness);
  const promotion = evaluatePromotionGate({
    runnerMode: evaluation.runnerMode,
    correctnessPassed: correctness.passed
  });

  let significance = { significant: false, reason: "correctness-gate-failed", effectSize: null };

  if (correctness.passed) {
    if (!baselineEvaluation) {
      significance = { significant: true, reason: "no-incumbent-first-candidate", effectSize: null };
    } else {
      significance = evaluateSignificance(
        { mean: evaluation.meanScore, variance: evaluation.variance, n: evaluation.repeatCount },
        { mean: baselineEvaluation.meanScore, variance: baselineEvaluation.variance, n: baselineEvaluation.repeatCount },
        thresholds.significance
      );
    }
  }

  return {
    correctness,
    promotion,
    significance,
    eligibleForPromotion: correctness.passed && significance.significant
  };
}
