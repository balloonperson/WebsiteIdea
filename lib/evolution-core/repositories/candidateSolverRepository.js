import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";

export function createCandidateSolverRepository(db) {
  return {
    create({
      evolutionRunId,
      parentSolverId = null,
      cycle,
      generationMethod,
      instructions,
      optimizationMode,
      targetModel,
      version = 1,
      repoCommitHash,
      subjectScope
    }) {
      const stmt = db.prepare(`
        INSERT INTO candidate_solvers (
          evolution_run_id, parent_solver_id, cycle, generation_method, instructions,
          optimization_mode, target_model, version, repo_commit_hash, subject_scope
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        evolutionRunId,
        parentSolverId,
        cycle,
        generationMethod,
        instructions,
        optimizationMode,
        targetModel,
        version,
        repoCommitHash,
        subjectScope
      );
      return this.getById(info.lastInsertRowid);
    },

    getById(id) {
      const row = db.prepare("SELECT * FROM candidate_solvers WHERE id = ?").get(id);
      return rowToCamel(row);
    },

    listByRun(evolutionRunId) {
      const rows = db
        .prepare("SELECT * FROM candidate_solvers WHERE evolution_run_id = ? ORDER BY cycle ASC, id ASC")
        .all(evolutionRunId);
      return rowsToCamel(rows);
    },

    listByCycle(evolutionRunId, cycle) {
      const rows = db
        .prepare("SELECT * FROM candidate_solvers WHERE evolution_run_id = ? AND cycle = ? ORDER BY id ASC")
        .all(evolutionRunId, cycle);
      return rowsToCamel(rows);
    },

    listLineage(solverId) {
      // Walk parent_solver_id back to the seed. Lineage chains are short
      // (bounded by cycle count) so a simple loop beats a recursive CTE here.
      const lineage = [];
      let current = this.getById(solverId);
      while (current) {
        lineage.push(current);
        current = current.parentSolverId ? this.getById(current.parentSolverId) : null;
      }
      return lineage;
    },

    retire(id) {
      db.prepare("UPDATE candidate_solvers SET status = 'retired' WHERE id = ?").run(id);
      return this.getById(id);
    }
  };
}
