/**
 * Stage 5: efficiency ordering. Ranks gate-passing candidates by cost and
 * token footprint — used for the lowestCostAboveThreshold slot and as a
 * tiebreaker after quality ordering.
 */
export function rankByEfficiency(evaluations) {
  return [...evaluations].sort((a, b) => {
    if (a.meanCostUsd !== b.meanCostUsd) return a.meanCostUsd - b.meanCostUsd;
    return (a.meanTokensIn + a.meanTokensOut) - (b.meanTokensIn + b.meanTokensOut);
  });
}

/**
 * bestBalanced support: a single scalar blending correctness against cost
 * and token footprint. Weights are deliberately configurable per call
 * rather than baked into the optimization-mode enum, since "balanced" is
 * itself a tradeoff a run operator should be able to tune.
 */
export function computeBalancedScore(
  evaluation,
  { correctnessWeight = 0.6, costWeight = 0.25, tokenWeight = 0.15, costNormalizerUsd = 1, tokenNormalizer = 1000 } = {}
) {
  const correctnessTerm = evaluation.meanScore * correctnessWeight;
  const costPenalty = (evaluation.meanCostUsd / costNormalizerUsd) * costWeight;
  const tokenPenalty = ((evaluation.meanTokensIn + evaluation.meanTokensOut) / tokenNormalizer) * tokenWeight;
  return correctnessTerm - costPenalty - tokenPenalty;
}
