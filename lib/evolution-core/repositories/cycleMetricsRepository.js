import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";
import { toJsonColumn, fromJsonColumn } from "../util/json.js";

function decorate(row) {
  if (!row) return row;
  return { ...row, metrics: fromJsonColumn(row.metricsJson, {}) };
}

export function createCycleMetricsRepository(db) {
  return {
    create({ evolutionRunId, cycle, metrics, explorationWasteUsd = 0 }) {
      db.prepare(`
        INSERT INTO cycle_metrics (evolution_run_id, cycle, metrics_json, exploration_waste_usd)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (evolution_run_id, cycle) DO UPDATE SET
          metrics_json = excluded.metrics_json,
          exploration_waste_usd = excluded.exploration_waste_usd
      `).run(evolutionRunId, cycle, toJsonColumn(metrics), explorationWasteUsd);
      return this.getByCycle(evolutionRunId, cycle);
    },

    getByCycle(evolutionRunId, cycle) {
      const row = db
        .prepare("SELECT * FROM cycle_metrics WHERE evolution_run_id = ? AND cycle = ?")
        .get(evolutionRunId, cycle);
      return decorate(rowToCamel(row));
    },

    listByRun(evolutionRunId) {
      const rows = db
        .prepare("SELECT * FROM cycle_metrics WHERE evolution_run_id = ? ORDER BY cycle ASC")
        .all(evolutionRunId);
      return rowsToCamel(rows).map(decorate);
    },

    getPrevious(evolutionRunId, cycle) {
      const row = db
        .prepare("SELECT * FROM cycle_metrics WHERE evolution_run_id = ? AND cycle < ? ORDER BY cycle DESC LIMIT 1")
        .get(evolutionRunId, cycle);
      return decorate(rowToCamel(row));
    }
  };
}
