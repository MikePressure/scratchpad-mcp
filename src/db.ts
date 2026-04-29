import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  cur_version INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (agent_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_agent_prefix ON files(agent_id, path);

CREATE TABLE IF NOT EXISTS file_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (file_id, version)
);
CREATE INDEX IF NOT EXISTS idx_versions_file ON file_versions(file_id, version DESC);

CREATE TABLE IF NOT EXISTS log_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT    NOT NULL,
  path       TEXT    NOT NULL,
  entry      TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_agent_path_id ON log_entries(agent_id, path, id);

CREATE TABLE IF NOT EXISTS summaries (
  file_id         INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  summarized_at_v INTEGER NOT NULL,
  summary         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_usage (
  agent_id         TEXT PRIMARY KEY,
  total_operations INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL
);
`;

let dbInstance: DatabaseType | null = null;

export function getDb(): DatabaseType {
  if (dbInstance) return dbInstance;

  // Default DB lives next to this source file's parent (the project root),
  // so the path doesn't depend on the cwd of whoever spawned the server.
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultPath = resolve(here, "..", "scratchpad.db");
  const dbPath = process.env.SCRATCHPAD_DB_PATH ?? defaultPath;
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  dbInstance = db;
  return db;
}

export function recordOperation(agentId: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_usage (agent_id, total_operations, updated_at)
     VALUES (?, 1, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       total_operations = total_operations + 1,
       updated_at = excluded.updated_at`
  ).run(agentId, now);
}
