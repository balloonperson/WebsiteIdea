import { RUNNER_MODES } from "../constants.js";

/**
 * Stage 2: mode-specific promotion gate. Eligibility is driven by the
 * runner mode of the *evaluation itself* (every CandidateEvaluation is
 * tagged simulated or real), not the run's overall mode — a Dual run
 * produces a mix of both, and each evaluation can only promote the slot
 * its own evidence is trustworthy enough to support.
 */
export function evaluatePromotionGate({ runnerMode, correctnessPassed }) {
  if (!correctnessPassed) {
    return { canPromotePredicted: false, canPromoteVerified: false };
  }

  return {
    canPromotePredicted: runnerMode === RUNNER_MODES.SIMULATED,
    canPromoteVerified: runnerMode === RUNNER_MODES.REAL
  };
}
