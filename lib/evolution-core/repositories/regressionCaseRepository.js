import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";

export function createRegressionCaseRepository(db) {
  return {
    create({ evolutionRunId, taskSpecId, reason, addedAtCycle }) {
      const stmt = db.prepare(`
        INSERT INTO regression_cases (evolution_run_id, task_spec_id, reason, added_at_cycle)
        VALUES (?, ?, ?, ?)
      `);
      const info = stmt.run(evolutionRunId, taskSpecId, reason, addedAtCycle);
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM regression_cases WHERE id = ?").get(id);
      return rowToCamel(row);
    },

    listActiveByRun(evolutionRunId) {
      const rows = db
        .prepare("SELECT * FROM regression_cases WHERE evolution_run_id = ? AND status = 'active' ORDER BY added_at_cycle ASC")
        .all(evolutionRunId);
      return rowsToCamel(rows);
    },

    resolve(id) {
      db.prepare("UPDATE regression_cases SET status = 'resolved' WHERE id = ?").run(id);
      return this.getById(id);
    }
  };
}
