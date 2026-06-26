import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";
import { toJsonColumn, fromJsonColumn } from "../util/json.js";

function decorate(row) {
  if (!row) return row;
  return {
    ...row,
    expectedCriteria: fromJsonColumn(row.expectedCriteria, []),
    isHeldOut: Boolean(row.isHeldOut)
  };
}

export function createTaskSpecRepository(db) {
  return {
    create({
      evolutionRunId = null,
      subject,
      taskFamily,
      prompt,
      expectedCriteria = [],
      isHeldOut = false,
      source = "manual"
    }) {
      const stmt = db.prepare(`
        INSERT INTO task_specs (evolution_run_id, subject, task_family, prompt, expected_criteria, is_held_out, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        evolutionRunId,
        subject,
        taskFamily,
        prompt,
        toJsonColumn(expectedCriteria),
        isHeldOut ? 1 : 0,
        source
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM task_specs WHERE id = ?").get(id);
      return decorate(rowToCamel(row));
    },

    listByRun(evolutionRunId, { heldOut } = {}) {
      if (heldOut === undefined) {
        const rows = db
          .prepare("SELECT * FROM task_specs WHERE evolution_run_id = ? ORDER BY created_at ASC")
          .all(evolutionRunId);
        return rowsToCamel(rows).map(decorate);
      }
      const rows = db
        .prepare("SELECT * FROM task_specs WHERE evolution_run_id = ? AND is_held_out = ? ORDER BY created_at ASC")
        .all(evolutionRunId, heldOut ? 1 : 0);
      return rowsToCamel(rows).map(decorate);
    }
  };
}
