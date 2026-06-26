import crypto from "node:crypto";
import { runProcess } from "../execution/processRunner.js";
import { captureChangedFiles, captureDiff } from "../execution/gitDiffCapture.js";
import { buildVerificationResult } from "../verification/verificationResult.js";
import { buildAllowedEnv } from "../safety/envAllowlist.js";
import { ATTEMPT_OUTCOME, DEFAULT_SAFETY } from "../constants.js";

/**
 * Runs one declared step (build/test/behavior) of a command profile. If the
 * step declares parseResult, its stdout must be a single JSON value;
 * anything else is recorded as malformedResult rather than thrown, so a
 * candidate's broken output shows up as a verification failure instead of
 * crashing the attempt.
 */
async function runStep(step, { cwd, env, safety }) {
  if (!step) return null;

  const result = await runProcess({
    command: step.command,
    args: step.args ?? [],
    cwd,
    env,
    allowlist: safety.commandAllowlist,
    disallowedGitSubcommands: safety.disallowedGitSubcommands,
    timeoutMs: safety.timeoutMs,
    maxOutputBytes: safety.maxOutputBytes
  });

  if (!step.parseResult || result.timedOut || result.outputTruncated) {
    return result;
  }

  try {
    const parsedResult = JSON.parse(result.stdout.trim());
    return { ...result, parsedResult, malformedResult: false };
  } catch {
    return { ...result, malformedResult: true };
  }
}

/**
 * Orchestrates a single verified attempt end to end: acquire an isolated
 * workspace from the pool, run whichever build/test/behavior steps the
 * profile declares, capture the resulting diff, reduce to a verification
 * result, then release the workspace back to the pool (success) or
 * retain/destroy it (failure) per the profile's policy.
 */
export async function runAttempt({ profile, pool, safety = {}, costMetadataFn = null, attemptId = crypto.randomUUID() }) {
  const mergedSafety = {
    commandAllowlist: safety.commandAllowlist ?? DEFAULT_SAFETY.COMMAND_ALLOWLIST,
    disallowedGitSubcommands: safety.disallowedGitSubcommands ?? DEFAULT_SAFETY.DISALLOWED_GIT_SUBCOMMANDS,
    timeoutMs: safety.timeoutMs ?? DEFAULT_SAFETY.TIMEOUT_MS,
    maxOutputBytes: safety.maxOutputBytes ?? DEFAULT_SAFETY.MAX_OUTPUT_BYTES,
    envAllowlist: safety.envAllowlist ?? DEFAULT_SAFETY.ENV_ALLOWLIST
  };
  const env = buildAllowedEnv(process.env, mergedSafety.envAllowlist, safety.extraEnv ?? {});

  const workspace = await pool.acquire();
  const startedAt = Date.now();

  let buildStep = null;
  let testStep = null;
  let behaviorStep = null;
  let changedFiles = [];
  let diff = "";
  let captureError = null;

  try {
    buildStep = await runStep(profile.steps.build, { cwd: workspace.path, env, safety: mergedSafety });
    testStep = await runStep(profile.steps.test, { cwd: workspace.path, env, safety: mergedSafety });
    behaviorStep = await runStep(profile.steps.behavior, { cwd: workspace.path, env, safety: mergedSafety });

    changedFiles = await captureChangedFiles(workspace.path);
    diff = await captureDiff(workspace.path);
  } catch (err) {
    captureError = err.message;
  }

  const verification = buildVerificationResult({ buildStep, testStep, behaviorStep, scope: profile.scope });
  const outcome = verification.verifiedCorrectness ? ATTEMPT_OUTCOME.SUCCESS : ATTEMPT_OUTCOME.FAILURE;
  const elapsedMs = Date.now() - startedAt;

  const releaseInfo = await pool.release(workspace, {
    outcome,
    retainOnFailure: Boolean(profile.retainOnFailure)
  });

  const costMetadata = costMetadataFn ? costMetadataFn({ buildStep, testStep, behaviorStep }) : null;

  return {
    attemptId,
    profileId: profile.id,
    outcome,
    elapsedMs,
    buildStep,
    testStep,
    behaviorStep,
    changedFiles,
    diff,
    captureError,
    retainedWorkspacePath: releaseInfo.retained ? releaseInfo.path : null,
    costMetadata,
    ...verification
  };
}
