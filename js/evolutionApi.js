async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.statusCode = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export const createEvolutionRun = (input) => request("POST", "/api/evolution/runs", input);
export const listEvolutionRuns = () => request("GET", "/api/evolution/runs");
export const getEvolutionRun = (id) => request("GET", `/api/evolution/runs/${id}`);
export const getCandidateDetail = (runId, candidateId) =>
  request("GET", `/api/evolution/runs/${runId}/candidates/${candidateId}`);
export const cancelEvolutionRun = (id) => request("POST", `/api/evolution/runs/${id}/cancel`);
export const resumeEvolutionRun = (id) => request("POST", `/api/evolution/runs/${id}/resume`);
export const verifyEvolutionRun = (id) => request("POST", `/api/evolution/runs/${id}/verify`);
export const exportEvolutionRun = (id) => request("POST", `/api/evolution/runs/${id}/export`);
export const deleteEvolutionRun = (id) => request("DELETE", `/api/evolution/runs/${id}`);

export function subscribeToRunEvents(runId, onEvent) {
  const source = new EventSource(`/api/evolution/runs/${runId}/events`);
  const types = [
    "run-started",
    "cycle-started",
    "tasks-suggesting",
    "tasks-generated",
    "candidate-proposed",
    "evaluation-recorded",
    "exploit-card-created",
    "cycle-completed",
    "run-completed",
    "run-cancelled",
    "run-failed"
  ];
  for (const type of types) {
    source.addEventListener(type, (event) => {
      let data = {};
      try {
        data = JSON.parse(event.data);
      } catch {
        data = {};
      }
      onEvent(type, data);
    });
  }
  return () => source.close();
}

export const suggestTasks = (input) => request("POST", "/api/tasks/suggest", input);
export const createTask = (input) => request("POST", "/api/tasks", input);
export const listTasks = (runId) => request("GET", `/api/tasks?runId=${encodeURIComponent(runId)}`);
export const patchTask = (id, input) => request("PATCH", `/api/tasks/${id}`, input);
export const deleteTask = (id) => request("DELETE", `/api/tasks/${id}`);
