import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, "..", "prompt-templates");

const GENERATE_TEMPLATES = {
  "cost-efficient": "generate-cost-efficient.txt",
  balanced: "generate-balanced.txt",
  "maximum-performance": "generate-maximum-performance.txt"
};

export async function buildSuggestPrompt({ fileTree, fileSamples, targetModel }) {
  const template = await readTemplate("suggest-subjects.txt");

  return {
    system: "You are a project analyst. Return JSON only. Do not include markdown fences.",
    user: [
      `Target model the final instructions will optimize for: ${targetModel}`,
      "",
      "Instructions for this suggestion task:",
      template,
      "",
      "Project file tree:",
      fileTree.join("\n"),
      "",
      "Sample files:",
      formatFiles(fileSamples)
    ].join("\n")
  };
}

export async function buildGeneratePrompt({
  targetModel,
  subject,
  optimizationPath,
  fileTree,
  relevantFiles
}) {
  const templateName = GENERATE_TEMPLATES[optimizationPath] || GENERATE_TEMPLATES["cost-efficient"];
  const template = await readTemplate(templateName);

  return {
    system: [
      "You are a coding workflow analyst.",
      `Produce a compact instruction profile for a coding agent using ${targetModel}.`,
      "Return JSON only. Do not include markdown fences."
    ].join(" "),
    user: [
      "The user-provided subject below defines the scope of the instructions.",
      "It may be a git branch name, a feature area, a development topic, or any other confinement the user wants the instructions focused on.",
      "Treat it as the boundary for all guidance you produce.",
      "",
      `Subject: ${subject}`,
      `Target model: ${targetModel}`,
      `Optimization path: ${optimizationPath}`,
      "",
      "Instructions for this generation task:",
      template,
      "",
      "Project file tree:",
      fileTree.join("\n"),
      "",
      "Relevant file contents:",
      formatFiles(relevantFiles)
    ].join("\n")
  };
}

async function readTemplate(fileName) {
  return readFile(path.join(TEMPLATE_DIR, fileName), "utf8");
}

export function formatFiles(files) {
  if (!files?.length) {
    return "No file contents included.";
  }

  return files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n");
}
