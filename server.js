import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callAi, parseJsonResponse } from "./lib/ai.js";
import { fetchRepoFiles } from "./lib/github.js";
import { buildGeneratePrompt, buildSuggestPrompt } from "./lib/prompts.js";

const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const MAX_CONTEXT_CHARS = 150000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        aiModel: process.env.AI_MODEL || "claude-sonnet-4-5-20250929"
      });
    }

    if (req.method === "POST" && url.pathname === "/api/suggest") {
      return await handleSuggest(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      return await handleGenerate(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/github") {
      return await handleGithub(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    return sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    return sendError(res, error);
  }
});

server.listen(port, host, () => {
  console.log(`WebsiteIdea app running at http://${host}:${port}`);
});

async function handleSuggest(req, res) {
  const { fileTree = [], fileSamples = [], targetModel } = await readJson(req);

  if (!Array.isArray(fileTree) || !targetModel) {
    return sendJson(res, 400, { error: "Missing project files or target model." });
  }

  const prompt = await buildSuggestPrompt({
    fileTree: fileTree.slice(0, 500),
    fileSamples: capFiles(fileSamples, 60000),
    targetModel
  });

  const raw = await callAi(prompt);
  const parsed = parseJsonResponse(raw, "subjects");
  return sendJson(res, 200, { subjects: parsed.subjects });
}

async function handleGenerate(req, res) {
  const {
    targetModel,
    subject,
    optimizationPath = "cost-efficient",
    fileTree = [],
    relevantFiles = []
  } = await readJson(req);

  if (!targetModel || !subject?.trim()) {
    return sendJson(res, 400, { error: "Missing target model or subject." });
  }

  if (!Array.isArray(fileTree) || !Array.isArray(relevantFiles)) {
    return sendJson(res, 400, { error: "Project file data was malformed." });
  }

  const prompt = await buildGeneratePrompt({
    targetModel,
    subject: subject.trim(),
    optimizationPath,
    fileTree: fileTree.slice(0, 800),
    relevantFiles: capFiles(relevantFiles, MAX_CONTEXT_CHARS)
  });

  const raw = await callAi(prompt);
  const parsed = parseJsonResponse(raw, "instructions");

  const rawAnalysis = Array.isArray(parsed.solverAnalysis)
    ? parsed.solverAnalysis
    : Array.isArray(parsed.tokenWasteSources)
      ? parsed.tokenWasteSources.map((content) => ({
          type: "waste-source",
          title: "Likely token waste",
          content
        }))
      : [];

  const solverAnalysis = rawAnalysis.map(normalizeFinding).filter(Boolean);

  if (rawAnalysis.length !== solverAnalysis.length) {
    console.warn(`Filtered ${rawAnalysis.length - solverAnalysis.length} malformed solver findings`);
  }
  if (solverAnalysis.length > 0 && (solverAnalysis.length < 3 || solverAnalysis.length > 25)) {
    console.warn(`Unusual solverAnalysis count: ${solverAnalysis.length}`);
  }

  return sendJson(res, 200, {
    instructions: parsed.instructions,
    subjectSummary: parsed.subjectSummary || "",
    relevantAreas: parsed.relevantAreas || [],
    solverAnalysis
  });
}

function normalizeFinding(item) {
  if (!item || typeof item !== "object") return null;
  const type    = typeof item.type    === "string" ? item.type.trim()    : "";
  const title   = typeof item.title   === "string" ? item.title.trim()   : "";
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!type || !title || !content) return null;
  return { type, title, content };
}

async function handleGithub(req, res) {
  const { repoUrl } = await readJson(req);

  if (!repoUrl || typeof repoUrl !== "string") {
    return sendJson(res, 400, { error: "Missing repoUrl." });
  }

  try {
    const project = await fetchRepoFiles(repoUrl.trim());
    return sendJson(res, 200, project);
  } catch (error) {
    return sendError(res, error);
  }
}

function capFiles(files, maxChars) {
  let used = 0;
  const capped = [];

  for (const file of files) {
    if (!file?.path || typeof file.content !== "string") {
      continue;
    }

    const remaining = maxChars - used;
    if (remaining <= 0) {
      break;
    }

    const content = file.content.slice(0, remaining);
    capped.push({ path: file.path, content });
    used += content.length;
  }

  return capped;
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const payload = {
    error: error.message || "Something went wrong."
  };

  if (error.rawResponse) {
    payload.rawResponse = error.rawResponse;
  }

  return sendJson(res, statusCode, payload);
}

async function readJson(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8 * 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
  }

  return body ? JSON.parse(body) : {};
}

async function serveStatic(requestPath, res) {
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(__dirname)) {
    return sendJson(res, 403, { error: "Forbidden." });
  }

  try {
    const contents = await readFile(filePath);
    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    return res.end(contents);
  } catch {
    return sendJson(res, 404, { error: "Not found." });
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  return res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const extension = path.extname(filePath);

  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";

  return "text/plain; charset=utf-8";
}
