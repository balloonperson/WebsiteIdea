import { RUN_STATUS, CHAMPION_SLOTS, RUNNER_MODES, EXPLOIT_TYPES } from "../evolution-core/index.js";
import { generateCandidateInstructions } from "./aiCandidate.js";
import { runNoiseTrials } from "./aiJudge.js";
import { suggestTaskDrafts } from "./aiTasks.js";
import { emitRunEvent } from "./events.js";
import { loadRunConfig, updateRunConfig } from "./runConfigStore.js";
import { resolveObjectiveProfile } from "./objectiveProfiles.js";

// Real worktree execution (Branch 3) is not wired into this build. Every
// trace this orchestrator produces is runnerMode "simulated" regardless of
// the run's configured runnerMode, so it can only ever back a Predicted
// Leader — never the Verified Leader or Current Champion. The UI must make
// that gap visible rather than papering over it.
export class RealRunnerUnavailableError extends Error {
  constructor(message) {
    super(message || "Real worktree verification is not available yet: the worktree-runner has not been wired in.");
    this.statusCode = 501;
  }
}

const activeLoops = new Map();

export function createOrchestrator(engine) {
  const repos = engine.repositories;

  function isCancelled(runId) {
    return activeLoops.get(runId)?.cancelled === true;
  }

  function markActive(runId) {
    activeLoops.set(runId, { cancelled: false });
  }

  function markInactive(runId) {
    activeLoops.delete(runId);
  }

  async function startRun(runId) {
    if (activeLoops.has(runId)) return;
    markActive(runId);
    runLoop(runId).catch((error) => {
      console.error(`Evolution run ${runId} loop crashed:`, error);
    });
  }

  function cancelRun(runId) {
    const entry = activeLoops.get(runId);
    if (entry) {
      entry.cancelled = true;
      return;
    }
    const run = repos.evolutionRuns.getById(runId);
    if (run && run.status === RUN_STATUS.RUNNING) {
      repos.evolutionRuns.updateStatus(runId, RUN_STATUS.STOPPED, { stoppedReason: "cancelled-by-user" });
      emitRunEvent(runId, "run-cancelled", { reason: "cancelled-by-user" });
    }
  }

  async function resumeRun(runId) {
    const run = repos.evolutionRuns.getById(runId);
    if (!run) throw new Error(`Unknown evolution run: ${runId}`);
    if (run.status !== RUN_STATUS.RUNNING) {
      repos.evolutionRuns.updateStatus(runId, RUN_STATUS.RUNNING, { stoppedReason: null });
    }
    await startRun(runId);
  }

  function requestVerify() {
    throw new RealRunnerUnavailableError();
  }

  async function runLoop(runId) {
    try {
      emitRunEvent(runId, "run-started", {});

      while (true) {
        if (isCancelled(runId)) {
          repos.evolutionRuns.updateStatus(runId, RUN_STATUS.STOPPED, { stoppedReason: "cancelled-by-user" });
          emitRunEvent(runId, "run-cancelled", { reason: "cancelled-by-user" });
          break;
        }

        const run = repos.evolutionRuns.getById(runId);
        if (!run || run.status !== RUN_STATUS.RUNNING) break;

        const config = (await loadRunConfig(runId)) || {};
        const settings = config.settings || {};
        const profile = resolveObjectiveProfile(settings.objectiveProfile);
        const candidatesPerCycle = settings.candidatesPerCycle ?? profile.candidatesPerCycle;
        const thresholds = {
          correctness: { minPassRate: settings.correctnessThreshold ?? profile.correctnessThreshold, maxCriticalFailureRate: 0 },
          significance: { minEffectSize: settings.minEffectSize ?? profile.minEffectSize }
        };

        const updatedRun = engine.startCycle(runId);
        const cycle = updatedRun.currentCycle;
        emitRunEvent(runId, "cycle-started", { cycle });

        let tasks = repos.taskSpecs.listByRun(runId);
        if (tasks.length === 0) {
          tasks = await seedTasks(runId, run, config);
        }
        const activeTasks = tasks.filter((t) => !t.isHeldOut);
        const evalTasks = activeTasks.length ? activeTasks : tasks;

        const slots = repos.championSlots.getAll(runId);
        const parentSlot = slots[CHAMPION_SLOTS.PREDICTED_LEADER] || slots[CHAMPION_SLOTS.CURRENT_CHAMPION];
        const parentSolver = parentSlot?.candidateSolverId ? repos.candidateSolvers.getById(parentSlot.candidateSolverId) : null;

        const knowledgeContext = [
          ...repos.repoKnowledge.listByRun(runId),
          ...repos.subjectModel.listByRun(runId)
        ];

        for (let i = 0; i < candidatesPerCycle; i += 1) {
          if (isCancelled(runId)) break;

          const generationMethod = parentSolver ? "mutation" : "seed";
          const generated = await generateCandidateInstructions({
            subject: run.subject,
            targetModel: run.targetModel,
            optimizationMode: run.optimizationMode,
            repoDigest: config.repoDigest,
            parentInstructions: parentSolver?.instructions,
            generationMethod,
            knowledgeContext: settings.knowledgeInfluencesMutation === false ? [] : knowledgeContext
          });

          const solver = engine.proposeCandidateSolver({
            evolutionRunId: runId,
            parentSolverId: parentSolver?.id ?? null,
            cycle,
            generationMethod,
            instructions: generated.instructions,
            optimizationMode: run.optimizationMode,
            targetModel: run.targetModel,
            repoCommitHash: run.repoCommitHash,
            subjectScope: run.subject
          });

          emitRunEvent(runId, "candidate-proposed", {
            cycle,
            candidateSolverId: solver.id,
            generationMethod,
            rationale: generated.rationale
          });

          await recordExploitHypotheses(runId, solver, cycle, generated.exploitHypotheses);

          for (const task of evalTasks) {
            if (isCancelled(runId)) break;

            const rawTraces = await runNoiseTrials({
              instructions: generated.instructions,
              task,
              subject: run.subject,
              repeatCount: run.noiseRepeatCount
            });
            const traces = rawTraces.map((trace) => ({ ...trace, rawLogRef: trace.reasoning || null }));

            const evaluation = engine.recordCandidateEvaluation({
              evolutionRunId: runId,
              candidateSolverId: solver.id,
              taskSpecId: task.id,
              cycle,
              runnerMode: RUNNER_MODES.SIMULATED,
              traces
            });

            emitRunEvent(runId, "evaluation-recorded", {
              cycle,
              candidateSolverId: solver.id,
              taskSpecId: task.id,
              evaluationId: evaluation.id,
              meanScore: evaluation.meanScore,
              passRate: evaluation.passRate,
              meanCostUsd: evaluation.meanCostUsd
            });
          }
        }

        const report = engine.completeCycle({
          evolutionRunId: runId,
          cycle,
          thresholds,
          balancedScoreOptions: settings.balancedScoreOptions || profile.balancedScoreOptions
        });

        emitRunEvent(runId, "cycle-completed", {
          cycle,
          slotUpdates: summarizeSlotUpdates(report.slotUpdates),
          metrics: report.metrics,
          explorationWasteUsd: report.explorationWasteUsd,
          stopDecision: report.stopDecision
        });

        if (report.stopDecision.shouldStop) {
          emitRunEvent(runId, "run-completed", { reason: report.stopDecision.reason });
          break;
        }
      }
    } catch (error) {
      repos.evolutionRuns.updateStatus(runId, RUN_STATUS.FAILED, { stoppedReason: error.message });
      emitRunEvent(runId, "run-failed", { message: error.message });
    } finally {
      markInactive(runId);
    }
  }

  async function seedTasks(runId, run, config) {
    emitRunEvent(runId, "tasks-suggesting", {});
    let drafts = [];
    try {
      drafts = await suggestTaskDrafts({ subject: run.subject, repoDigest: config.repoDigest, count: 4 });
    } catch (error) {
      drafts = [];
    }

    if (drafts.length === 0) {
      drafts = [
        {
          taskFamily: "general",
          prompt: `Make a focused, correct change related to "${run.subject}" in this repository.`,
          expectedCriteria: ["Change compiles/runs", "Change is scoped to the stated subject"]
        }
      ];
    }

    const created = drafts.map((draft) =>
      repos.taskSpecs.create({
        evolutionRunId: runId,
        subject: run.subject,
        taskFamily: draft.taskFamily,
        prompt: draft.prompt,
        expectedCriteria: draft.expectedCriteria,
        source: "generated"
      })
    );

    emitRunEvent(runId, "tasks-generated", { count: created.length });
    return created;
  }

  async function recordExploitHypotheses(runId, solver, cycle, hypotheses) {
    if (!hypotheses?.length) return;
    const run = repos.evolutionRuns.getById(runId);

    const validTypes = new Set(Object.values(EXPLOIT_TYPES));

    for (const hypothesis of hypotheses) {
      const card = engine.recordExploitCard({
        evolutionRunId: runId,
        type: validTypes.has(hypothesis.type) ? hypothesis.type : EXPLOIT_TYPES.RELIABLE_SHORTCUT,
        title: hypothesis.title,
        description: hypothesis.evidence,
        repoCommitHash: run.repoCommitHash,
        subjectScope: run.subject,
        taskFamily: run.subject,
        status: "claimed",
        confidence: 0.3,
        firstSeenCycle: cycle
      });
      try {
        repos.solverKnowledgeLinks.link(solver.id, "exploit_card", card.id);
      } catch {
        // Duplicate link or constraint mismatch; the exploit card itself was still recorded.
      }
      emitRunEvent(runId, "exploit-card-created", { cycle, exploitCardId: card.id, title: card.title, status: card.status });
    }
  }

  return { startRun, cancelRun, resumeRun, requestVerify, isCancelled };
}

function summarizeSlotUpdates(slotUpdates) {
  const summary = {};
  for (const [slotName, decision] of Object.entries(slotUpdates)) {
    if (slotName === "eligibleEvaluations" || slotName === "gateResults") continue;
    summary[slotName] = {
      changed: decision.changed,
      reason: decision.reason,
      holderSolverId: decision.holder?.candidateSolverId ?? decision.holder?.solverId ?? null
    };
  }
  return summary;
}

export async function initRunConfig(runId, { repoDigest, settings }) {
  await updateRunConfig(runId, () => ({ repoDigest, settings }));
}
