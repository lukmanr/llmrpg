import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type WorldDb = Database.Database;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS world_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS components (
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (entity_id, kind),
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  tick INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  verb TEXT NOT NULL,
  actor_id TEXT,
  target_ids TEXT NOT NULL,
  data TEXT NOT NULL,
  caused_by TEXT NOT NULL,
  witnessed_by TEXT NOT NULL,
  narrative_tags TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions_log (
  action_id TEXT PRIMARY KEY,
  playthrough_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  request TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playthroughs (
  id TEXT PRIMARY KEY,
  player_entity_id TEXT NOT NULL,
  explored TEXT NOT NULL,
  log TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/**
 * Open (or create) a world SQLite database.
 * Pass `':memory:'` for tests. File paths get their parent dirs created.
 * Uses WAL mode for on-disk databases.
 */
export function createWorldDb(dbPath: string): WorldDb {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.exec(SCHEMA_SQL);
  return db;
}

export function defaultWorldDbPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../data/worlds/default.sqlite',
  );
}
