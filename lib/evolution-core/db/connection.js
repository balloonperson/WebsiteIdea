import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BUSY_TIMEOUT_MS = 5000;

export function openConnection(filePath) {
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const db = new DatabaseSync(filePath);
  // WAL is a no-op on :memory: databases but harmless to request.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

// node:sqlite has no built-in nested-transaction guard, so re-entrant calls
// would emit a bare "BEGIN" inside an open transaction and fail. Tracking
// depth lets callers compose repository methods inside `withTransaction`
// without each one needing to know whether it's already inside one.
const transactionDepth = new WeakMap();

export function withTransaction(db, fn) {
  const depth = transactionDepth.get(db) ?? 0;

  if (depth > 0) {
    transactionDepth.set(db, depth + 1);
    try {
      return fn();
    } finally {
      transactionDepth.set(db, depth);
    }
  }

  transactionDepth.set(db, 1);
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth.set(db, 0);
  }
}
