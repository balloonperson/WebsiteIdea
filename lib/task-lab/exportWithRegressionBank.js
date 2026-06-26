import { regressionBankExportSummary } from "./regressionBank.js";

/**
 * Adds whether-the-final-solver-passed-the-regression-bank to an already
 * exported run. Takes the plain object exportRunToJson produces (so it
 * doesn't need its own db/repos wiring beyond the Task Lab repositories
 * already passed elsewhere) rather than reaching into evolution-core's
 * export internals, keeping the two modules' export logic independently
 * testable.
 */
export function attachRegressionBankSummary(exportedRun, repos) {
  const championSolverId =
    exportedRun.championSlots?.currentChampion?.candidateSolverId ??
    exportedRun.championSlots?.verifiedLeader?.candidateSolverId ??
    null;

  return {
    ...exportedRun,
    regressionBank: regressionBankExportSummary(repos, {
      evolutionRunId: exportedRun.run.id,
      candidateSolverId: championSolverId
    })
  };
}
