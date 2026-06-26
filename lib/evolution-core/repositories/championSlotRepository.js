import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";
import { toJsonColumn, fromJsonColumn } from "../util/json.js";
import { nowIso } from "../util/time.js";
import { ALL_CHAMPION_SLOTS } from "../constants.js";

function decorate(row) {
  if (!row) return row;
  return { ...row, metricSnapshot: fromJsonColumn(row.metricSnapshot, {}) };
}

export function createChampionSlotRepository(db) {
  return {
    upsert(evolutionRunId, slotName, { candidateSolverId, candidateEvaluationId, metricSnapshot = {}, cycle }) {
      if (!ALL_CHAMPION_SLOTS.includes(slotName)) {
        throw new Error(`Unknown champion slot: ${slotName}`);
      }
      db.prepare(`
        INSERT INTO champion_slots (evolution_run_id, slot_name, candidate_solver_id, candidate_evaluation_id, metric_snapshot, updated_at_cycle, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (evolution_run_id, slot_name) DO UPDATE SET
          candidate_solver_id = excluded.candidate_solver_id,
          candidate_evaluation_id = excluded.candidate_evaluation_id,
          metric_snapshot = excluded.metric_snapshot,
          updated_at_cycle = excluded.updated_at_cycle,
          updated_at = excluded.updated_at
      `).run(
        evolutionRunId,
        slotName,
        candidateSolverId ?? null,
        candidateEvaluationId ?? null,
        toJsonColumn(metricSnapshot),
        cycle,
        nowIso()
      );
      return this.getSlot(evolutionRunId, slotName);
    },

    getSlot(evolutionRunId, slotName) {
      const row = db
        .prepare("SELECT * FROM champion_slots WHERE evolution_run_id = ? AND slot_name = ?")
        .get(evolutionRunId, slotName);
      return decorate(rowToCamel(row));
    },

    getAll(evolutionRunId) {
      const rows = db.prepare("SELECT * FROM champion_slots WHERE evolution_run_id = ?").all(evolutionRunId);
      const camel = rowsToCamel(rows).map(decorate);
      const bySlot = {};
      for (const slot of camel) {
        bySlot[slot.slotName] = slot;
      }
      return bySlot;
    }
  };
}
