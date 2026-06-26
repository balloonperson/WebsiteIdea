import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  CommandNotAllowedError,
  UnsafePathError,
  assertArgsAreSafe,
  assertCommandAllowed,
  assertGitSubcommandAllowed,
  assertPathInsideRoot,
  assertNotMainWorkingTree,
  buildAllowedEnv,
  createConcurrencyLimiter,
  createWorktreePool,
  runAttempt,
  runNoiseRepeats,
  selectRealVerificationCandidates,
  toCandidateEvaluationTraces,
  FAKE_COMMAND_PROFILES
} from "../lib/worktree-runner/index.js";
import { aggregateNoiseRepeats } from "../lib/evolution-core/scoring/noise.js";

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")}: ${stderr}`))));
  });
}

async function createTempRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wt-runner-repo-"));
  await run("git", ["init", "-q"], repoRoot);
  await run("git", ["config", "user.email", "test@example.com"], repoRoot);
  await run("git", ["config", "user.name", "Test"], repoRoot);
  await writeFile(path.join(repoRoot, "README.md"), "hello\n");
  await run("git", ["add", "."], repoRoot);
  await run("git", ["commit", "-q", "-m", "init"], repoRoot);
  return repoRoot;
}

// --- Command safety -------------------------------------------------------

test("command allowlist rejects a disallowed command", () => {
  assert.throws(() => assertCommandAllowed("rm", ["node", "npm"]), CommandNotAllowedError);
});

test("command allowlist accepts an allowlisted command", () => {
  assert.doesNotThrow(() => assertCommandAllowed("node", ["node", "npm"]));
});

test("args must be an array, never an interpolated shell string", () => {
  assert.throws(() => assertArgsAreSafe("rm -rf /"), TypeError);
  assert.doesNotThrow(() => assertArgsAreSafe(["-e", "1"]));
});

test("git push/remote/fetch/clone subcommands are always blocked", () => {
  assert.throws(() => assertGitSubcommandAllowed("git", ["push", "origin", "main"]), CommandNotAllowedError);
  assert.throws(() => assertGitSubcommandAllowed("git", ["remote", "add", "x", "y"]), CommandNotAllowedError);
  assert.doesNotThrow(() => assertGitSubcommandAllowed("git", ["status"]));
});

test("path validation rejects paths that escape the allowed root", () => {
  assert.throws(() => assertPathInsideRoot("/tmp/runs/../../etc", "/tmp/runs"), UnsafePathError);
  assert.doesNotThrow(() => assertPathInsideRoot("/tmp/runs/attempt-1", "/tmp/runs"));
});

test("refuses to operate directly on the main working tree", () => {
  assert.throws(() => assertNotMainWorkingTree("/repo", "/repo"), UnsafePathError);
  assert.doesNotThrow(() => assertNotMainWorkingTree("/repo/.runs/attempt-1", "/repo"));
});

test("env allowlist filters out everything not explicitly permitted", () => {
  const filtered = buildAllowedEnv({ PATH: "/usr/bin", SECRET_TOKEN: "shh", HOME: "/home/x" }, ["PATH", "HOME"]);
  assert.deepEqual(filtered, { PATH: "/usr/bin", HOME: "/home/x" });
  assert.equal(filtered.SECRET_TOKEN, undefined);
});

test("concurrency limiter never exceeds the configured cap", async () => {
  const limiter = createConcurrencyLimiter(2);
  let concurrent = 0;
  let maxConcurrent = 0;

  const task = () =>
    new Promise((resolve) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      setTimeout(() => {
        concurrent -= 1;
        resolve();
      }, 20);
    });

  await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)));
  assert.ok(maxConcurrent <= 2, `expected max concurrency <= 2, got ${maxConcurrent}`);
});

// --- Worktree pool + attempt execution ------------------------------------

test("worktree pool, run attempts, and dual-mode scheduling", async (t) => {
  const mainRepoRoot = await createTempRepo();
  const runsRoot = await mkdtemp(path.join(os.tmpdir(), "wt-runner-runs-"));
  const pool = createWorktreePool({ mainRepoRoot, runsRoot, poolSize: 2 });

  t.after(async () => {
    await pool.drain();
    await rm(mainRepoRoot, { recursive: true, force: true });
    await rm(runsRoot, { recursive: true, force: true });
  });

  await t.test("refuses to create a workspace at the main working tree path", async () => {
    assert.throws(() => createWorktreePool({ mainRepoRoot, runsRoot: mainRepoRoot }), UnsafePathError);
  });

  await t.test("successful attempt verifies correctness and returns the workspace to the pool", async () => {
    const result = await runAttempt({ profile: FAKE_COMMAND_PROFILES.success, pool });
    assert.equal(result.outcome, "success");
    assert.equal(result.verifiedCorrectness, true);
    assert.equal(result.buildPassed, true);
    assert.equal(result.testsPassed, true);
    assert.equal(result.retainedWorkspacePath, null);
    assert.equal(pool.idleCount, 1);
  });

  await t.test("failed attempt without retain destroys the workspace", async () => {
    const before = pool.liveCount;
    const result = await runAttempt({ profile: FAKE_COMMAND_PROFILES.failure, pool });
    assert.equal(result.outcome, "failure");
    assert.equal(result.verifiedCorrectness, false);
    assert.equal(result.testsPassed, false);
    assert.equal(result.retainedWorkspacePath, null);
    assert.ok(pool.liveCount <= before, "destroyed workspace should not increase live count");
  });

  await t.test("failed attempt with retainOnFailure keeps the workspace on disk", async () => {
    const result = await runAttempt({ profile: FAKE_COMMAND_PROFILES.retainedFailure, pool });
    assert.equal(result.outcome, "failure");
    assert.ok(result.retainedWorkspacePath, "expected a retained workspace path");
    await access(result.retainedWorkspacePath);
    await access(path.join(result.retainedWorkspacePath, ".worktree-runner-retained.json"));
  });

  await t.test("timeout is enforced and reported as a verification failure", async () => {
    const result = await runAttempt({
      profile: FAKE_COMMAND_PROFILES.timeout,
      pool,
      safety: { timeoutMs: 200 }
    });
    assert.equal(result.buildStep.timedOut, true);
    assert.equal(result.verifiedCorrectness, false);
    assert.equal(result.verifiedFailureReason, "build-timed-out");
  });

  await t.test("oversized output is truncated and the process is killed", async () => {
    const result = await runAttempt({
      profile: FAKE_COMMAND_PROFILES.oversizedOutput,
      pool,
      safety: { maxOutputBytes: 1024 }
    });
    assert.equal(result.buildStep.outputTruncated, true);
    assert.equal(result.verifiedCorrectness, false);
    assert.equal(result.verifiedFailureReason, "build-output-exceeded-limit");
  });

  await t.test("malformed structured result fails verification without throwing", async () => {
    const result = await runAttempt({ profile: FAKE_COMMAND_PROFILES.malformedResult, pool });
    assert.equal(result.behaviorStep.malformedResult, true);
    assert.equal(result.behaviorPassed, false);
    assert.equal(result.verifiedCorrectness, false);
    assert.equal(result.verifiedFailureReason, "behavior-result-malformed");
  });

  await t.test("repeated noise trials run through the concurrency limiter and aggregate cleanly", async () => {
    const limiter = createConcurrencyLimiter(2);
    const attempts = await runNoiseRepeats({ profile: FAKE_COMMAND_PROFILES.success, pool, limiter, repeatCount: 3 });
    assert.equal(attempts.length, 3);
    assert.ok(attempts.every((a) => a.verifiedCorrectness === true));

    const traces = toCandidateEvaluationTraces(attempts);
    const aggregate = aggregateNoiseRepeats(traces);
    assert.equal(aggregate.repeatCount, 3);
    assert.equal(aggregate.passRate, 1);
    assert.equal(aggregate.variance, 0);
  });

  await t.test("dual-mode scheduler enforces the real-verification reserve over a thin split", () => {
    const predictedEvaluations = [
      { candidateSolverId: 1, meanScore: 0.95, passRate: 1, variance: 0 },
      { candidateSolverId: 2, meanScore: 0.9, passRate: 1, variance: 0 },
      { candidateSolverId: 3, meanScore: 0.5, passRate: 0.5, variance: 0.1 }
    ];

    const thinSplit = selectRealVerificationCandidates({
      predictedEvaluations,
      totalAttemptsPlanned: 3,
      dualRealSplit: 0.1,
      minRealVerificationReserve: 2,
      realEvaluationsCompletedSoFar: 0
    });
    assert.equal(thinSplit.splitCount, 0);
    assert.equal(thinSplit.reserveRemaining, 2);
    assert.equal(thinSplit.realAttemptBudget, 2);
    assert.equal(thinSplit.selected.length, 2);
    assert.equal(thinSplit.selected[0].candidateSolverId, 1);
    assert.equal(thinSplit.selected[1].candidateSolverId, 2);

    const reserveAlreadyMet = selectRealVerificationCandidates({
      predictedEvaluations,
      totalAttemptsPlanned: 3,
      dualRealSplit: 0.1,
      minRealVerificationReserve: 2,
      realEvaluationsCompletedSoFar: 2
    });
    assert.equal(reserveAlreadyMet.reserveRemaining, 0);
    assert.equal(reserveAlreadyMet.realAttemptBudget, 0);
    assert.equal(reserveAlreadyMet.selected.length, 0);
  });
});
