const listeners = new Set();
const state = {
  selectedRunId: null,
  runs: []
};

export function getState() {
  return state;
}

export function setSelectedRunId(runId) {
  state.selectedRunId = runId;
  notify();
}

export function setRuns(runs) {
  state.runs = runs;
  notify();
}

export function onStoreChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener(state);
}
