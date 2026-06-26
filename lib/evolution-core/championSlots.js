// Pure decision logic for the 7 champion slots. No DB access here — callers
// (evolutionEngine.js) resolve incumbents and regression results from
// storage and pass plain data in, which keeps every rule in this file
// independently testable.
import { CHAMPION_SLOTS } from "./constants.js";
import { evaluateCorrectnessGate } from "./scoring/correctnessGate.js";
import { rankByQuality } from "./scoring/qualityOrdering.js";
import { rankByEfficiency, computeBalancedScore } from "./scoring/efficiencyOrdering.js";
import { evaluateSignificance } from "./scoring/significance.js";

const scoreSample = (evaluation) => ({ mean: evaluation.meanScore, variance: evaluation.variance, n: evaluation.repeatCount });
// Cost is "lower is better." Negating turns it into the same "higher wins"
// shape evaluateSignificance assumes, so the gate logic doesn't need a
// direction flag.
const inverseCostSample = (evaluation) => ({
  mean: -evaluation.meanCostUsd,
  variance: evaluation.costVariance,
  n: evaluation.repeatCount
});

function decideBySignificance({ candidates, orderingFn, incumbent, toSample, significanceOptions }) {
  const ordered = orderingFn(candidates);
  const challenger = ordered[0] ?? null;

  if (!challenger) {
    return { changed: false, holder: incumbent ?? null, reason: "no-eligible-candidate", significance: null };
  }
  if (!incumbent) {
    return { changed: true, holder: challenger, reason: "no-incumbent", significance: null };
  }

  const significance = evaluateSignificance(toSample(challenger), toSample(incumbent), significanceOptions);
  if (significance.significant) {
    return { changed: true, holder: challenger, reason: significance.reason, significance };
  }
  return { changed: false, holder: incumbent, reason: significance.reason, significance };
}

export function decideHighestCorrectness({ eligibleEvaluations, incumbent, significanceOptions }) {
  return decideBySignificance({
    candidates: eligibleEvaluations,
    orderingFn: rankByQuality,
    incumbent,
    toSample: scoreSample,
    significanceOptions
  });
}

export function decideLowestCostAboveThreshold({ eligibleEvaluations, incumbent, significanceOptions }) {
  return decideBySignificance({
    candidates: eligibleEvaluations,
    orderingFn: rankByEfficiency,
    incumbent,
    toSample: inverseCostSample,
    significanceOptions
  });
}

export function decidePredictedLeader({ eligibleEvaluations, incumbent, significanceOptions }) {
  return decideBySignificance({
    candidates: eligibleEvaluations.filter((e) => e.runnerMode === "simulated"),
    orderingFn: rankByQuality,
    incumbent,
    toSample: scoreSample,
    significanceOptions
  });
}

export function decideVerifiedLeader({ eligibleEvaluations, incumbent, significanceOptions }) {
  return decideBySignificance({
    candidates: eligibleEvaluations.filter((e) => e.runnerMode === "real"),
    orderingFn: rankByQuality,
    incumbent,
    toSample: scoreSample,
    significanceOptions
  });
}

// Correctness significance alone isn't enough here: two candidates can be
// statistically tied on score while one is meaningfully cheaper. Reuse the
// score-based significance gate as the noise filter, then additionally
// require the composite balanced score to actually be higher.
export function decideBestBalanced({ eligibleEvaluations, incumbent, significanceOptions, balancedScoreOptions }) {
  const base = decideBySignificance({
    candidates: eligibleEvaluations,
    orderingFn: (evals) => [...evals].sort(
      (a, b) => computeBalancedScore(b, balancedScoreOptions) - computeBalancedScore(a, balancedScoreOptions)
    ),
    incumbent,
    toSample: scoreSample,
    significanceOptions
  });

  if (!base.changed || !incumbent) return base;

  const challengerBalanced = computeBalancedScore(base.holder, balancedScoreOptions);
  const incumbentBalanced = computeBalancedScore(incumbent, balancedScoreOptions);
  if (challengerBalanced <= incumbentBalanced) {
    return { changed: false, holder: incumbent, reason: "balanced-score-not-improved", significance: base.significance };
  }
  return base;
}

/**
 * Held-out coverage is a count-based fraction, not a per-trace noise
 * sample, so it doesn't go through evaluateSignificance. Promotion requires
 * strictly more distinct held-out tasks passed, without attempting fewer
 * tasks than the incumbent (otherwise a solver could "win" by only being
 * tested against the easy subset).
 */
export function decideBestHeldOutCoverage({ coverageBySolver, incumbentCoverage }) {
  let best = null;
  for (const candidate of coverageBySolver) {
    if (candidate.attempted === 0) continue;
    const fraction = candidate.passed / candidate.attempted;
    if (!best || fraction > best.fraction || (fraction === best.fraction && candidate.passed > best.passed)) {
      best = { ...candidate, fraction };
    }
  }

  if (!best) {
    return { changed: false, holder: incumbentCoverage ?? null, reason: "no-held-out-data" };
  }
  if (!incumbentCoverage) {
    return { changed: true, holder: best, reason: "no-incumbent" };
  }

  const incumbentFraction = incumbentCoverage.attempted === 0 ? 0 : incumbentCoverage.passed / incumbentCoverage.attempted;
  const improved = best.fraction > incumbentFraction && best.attempted >= incumbentCoverage.attempted;
  if (improved) {
    return { changed: true, holder: best, reason: "coverage-improved" };
  }
  return { changed: false, holder: incumbentCoverage, reason: "coverage-not-improved" };
}

/**
 * The current champion always mirrors the verified leader. A purely
 * predicted result is never allowed to occupy this slot — if there's no
 * verified evidence yet, currentChampion stays at whatever it already was
 * (commonly null), even if a strong predicted leader exists.
 */
export function decideCurrentChampion({ verifiedLeaderDecision, incumbent }) {
  const holder = verifiedLeaderDecision.holder ?? null;
  const changed = (holder?.id ?? null) !== (incumbent?.id ?? null);
  return { changed, holder, reason: "mirrors-verified-leader" };
}

export function computeChampionSlotUpdates({
  evaluations,
  regressionEvaluationsBySolver = new Map(),
  heldOutCoverageBySolver = [],
  incumbents = {},
  thresholds = {},
  balancedScoreOptions = {}
}) {
  const gateResults = evaluations.map((evaluation) => ({
    evaluation,
    correctness: evaluateCorrectnessGate(
      evaluation,
      regressionEvaluationsBySolver.get(evaluation.candidateSolverId) ?? [],
      thresholds.correctness
    )
  }));

  const eligibleEvaluations = gateResults.filter((g) => g.correctness.passed).map((g) => g.evaluation);
  const significanceOptions = thresholds.significance;

  const highestCorrectness = decideHighestCorrectness({
    eligibleEvaluations,
    incumbent: incumbents[CHAMPION_SLOTS.HIGHEST_CORRECTNESS],
    significanceOptions
  });
  const lowestCostAboveThreshold = decideLowestCostAboveThreshold({
    eligibleEvaluations,
    incumbent: incumbents[CHAMPION_SLOTS.LOWEST_COST_ABOVE_THRESHOLD],
    significanceOptions
  });
  const bestBalanced = decideBestBalanced({
    eligibleEvaluations,
    incumbent: incumbents[CHAMPION_SLOTS.BEST_BALANCED],
    significanceOptions,
    balancedScoreOptions
  });
  const predictedLeader = decidePredictedLeader({
    eligibleEvaluations,
    incumbent: incumbents[CHAMPION_SLOTS.PREDICTED_LEADER],
    significanceOptions
  });
  const verifiedLeader = decideVerifiedLeader({
    eligibleEvaluations,
    incumbent: incumbents[CHAMPION_SLOTS.VERIFIED_LEADER],
    significanceOptions
  });
  const bestHeldOutCoverage = decideBestHeldOutCoverage({
    coverageBySolver: heldOutCoverageBySolver,
    incumbentCoverage: incumbents[CHAMPION_SLOTS.BEST_HELD_OUT_COVERAGE]
  });
  const currentChampion = decideCurrentChampion({
    verifiedLeaderDecision: verifiedLeader,
    incumbent: incumbents[CHAMPION_SLOTS.CURRENT_CHAMPION]
  });

  return {
    [CHAMPION_SLOTS.HIGHEST_CORRECTNESS]: highestCorrectness,
    [CHAMPION_SLOTS.LOWEST_COST_ABOVE_THRESHOLD]: lowestCostAboveThreshold,
    [CHAMPION_SLOTS.BEST_BALANCED]: bestBalanced,
    [CHAMPION_SLOTS.PREDICTED_LEADER]: predictedLeader,
    [CHAMPION_SLOTS.VERIFIED_LEADER]: verifiedLeader,
    [CHAMPION_SLOTS.BEST_HELD_OUT_COVERAGE]: bestHeldOutCoverage,
    [CHAMPION_SLOTS.CURRENT_CHAMPION]: currentChampion,
    eligibleEvaluations,
    gateResults
  };
}
