import { VERIFICATION_SCOPE } from "../constants.js";

/**
 * A step result is "passed" only if it actually ran to completion, exited
 * 0, stayed within the output cap, and (if it declared a structured
 * result) parsed cleanly. Any safety trip (timeout/oversized output) or
 * parse failure counts as not-passed, never as "unknown".
 */
function stepPassed(step) {
  if (!step) return null;
  if (step.timedOut) return false;
  if (step.outputTruncated) return false;
  if (step.malformedResult) return false;
  return step.exitCode === 0;
}

function stepFailureReason(name, step) {
  if (!step) return `${name}-step-missing`;
  if (step.timedOut) return `${name}-timed-out`;
  if (step.outputTruncated) return `${name}-output-exceeded-limit`;
  if (step.malformedResult) return `${name}-result-malformed`;
  if (step.exitCode !== 0) return `${name}-exit-code-${step.exitCode}`;
  return null;
}

const REQUIRED_STEPS_BY_SCOPE = Object.freeze({
  [VERIFICATION_SCOPE.BUILD_ONLY]: ["build"],
  [VERIFICATION_SCOPE.BUILD_AND_TESTS]: ["build", "tests"],
  [VERIFICATION_SCOPE.FULL_BEHAVIOR]: ["build", "tests", "behavior"]
});

/**
 * Reduces raw step results into the verification outputs the rest of the
 * system promotes against: buildPassed / testsPassed / behaviorPassed are
 * per-step facts (or null if that step wasn't part of this profile);
 * verifiedCorrectness is the single gate value, true only if every step
 * required by `scope` passed. verificationScope records exactly how much
 * was checked, so a build-only pass is never confused with a fully
 * verified behavior pass downstream.
 */
export function buildVerificationResult({ buildStep = null, testStep = null, behaviorStep = null, scope }) {
  const required = REQUIRED_STEPS_BY_SCOPE[scope];
  if (!required) {
    throw new RangeError(`Unknown verification scope: ${scope}`);
  }

  const stepsByName = { build: buildStep, tests: testStep, behavior: behaviorStep };
  const buildPassed = stepPassed(buildStep);
  const testsPassed = stepPassed(testStep);
  const behaviorPassed = stepPassed(behaviorStep);
  const passedByName = { build: buildPassed, tests: testsPassed, behavior: behaviorPassed };

  let verifiedCorrectness = true;
  let verifiedFailureReason = null;
  for (const name of required) {
    if (passedByName[name] !== true) {
      verifiedCorrectness = false;
      verifiedFailureReason = verifiedFailureReason ?? stepFailureReason(name, stepsByName[name]);
    }
  }

  return { buildPassed, testsPassed, behaviorPassed, verifiedCorrectness, verifiedFailureReason, verificationScope: scope };
}
