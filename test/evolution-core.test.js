import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { openEvolutionDatabase, getSchemaVersion } from "../lib/evolution-core/db/index.js";
import { createEvolutionEngine } from "../lib/evolution-core/evolutionEngine.js";
import { assertValidProvenance } from "../lib/evolution-core/knowledgeProvenance.js";
import { checkEarlyStopping } from "../lib/evolution-core/earlyStopping.js";
import { evaluateSignificance } from "../lib/evolution-core/scoring/significance.js";

function repeatTrace(n, overrides) {
  return Array.from({ length: n }, () => ({
    score: 1,
    passed: true,
    criticalFailure: false,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.01,
    ...overrides
  }));
}

function freshEngine() {
  const db = openEvolutionDatabase(":memory:");
  return { db, engine: createEvolutionEngine(db) };
}

function baseRunInput(overrides = {}) {
  return {
    repoIdentifier: "github.com/example/repo",
    repoCommitHash: "commit-1",
    subject: "payment retries",
    targetModel: "claude-sonnet-4-5",
    optimizationMode: "cost-efficient",
    ...overrides
  };
}

test("migrations apply and report a schema version", () => {
  const { db } = freshEngine();
  assert.equal(getSchemaVersion(db), 2);
  db.close();
});

test("simulated evaluations can only promote a predicted leader, never a verified one or the current champion", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  engine.startCycle(run.id);
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });
  const solver = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "seed",
    instructions: "do X then Y",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });

  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: task.id,
    cycle: 1,
    runnerMode: "simulated",
    traces: repeatTrace(3, { score: 0.95 })
  });

  const report = engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  assert.equal(report.slotUpdates.predictedLeader.changed, true);
  assert.equal(report.slotUpdates.verifiedLeader.changed, false);
  assert.equal(report.slotUpdates.verifiedLeader.holder, null);
  assert.equal(report.slotUpdates.currentChampion.holder, null, "current champion must stay unset without real verification");

  db.close();
});

test("a real evaluation promotes the verified leader and the current champion mirrors it", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  engine.startCycle(run.id);
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });
  const solver = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "seed",
    instructions: "do X then Y",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });

  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: task.id,
    cycle: 1,
    runnerMode: "real",
    traces: repeatTrace(3, { score: 0.95 })
  });

  const report = engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  assert.equal(report.slotUpdates.verifiedLeader.changed, true);
  assert.equal(report.slotUpdates.currentChampion.changed, true);
  assert.equal(report.slotUpdates.currentChampion.holder.candidateSolverId, solver.id);

  db.close();
});

test("a marginal, noisy improvement does not displace an incumbent (prediction vs verification)", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });

  engine.startCycle(run.id);
  const solverA = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "seed",
    instructions: "approach A",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });
  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solverA.id,
    taskSpecId: task.id,
    cycle: 1,
    runnerMode: "real",
    traces: repeatTrace(3, { score: 0.9 })
  });
  engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  engine.startCycle(run.id);
  const solverB = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    parentSolverId: solverA.id,
    cycle: 2,
    generationMethod: "mutation",
    instructions: "approach B, a tiny tweak",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });
  // Higher raw mean (0.91 vs 0.9) but high variance -> should NOT pass the
  // effect-size gate against a tightly clustered incumbent.
  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solverB.id,
    taskSpecId: task.id,
    cycle: 2,
    runnerMode: "real",
    traces: [
      { score: 0.99, passed: true, criticalFailure: false, tokensIn: 100, tokensOut: 50, costUsd: 0.01 },
      { score: 0.6, passed: true, criticalFailure: false, tokensIn: 100, tokensOut: 50, costUsd: 0.01 },
      { score: 1.14, passed: true, criticalFailure: false, tokensIn: 100, tokensOut: 50, costUsd: 0.01 }
    ]
  });
  const report2 = engine.completeCycle({ evolutionRunId: run.id, cycle: 2 });

  assert.equal(report2.slotUpdates.verifiedLeader.changed, false);
  assert.equal(report2.slotUpdates.verifiedLeader.reason, "effect-size-below-threshold");
  assert.equal(report2.slotUpdates.currentChampion.holder.candidateSolverId, solverA.id);

  db.close();
});

test("a failing regression case blocks promotion even when the primary task looks better", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  const primaryTask = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });
  const regressionTask = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic-regression",
    prompt: "must not reintroduce the double-charge bug"
  });
  engine.repositories.regressionCases.create({
    evolutionRunId: run.id,
    taskSpecId: regressionTask.id,
    reason: "previously fixed double-charge bug",
    addedAtCycle: 1
  });

  engine.startCycle(run.id);
  const solver = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "mutation",
    instructions: "a faster but regressive approach",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });

  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: primaryTask.id,
    cycle: 1,
    runnerMode: "real",
    traces: repeatTrace(3, { score: 0.99 })
  });
  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: regressionTask.id,
    cycle: 1,
    runnerMode: "real",
    traces: repeatTrace(3, { score: 0, passed: false, criticalFailure: true })
  });

  const report = engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  assert.equal(report.slotUpdates.verifiedLeader.changed, false);
  assert.equal(report.slotUpdates.currentChampion.holder, null);

  db.close();
});

test("confidence debt counts unverified knowledge backing the current champion", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });

  const predictedClaim = engine.recordRepoKnowledge({
    evolutionRunId: run.id,
    repoCommitHash: "commit-1",
    subjectScope: "payment retries",
    taskFamily: "retry-logic",
    filesInvolved: ["lib/retry.js"],
    claimText: "Retries can skip the backoff branch entirely.",
    verificationMethod: "simulated-eval-diff",
    confidence: 0.6,
    status: "predicted"
  });

  engine.startCycle(run.id);
  const solver = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "seed",
    instructions: "skip backoff branch",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries",
    knowledgeLinks: [{ type: "repo", id: predictedClaim.id }]
  });

  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: task.id,
    cycle: 1,
    runnerMode: "real",
    traces: repeatTrace(3, { score: 0.95 })
  });

  const report = engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  assert.equal(report.metrics.confidenceDebt, 1);

  db.close();
});

test("knowledge provenance rejects a 'verified' claim with no source trace", () => {
  assert.throws(
    () =>
      assertValidProvenance({
        repoCommitHash: "commit-1",
        subjectScope: "payment retries",
        taskFamily: "retry-logic",
        verificationMethod: "real-worktree-diff",
        confidence: 0.9,
        status: "verified",
        sourceTraceId: null
      }),
    /must reference a source trace/
  );
});

test("max-cycles early stopping completes the run with a recorded reason", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput({ maxCycles: 1 }));
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });

  engine.startCycle(run.id);
  const solver = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "seed",
    instructions: "do X",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });
  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: task.id,
    cycle: 1,
    runnerMode: "real",
    traces: repeatTrace(3, { score: 0.9 })
  });

  const report = engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  assert.equal(report.stopDecision.shouldStop, true);
  assert.equal(report.stopDecision.reason, "max-cycles-reached");
  assert.equal(report.run.status, "completed");
  assert.equal(report.run.stoppedReason, "max-cycles-reached");

  db.close();
});

test("dual mode blocks the no-improvement stop until the real-verification reserve is met", () => {
  const run = {
    runnerMode: "dual",
    minRealVerificationReserve: 2,
    currentCycle: 3,
    noImprovementWindow: 2,
    maxCycles: null,
    hardRunBudgetUsd: null
  };
  const flatHistory = [{ correctnessImprovementPct: 0 }, { correctnessImprovementPct: null }];

  const blocked = checkEarlyStopping(run, { cycleMetricsHistory: flatHistory, totalSpendUsd: 1, realEvaluationsCompleted: 1 });
  assert.equal(blocked.shouldStop, false);
  assert.equal(blocked.reason, "blocked-pending-real-verification-reserve");

  const allowed = checkEarlyStopping(run, { cycleMetricsHistory: flatHistory, totalSpendUsd: 1, realEvaluationsCompleted: 2 });
  assert.equal(allowed.shouldStop, true);
});

test("a transaction rolls back fully when a constraint violation occurs mid-write", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });
  const solver = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "seed",
    instructions: "do X",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });

  assert.throws(() =>
    engine.recordCandidateEvaluation({
      evolutionRunId: run.id,
      candidateSolverId: solver.id,
      taskSpecId: task.id,
      cycle: 1,
      runnerMode: "not-a-real-mode", // violates the CHECK constraint
      traces: repeatTrace(3, { score: 0.9 })
    })
  );

  assert.equal(engine.repositories.candidateEvaluations.listByRun(run.id).length, 0);
  assert.equal(engine.repositories.evalTraces.listByEvaluation(1).length, 0);

  db.close();
});

test("WAL mode and a busy_timeout are set on a file-backed database", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "evolution-core-test-"));
  const dbPath = path.join(dir, "evolution.db");
  const db = openEvolutionDatabase(dbPath);

  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.ok(db.prepare("PRAGMA busy_timeout").get().timeout > 0);
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);

  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("exportRun produces a complete, self-describing snapshot of a run", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "fix the retry bug"
  });
  engine.startCycle(run.id);
  const solver = engine.proposeCandidateSolver({
    evolutionRunId: run.id,
    cycle: 1,
    generationMethod: "seed",
    instructions: "do X",
    optimizationMode: "cost-efficient",
    targetModel: "claude-sonnet-4-5",
    repoCommitHash: "commit-1",
    subjectScope: "payment retries"
  });
  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: task.id,
    cycle: 1,
    runnerMode: "real",
    traces: repeatTrace(3, { score: 0.9 })
  });
  engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  const exported = engine.exportRun(run.id);

  assert.equal(exported.run.id, run.id);
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.candidateSolvers.length, 1);
  assert.equal(exported.candidateEvaluations.length, 1);
  assert.equal(exported.championSlots.currentChampion.candidateSolverId, solver.id);
  assert.ok(Array.isArray(exported.cycleMetrics));

  db.close();
});

test("evaluateSignificance refuses to call a result significant from too few repeats", () => {
  const result = evaluateSignificance({ mean: 0.9, variance: 0.001, n: 1 }, { mean: 0.5, variance: 0.001, n: 3 });
  assert.equal(result.significant, false);
  assert.equal(result.reason, "insufficient-sample");
});
