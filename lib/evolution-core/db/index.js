import path from "node:path";
import { fileURLToPath } from "node:url";
import { openConnection, withTransaction } from "./connection.js";
import { runMigrations, getSchemaVersion } from "./migrationRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = path.join(__dirname, "..", "..", "..", "data", "evolution.db");

export function openEvolutionDatabase(filePath = DEFAULT_DB_PATH) {
  const db = openConnection(filePath);
  runMigrations(db);
  return db;
}

export { withTransaction, getSchemaVersion };
