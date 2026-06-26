import test from "node:test";
import assert from "node:assert/strict";

import { openEvolutionDatabase, getSchemaVersion } from "../lib/evolution-core/db/index.js";
import { createEvolutionEngine } from "../lib/evolution-core/evolutionEngine.js";
import { TASK_ROLE, TASK_REVIEW_STATUS } from "../lib/evolution-core/constants.js";
import { validateTaskSpec } from "../lib/task-lab/qualityGates.js";
import { enforceDiversity } from "../lib/task-lab/diversity.js";
import { addTask, createManualTaskSet, importTaskSet } from "../lib/task-lab/taskAuthoring.js";
import { suggestTasks } from "../lib/task-lab/taskSuggestion.js";
import { approveTask, rejectTask, editTask, markRole, listPendingReview, readinessForSeriousRun } from "../lib/task-lab/taskReview.js";
import { filterForMutationPrompt, sanitizeTaskForMutationPrompt, summarizeFailuresForMutation } from "../lib/task-lab/heldOutGuard.js";
import { promoteFailureToRegression, evaluateRegressionBank, regressionBankExportSummary } from "../lib/task-lab/regressionBank.js";
import { attachRegressionBankSummary } from "../lib/task-lab/exportWithRegressionBank.js";

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

function validTaskDraft(overrides = {}) {
  return {
    subject: "payment retries",
    taskFamily: "retry-logic",
    prompt: "Fix the retry backoff so it does not skip the jitter branch on the third attempt.",
    subjectBoundary: "In scope: lib/retry.js retry/backoff logic. Out of scope: payment gateway integration.",
    verificationMethod: "run test/retry.test.js and confirm jitter is applied on attempt 3",
    expectedTouchedAreas: ["lib/retry.js"],
    requiredBehavior: ["applies jitter on every retry"],
    forbiddenBehavior: [],
    difficulty: "medium",
    fileScope: "single",
    failureMode: "skips jitter on later attempts",
    ...overrides
  };
}

test("migration 002 lands and task_specs carries the richer columns", () => {
  const { db } = freshEngine();
  assert.equal(getSchemaVersion(db), 2);
  db.close();
});

test("quality gate rejects vague tasks, tasks with no verification method, and tasks with contradictory scope", () => {
  const vague = validateTaskSpec(validTaskDraft({ prompt: "fix it" }));
  assert.equal(vague.valid, false);
  assert.ok(vague.errors.some((e) => e.includes("vague")));

  const noVerification = validateTaskSpec(validTaskDraft({ verificationMethod: "" }));
  assert.equal(noVerification.valid, false);
  assert.ok(noVerification.errors.some((e) => e.includes("verification")));

  const contradictory = validateTaskSpec(
    validTaskDraft({ expectedTouchedAreas: ["lib/retry.js"], forbiddenBehavior: ["lib/retry.js"] })
  );
  assert.equal(contradictory.valid, false);

  const valid = validateTaskSpec(validTaskDraft());
  assert.equal(valid.valid, true);
});

test("diversity enforcement caps tasks per family/file-scope/difficulty/failure-mode bucket", () => {
  const existing = [];
  const candidates = Array.from({ length: 5 }, (_, i) =>
    validTaskDraft({
      prompt: `Distinct retry fix number ${i} touching a different backoff path.`,
      expectedTouchedAreas: [`lib/retry-${i}.js`]
    })
  );

  const { accepted, rejected } = enforceDiversity(existing, candidates, { maxPerBucket: 3 });
  assert.equal(accepted.length, 3);
  assert.equal(rejected.length, 2);
});

test("diversity enforcement rejects near-duplicate file targets even under the bucket cap", () => {
  const candidates = [
    validTaskDraft({ prompt: "First retry fix touching the shared backoff path." }),
    validTaskDraft({ prompt: "Second retry fix touching the same shared backoff path." })
  ];

  const { accepted, rejected } = enforceDiversity([], candidates, { maxPerBucket: 3 });
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason.includes("nearly the same files"));
});

test("addTask rejects an invalid draft and persists a valid one as user-added/training/pending", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());

  const bad = addTask(engine.repositories, run.id, validTaskDraft({ prompt: "todo" }));
  assert.equal(bad.created, null);
  assert.ok(bad.errors.length > 0);

  const good = addTask(engine.repositories, run.id, validTaskDraft());
  assert.ok(good.created.id);
  assert.equal(good.created.origin, "user-added");
  assert.equal(good.created.role, "training");
  assert.equal(good.created.reviewStatus, "pending");

  db.close();
});

test("createManualTaskSet requires an explicit role per task and enforces diversity across the whole set", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());

  assert.throws(() => createManualTaskSet(engine.repositories, run.id, [validTaskDraft()]), /must declare a role/);

  const result = createManualTaskSet(engine.repositories, run.id, [
    validTaskDraft({
      role: "training",
      prompt: "Training case: retry backoff jitter on attempt 3.",
      expectedTouchedAreas: ["lib/retry.js"]
    }),
    validTaskDraft({
      role: "held-out",
      prompt: "Held-out case: retry backoff jitter on attempt 5.",
      expectedTouchedAreas: ["lib/backoff.js"]
    }),
    validTaskDraft({
      role: "regression",
      prompt: "Regression case: double-charge must not reoccur on retry.",
      expectedTouchedAreas: ["lib/payment.js"]
    })
  ]);

  assert.equal(result.created.length, 3);
  const heldOut = result.created.find((t) => t.role === "held-out");
  assert.equal(heldOut.isHeldOut, true);

  db.close();
});

test("importTaskSet tags imported origin and still runs the quality gate", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());

  const result = importTaskSet(engine.repositories, run.id, [validTaskDraft(), validTaskDraft({ prompt: "todo" })]);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].origin, "imported");
  assert.equal(result.rejected.length, 1);

  db.close();
});

test("suggestTasks normalizes AI output, tags optimizer-suggested origin, and filters through the quality gate", async () => {
  const fakeGenerate = async () =>
    JSON.stringify({
      tasks: [
        {
          prompt: "Fix the retry backoff so it does not skip the jitter branch on the third attempt.",
          taskFamily: "retry-logic",
          subjectBoundary: "In scope: lib/retry.js.",
          repoEvidence: "lib/retry.js has a branch that skips jitter after attempt 2.",
          difficulty: "medium",
          requiredBehavior: ["applies jitter on every retry"],
          forbiddenBehavior: [],
          expectedTouchedAreas: ["lib/retry.js"],
          fileScope: "single",
          verificationMethod: "run test/retry.test.js",
          hiddenAssertions: ["jitter value differs across repeated calls"],
          failureMode: "skips jitter on later attempts"
        },
        { prompt: "todo", taskFamily: "vague-one" }
      ]
    });

  const { accepted, rejected } = await suggestTasks({
    subject: "payment retries",
    fileTree: ["lib/retry.js"],
    fileSamples: [],
    generate: fakeGenerate
  });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].origin, "optimizer-suggested");
  assert.equal(accepted[0].reviewStatus, "pending");
  assert.equal(rejected.length, 1);
});

test("task review: approve/reject/edit/markRole and the serious-run readiness gate", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  const { created } = addTask(engine.repositories, run.id, validTaskDraft());

  assert.equal(listPendingReview(engine.repositories, run.id).length, 1);

  const notReady = readinessForSeriousRun(created);
  assert.equal(notReady.ready, false);

  const approved = approveTask(engine.repositories, created.id, "looks good");
  assert.equal(approved.reviewStatus, "approved");
  assert.equal(readinessForSeriousRun(approved).ready, true);

  assert.throws(() => rejectTask(engine.repositories, created.id, ""), /requires a reason/);
  const rejected = rejectTask(engine.repositories, created.id, "doesn't apply anymore");
  assert.equal(rejected.reviewStatus, "rejected");

  const editResult = editTask(engine.repositories, created.id, { prompt: "todo" });
  assert.equal(editResult.updated, null);
  assert.ok(editResult.errors.length > 0);

  const okEdit = editTask(engine.repositories, created.id, { difficulty: "hard" });
  assert.equal(okEdit.updated.difficulty, "hard");

  const moved = markRole(engine.repositories, created.id, "held-out");
  assert.equal(moved.role, "held-out");
  assert.equal(moved.isHeldOut, true);

  assert.throws(() => markRole(engine.repositories, created.id, "not-a-role"), /Unknown task role/);

  db.close();
});

test("held-out guard excludes held-out tasks and hidden assertions from mutation-facing data", () => {
  const tasks = [
    { id: 1, role: TASK_ROLE.TRAINING, taskFamily: "a", hiddenAssertions: ["x"] },
    { id: 2, role: TASK_ROLE.HELD_OUT, taskFamily: "b", hiddenAssertions: ["y"] }
  ];

  const filtered = filterForMutationPrompt(tasks);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 1);

  const sanitized = sanitizeTaskForMutationPrompt(tasks[0]);
  assert.equal(sanitized.hiddenAssertions, undefined);

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const evaluations = [
    { taskSpecId: 1, passRate: 0.5, criticalFailureRate: 0 },
    { taskSpecId: 2, passRate: 0.1, criticalFailureRate: 1 }
  ];
  const summaries = summarizeFailuresForMutation(evaluations, tasksById);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].taskFamily, "a");
});

test("regression bank: promoting a failure tracks it, and evaluateRegressionBank requires a passing evaluation for the solver", () => {
  const { db, engine } = freshEngine();
  const run = engine.createRun(baseRunInput());
  const task = engine.repositories.taskSpecs.create({
    evolutionRunId: run.id,
    subject: run.subject,
    taskFamily: "retry-logic",
    prompt: "must not reintroduce the double-charge bug"
  });

  const regressionCase = promoteFailureToRegression(engine.repositories, {
    evolutionRunId: run.id,
    taskSpecId: task.id,
    reason: "previously fixed double-charge bug",
    addedAtCycle: 1
  });
  assert.ok(regressionCase.id);
  assert.equal(engine.repositories.taskSpecs.getById(task.id).role, "regression");

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

  const noEvalYet = evaluateRegressionBank(engine.repositories, { evolutionRunId: run.id, candidateSolverId: solver.id });
  assert.equal(noEvalYet.passedAll, false);
  assert.equal(noEvalYet.results[0].evaluated, false);

  engine.recordCandidateEvaluation({
    evolutionRunId: run.id,
    candidateSolverId: solver.id,
    taskSpecId: task.id,
    cycle: 1,
    runnerMode: "real",
    traces: [
      { score: 1, passed: true, criticalFailure: false, tokensIn: 1, tokensOut: 1, costUsd: 0 },
      { score: 1, passed: true, criticalFailure: false, tokensIn: 1, tokensOut: 1, costUsd: 0 }
    ]
  });

  const passing = evaluateRegressionBank(engine.repositories, { evolutionRunId: run.id, candidateSolverId: solver.id });
  assert.equal(passing.passedAll, true);

  const exportSummary = regressionBankExportSummary(engine.repositories, { evolutionRunId: run.id, candidateSolverId: solver.id });
  assert.equal(exportSummary.passedAll, true);

  db.close();
});

test("attachRegressionBankSummary merges the regression bank result keyed off the export's champion slot", () => {
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
    traces: [{ score: 0.9, passed: true, criticalFailure: false, tokensIn: 1, tokensOut: 1, costUsd: 0 }]
  });
  engine.completeCycle({ evolutionRunId: run.id, cycle: 1 });

  const exported = engine.exportRun(run.id);
  const withBank = attachRegressionBankSummary(exported, engine.repositories);

  assert.ok(withBank.regressionBank);
  assert.equal(withBank.regressionBank.evaluated, true);
  assert.equal(withBank.regressionBank.totalCases, 0);
  assert.equal(withBank.regressionBank.passedAll, true);

  db.close();
});
