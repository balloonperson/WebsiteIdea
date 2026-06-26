import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callAi, parseJsonResponse } from "../ai.js";
import { formatFiles } from "../prompts.js";
import { TASK_DIFFICULTY, TASK_FILE_SCOPE, TASK_ORIGIN, TASK_REVIEW_STATUS, TASK_ROLE } from "../evolution-core/constants.js";
import { validateTaskSpec } from "./qualityGates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "prompt-templates", "suggest-tasks.txt");

async function buildSuggestTasksPrompt({ subject, fileTree, fileSamples, existingTaskFamilies }) {
  const template = await readFile(TEMPLATE_PATH, "utf8");
  return {
    system: "You are a test-task author for one exact repository and one exact subject. Return JSON only. Do not include markdown fences.",
    user: [
      `Subject: ${subject}`,
      "",
      "Instructions for this suggestion task:",
      template,
      "",
      existingTaskFamilies.length
        ? `Task families that already have coverage (avoid redundant duplicates of these unless adding a genuinely new failure mode): ${existingTaskFamilies.join(", ")}`
        : "No tasks exist yet for this run.",
      "",
      "Project file tree:",
      fileTree.join("\n"),
      "",
      "Sample files:",
      formatFiles(fileSamples)
    ].join("\n")
  };
}

function normalizeSuggestedTask(raw, subject) {
  if (!raw || typeof raw !== "object") return null;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const taskFamily = typeof raw.taskFamily === "string" ? raw.taskFamily.trim() : "";
  if (!prompt || !taskFamily) return null;

  return {
    subject,
    taskFamily,
    prompt,
    subjectBoundary: typeof raw.subjectBoundary === "string" ? raw.subjectBoundary.trim() : "",
    repoEvidence: typeof raw.repoEvidence === "string" ? raw.repoEvidence.trim() : "",
    difficulty: Object.values(TASK_DIFFICULTY).includes(raw.difficulty) ? raw.difficulty : TASK_DIFFICULTY.MEDIUM,
    requiredBehavior: Array.isArray(raw.requiredBehavior) ? raw.requiredBehavior.map(String) : [],
    forbiddenBehavior: Array.isArray(raw.forbiddenBehavior) ? raw.forbiddenBehavior.map(String) : [],
    expectedTouchedAreas: Array.isArray(raw.expectedTouchedAreas) ? raw.expectedTouchedAreas.map(String) : [],
    fileScope: Object.values(TASK_FILE_SCOPE).includes(raw.fileScope) ? raw.fileScope : TASK_FILE_SCOPE.SINGLE,
    verificationMethod: typeof raw.verificationMethod === "string" ? raw.verificationMethod.trim() : "",
    hiddenAssertions: Array.isArray(raw.hiddenAssertions) ? raw.hiddenAssertions.map(String) : [],
    failureMode: typeof raw.failureMode === "string" ? raw.failureMode.trim() : "",
    expectedCriteria: Array.isArray(raw.requiredBehavior) ? raw.requiredBehavior.map(String) : [],
    origin: TASK_ORIGIN.OPTIMIZER_SUGGESTED,
    role: TASK_ROLE.TRAINING,
    reviewStatus: TASK_REVIEW_STATUS.PENDING
  };
}

/**
 * "Suggest Tasks": the optimizer proposes tasks from repo/subject evidence.
 * Every proposal still runs through the same quality gate a human-authored
 * task would — an AI suggestion is a draft, not an approval. Nothing is
 * persisted here; callers decide whether to hand accepted drafts to the
 * review queue or straight into a task set.
 */
export async function suggestTasks({
  subject,
  fileTree = [],
  fileSamples = [],
  existingTaskFamilies = [],
  generate = callAi
}) {
  const prompt = await buildSuggestTasksPrompt({ subject, fileTree, fileSamples, existingTaskFamilies });
  const raw = await generate(prompt);
  const parsed = parseJsonResponse(raw, "tasks");
  const candidates = Array.isArray(parsed.tasks) ? parsed.tasks : [];

  const normalized = candidates.map((item) => normalizeSuggestedTask(item, subject)).filter(Boolean);

  const accepted = [];
  const rejected = [];
  for (const task of normalized) {
    const { valid, errors } = validateTaskSpec(task);
    if (valid) accepted.push(task);
    else rejected.push({ task, errors });
  }

  return { accepted, rejected };
}
