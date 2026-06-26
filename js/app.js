import { generateInstructions, getConfig, loadGithubRepo, suggestSubjects } from "./api.js";
import { extractProjectZip } from "./zip.js";

const state = {
  project: null,
  optimizationPath: "cost-efficient",
  instructions: ""
};

const els = {
  modelBanner: document.querySelector("#model-banner"),
  uploadBox: document.querySelector("#upload-box"),
  uploadInput: document.querySelector("#project-upload"),
  uploadStatus: document.querySelector("#upload-status"),
  uploadError: document.querySelector("#upload-error"),
  githubUrl: document.querySelector("#github-url"),
  githubLoadButton: document.querySelector("#github-load-button"),
  githubStatus: document.querySelector("#github-status"),
  githubError: document.querySelector("#github-error"),
  modelSelect: document.querySelector("#model-select"),
  otherModel: document.querySelector("#other-model"),
  subjectInput: document.querySelector("#subject-input"),
  suggestButton: document.querySelector("#suggest-button"),
  suggestionsSelect: document.querySelector("#suggestions-select"),
  suggestError: document.querySelector("#suggest-error"),
  runButton: document.querySelector("#run-button"),
  runStatus: document.querySelector("#run-status"),
  runError: document.querySelector("#run-error"),
  output: document.querySelector("#output"),
  copyButton: document.querySelector("#copy-button"),
  clearButton: document.querySelector("#clear-button"),
  solverAnalysis: document.querySelector("#solver-analysis")
};

els.uploadInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) {
    await handleZip(file);
  }
});

els.uploadBox.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.uploadBox.classList.add("dragging");
});

els.uploadBox.addEventListener("dragleave", () => {
  els.uploadBox.classList.remove("dragging");
});

els.uploadBox.addEventListener("drop", async (event) => {
  event.preventDefault();
  els.uploadBox.classList.remove("dragging");
  const [file] = event.dataTransfer.files;
  if (file) {
    await handleZip(file);
  }
});

els.githubLoadButton.addEventListener("click", async () => {
  await handleGithubUrl();
});

els.githubUrl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    await handleGithubUrl();
  }
});

els.modelSelect.addEventListener("change", () => {
  els.otherModel.hidden = els.modelSelect.value !== "Other";
  updateRunState();
});

els.otherModel.addEventListener("input", updateRunState);
els.subjectInput.addEventListener("input", updateRunState);

els.suggestButton.addEventListener("click", async () => {
  clearError(els.suggestError);
  setLoading(els.suggestButton, true, "Suggesting...");

  try {
    const targetModel = getTargetModel() || "unspecified model";
    const files = state.project.acceptedFiles;
    const response = await suggestSubjects({
      targetModel,
      fileTree: files.map((file) => file.path),
      fileSamples: files.slice(0, 20)
    });

    renderSuggestions(response.subjects || []);
  } catch (error) {
    showError(els.suggestError, error.message);
  } finally {
    setLoading(els.suggestButton, false, "Suggest Subjects");
  }
});

els.suggestionsSelect.addEventListener("change", () => {
  if (els.suggestionsSelect.value) {
    els.subjectInput.value = els.suggestionsSelect.value;
    updateRunState();
  }
});

els.runButton.addEventListener("click", async () => {
  clearError(els.runError);
  state.instructions = "";
  els.output.value = "";
  els.copyButton.disabled = true;
  renderSolverAnalysisState("loading");
  setLoading(els.runButton, true, "Running...");
  els.runStatus.textContent = "Analyzing project and generating instructions...";

  try {
    const targetModel = getTargetModel();
    const subject = els.subjectInput.value.trim();
    const files = state.project.acceptedFiles;
    const response = await generateInstructions({
      targetModel,
      subject,
      optimizationPath: state.optimizationPath,
      fileTree: files.map((file) => file.path),
      relevantFiles: selectRelevantFiles(files, subject)
    });

    state.instructions = response.instructions;
    els.output.value = response.instructions;
    els.copyButton.disabled = false;
    els.runStatus.textContent = "Instructions generated.";
    renderSolverAnalysisState("results", response.solverAnalysis ?? []);
  } catch (error) {
    showError(els.runError, error.message);
    els.runStatus.textContent = "Generation failed.";
    renderSolverAnalysisState("error");
  } finally {
    setLoading(els.runButton, false, "Run");
    updateRunState();
  }
});

els.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.output.value);
  els.copyButton.textContent = "Copied";
  window.setTimeout(() => {
    els.copyButton.textContent = "Copy";
  }, 1200);
});

els.clearButton.addEventListener("click", () => {
  state.instructions = "";
  els.output.value = "";
  els.copyButton.disabled = true;
  clearError(els.runError);
  els.runStatus.textContent = "Output cleared.";
  renderSolverAnalysisState("initial");
});

loadConfig();
renderSolverAnalysisState("initial");

async function handleZip(file) {
  clearError(els.uploadError);
  els.uploadStatus.textContent = "Processing ZIP...";
  els.suggestButton.disabled = true;

  try {
    const project = await extractProjectZip(file);
    state.project = project;
    const warning = project.isLargeZip ? " Large ZIP detected, processing may be slower." : "";
    els.uploadStatus.textContent = `${project.fileName}: ${project.acceptedFiles.length} files accepted, ${project.skippedCount} skipped.${warning}`;
    els.suggestButton.disabled = false;
  } catch (error) {
    state.project = null;
    els.uploadStatus.textContent = "No project uploaded yet.";
    showError(els.uploadError, error.message);
  } finally {
    updateRunState();
  }
}

async function handleGithubUrl() {
  const repoUrl = els.githubUrl.value.trim();
  if (!repoUrl) return;

  clearError(els.githubError);
  els.githubStatus.textContent = "Downloading repository...";
  els.githubLoadButton.disabled = true;

  try {
    const project = await loadGithubRepo({ repoUrl });
    state.project = project;
    els.githubStatus.textContent = `${project.fileName}: ${project.acceptedCount} files accepted, ${project.skippedCount} skipped.`;
    els.suggestButton.disabled = false;
  } catch (error) {
    showError(els.githubError, error.message);
    els.githubStatus.textContent = "";
  } finally {
    els.githubLoadButton.disabled = false;
    updateRunState();
  }
}

function renderSuggestions(subjects) {
  els.suggestionsSelect.innerHTML = '<option value="">Choose a suggested subject</option>';

  for (const subject of subjects) {
    const option = document.createElement("option");
    option.value = subject.name;
    option.textContent = `${subject.name} — ${subject.description}`;
    els.suggestionsSelect.append(option);
  }

  els.suggestionsSelect.hidden = subjects.length === 0;
  if (!subjects.length) {
    showError(els.suggestError, "No suggestions were returned.");
  }
}

function renderSolverAnalysisState(status, items) {
  const el = els.solverAnalysis;
  el.innerHTML = "";
  el.setAttribute("aria-busy", status === "loading" ? "true" : "false");

  if (status === "initial") {
    const p = document.createElement("p");
    p.className = "solver-analysis-placeholder";
    p.textContent = "Key solver findings will appear here after generation.";
    el.append(p);
    return;
  }

  if (status === "loading") {
    const p = document.createElement("p");
    p.className = "solver-analysis-loading";
    p.textContent = "Analyzing…";
    el.append(p);
    return;
  }

  if (status === "error") {
    const p = document.createElement("p");
    p.className = "solver-analysis-error";
    p.textContent = "Analysis unavailable.";
    el.append(p);
    return;
  }

  if (status === "results") {
    const valid = (items || []).filter(
      (item) => item && typeof item.type === "string" && typeof item.title === "string" && typeof item.content === "string"
    );

    if (!valid.length) {
      const p = document.createElement("p");
      p.className = "solver-analysis-empty";
      p.textContent = "No findings were returned.";
      el.append(p);
      return;
    }

    for (const item of valid) {
      const finding = document.createElement("div");
      finding.className = "solver-finding";

      const typeEl = document.createElement("span");
      typeEl.className = "solver-finding-type";
      typeEl.textContent = formatFindingType(item.type);

      const titleEl = document.createElement("span");
      titleEl.className = "solver-finding-title";
      titleEl.textContent = item.title;

      const contentEl = document.createElement("p");
      contentEl.className = "solver-finding-content";
      contentEl.textContent = item.content;

      finding.append(typeEl, titleEl, contentEl);
      el.append(finding);
    }
  }
}

function formatFindingType(type) {
  return type
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ");
}

function updateRunState() {
  const ready = Boolean(state.project && getTargetModel() && els.subjectInput.value.trim());
  els.runButton.disabled = !ready;

  if (ready) {
    els.runStatus.textContent = "Ready to generate instructions.";
  }
}

function getTargetModel() {
  if (els.modelSelect.value === "Other") {
    return els.otherModel.value.trim();
  }

  return els.modelSelect.value;
}

function selectRelevantFiles(files, subject) {
  const tokens = subject
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2);

  const alwaysInclude = /(^|\/)(package\.json|index\.(html|js|ts|tsx)|main\.(js|ts|tsx)|app\.(js|ts|tsx)|server\.(js|ts))$/i;
  const selected = files.filter((file) => {
    const lowerPath = file.path.toLowerCase();
    return alwaysInclude.test(file.path) || tokens.some((token) => lowerPath.includes(token));
  });

  const fallback = selected.length ? selected : files.slice(0, 20);
  return fallback.slice(0, 40);
}

function setLoading(button, loading, label) {
  button.disabled = loading;
  button.textContent = label;
}

function showError(element, message) {
  element.hidden = false;
  element.textContent = message;
}

function clearError(element) {
  element.hidden = true;
  element.textContent = "";
}

async function loadConfig() {
  try {
    const config = await getConfig();
    els.modelBanner.textContent = `Current instruction-generator model: ${config.aiModel}`;
  } catch {
    els.modelBanner.textContent = "Current instruction-generator model: unavailable";
  }
}

updateRunState();
