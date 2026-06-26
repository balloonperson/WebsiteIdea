import { callAiWithUsage } from "../ai.js";
import { formatFiles } from "../prompts.js";
import { estimateCostUsd } from "./pricing.js";

function repoContextBlock(repoDigest) {
  if (!repoDigest) return "No repository context was provided.";
  return [
    "File tree:",
    (repoDigest.fileTree || []).join("\n"),
    "",
    "Relevant file contents:",
    formatFiles(repoDigest.relevantFiles || [])
  ].join("\n");
}

/**
 * Generates one candidate solver (seed or mutation). Returns the
 * instructions text plus exploit hypotheses the candidate is claiming to
 * exploit — these are recorded as "claimed" exploit cards, never
 * "verified", since nothing here has executed real code yet.
 */
export async function generateCandidateInstructions({
  subject,
  targetModel,
  optimizationMode,
  repoDigest,
  parentInstructions,
  generationMethod,
  knowledgeContext = []
}) {
  const system = [
    "You are an evolutionary optimizer for coding-agent instructions, scoped to one exact repository and one exact subject.",
    "You intentionally overfit: find stable interfaces, reliable shortcuts, subject-specific normal forms, file boundaries,",
    "focused verification methods, and reasoning steps a smaller model could skip, for this repo and subject only.",
    "Generic best-practice advice is not useful here.",
    "Return JSON only, no markdown fences."
  ].join(" ");

  const mutationBlock =
    generationMethod === "mutation" && parentInstructions
      ? [
          "You are mutating the current best instruction set below. Keep what is working, change one or two things",
          "that could plausibly improve correctness, cost, or token usage for this exact subject. Do not rewrite it wholesale.",
          "",
          "Current best instructions:",
          parentInstructions
        ].join("\n")
      : "Propose a fresh (seed) instruction set for this subject.";

  const knowledgeBlock = knowledgeContext.length
    ? ["Known claims about this repo/subject (status shown — claimed/predicted are not yet proven):",
        ...knowledgeContext.map((k) => `- [${k.status}] ${k.claimText || k.title}`)
      ].join("\n")
    : "No prior recorded knowledge for this repo/subject yet.";

  const user = [
    `Subject (exact scope, do not generalize beyond it): ${subject}`,
    `Target model: ${targetModel}`,
    `Optimization mode: ${optimizationMode}`,
    "",
    mutationBlock,
    "",
    knowledgeBlock,
    "",
    "Repository context:",
    repoContextBlock(repoDigest),
    "",
    'Respond with JSON: {"instructions": "...", "rationale": "...", "exploitHypotheses": [{"type": "stable-interface|reliable-shortcut|normal-form|file-boundary|verification-method|skippable-reasoning", "title": "...", "evidence": "..."}]}'
  ].join("\n");

  const { text, model, usage } = await callAiWithUsage({ system, user });
  const parsed = parseJsonLoose(text);
  const costUsd = estimateCostUsd({ model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });

  return {
    instructions: typeof parsed?.instructions === "string" ? parsed.instructions : text,
    rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "",
    exploitHypotheses: Array.isArray(parsed?.exploitHypotheses) ? parsed.exploitHypotheses.filter(isValidHypothesis) : [],
    usage,
    costUsd
  };
}

function isValidHypothesis(item) {
  return item && typeof item.type === "string" && typeof item.title === "string" && typeof item.evidence === "string";
}

export function parseJsonLoose(rawText) {
  const cleaned = (rawText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
