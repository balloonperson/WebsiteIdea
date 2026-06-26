import { RUNNER_MODES } from "../evolution-core/constants.js";

const MAX_DIFF_LOG_LENGTH = 20_000;

function truncateForLog(diff) {
  if (!diff) return diff;
  return diff.length > MAX_DIFF_LOG_LENGTH ? `${diff.slice(0, MAX_DIFF_LOG_LENGTH)}\n...[truncated]` : diff;
}

/**
 * Maps a runAttempt() result onto the eval_traces shape evolution-core's
 * engine expects (see recordCandidateEvaluation). evolution-core's schema
 * has no dedicated verification columns yet, so the full verification
 * detail (buildPassed/testsPassed/behaviorPassed/verifiedFailureReason/
 * verificationScope, plus changed files and a capped diff) travels inside
 * rawLogRef as JSON rather than being dropped on the floor.
 */
export function toEvalTrace(attemptResult, { repeatIndex = 0 } = {}) {
  return {
    repeatIndex,
    runnerMode: RUNNER_MODES.REAL,
    score: attemptResult.verifiedCorrectness ? 1 : 0,
    passed: attemptResult.verifiedCorrectness,
    criticalFailure: Boolean(
      attemptResult.buildStep?.timedOut ||
        attemptResult.testStep?.timedOut ||
        attemptResult.behaviorStep?.timedOut ||
        attemptResult.buildStep?.outputTruncated ||
        attemptResult.testStep?.outputTruncated ||
        attemptResult.behaviorStep?.outputTruncated
    ),
    tokensIn: attemptResult.costMetadata?.tokensIn ?? 0,
    tokensOut: attemptResult.costMetadata?.tokensOut ?? 0,
    costUsd: attemptResult.costMetadata?.costUsd ?? 0,
    durationMs: attemptResult.elapsedMs ?? null,
    rawLogRef: JSON.stringify({
      buildPassed: attemptResult.buildPassed,
      testsPassed: attemptResult.testsPassed,
      behaviorPassed: attemptResult.behaviorPassed,
      verifiedCorrectness: attemptResult.verifiedCorrectness,
      verifiedFailureReason: attemptResult.verifiedFailureReason,
      verificationScope: attemptResult.verificationScope,
      changedFiles: attemptResult.changedFiles,
      diff: truncateForLog(attemptResult.diff),
      retainedWorkspacePath: attemptResult.retainedWorkspacePath ?? null
    })
  };
}

export function toCandidateEvaluationTraces(attemptResults) {
  return attemptResults.map((result, index) => toEvalTrace(result, { repeatIndex: index }));
}
