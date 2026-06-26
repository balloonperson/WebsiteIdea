import { EventEmitter } from "node:events";

// One bus per run, created lazily. The DB is the durable source of truth
// for run state (per the plan); this bus only carries best-effort live
// ticks to connected SSE clients, plus a short replay buffer so a client
// that reconnects a moment later doesn't miss the last few events. History
// before that should come from re-fetching the run via the REST endpoints.
const buses = new Map();
const REPLAY_LIMIT = 50;

function getOrCreate(runId) {
  let entry = buses.get(runId);
  if (!entry) {
    entry = { emitter: new EventEmitter(), recent: [] };
    entry.emitter.setMaxListeners(50);
    buses.set(runId, entry);
  }
  return entry;
}

export function emitRunEvent(runId, type, data) {
  const entry = getOrCreate(runId);
  const event = { type, data, at: new Date().toISOString() };
  entry.recent.push(event);
  if (entry.recent.length > REPLAY_LIMIT) {
    entry.recent.shift();
  }
  entry.emitter.emit("event", event);
  return event;
}

export function subscribeToRun(runId, listener) {
  const entry = getOrCreate(runId);
  entry.emitter.on("event", listener);
  return () => entry.emitter.off("event", listener);
}

export function getRecentEvents(runId) {
  return getOrCreate(runId).recent.slice();
}
