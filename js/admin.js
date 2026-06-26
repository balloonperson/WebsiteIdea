import { getEvolutionRun, getCandidateDetail, subscribeToRunEvents, exportEvolutionRun, verifyEvolutionRun } from "./evolutionApi.js";
import { onStoreChange, getState, setSelectedRunId } from "./store.js";
import { renderPercentChangeChart, renderBarChart, renderLegend } from "./charts.js";

const els = {
  runSelect: document.querySelector("#admin-run-select"),
  summary: document.querySelector("#admin-run-summary"),
  lineageTree: document.querySelector("#admin-lineage-tree"),
  currentExperiment: document.querySelector("#admin-current-experiment"),
  instructionDiff: document.querySelector("#admin-instruction-diff"),
  cycleChart: document.querySelector("#admin-cycle-chart"),
  costChart: document.querySelector("#admin-cost-chart"),
  noiseTable: document.querySelector("#admin-noise-table"),
  exploitCards: document.querySelector("#admin-exploit-cards"),
  taskSet: document.querySelector("#admin-task-set"),
  evidencePanel: document.querySelector("#admin-evidence-panel"),
  drawer: document.querySelector("#trace-drawer"),
  drawerBackdrop: document.querySelector("#trace-drawer-backdrop"),
  drawerClose: document.querySelector("#trace-drawer-close"),
  drawerBody: document.querySelector("#trace-drawer-body")
};

const state = {
  runId: null,
  detail: null,
  selectedCandidateId: null,
  unsubscribe: null
};

const CHAMPION_SLOT_LABELS = {
  highestCorrectness: "Highest correctness",
  lowestCostAboveThreshold: "Lowest cost above threshold",
  bestHeldOutCoverage: "Best held-out coverage",
  bestBalanced: "Best balanced",
  predictedLeader: "Predicted Leader (simulated, unverified)",
  verifiedLeader: "Verified Leader (real worktree only)",
  currentChampion: "Current Champion (mirrors Verified Leader)"
};

onStoreChange((s) => {
  renderRunOptions(s.runs);
  if (s.selectedRunId && s.selectedRunId !== state.runId) {
    els.runSelect.value = String(s.selectedRunId);
    loadRun(s.selectedRunId);
  }
});

els.runSelect.addEventListener("change", () => {
  if (els.runSelect.value) {
    setSelectedRunId(Number(els.runSelect.value));
  }
});

window.addEventListener("tab-activated", (event) => {
  if (event.detail.tab === "admin") {
    renderRunOptions(getState().runs);
    if (state.runId) loadRun(state.runId);
  }
});

els.drawerClose.addEventListener("click", closeDrawer);
els.drawerBackdrop.addEventListener("click", closeDrawer);
function closeDrawer() {
  els.drawer.hidden = true;
}

function renderRunOptions(runs) {
  const current = els.runSelect.value;
  els.runSelect.innerHTML = '<option value="">Select a run...</option>';
  for (const run of runs) {
    const option = document.createElement("option");
    option.value = String(run.id);
    option.textContent = `#${run.id} — ${run.subject} (${run.status})`;
    els.runSelect.append(option);
  }
  if (current) els.runSelect.value = current;
}

async function loadRun(runId) {
  if (state.unsubscribe) state.unsubscribe();
  state.runId = runId;
  const detail = await getEvolutionRun(runId);
  state.detail = detail;
  renderAll();

  state.unsubscribe = subscribeToRunEvents(runId, async () => {
    state.detail = await getEvolutionRun(runId);
    renderAll();
  });
}

function renderAll() {
  const detail = state.detail;
  if (!detail) return;
  renderSummary(detail);
  renderLineage(detail);
  renderCurrentExperiment(detail);
  renderInstructionDiffForSelection(detail);
  renderCycleChart(detail);
  renderCostChart(detail);
  renderNoiseTable(detail);
  renderExploitCards(detail);
  renderTaskSet(detail);
  renderEvidencePanel(detail);
}

function renderSummary(detail) {
  const { run, championSlots } = detail;
  const slotBadges = Object.entries(CHAMPION_SLOT_LABELS)
    .map(([slot, label]) => {
      const holder = championSlots[slot];
      const has = holder?.candidateSolverId != null || holder?.metricSnapshot?.attempted != null;
      const verified = slot === "verifiedLeader" || slot === "currentChampion";
      return `<span class="status-pill ${has ? (verified ? "status-pill-verified" : "status-pill-predicted") : "status-pill-neutral"}">
        ${label}: ${has ? (holder.candidateSolverId ? `#${holder.candidateSolverId}` : "set") : "none"}
      </span>`;
    })
    .join("");

  els.summary.innerHTML = `
    <div class="run-summary-row">
      <span class="status-pill ${statusPillClass(run.status)}">${run.status}</span>
      <span>#${run.id} — ${escapeHtml(run.subject)}</span>
      <span class="hint">${escapeHtml(run.targetModel)} · ${run.optimizationMode} · runner: ${run.runnerMode}</span>
      <span class="hint">cycle ${run.currentCycle}${run.maxCycles ? ` / ${run.maxCycles}` : ""}</span>
      ${run.stoppedReason ? `<span class="hint">stopped: ${escapeHtml(run.stoppedReason)}</span>` : ""}
    </div>
    <div class="champion-slot-row">${slotBadges}</div>
    <p class="hint">Real worktree verification is not connected in this build. Predicted Leader is the only slot Simulated Eval can ever promote — never treat it as equivalent to a Verified Leader.</p>
    <div class="admin-action-row">
      <button type="button" class="secondary-button" id="admin-export-button">Export run JSON</button>
      <button type="button" class="secondary-button" id="admin-verify-button">Request real verification</button>
    </div>
    <p class="error" id="admin-verify-error" hidden></p>
  `;

  document.querySelector("#admin-export-button").addEventListener("click", async () => {
    const data = await exportEvolutionRun(run.id);
    downloadJson(data, `evolution-run-${run.id}.json`);
  });
  document.querySelector("#admin-verify-button").addEventListener("click", async () => {
    const errorEl = document.querySelector("#admin-verify-error");
    errorEl.hidden = true;
    try {
      await verifyEvolutionRun(run.id);
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error.message;
    }
  });
}

function statusPillClass(status) {
  if (status === "failed") return "status-pill-danger";
  if (status === "running") return "status-pill-info";
  if (status === "completed") return "status-pill-verified";
  return "status-pill-neutral";
}

function renderLineage(detail) {
  const { candidateSolvers } = detail;
  els.lineageTree.innerHTML = "";
  if (!candidateSolvers.length) {
    els.lineageTree.innerHTML = '<p class="solver-analysis-empty">No candidates yet.</p>';
    return;
  }

  const byParent = new Map();
  for (const solver of candidateSolvers) {
    const key = solver.parentSolverId ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(solver);
  }

  const root = document.createElement("ul");
  root.className = "lineage-list";
  for (const solver of byParent.get("root") || []) {
    root.append(buildLineageNode(solver, byParent));
  }
  els.lineageTree.append(root);
}

function buildLineageNode(solver, byParent) {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lineage-node" + (solver.id === state.selectedCandidateId ? " active" : "");
  button.textContent = `#${solver.id} cycle ${solver.cycle} (${solver.generationMethod})`;
  button.addEventListener("click", () => {
    state.selectedCandidateId = solver.id;
    renderLineage(state.detail);
    renderInstructionDiffForSelection(state.detail);
  });
  li.append(button);

  const children = byParent.get(solver.id) || [];
  if (children.length) {
    const childList = document.createElement("ul");
    childList.className = "lineage-list";
    for (const child of children) childList.append(buildLineageNode(child, byParent));
    li.append(childList);
  }
  return li;
}

function renderCurrentExperiment(detail) {
  const { candidateSolvers, candidateEvaluations, run } = detail;
  const latestCycleCandidates = candidateSolvers.filter((s) => s.cycle === run.currentCycle);

  if (!latestCycleCandidates.length) {
    els.currentExperiment.innerHTML = '<p class="solver-analysis-placeholder">No candidates proposed for the current cycle yet.</p>';
    return;
  }

  els.currentExperiment.innerHTML = latestCycleCandidates
    .map((solver) => {
      const evals = candidateEvaluations.filter((e) => e.candidateSolverId === solver.id);
      const meanScore = evals.length ? evals.reduce((sum, e) => sum + e.meanScore, 0) / evals.length : null;
      return `
        <div class="experiment-row">
          <strong>#${solver.id}</strong> <span class="hint">${solver.generationMethod}</span>
          <p class="hint">${evals.length} task evaluation(s) · mean score ${meanScore != null ? meanScore.toFixed(2) : "pending"}</p>
        </div>
      `;
    })
    .join("");
}

async function renderInstructionDiffForSelection(detail) {
  let candidateId = state.selectedCandidateId;
  if (!candidateId && detail.candidateSolvers.length) {
    candidateId = detail.candidateSolvers[detail.candidateSolvers.length - 1].id;
    state.selectedCandidateId = candidateId;
  }
  if (!candidateId) {
    els.instructionDiff.innerHTML = '<p class="solver-analysis-placeholder">No candidates yet.</p>';
    return;
  }

  const data = await getCandidateDetail(detail.run.id, candidateId);
  const parent = data.lineage[1] || null;
  els.instructionDiff.innerHTML = renderDiff(parent?.instructions || "", data.candidate.instructions);
}

function renderDiff(before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const beforeHtml = beforeLines
    .map((line) => `<div class="diff-line ${afterSet.has(line) ? "" : "diff-removed"}">${escapeHtml(line) || "&nbsp;"}</div>`)
    .join("");
  const afterHtml = afterLines
    .map((line) => `<div class="diff-line ${beforeSet.has(line) ? "" : "diff-added"}">${escapeHtml(line) || "&nbsp;"}</div>`)
    .join("");

  return `
    <div class="diff-columns">
      <div class="diff-column"><h4>Parent</h4>${beforeHtml || '<p class="hint">No parent (seed candidate)</p>'}</div>
      <div class="diff-column"><h4>Selected candidate</h4>${afterHtml}</div>
    </div>
  `;
}

function renderCycleChart(detail) {
  const cycles = detail.cycleMetrics.map((m) => m.cycle);
  if (!cycles.length) {
    els.cycleChart.innerHTML = '<p class="solver-analysis-placeholder">No completed cycles yet.</p>';
    return;
  }

  const series = [
    { label: "Correctness", color: "#16a34a", values: detail.cycleMetrics.map((m) => m.metrics.correctnessImprovementPct) },
    { label: "Pass rate", color: "#2563eb", values: detail.cycleMetrics.map((m) => m.metrics.passRateChangePct) },
    { label: "Cost", color: "#d97706", values: detail.cycleMetrics.map((m) => m.metrics.costChangePct) },
    { label: "Output tokens", color: "#9333ea", values: detail.cycleMetrics.map((m) => m.metrics.outputTokenChangePct) },
    { label: "Exploration waste", color: "#b42318", values: detail.cycleMetrics.map((m) => m.metrics.explorationWasteChangePct) }
  ];

  els.cycleChart.innerHTML = renderPercentChangeChart(series, cycles) + `<div class="chart-legend">${renderLegend(series)}</div>` +
    '<p class="hint">Faint, small markers are noisy/marginal moves; larger solid markers are changes the promotion gate treated as significant.</p>';
}

function renderCostChart(detail) {
  const byCycle = new Map();
  for (const evaluation of detail.candidateEvaluations) {
    const entry = byCycle.get(evaluation.cycle) || { costUsd: 0, tokensIn: 0, tokensOut: 0 };
    entry.costUsd += evaluation.totalCostUsd;
    entry.tokensIn += evaluation.totalTokensIn;
    entry.tokensOut += evaluation.totalTokensOut;
    byCycle.set(evaluation.cycle, entry);
  }
  const cycles = [...byCycle.keys()].sort((a, b) => a - b);
  if (!cycles.length) {
    els.costChart.innerHTML = '<p class="solver-analysis-placeholder">No evaluations recorded yet.</p>';
    return;
  }

  const series = [
    { label: "Cost (USD x1000)", color: "#d97706", values: cycles.map((c) => byCycle.get(c).costUsd * 1000) },
    { label: "Input tokens (k)", color: "#2563eb", values: cycles.map((c) => byCycle.get(c).tokensIn / 1000) },
    { label: "Output tokens (k)", color: "#9333ea", values: cycles.map((c) => byCycle.get(c).tokensOut / 1000) }
  ];

  els.costChart.innerHTML = renderBarChart(series, cycles) + `<div class="chart-legend">${renderLegend(series)}</div>`;
}

function renderNoiseTable(detail) {
  const { candidateEvaluations } = detail;
  if (!candidateEvaluations.length) {
    els.noiseTable.innerHTML = '<p class="solver-analysis-placeholder">No evaluations recorded yet.</p>';
    return;
  }

  const rows = candidateEvaluations
    .map(
      (e) => `
      <tr data-evaluation-id="${e.id}" data-candidate-id="${e.candidateSolverId}" class="noise-table-row">
        <td>#${e.candidateSolverId}</td>
        <td>${e.cycle}</td>
        <td>${e.runnerMode}</td>
        <td>${e.meanScore.toFixed(2)}</td>
        <td>${e.minScore.toFixed(2)}</td>
        <td>${(e.passRate * 100).toFixed(0)}%</td>
        <td>${e.variance.toFixed(3)}</td>
        <td>${(e.criticalFailureRate * 100).toFixed(0)}%</td>
        <td>$${e.meanCostUsd.toFixed(4)}</td>
        <td>${e.repeatCount}</td>
      </tr>`
    )
    .join("");

  els.noiseTable.innerHTML = `
    <table class="noise-table">
      <thead><tr><th>Candidate</th><th>Cycle</th><th>Mode</th><th>Mean</th><th>Min</th><th>Pass rate</th><th>Variance</th><th>Crit. fail</th><th>Mean cost</th><th>n</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  for (const row of els.noiseTable.querySelectorAll(".noise-table-row")) {
    row.addEventListener("click", () => openTraceDrawer(Number(row.dataset.candidateId), Number(row.dataset.evaluationId)));
  }
}

async function openTraceDrawer(candidateId, evaluationId) {
  const data = await getCandidateDetail(state.runId, candidateId);
  const evaluation = data.evaluations.find((e) => e.id === evaluationId);
  if (!evaluation) return;

  els.drawerBody.innerHTML = `
    <h3>Candidate #${candidateId} · evaluation #${evaluationId}</h3>
    <p class="hint">Runner mode: ${evaluation.runnerMode} · ${evaluation.repeatCount} repeat(s) · pass rate ${(evaluation.passRate * 100).toFixed(0)}%</p>
    <h4>Instructions given</h4>
    <pre class="trace-pre">${escapeHtml(data.candidate.instructions)}</pre>
    <h4>Trials</h4>
    ${evaluation.traces
      .map(
        (trace) => `
      <div class="trace-card">
        <div class="run-summary-row">
          <span class="status-pill ${trace.passed ? "status-pill-verified" : "status-pill-danger"}">${trace.passed ? "passed" : "failed"}</span>
          <span>score ${trace.score.toFixed(2)}</span>
          <span>${trace.tokensIn} in / ${trace.tokensOut} out</span>
          <span>$${trace.costUsd.toFixed(4)}</span>
          ${trace.criticalFailure ? '<span class="status-pill status-pill-danger">critical failure</span>' : ""}
        </div>
        ${trace.rawLogRef ? `<p class="hint">${escapeHtml(trace.rawLogRef)}</p>` : ""}
      </div>`
      )
      .join("")}
  `;
  els.drawer.hidden = false;
}

function renderExploitCards(detail) {
  const { exploitCards } = detail;
  if (!exploitCards.length) {
    els.exploitCards.innerHTML = '<p class="solver-analysis-placeholder">No exploit hypotheses recorded yet.</p>';
    return;
  }

  els.exploitCards.innerHTML = exploitCards
    .map(
      (card) => `
      <div class="exploit-card">
        <div class="exploit-card-header">
          <strong>${escapeHtml(card.title)}</strong>
          <span class="status-pill ${statusToPillClass(card.status)}">${card.status}</span>
        </div>
        <p class="hint">${card.type}</p>
        <p>${escapeHtml(card.description)}</p>
        <p class="hint">Repo evidence: ${escapeHtml(card.repoCommitHash)} · Subject evidence: ${escapeHtml(card.subjectScope)}</p>
        <p class="hint">Scope: ${escapeHtml(card.taskFamily)} · Confidence debt: ${card.status === "verified" ? "0" : (1 - card.confidence).toFixed(2)}</p>
        <p class="hint">First seen cycle ${card.firstSeenCycle}${card.lastConfirmedCycle ? `, confirmed at cycle ${card.lastConfirmedCycle}` : ""}</p>
      </div>`
    )
    .join("");
}

function statusToPillClass(status) {
  if (status === "verified") return "status-pill-verified";
  if (status === "refuted" || status === "stale") return "status-pill-danger";
  if (status === "predicted") return "status-pill-predicted";
  return "status-pill-neutral";
}

function renderTaskSet(detail) {
  const { taskSpecs, regressionCases } = detail;
  if (!taskSpecs.length) {
    els.taskSet.innerHTML = '<p class="solver-analysis-placeholder">No tasks for this run yet.</p>';
    return;
  }
  const regressionTaskIds = new Set(regressionCases.map((r) => r.taskSpecId));
  els.taskSet.innerHTML = taskSpecs
    .map(
      (task) => `
      <div class="task-row">
        <div class="task-row-header">
          <strong>${escapeHtml(task.taskFamily)}</strong>
          <span class="status-pill status-pill-neutral">${task.source}</span>
          ${task.isHeldOut ? '<span class="status-pill status-pill-warning">held out</span>' : ""}
          ${regressionTaskIds.has(task.id) ? '<span class="status-pill status-pill-danger">regression</span>' : ""}
        </div>
        <p>${escapeHtml(task.prompt)}</p>
      </div>`
    )
    .join("");
}

function renderEvidencePanel(detail) {
  const entries = [...(detail.repoKnowledgeEntries || []), ...(detail.subjectModelEntries || [])];
  if (!entries.length) {
    els.evidencePanel.innerHTML = '<p class="solver-analysis-placeholder">No recorded knowledge entries yet.</p>';
    return;
  }
  els.evidencePanel.innerHTML = entries
    .map(
      (entry) => `
      <div class="evidence-row">
        <span class="status-pill ${statusToPillClass(entry.status)}">${entry.status}</span>
        <p>${escapeHtml(entry.claimText)}</p>
        <p class="hint">Verification method: ${escapeHtml(entry.verificationMethod)} · confidence ${entry.confidence}</p>
      </div>`
    )
    .join("");
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

renderRunOptions(getState().runs);
