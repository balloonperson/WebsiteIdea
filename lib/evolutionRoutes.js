import { initRunConfig, deleteRunConfig, subscribeToRun, getRecentEvents, suggestTaskDrafts, RealRunnerUnavailableError } from "./evolution-orchestrator/index.js";

const RUN_ID_RE = /^\/api\/evolution\/runs\/(\d+)$/;
const RUN_ACTION_RE = /^\/api\/evolution\/runs\/(\d+)\/(cancel|resume|verify|export|events)$/;
const CANDIDATE_RE = /^\/api\/evolution\/runs\/(\d+)\/candidates\/(\d+)$/;
const TASK_ID_RE = /^\/api\/tasks\/(\d+)$/;

export function createEvolutionRoutes({ engine, orchestrator }) {
  const repos = engine.repositories;

  return async function handle(req, res, url) {
    const { pathname } = url;

    if (pathname === "/api/evolution/runs" && req.method === "POST") {
      return await createRun(req, res);
    }
    if (pathname === "/api/evolution/runs" && req.method === "GET") {
      return sendJson(res, 200, { runs: repos.evolutionRuns.listAll() });
    }

    const actionMatch = pathname.match(RUN_ACTION_RE);
    if (actionMatch) {
      const runId = Number(actionMatch[1]);
      const action = actionMatch[2];
      if (action === "events" && req.method === "GET") return streamEvents(runId, req, res);
      if (action === "cancel" && req.method === "POST") return cancelRun(runId, res);
      if (action === "resume" && req.method === "POST") return await resumeRun(runId, res);
      if (action === "verify" && req.method === "POST") return await verifyRun(runId, req, res);
      if (action === "export" && req.method === "POST") return exportRun(runId, res);
    }

    const candidateMatch = pathname.match(CANDIDATE_RE);
    if (candidateMatch && req.method === "GET") {
      return getCandidateDetail(Number(candidateMatch[1]), Number(candidateMatch[2]), res);
    }

    const runIdMatch = pathname.match(RUN_ID_RE);
    if (runIdMatch && req.method === "GET") {
      return getRunDetail(Number(runIdMatch[1]), res);
    }
    if (runIdMatch && req.method === "DELETE") {
      return await deleteRun(Number(runIdMatch[1]), res);
    }

    if (pathname === "/api/tasks/suggest" && req.method === "POST") {
      return await suggestTasks(req, res);
    }
    if (pathname === "/api/tasks" && req.method === "POST") {
      return await createTask(req, res);
    }
    if (pathname === "/api/tasks" && req.method === "GET") {
      return listTasks(url, res);
    }
    const taskIdMatch = pathname.match(TASK_ID_RE);
    if (taskIdMatch && req.method === "PATCH") {
      return await patchTask(Number(taskIdMatch[1]), req, res);
    }
    if (taskIdMatch && req.method === "DELETE") {
      return deleteTask(Number(taskIdMatch[1]), res);
    }

    return false;
  };

  async function createRun(req, res) {
    const body = await readJson(req);
    const {
      repoIdentifier,
      repoCommitHash,
      subject,
      targetModel,
      optimizationMode = "cost-efficient",
      runnerMode = "dual",
      dualSimulatedSplit,
      dualRealSplit,
      noiseRepeatCount,
      hardRunBudgetUsd,
      maxCycles,
      noImprovementWindow,
      minRealVerificationReserve,
      settings = {},
      repoDigest = {}
    } = body;

    if (!repoIdentifier || !subject?.trim() || !targetModel) {
      return sendJson(res, 400, { error: "Missing repoIdentifier, subject, or targetModel." });
    }

    const run = engine.createRun({
      repoIdentifier,
      repoCommitHash: repoCommitHash || "unspecified",
      subject: subject.trim(),
      targetModel,
      optimizationMode,
      runnerMode,
      dualSimulatedSplit,
      dualRealSplit,
      noiseRepeatCount,
      hardRunBudgetUsd,
      maxCycles: maxCycles ?? (hardRunBudgetUsd == null ? 8 : null),
      noImprovementWindow,
      minRealVerificationReserve
    });

    await initRunConfig(run.id, {
      repoDigest: {
        fileTree: Array.isArray(repoDigest.fileTree) ? repoDigest.fileTree.slice(0, 800) : [],
        relevantFiles: Array.isArray(repoDigest.relevantFiles) ? capFiles(repoDigest.relevantFiles, 150000) : []
      },
      settings
    });

    await orchestrator.startRun(run.id);
    return sendJson(res, 201, { run });
  }

  function getRunDetail(runId, res) {
    const run = repos.evolutionRuns.getById(runId);
    if (!run) return sendJson(res, 404, { error: "Run not found." });

    return sendJson(res, 200, {
      run,
      taskSpecs: repos.taskSpecs.listByRun(runId),
      regressionCases: repos.regressionCases.listActiveByRun(runId),
      candidateSolvers: repos.candidateSolvers.listByRun(runId),
      candidateEvaluations: repos.candidateEvaluations.listByRun(runId),
      exploitCards: repos.exploitCards.listByRun(runId),
      championSlots: repos.championSlots.getAll(runId),
      cycleMetrics: repos.cycleMetrics.listByRun(runId),
      repoKnowledgeEntries: repos.repoKnowledge.listByRun(runId),
      subjectModelEntries: repos.subjectModel.listByRun(runId)
    });
  }

  function getCandidateDetail(runId, candidateId, res) {
    const solver = repos.candidateSolvers.getById(candidateId);
    if (!solver || solver.evolutionRunId !== runId) {
      return sendJson(res, 404, { error: "Candidate not found for this run." });
    }

    const evaluations = repos.candidateEvaluations.listBySolver(candidateId);
    const evaluationsWithTraces = evaluations.map((evaluation) => ({
      ...evaluation,
      traces: repos.evalTraces.listByEvaluation(evaluation.id)
    }));

    return sendJson(res, 200, {
      candidate: solver,
      lineage: repos.candidateSolvers.listLineage(candidateId),
      knowledgeLinks: repos.solverKnowledgeLinks.listBySolver(candidateId),
      evaluations: evaluationsWithTraces
    });
  }

  function cancelRun(runId, res) {
    orchestrator.cancelRun(runId);
    return sendJson(res, 200, { ok: true });
  }

  async function resumeRun(runId, res) {
    await orchestrator.resumeRun(runId);
    return sendJson(res, 200, { run: repos.evolutionRuns.getById(runId) });
  }

  async function verifyRun(runId, req, res) {
    try {
      await readJson(req);
      orchestrator.requestVerify(runId);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      if (error instanceof RealRunnerUnavailableError) {
        return sendJson(res, 501, { error: error.message, code: "real-runner-unavailable" });
      }
      throw error;
    }
  }

  function exportRun(runId, res) {
    const run = repos.evolutionRuns.getById(runId);
    if (!run) return sendJson(res, 404, { error: "Run not found." });
    return sendJson(res, 200, engine.exportRun(runId));
  }

  async function deleteRun(runId, res) {
    orchestrator.cancelRun(runId);
    repos.evolutionRuns.remove(runId);
    await deleteRunConfig(runId);
    return sendJson(res, 200, { ok: true });
  }

  function streamEvents(runId, req, res) {
    const run = repos.evolutionRuns.getById(runId);
    if (!run) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Run not found." }));
      return true;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    for (const event of getRecentEvents(runId)) {
      writeSseEvent(res, event);
    }

    const unsubscribe = subscribeToRun(runId, (event) => writeSseEvent(res, event));
    const heartbeat = setInterval(() => res.write(":heartbeat\n\n"), 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return true;
  }

  async function suggestTasks(req, res) {
    const { subject, repoDigest, count } = await readJson(req);
    if (!subject?.trim()) {
      return sendJson(res, 400, { error: "Missing subject." });
    }
    const tasks = await suggestTaskDrafts({ subject: subject.trim(), repoDigest, count: count || 4 });
    return sendJson(res, 200, { tasks });
  }

  async function createTask(req, res) {
    const { evolutionRunId, subject, taskFamily, prompt, expectedCriteria, isHeldOut, source } = await readJson(req);
    if (!subject?.trim() || !taskFamily?.trim() || !prompt?.trim()) {
      return sendJson(res, 400, { error: "Missing subject, taskFamily, or prompt." });
    }
    const task = repos.taskSpecs.create({
      evolutionRunId: evolutionRunId ?? null,
      subject: subject.trim(),
      taskFamily: taskFamily.trim(),
      prompt: prompt.trim(),
      expectedCriteria: Array.isArray(expectedCriteria) ? expectedCriteria : [],
      isHeldOut: Boolean(isHeldOut),
      source: source === "generated" ? "generated" : "manual"
    });
    return sendJson(res, 201, { task });
  }

  function listTasks(url, res) {
    const runId = url.searchParams.get("runId");
    if (!runId) return sendJson(res, 400, { error: "Missing runId query parameter." });
    return sendJson(res, 200, { tasks: repos.taskSpecs.listByRun(Number(runId)) });
  }

  async function patchTask(taskId, req, res) {
    const body = await readJson(req);
    const task = repos.taskSpecs.update(taskId, body);
    if (!task) return sendJson(res, 404, { error: "Task not found." });
    return sendJson(res, 200, { task });
  }

  function deleteTask(taskId, res) {
    repos.taskSpecs.remove(taskId);
    return sendJson(res, 200, { ok: true });
  }
}

function writeSseEvent(res, event) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify({ ...event.data, at: event.at })}\n\n`);
}

function capFiles(files, maxChars) {
  let used = 0;
  const capped = [];
  for (const file of files) {
    if (!file?.path || typeof file.content !== "string") continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const content = file.content.slice(0, remaining);
    capped.push({ path: file.path, content });
    used += content.length;
  }
  return capped;
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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
  return true;
}
