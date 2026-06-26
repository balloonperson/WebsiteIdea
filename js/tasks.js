import { suggestTasks, createTask, listTasks, patchTask, deleteTask } from "./evolutionApi.js";
import { onStoreChange, getState } from "./store.js";

const els = {
  runSelect: document.querySelector("#tasks-run-select"),
  suggestSubject: document.querySelector("#tasks-suggest-subject"),
  suggestButton: document.querySelector("#tasks-suggest-button"),
  suggestions: document.querySelector("#tasks-suggestions"),
  suggestError: document.querySelector("#tasks-suggest-error"),
  newFamily: document.querySelector("#tasks-new-family"),
  newPrompt: document.querySelector("#tasks-new-prompt"),
  newCriteria: document.querySelector("#tasks-new-criteria"),
  newHeldOut: document.querySelector("#tasks-new-held-out"),
  addButton: document.querySelector("#tasks-add-button"),
  addError: document.querySelector("#tasks-add-error"),
  list: document.querySelector("#tasks-list")
};

onStoreChange((state) => renderRunOptions(state.runs));

els.runSelect.addEventListener("change", () => {
  if (els.runSelect.value) refreshTasks();
});

window.addEventListener("tab-activated", (event) => {
  if (event.detail.tab === "tasks") {
    renderRunOptions(getState().runs);
    if (els.runSelect.value) refreshTasks();
  }
});

els.suggestButton.addEventListener("click", async () => {
  clearError(els.suggestError);
  const subject = els.suggestSubject.value.trim();
  if (!subject) return showError(els.suggestError, "Enter a subject to suggest tasks for.");

  els.suggestButton.disabled = true;
  els.suggestButton.textContent = "Suggesting...";
  try {
    const { tasks } = await suggestTasks({ subject, count: 4 });
    renderSuggestions(tasks, subject);
  } catch (error) {
    showError(els.suggestError, error.message);
  } finally {
    els.suggestButton.disabled = false;
    els.suggestButton.textContent = "Suggest";
  }
});

function renderSuggestions(tasks, subject) {
  els.suggestions.innerHTML = "";
  if (!tasks.length) {
    els.suggestions.innerHTML = '<p class="solver-analysis-empty">No suggestions returned.</p>';
    return;
  }
  for (const task of tasks) {
    const card = document.createElement("div");
    card.className = "task-suggestion-card";
    card.innerHTML = `
      <strong>${escapeHtml(task.taskFamily)}</strong>
      <p>${escapeHtml(task.prompt)}</p>
      <p class="hint">Criteria: ${task.expectedCriteria.map(escapeHtml).join(", ") || "none"}</p>
      <button type="button" class="secondary-button">Add to run</button>
    `;
    card.querySelector("button").addEventListener("click", async () => {
      const runId = els.runSelect.value ? Number(els.runSelect.value) : null;
      await createTask({
        evolutionRunId: runId,
        subject,
        taskFamily: task.taskFamily,
        prompt: task.prompt,
        expectedCriteria: task.expectedCriteria,
        source: "generated"
      });
      card.remove();
      if (runId) refreshTasks();
    });
    els.suggestions.append(card);
  }
}

els.addButton.addEventListener("click", async () => {
  clearError(els.addError);
  const runId = els.runSelect.value ? Number(els.runSelect.value) : null;
  const run = getState().runs.find((r) => r.id === runId);
  const taskFamily = els.newFamily.value.trim();
  const prompt = els.newPrompt.value.trim();

  if (!taskFamily || !prompt) {
    return showError(els.addError, "Task family and prompt are required.");
  }

  try {
    await createTask({
      evolutionRunId: runId,
      subject: run?.subject || taskFamily,
      taskFamily,
      prompt,
      expectedCriteria: els.newCriteria.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      isHeldOut: els.newHeldOut.checked,
      source: "manual"
    });
    els.newFamily.value = "";
    els.newPrompt.value = "";
    els.newCriteria.value = "";
    els.newHeldOut.checked = false;
    if (runId) refreshTasks();
  } catch (error) {
    showError(els.addError, error.message);
  }
});

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

async function refreshTasks() {
  const runId = Number(els.runSelect.value);
  const { tasks } = await listTasks(runId);
  renderTaskList(tasks);
}

function renderTaskList(tasks) {
  els.list.innerHTML = "";
  if (!tasks.length) {
    els.list.innerHTML = '<p class="solver-analysis-empty">No tasks yet for this run.</p>';
    return;
  }
  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "task-row";
    row.innerHTML = `
      <div class="task-row-header">
        <strong>${escapeHtml(task.taskFamily)}</strong>
        <span class="status-pill ${task.source === "generated" ? "status-pill-info" : "status-pill-neutral"}">${task.source}</span>
        ${task.isHeldOut ? '<span class="status-pill status-pill-warning">held out</span>' : ""}
      </div>
      <p>${escapeHtml(task.prompt)}</p>
      <p class="hint">Criteria: ${(task.expectedCriteria || []).map(escapeHtml).join(", ") || "none"}</p>
      <div class="task-row-actions">
        <label class="checkbox-row"><input type="checkbox" class="held-out-toggle" ${task.isHeldOut ? "checked" : ""}/> Held out</label>
        <button type="button" class="secondary-button delete-task-button">Delete</button>
      </div>
    `;
    row.querySelector(".held-out-toggle").addEventListener("change", async (event) => {
      await patchTask(task.id, { isHeldOut: event.target.checked });
    });
    row.querySelector(".delete-task-button").addEventListener("click", async () => {
      await deleteTask(task.id);
      refreshTasks();
    });
    els.list.append(row);
  }
}

function showError(el, message) {
  el.hidden = false;
  el.textContent = message;
}

function clearError(el) {
  el.hidden = true;
  el.textContent = "";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

renderRunOptions(getState().runs);
