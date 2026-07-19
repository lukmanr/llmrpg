import type { WorldDb } from '../engine/db';

let ftsAvailable: boolean | null = null;

/** Whether this SQLite build supports FTS5 (cached after first check). */
export function isFts5Available(db: WorldDb): boolean {
  if (ftsAvailable !== null) return ftsAvailable;
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(x)`);
    db.exec(`DROP TABLE IF EXISTS _fts5_probe`);
    ftsAvailable = true;
  } catch {
    ftsAvailable = false;
  }
  return ftsAvailable;
}

/** Reset FTS capability cache (tests only). */
export function resetFts5Cache(): void {
  ftsAvailable = null;
}

/**
 * Idempotent cognition schema on the world DB.
 * Memories keep an FTS5 index in sync when available; callers fall back to LIKE otherwise.
 */
export function ensureCognitionSchema(db: WorldDb): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  npc_id TEXT NOT NULL,
  tick INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  subjects TEXT NOT NULL,
  importance REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_npc_id ON memories(npc_id);
CREATE INDEX IF NOT EXISTS idx_memories_npc_tick ON memories(npc_id, tick DESC);

CREATE TABLE IF NOT EXISTS beliefs (
  id TEXT PRIMARY KEY,
  npc_id TEXT NOT NULL,
  proposition TEXT NOT NULL,
  about_entity_ids TEXT NOT NULL,
  source TEXT NOT NULL,
  firsthand INTEGER NOT NULL,
  confidence REAL NOT NULL,
  observed_at_tick INTEGER NOT NULL,
  received_at_tick INTEGER NOT NULL,
  distortion_history TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_beliefs_npc_id ON beliefs(npc_id);

CREATE TABLE IF NOT EXISTS relationships (
  npc_id TEXT NOT NULL,
  other_id TEXT NOT NULL,
  trust REAL NOT NULL,
  affection REAL NOT NULL,
  fear REAL NOT NULL,
  note TEXT NOT NULL,
  updated_at_tick INTEGER NOT NULL,
  PRIMARY KEY (npc_id, other_id)
);
CREATE INDEX IF NOT EXISTS idx_relationships_npc_id ON relationships(npc_id);

CREATE TABLE IF NOT EXISTS promises (
  id TEXT PRIMARY KEY,
  terms TEXT NOT NULL,
  from_entity_id TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  to_name TEXT NOT NULL,
  deadline_tick INTEGER,
  status TEXT NOT NULL,
  created_at_tick INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promises_status ON promises(status);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  proposition TEXT NOT NULL,
  about_entity_ids TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  firsthand INTEGER NOT NULL,
  at_tick INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_source ON claims(source_entity_id);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  tick INTEGER NOT NULL,
  text TEXT NOT NULL,
  event_ids TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  npc_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after_tick INTEGER NOT NULL,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, run_after_tick);

CREATE TABLE IF NOT EXISTS conversations (
  dialogue_id TEXT PRIMARY KEY,
  npc_id TEXT NOT NULL,
  npc_name TEXT NOT NULL,
  patience REAL NOT NULL,
  rapport REAL NOT NULL,
  turns INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0,
  closing_line TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_npc ON conversations(npc_id, ended);

CREATE TABLE IF NOT EXISTS vows (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at_tick INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reflection_state (
  npc_id TEXT PRIMARY KEY,
  importance_since REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people_met (
  npc_id TEXT NOT NULL,
  other_id TEXT NOT NULL,
  first_met_tick INTEGER NOT NULL,
  last_seen_tick INTEGER NOT NULL,
  PRIMARY KEY (npc_id, other_id)
);
CREATE INDEX IF NOT EXISTS idx_people_met_npc ON people_met(npc_id);
`);

  if (isFts5Available(db)) {
    db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  text,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`);
  }
}
