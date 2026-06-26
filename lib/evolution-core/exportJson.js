import { writeFile } from "node:fs/promises";
import { getSchemaVersion } from "./db/migrationRunner.js";

export function exportRunToJson(db, repos, evolutionRunId) {
  const run = repos.evolutionRuns.getById(evolutionRunId);
  if (!run) {
    throw new Error(`Unknown evolution run: ${evolutionRunId}`);
  }

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: getSchemaVersion(db),
    run,
    taskSpecs: repos.taskSpecs.listByRun(evolutionRunId),
    regressionCases: repos.regressionCases.listActiveByRun(evolutionRunId),
    candidateSolvers: repos.candidateSolvers.listByRun(evolutionRunId),
    candidateEvaluations: repos.candidateEvaluations.listByRun(evolutionRunId),
    repoKnowledgeEntries: repos.repoKnowledge.listByRun(evolutionRunId),
    subjectModelEntries: repos.subjectModel.listByRun(evolutionRunId),
    exploitCards: repos.exploitCards.listByRun(evolutionRunId),
    championSlots: repos.championSlots.getAll(evolutionRunId),
    cycleMetrics: repos.cycleMetrics.listByRun(evolutionRunId)
  };
}

export async function exportRunToFile(db, repos, evolutionRunId, filePath) {
  const data = exportRunToJson(db, repos, evolutionRunId);
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  return data;
}
