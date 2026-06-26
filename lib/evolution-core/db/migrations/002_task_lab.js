// Extends task_specs with the richer Task Lab spec surface: repo-specific
// evidence, subject boundary, difficulty, required/forbidden behavior,
// expected touched areas, an explicit verification method, hidden
// assertions (never sent to mutation prompts), failure severity rules,
// task origin, training/held-out/regression role, and a review gate.
//
// is_held_out (from 001) stays the source of truth the evolution engine
// reads directly; `role` is the Task Lab's richer classification and is
// kept in sync with it by the repository layer.
const SQL = `
ALTER TABLE task_specs ADD COLUMN repo_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE task_specs ADD COLUMN subject_boundary TEXT NOT NULL DEFAULT '';
ALTER TABLE task_specs ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('trivial','easy','medium','hard','expert'));
ALTER TABLE task_specs ADD COLUMN required_behavior TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN forbidden_behavior TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN expected_touched_areas TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN verification_method TEXT NOT NULL DEFAULT '';
ALTER TABLE task_specs ADD COLUMN hidden_assertions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN failure_severity_rules TEXT NOT NULL DEFAULT '{}';
ALTER TABLE task_specs ADD COLUMN failure_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE task_specs ADD COLUMN file_scope TEXT NOT NULL DEFAULT 'single' CHECK (file_scope IN ('single','multi'));
ALTER TABLE task_specs ADD COLUMN origin TEXT NOT NULL DEFAULT 'user-added' CHECK (origin IN ('optimizer-suggested','user-added','manual-set','imported','regression-from-failure'));
ALTER TABLE task_specs ADD COLUMN role TEXT NOT NULL DEFAULT 'training' CHECK (role IN ('training','held-out','regression'));
ALTER TABLE task_specs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected'));
ALTER TABLE task_specs ADD COLUMN review_notes TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_task_specs_role ON task_specs(evolution_run_id, role);
CREATE INDEX idx_task_specs_review_status ON task_specs(evolution_run_id, review_status);
CREATE INDEX idx_task_specs_family ON task_specs(evolution_run_id, task_family);

-- A regression case may reference a richer reason payload than the free-text
-- 'reason' column from 001 carries; severity lets the regression bank report
-- distinguish "blocks promotion" failures from minor ones.
ALTER TABLE regression_cases ADD COLUMN severity TEXT NOT NULL DEFAULT 'critical' CHECK (severity IN ('critical','major','minor'));
`;

export default {
  version: 2,
  name: "task_lab_schema",
  up(db) {
    db.exec(SQL);
  }
};
