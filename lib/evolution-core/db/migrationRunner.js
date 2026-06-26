import { withTransaction } from "./connection.js";
import migration001 from "./migrations/001_init.js";
import migration002 from "./migrations/002_task_lab.js";

// Add new migrations to this array as the schema evolves. Never edit an
// already-released migration's `up` body — append a new one instead, so a
// database that already applied it is not replayed against a changed script.
const MIGRATIONS = [migration001, migration002];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);

  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all();
  const applied = new Set(appliedRows.map((row) => row.version));
  const pending = [...MIGRATIONS].sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    if (applied.has(migration.version)) continue;

    withTransaction(db, () => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name
      );
    });
    db.exec(`PRAGMA user_version = ${migration.version}`);
  }
}

export function getSchemaVersion(db) {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
  return row?.v ?? 0;
}
