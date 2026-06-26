import { rowToCamel, rowsToCamel } from "../db/rowMapper.js";

export function createSolverKnowledgeLinkRepository(db) {
  return {
    link(candidateSolverId, knowledgeType, knowledgeId) {
      db.prepare(`
        INSERT INTO candidate_solver_knowledge_links (candidate_solver_id, knowledge_type, knowledge_id)
        VALUES (?, ?, ?)
        ON CONFLICT (candidate_solver_id, knowledge_type, knowledge_id) DO NOTHING
      `).run(candidateSolverId, knowledgeType, knowledgeId);
    },

    listBySolver(candidateSolverId) {
      const rows = db
        .prepare("SELECT * FROM candidate_solver_knowledge_links WHERE candidate_solver_id = ?")
        .all(candidateSolverId);
      return rowsToCamel(rows);
    }
  };
}
