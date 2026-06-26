import { withTransaction } from "./db/connection.js";
import { createRepositories } from "./repositories/index.js";
import { aggregateNoiseRepeats } from "./scoring/noise.js";
import { computeChampionSlotUpdates } from "./championSlots.js";
import { computeCycleMetrics, computeExplorationWaste } from "./metrics.js";
import { checkEarlyStopping } from "./earlyStopping.js";
import { assertValidProvenance } from "./knowledgeProvenance.js";
import { exportRunToJson, exportRunToFile } from "./exportJson.js";
import { ALL_CHAMPION_SLOTS, CHAMPION_SLOTS, DEFAULTS, RUN_STATUS, RUNNER_MODES } from "./constants.js";

/**
 * Ties repositories, the scoring pipeline, champion slots, metrics, and
 * early stopping into the run lifecycle: createRun -> startCycle ->
 * propose candidates -> recordCandidateEvaluation (per solver/task) ->
 * completeCycle, repeated until completeCycle reports a stop.
 */
export function createEvolutionEngine(db) {
  const repos = createRepositories(db);

  function createRun(input) {
    return repos.evolutionRuns.create(input);
  }

  function startCycle(evolutionRunId) {
    return repos.evolutionRuns.incrementCycle(evolutionRunId);
  }

  function proposeCandidateSolver({ knowledgeLinks = [], ...solverInput }) {
    return withTransaction(db, () => {
      const solver = repos.candidateSolvers.create(solverInput);
      for (const link of knowledgeLinks) {
        repos.solverKnowledgeLinks.link(solver.id, link.type, link.id);
      }
      return solver;
    });
  }

  function recordCandidateEvaluation({ evolutionRunId, candidateSolverId, taskSpecId, cycle, runnerMode, traces }) {
    return withTransaction(db, () => {
      const aggregate = aggregateNoiseRepeats(traces);
      const evaluation = repos.candidateEvaluations.create({
        evolutionRunId,
        candidateSolverId,
        taskSpecId,
        cycle,
        runnerMode,
        ...aggregate
      });
      traces.forEach((trace, index) => {
        repos.evalTraces.create({
          candidateEvaluationId: evaluation.id,
          repeatIndex: index,
          runnerMode,
          ...trace
        });
      });
      return evaluation;
    });
  }

  function recordRepoKnowledge(entry) {
    assertValidProvenance(entry);
    return repos.repoKnowledge.create(entry);
  }

  function recordSubjectModelKnowledge(entry) {
    assertValidProvenance(entry);
    return repos.subjectModel.create(entry);
  }

  function recordExploitCard(entry) {
    return repos.exploitCards.create(entry);
  }

  function getChampionKnowledgeLinks(candidateSolverId) {
    if (!candidateSolverId) return [];
    const links = repos.solverKnowledgeLinks.listBySolver(candidateSolverId);
    return links
      .map((link) => {
        if (link.knowledgeType === "repo") return repos.repoKnowledge.getById(link.knowledgeId);
        if (link.knowledgeType === "subject") return repos.subjectModel.getById(link.knowledgeId);
        return repos.exploitCards.getById(link.knowledgeId);
      })
      .filter(Boolean);
  }

  function buildPrimaryEvaluations(evolutionRunId, cycle, heldOutTaskIds, regressionTaskIds) {
    return repos.candidateEvaluations
      .listByRunAndCycle(evolutionRunId, cycle)
      .filter((e) => !heldOutTaskIds.has(e.taskSpecId) && !regressionTaskIds.has(e.taskSpecId));
  }

  function buildRegressionEvaluationsBySolver(evolutionRunId, cycle, regressionTaskIds) {
    const bySolver = new Map();
    if (regressionTaskIds.size === 0) return bySolver;

    const cycleEvaluations = repos.candidateEvaluations.listByRunAndCycle(evolutionRunId, cycle);
    for (const evaluation of cycleEvaluations) {
      if (!regressionTaskIds.has(evaluation.taskSpecId)) continue;
      const list = bySolver.get(evaluation.candidateSolverId) ?? [];
      list.push(evaluation);
      bySolver.set(evaluation.candidateSolverId, list);
    }
    return bySolver;
  }

  function buildHeldOutCoverage(evolutionRunId, heldOutTaskIds, minPassRate) {
    if (heldOutTaskIds.size === 0) return [];

    const bySolver = new Map();
    const evaluations = repos.candidateEvaluations
      .listByRun(evolutionRunId)
      .filter((e) => heldOutTaskIds.has(e.taskSpecId));

    for (const evaluation of evaluations) {
      const entry = bySolver.get(evaluation.candidateSolverId) ?? {
        solverId: evaluation.candidateSolverId,
        attemptedTaskIds: new Set(),
        passedTaskIds: new Set()
      };
      entry.attemptedTaskIds.add(evaluation.taskSpecId);
      if (evaluation.passRate >= minPassRate) entry.passedTaskIds.add(evaluation.taskSpecId);
      bySolver.set(evaluation.candidateSolverId, entry);
    }

    return [...bySolver.values()].map((entry) => ({
      solverId: entry.solverId,
      attempted: entry.attemptedTaskIds.size,
      passed: entry.passedTaskIds.size
    }));
  }

  function resolveIncumbents(evolutionRunId) {
    const currentSlots = repos.championSlots.getAll(evolutionRunId);
    const incumbents = {};

    for (const slotName of ALL_CHAMPION_SLOTS) {
      if (slotName === CHAMPION_SLOTS.BEST_HELD_OUT_COVERAGE) continue;
      const slot = currentSlots[slotName];
      incumbents[slotName] = slot?.candidateEvaluationId ? repos.candidateEvaluations.getById(slot.candidateEvaluationId) : null;
    }

    const coverageSlot = currentSlots[CHAMPION_SLOTS.BEST_HELD_OUT_COVERAGE];
    incumbents[CHAMPION_SLOTS.BEST_HELD_OUT_COVERAGE] =
      coverageSlot?.metricSnapshot?.attempted != null ? coverageSlot.metricSnapshot : null;

    return { currentSlots, incumbents };
  }

  function persistSlotUpdates(evolutionRunId, updates, cycle) {
    for (const slotName of ALL_CHAMPION_SLOTS) {
      const decision = updates[slotName];
      if (!decision?.changed) continue;

      if (slotName === CHAMPION_SLOTS.BEST_HELD_OUT_COVERAGE) {
        repos.championSlots.upsert(evolutionRunId, slotName, {
          candidateSolverId: decision.holder.solverId,
          candidateEvaluationId: null,
          metricSnapshot: decision.holder,
          cycle
        });
        continue;
      }

      repos.championSlots.upsert(evolutionRunId, slotName, {
        candidateSolverId: decision.holder.candidateSolverId,
        candidateEvaluationId: decision.holder.id,
        metricSnapshot: {
          meanScore: decision.holder.meanScore,
          passRate: decision.holder.passRate,
          variance: decision.holder.variance,
          meanCostUsd: decision.holder.meanCostUsd,
          meanTokensIn: decision.holder.meanTokensIn,
          meanTokensOut: decision.holder.meanTokensOut,
          runnerMode: decision.holder.runnerMode,
          significance: decision.significance ?? null
        },
        cycle
      });
    }
  }

  /**
   * The single transactional boundary for a cycle: champion-slot
   * recomputation, the cycle's admin metrics snapshot, and any resulting
   * run-status change all commit together or not at all.
   */
  function completeCycle({ evolutionRunId, cycle, thresholds = {}, balancedScoreOptions = {} }) {
    return withTransaction(db, () => {
      const run = repos.evolutionRuns.getById(evolutionRunId);
      if (!run) throw new Error(`Unknown evolution run: ${evolutionRunId}`);

      const allTasks = repos.taskSpecs.listByRun(evolutionRunId);
      const heldOutTaskIds = new Set(allTasks.filter((t) => t.isHeldOut).map((t) => t.id));
      const regressionTaskIds = new Set(repos.regressionCases.listActiveByRun(evolutionRunId).map((r) => r.taskSpecId));

      const primaryEvaluations = buildPrimaryEvaluations(evolutionRunId, cycle, heldOutTaskIds, regressionTaskIds);
      const regressionEvaluationsBySolver = buildRegressionEvaluationsBySolver(evolutionRunId, cycle, regressionTaskIds);
      const heldOutCoverageBySolver = buildHeldOutCoverage(
        evolutionRunId,
        heldOutTaskIds,
        thresholds.correctness?.minPassRate ?? DEFAULTS.MIN_PASS_RATE
      );
      const { currentSlots, incumbents } = resolveIncumbents(evolutionRunId);

      const updates = computeChampionSlotUpdates({
        evaluations: primaryEvaluations,
        regressionEvaluationsBySolver,
        heldOutCoverageBySolver,
        incumbents,
        thresholds,
        balancedScoreOptions
      });

      persistSlotUpdates(evolutionRunId, updates, cycle);

      const previousChampionSlot = currentSlots[CHAMPION_SLOTS.CURRENT_CHAMPION];
      const championDecision = updates[CHAMPION_SLOTS.CURRENT_CHAMPION];
      const championKnowledgeLinks = getChampionKnowledgeLinks(championDecision.holder?.candidateSolverId ?? null);

      const explorationWasteUsd = computeExplorationWaste({
        evaluationsThisCycle: primaryEvaluations,
        championEvaluationId: championDecision.holder?.id ?? null
      });
      const previousCycleMetrics = repos.cycleMetrics.getPrevious(evolutionRunId, cycle);

      const metrics = computeCycleMetrics({
        previous: previousChampionSlot?.candidateEvaluationId
          ? repos.candidateEvaluations.getById(previousChampionSlot.candidateEvaluationId)
          : null,
        current: championDecision.holder,
        championKnowledgeLinks,
        explorationWasteUsd,
        previousExplorationWasteUsd: previousCycleMetrics?.explorationWasteUsd ?? null
      });

      repos.cycleMetrics.create({ evolutionRunId, cycle, metrics, explorationWasteUsd });

      const allEvaluations = repos.candidateEvaluations.listByRun(evolutionRunId);
      const realEvaluationsCompleted = allEvaluations.filter((e) => e.runnerMode === RUNNER_MODES.REAL).length;
      const totalSpendUsd = allEvaluations.reduce((total, e) => total + e.totalCostUsd, 0);
      const cycleMetricsHistory = repos.cycleMetrics.listByRun(evolutionRunId).map((m) => m.metrics);

      const stopDecision = checkEarlyStopping(run, {
        cycleMetricsHistory,
        totalSpendUsd,
        realEvaluationsCompleted
      });

      let finalRun = run;
      if (stopDecision.shouldStop) {
        finalRun = repos.evolutionRuns.updateStatus(evolutionRunId, RUN_STATUS.COMPLETED, {
          stoppedReason: stopDecision.reason
        });
      }

      return { cycle, slotUpdates: updates, metrics, explorationWasteUsd, stopDecision, run: finalRun };
    });
  }

  function exportRun(evolutionRunId) {
    return exportRunToJson(db, repos, evolutionRunId);
  }

  function exportRunToFilePath(evolutionRunId, filePath) {
    return exportRunToFile(db, repos, evolutionRunId, filePath);
  }

  return {
    repositories: repos,
    createRun,
    startCycle,
    proposeCandidateSolver,
    recordCandidateEvaluation,
    recordRepoKnowledge,
    recordSubjectModelKnowledge,
    recordExploitCard,
    completeCycle,
    exportRun,
    exportRunToFilePath
  };
}
