import { callAiWithUsage } from "../ai.js";
import { formatFiles } from "../prompts.js";
import { parseJsonLoose } from "./aiCandidate.js";

export async function suggestTaskDrafts({ subject, repoDigest, count = 4 }) {
  const system = [
    "You write concrete, checkable coding tasks scoped to one exact repository subject.",
    "Each task must be something a coding agent could actually attempt against this repo, with criteria a reviewer could check.",
    "Avoid generic tasks unrelated to the named subject. Return JSON only, no markdown fences."
  ].join(" ");

  const user = [
    `Subject: ${subject}`,
    `Number of tasks requested: ${count}`,
    "",
    "File tree:",
    (repoDigest?.fileTree || []).join("\n"),
    "",
    "Relevant file contents:",
    formatFiles(repoDigest?.relevantFiles || []),
    "",
    'Respond with JSON: {"tasks": [{"taskFamily": "...", "prompt": "...", "expectedCriteria": ["..."]}]}'
  ].join("\n");

  const { text } = await callAiWithUsage({ system, user });
  const parsed = parseJsonLoose(text);
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];

  return tasks
    .filter((t) => t && typeof t.prompt === "string" && t.prompt.trim())
    .map((t) => ({
      taskFamily: typeof t.taskFamily === "string" && t.taskFamily.trim() ? t.taskFamily.trim() : "general",
      prompt: t.prompt.trim(),
      expectedCriteria: Array.isArray(t.expectedCriteria) ? t.expectedCriteria.filter((c) => typeof c === "string") : []
    }));
}
