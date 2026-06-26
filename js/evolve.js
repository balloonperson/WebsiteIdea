import { wireProjectLoader, selectRelevantFiles } from "./projectLoader.js";
import { createEvolutionRun, cancelEvolutionRun, resumeEvolutionRun, subscribeToRunEvents, listEvolutionRuns } from "./evolutionApi.js";
import { setSelectedRunId, setRuns } from "./store.js";

const els = {
  uploadInput: document.querySelector("#evolve-project-upload"),
  uploadBox: document.querySelector("#evolve-upload-box"),
  uploadStatus: document.querySelector("#evolve-upload-status"),
  uploadError: document.querySelector("#evolve-upload-error"),
  githubUrl: document.querySelector("#evolve-github-url"),
  githubButton: document.querySelector("#evolve-github-load-button"),
  repoIdentifier: document.querySelector("#evolve-repo-identifier"),
  subject: document.querySelector("#evolve-subject"),
  targetModel: document.querySelector("#evolve-target-model"),
  settingsButton: document.querySelector("#evolve-settings-button"),
  objectiveBadge: document.querySelector("#evolve-objective-badge"),
  startButton: document.querySelector("#evolve-start-button"),
  cancelButton: document.querySelector("#evolve-cancel-button"),
  resumeButton: document.querySelector("#evolve-resume-button"),
  startError: document.querySelector("#evolve-start-error"),
  runSummary: document.querySelector("#evolve-run-summary"),
  eventLog: document.querySelector("#evolve-event-log"),

  settingsModal: document.querySelector("#settings-modal"),
  settingsBackdrop: document.querySelector("#settings-modal-backdrop"),
  settingsClose: document.querySelector("#settings-close-button"),
  settingsSave: document.querySelector("#settings-save-button"),
  objectiveProfile: document.querySelector("#settings-objective-profile"),
  customWeightsRow: document.querySelector("#settings-custom-weights")
};

const state = {
  project: null,
  currentRunId: null,
  unsubscribe: null,
  cycleEvents: []
};

wireProjectLoader({
  fileInput: els.uploadInput,
  uploadBox: els.uploadBox,
  githubUrlInput: els.githubUrl,
  githubButton: els.githubButton,
  statusEl: els.uploadStatus,
  errorEl: els.uploadError,
  onLoaded: (project) => {
    state.project = project;
    if (!els.repoIdentifier.value && project.repoUrl) {
      els.repoIdentifier.value = project.repoUrl;
    } else if (!els.repoIdentifier.value) {
      els.repoIdentifier.value = project.fileName;
    }
  }
});

els.settingsButton.addEventListener("click", () => {
  els.settingsModal.hidden = false;
});
els.settingsClose.addEventListener("click", closeSettings);
els.settingsBackdrop.addEventListener("click", closeSettings);
function closeSettings() {
  els.settingsModal.hidden = true;
}

els.objectiveProfile.addEventListener("change", () => {
  els.customWeightsRow.hidden = els.objectiveProfile.value !== "custom";
  updateObjectiveBadge();
});

els.settingsSave.addEventListener("click", () => {
  updateObjectiveBadge();
  closeSettings();
});

function updateObjectiveBadge() {
  const label = els.objectiveProfile.options[els.objectiveProfile.selectedIndex].text;
  els.objectiveBadge.textContent = `Objective: ${label}`;
}

function readSettings() {
  return {
    objectiveProfile: els.objectiveProfile.value,
    candidatesPerCycle: Number(document.querySelector("#settings-candidates-per-cycle").value) || 2,
    correctnessThreshold: Number(document.querySelector("#settings-correctness-threshold").value) || 0.75,
    minEffectSize: Number(document.querySelector("#settings-min-effect-size").value) || 0.4,
    criticalFailurePolicy: document.querySelector("#settings-critical-failure-policy").value,
    knowledgeInfluencesMutation: document.querySelector("#settings-knowledge-influences-mutation").checked,
    balancedScoreOptions:
      els.objectiveProfile.value === "custom"
        ? {
            correctnessWeight: Number(document.querySelector("#settings-weight-correctness").value) || 0.6,
            costWeight: Number(document.querySelector("#settings-weight-cost").value) || 0.25,
            tokenWeight: Number(document.querySelector("#settings-weight-tokens").value) || 0.15
          }
        : undefined,
    realRunner: {
      commandProfile: document.querySelector("#settings-real-command-profile").value || null,
      timeoutSeconds: Number(document.querySelector("#settings-real-timeout").value) || null,
      retentionDays: Number(document.querySelector("#settings-real-retention").value) || null,
      concurrency: Number(document.querySelector("#settings-real-concurrency").value) || null
    }
  };
}

function readRunFields() {
  return {
    runnerMode: document.querySelector("#settings-runner-mode").value,
    dualSimulatedSplit: (Number(document.querySelector("#settings-dual-simulated-split").value) || 70) / 100,
    dualRealSplit: 1 - (Number(document.querySelector("#settings-dual-simulated-split").value) || 70) / 100,
    maxCycles: Number(document.querySelector("#settings-max-cycles").value) || 8,
    noiseRepeatCount: Number(document.querySelector("#settings-noise-trials").value) || 3,
    hardRunBudgetUsd: document.querySelector("#settings-max-spend").value
      ? Number(document.querySelector("#settings-max-spend").value)
      : null,
    minRealVerificationReserve: Number(document.querySelector("#settings-reserved-real-attempts").value) || 0,
    noImprovementWindow: Number(document.querySelector("#settings-no-improvement-window").value) || 3
  };
}

els.startButton.addEventListener("click", async () => {
  clearError();
  const repoIdentifier = els.repoIdentifier.value.trim();
  const subject = els.subject.value.trim();
  const targetModel = els.targetModel.value.trim();

  if (!repoIdentifier || !subject || !targetModel) {
    return showError("Fill in repo identifier, subject, and target model.");
  }

  setLoading(true);
  try {
    const relevantFiles = state.project
      ? selectRelevantFiles(state.project.acceptedFiles, subject, 60)
      : [];
    const fileTree = state.project ? state.project.acceptedFiles.map((f) => f.path) : [];

    const { run } = await createEvolutionRun({
      repoIdentifier,
      subject,
      targetModel,
      ...readRunFields(),
      settings: readSettings(),
      repoDigest: { fileTree, relevantFiles }
    });

    attachToRun(run.id);
    await refreshRunList();
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
});

els.cancelButton.addEventListener("click", async () => {
  if (!state.currentRunId) return;
  await cancelEvolutionRun(state.currentRunId);
});

els.resumeButton.addEventListener("click", async () => {
  if (!state.currentRunId) return;
  await resumeEvolutionRun(state.currentRunId);
  els.resumeButton.hidden = true;
  els.cancelButton.hidden = false;
});

function attachToRun(runId) {
  if (state.unsubscribe) state.unsubscribe();
  state.currentRunId = runId;
  state.cycleEvents = [];
  setSelectedRunId(runId);
  els.eventLog.innerHTML = "";
  els.startButton.hidden = true;
  els.cancelButton.hidden = false;
  els.resumeButton.hidden = true;
  renderSummary({ status: "running", currentCycle: 0, subject: els.subject.value.trim() });

  state.unsubscribe = subscribeToRunEvents(runId, (type, data) => {
    logEvent(type, data);
    handleEvent(type, data);
  });
}

function handleEvent(type, data) {
  if (type === "cycle-started") {
    renderSummary({ status: "running", currentCycle: data.cycle, subject: els.subject.value.trim() });
  }
  if (type === "cycle-completed") {
    renderSummary({
      status: "running",
      currentCycle: data.cycle,
      subject: els.subject.value.trim(),
      lastMetrics: data.metrics
    });
  }
  if (type === "run-completed" || type === "run-cancelled" || type === "run-failed") {
    els.cancelButton.hidden = true;
    els.startButton.hidden = false;
    renderSummary({
      status: type === "run-completed" ? "completed" : type === "run-cancelled" ? "stopped" : "failed",
      reason: data.reason || data.message
    });
  }
}

function renderSummary({ status, currentCycle, subject, lastMetrics, reason }) {
  const statusClass = status === "failed" ? "status-pill-danger" : status === "running" ? "status-pill-info" : "status-pill-neutral";
  els.runSummary.innerHTML = `
    <div class="run-summary-row">
      <span class="status-pill ${statusClass}">${status}</span>
      ${currentCycle != null ? `<span>Cycle ${currentCycle}</span>` : ""}
      ${subject ? `<span>${escapeHtml(subject)}</span>` : ""}
      ${reason ? `<span class="hint">${escapeHtml(reason)}</span>` : ""}
    </div>
    ${lastMetrics ? `<p class="hint">Correctness change: ${formatPct(lastMetrics.correctnessImprovementPct)} | Cost change: ${formatPct(lastMetrics.costChangePct)} | Confidence debt: ${lastMetrics.confidenceDebt}</p>` : ""}
    <p class="hint">This run produces Simulated Eval results only. It can promote a Predicted Leader; the Verified Leader and Current Champion stay empty until a real worktree runner is connected.</p>
  `;
}

function formatPct(value) {
  if (value == null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function logEvent(type, data) {
  const row = document.createElement("div");
  row.className = "event-log-row";
  row.innerHTML = `<span class="event-log-type">${type}</span><span class="event-log-data">${escapeHtml(summarize(data))}</span>`;
  els.eventLog.prepend(row);
  while (els.eventLog.children.length > 100) {
    els.eventLog.removeChild(els.eventLog.lastChild);
  }
}

function summarize(data) {
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

async function refreshRunList() {
  const { runs } = await listEvolutionRuns();
  setRuns(runs);
}

function setLoading(loading) {
  els.startButton.disabled = loading;
  els.startButton.textContent = loading ? "Starting..." : "Start run";
}

function showError(message) {
  els.startError.hidden = false;
  els.startError.textContent = message;
}

function clearError() {
  els.startError.hidden = true;
  els.startError.textContent = "";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

updateObjectiveBadge();
refreshRunList();
