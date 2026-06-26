// Initial schema for the evolution engine. Every provenance-bearing table
// (repo_knowledge_entries, subject_model_entries, exploit_cards) carries the
// same scope columns: repo_commit_hash, subject_scope, task_family. A fact is
// only ever "verified" inside that exact recorded scope — nothing here
// generalizes a finding across commits or subjects automatically.
const SQL = `
CREATE TABLE evolution_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_identifier TEXT NOT NULL,
  repo_commit_hash TEXT NOT NULL,
  subject TEXT NOT NULL,
  target_model TEXT NOT NULL,
  optimization_mode TEXT NOT NULL CHECK (optimization_mode IN ('cost-efficient','balanced','maximum-performance')),
  runner_mode TEXT NOT NULL CHECK (runner_mode IN ('simulated','real','dual')) DEFAULT 'dual',
  dual_simulated_split REAL NOT NULL DEFAULT 0.7,
  dual_real_split REAL NOT NULL DEFAULT 0.3,
  noise_repeat_count INTEGER NOT NULL DEFAULT 3,
  hard_run_budget_usd REAL,
  max_cycles INTEGER,
  no_improvement_window INTEGER NOT NULL DEFAULT 3,
  min_real_verification_reserve INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('running','completed','stopped','failed')) DEFAULT 'running',
  current_cycle INTEGER NOT NULL DEFAULT 0,
  stopped_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

CREATE TABLE task_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER REFERENCES evolution_runs(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  task_family TEXT NOT NULL,
  prompt TEXT NOT NULL,
  expected_criteria TEXT NOT NULL DEFAULT '[]',
  is_held_out INTEGER NOT NULL DEFAULT 0 CHECK (is_held_out IN (0,1)),
  source TEXT NOT NULL CHECK (source IN ('manual','generated')) DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_task_specs_run ON task_specs(evolution_run_id);

CREATE TABLE regression_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  task_spec_id INTEGER NOT NULL REFERENCES task_specs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  added_at_cycle INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','resolved')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_regression_cases_run ON regression_cases(evolution_run_id, status);

CREATE TABLE candidate_solvers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  parent_solver_id INTEGER REFERENCES candidate_solvers(id) ON DELETE SET NULL,
  cycle INTEGER NOT NULL,
  generation_method TEXT NOT NULL CHECK (generation_method IN ('seed','mutation','crossover','manual')),
  instructions TEXT NOT NULL,
  optimization_mode TEXT NOT NULL,
  target_model TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  repo_commit_hash TEXT NOT NULL,
  subject_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','retired')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_candidate_solvers_run_cycle ON candidate_solvers(evolution_run_id, cycle);
CREATE INDEX idx_candidate_solvers_parent ON candidate_solvers(parent_solver_id);

-- Polymorphic link from a solver to whatever knowledge justified it
-- (repo_knowledge_entries | subject_model_entries | exploit_cards). The
-- target table varies per row, so it is not declared as a foreign key;
-- referential integrity for this table is enforced in application code.
CREATE TABLE candidate_solver_knowledge_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_solver_id INTEGER NOT NULL REFERENCES candidate_solvers(id) ON DELETE CASCADE,
  knowledge_type TEXT NOT NULL CHECK (knowledge_type IN ('repo','subject','exploit_card')),
  knowledge_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (candidate_solver_id, knowledge_type, knowledge_id)
);

CREATE INDEX idx_solver_knowledge_links_solver ON candidate_solver_knowledge_links(candidate_solver_id);

CREATE TABLE candidate_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  candidate_solver_id INTEGER NOT NULL REFERENCES candidate_solvers(id) ON DELETE CASCADE,
  task_spec_id INTEGER NOT NULL REFERENCES task_specs(id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL,
  runner_mode TEXT NOT NULL CHECK (runner_mode IN ('simulated','real')),
  repeat_count INTEGER NOT NULL,
  mean_score REAL NOT NULL,
  min_score REAL NOT NULL,
  pass_rate REAL NOT NULL,
  variance REAL NOT NULL DEFAULT 0,
  critical_failure_rate REAL NOT NULL DEFAULT 0,
  mean_tokens_in REAL NOT NULL DEFAULT 0,
  mean_tokens_out REAL NOT NULL DEFAULT 0,
  mean_cost_usd REAL NOT NULL DEFAULT 0,
  cost_variance REAL NOT NULL DEFAULT 0,
  total_tokens_in REAL NOT NULL DEFAULT 0,
  total_tokens_out REAL NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')) DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_candidate_evaluations_run_cycle ON candidate_evaluations(evolution_run_id, cycle);
CREATE INDEX idx_candidate_evaluations_solver ON candidate_evaluations(candidate_solver_id);
CREATE INDEX idx_candidate_evaluations_task ON candidate_evaluations(task_spec_id);

CREATE TABLE eval_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_evaluation_id INTEGER NOT NULL REFERENCES candidate_evaluations(id) ON DELETE CASCADE,
  repeat_index INTEGER NOT NULL,
  runner_mode TEXT NOT NULL CHECK (runner_mode IN ('simulated','real')),
  score REAL NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0,1)),
  critical_failure INTEGER NOT NULL DEFAULT 0 CHECK (critical_failure IN (0,1)),
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  raw_log_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_eval_traces_evaluation ON eval_traces(candidate_evaluation_id);

CREATE TABLE repo_knowledge_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  repo_commit_hash TEXT NOT NULL,
  subject_scope TEXT NOT NULL,
  task_family TEXT NOT NULL,
  files_involved TEXT NOT NULL DEFAULT '[]',
  claim_text TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  source_trace_id INTEGER REFERENCES eval_traces(id) ON DELETE SET NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('claimed','predicted','verified','refuted','stale')) DEFAULT 'claimed',
  superseded_by_entry_id INTEGER REFERENCES repo_knowledge_entries(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_repo_knowledge_run_status ON repo_knowledge_entries(evolution_run_id, status);
CREATE INDEX idx_repo_knowledge_scope ON repo_knowledge_entries(repo_commit_hash, subject_scope, task_family);

CREATE TABLE subject_model_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  target_model TEXT NOT NULL,
  repo_commit_hash TEXT NOT NULL,
  subject_scope TEXT NOT NULL,
  task_family TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  source_trace_id INTEGER REFERENCES eval_traces(id) ON DELETE SET NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('claimed','predicted','verified','refuted','stale')) DEFAULT 'claimed',
  superseded_by_entry_id INTEGER REFERENCES subject_model_entries(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_subject_model_run_status ON subject_model_entries(evolution_run_id, status);
CREATE INDEX idx_subject_model_scope ON subject_model_entries(target_model, subject_scope, task_family);

CREATE TABLE exploit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('stable-interface','reliable-shortcut','normal-form','file-boundary','verification-method','skippable-reasoning')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  repo_commit_hash TEXT NOT NULL,
  subject_scope TEXT NOT NULL,
  task_family TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','predicted','verified','refuted','stale')) DEFAULT 'claimed',
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  supporting_knowledge_entry_ids TEXT NOT NULL DEFAULT '[]',
  first_seen_cycle INTEGER NOT NULL,
  last_confirmed_cycle INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_exploit_cards_run_status ON exploit_cards(evolution_run_id, status);

CREATE TABLE champion_slots (
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL CHECK (slot_name IN ('highestCorrectness','lowestCostAboveThreshold','bestHeldOutCoverage','bestBalanced','predictedLeader','verifiedLeader','currentChampion')),
  candidate_solver_id INTEGER REFERENCES candidate_solvers(id) ON DELETE SET NULL,
  candidate_evaluation_id INTEGER REFERENCES candidate_evaluations(id) ON DELETE SET NULL,
  metric_snapshot TEXT NOT NULL DEFAULT '{}',
  updated_at_cycle INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (evolution_run_id, slot_name)
);

CREATE TABLE cycle_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_run_id INTEGER NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  exploration_waste_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (evolution_run_id, cycle)
);

CREATE INDEX idx_cycle_metrics_run ON cycle_metrics(evolution_run_id, cycle);
`;

export default {
  version: 1,
  name: "init_schema",
  up(db) {
    db.exec(SQL);
  }
};
