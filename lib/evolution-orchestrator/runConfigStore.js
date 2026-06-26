// Branch 4 (admin console) needs to persist settings the evolution-core
// schema (Branch 1) has no columns for — objective profile, candidates per
// cycle, knowledge-influence toggle, real-runner profile info — plus the
// repo digest a run was started with, so a run can resume after a server
// restart without re-uploading the project. This lives outside the
// evolution-core DB entirely: a small JSON file per run under data/runs/.
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "..", "..", "data", "runs");

function filePathFor(runId) {
  return path.join(RUNS_DIR, `${runId}.json`);
}

export async function saveRunConfig(runId, config) {
  await mkdir(RUNS_DIR, { recursive: true });
  await writeFile(filePathFor(runId), JSON.stringify(config, null, 2), "utf8");
}

export async function loadRunConfig(runId) {
  try {
    const raw = await readFile(filePathFor(runId), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deleteRunConfig(runId) {
  await rm(filePathFor(runId), { force: true });
}

export async function updateRunConfig(runId, mutator) {
  const current = (await loadRunConfig(runId)) || {};
  const next = mutator(current) || current;
  await saveRunConfig(runId, next);
  return next;
}
