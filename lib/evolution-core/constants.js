// Shared enums for the evolution engine. Keep these as the single source of
// truth — repositories, scoring, and migrations all check against these
// values (and the DB CHECK constraints mirror them).

export const RUNNER_MODES = Object.freeze({
  SIMULATED: "simulated",
  REAL: "real",
  DUAL: "dual"
});

export const OPTIMIZATION_MODES = Object.freeze({
  COST_EFFICIENT: "cost-efficient",
  BALANCED: "balanced",
  MAXIMUM_PERFORMANCE: "maximum-performance"
});

export const KNOWLEDGE_STATUS = Object.freeze({
  CLAIMED: "claimed",
  PREDICTED: "predicted",
  VERIFIED: "verified",
  REFUTED: "refuted",
  STALE: "stale"
});

export const CHAMPION_SLOTS = Object.freeze({
  HIGHEST_CORRECTNESS: "highestCorrectness",
  LOWEST_COST_ABOVE_THRESHOLD: "lowestCostAboveThreshold",
  BEST_HELD_OUT_COVERAGE: "bestHeldOutCoverage",
  BEST_BALANCED: "bestBalanced",
  PREDICTED_LEADER: "predictedLeader",
  VERIFIED_LEADER: "verifiedLeader",
  CURRENT_CHAMPION: "currentChampion"
});

export const ALL_CHAMPION_SLOTS = Object.freeze(Object.values(CHAMPION_SLOTS));

export const GENERATION_METHODS = Object.freeze({
  SEED: "seed",
  MUTATION: "mutation",
  CROSSOVER: "crossover",
  MANUAL: "manual"
});

export const EXPLOIT_TYPES = Object.freeze({
  STABLE_INTERFACE: "stable-interface",
  RELIABLE_SHORTCUT: "reliable-shortcut",
  NORMAL_FORM: "normal-form",
  FILE_BOUNDARY: "file-boundary",
  VERIFICATION_METHOD: "verification-method",
  SKIPPABLE_REASONING: "skippable-reasoning"
});

export const RUN_STATUS = Object.freeze({
  RUNNING: "running",
  COMPLETED: "completed",
  STOPPED: "stopped",
  FAILED: "failed"
});

export const EVALUATION_STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed"
});

export const DEFAULTS = Object.freeze({
  NOISE_REPEAT_COUNT: 3,
  DUAL_SIMULATED_SPLIT: 0.7,
  DUAL_REAL_SPLIT: 0.3,
  MIN_PASS_RATE: 0.8,
  MAX_CRITICAL_FAILURE_RATE: 0,
  MIN_EFFECT_SIZE: 0.5,
  MIN_SAMPLE_SIZE: 2,
  NO_IMPROVEMENT_WINDOW: 3,
  MIN_REAL_VERIFICATION_RESERVE: 0
});
