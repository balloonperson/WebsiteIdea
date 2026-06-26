import { createEvolutionRunRepository } from "./evolutionRunRepository.js";
import { createTaskSpecRepository } from "./taskSpecRepository.js";
import { createRegressionCaseRepository } from "./regressionCaseRepository.js";
import { createCandidateSolverRepository } from "./candidateSolverRepository.js";
import { createSolverKnowledgeLinkRepository } from "./solverKnowledgeLinkRepository.js";
import { createCandidateEvaluationRepository } from "./candidateEvaluationRepository.js";
import { createEvalTraceRepository } from "./evalTraceRepository.js";
import { createRepoKnowledgeRepository } from "./repoKnowledgeRepository.js";
import { createSubjectModelRepository } from "./subjectModelRepository.js";
import { createExploitCardRepository } from "./exploitCardRepository.js";
import { createChampionSlotRepository } from "./championSlotRepository.js";
import { createCycleMetricsRepository } from "./cycleMetricsRepository.js";

export function createRepositories(db) {
  return {
    evolutionRuns: createEvolutionRunRepository(db),
    taskSpecs: createTaskSpecRepository(db),
    regressionCases: createRegressionCaseRepository(db),
    candidateSolvers: createCandidateSolverRepository(db),
    solverKnowledgeLinks: createSolverKnowledgeLinkRepository(db),
    candidateEvaluations: createCandidateEvaluationRepository(db),
    evalTraces: createEvalTraceRepository(db),
    repoKnowledge: createRepoKnowledgeRepository(db),
    subjectModel: createSubjectModelRepository(db),
    exploitCards: createExploitCardRepository(db),
    championSlots: createChampionSlotRepository(db),
    cycleMetrics: createCycleMetricsRepository(db)
  };
}
