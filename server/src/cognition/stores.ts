import {
  JournalSchema,
  type ClaimView,
  type DialogueState,
  type Journal,
  type PromiseView,
  type ReceiptView,
  type VowView,
} from '@llmrpg/shared';
import type { WorldDb } from '../engine/db';
import type {
  BeliefRecord,
  BeliefStore,
  ClaimStore,
  CognitionStores,
  ConversationStore,
  JobQueue,
  JobRecord,
  MemoryQuery,
  MemoryRecord,
  MemoryStore,
  ProfileStore,
  PromiseStore,
  ReceiptStore,
  RelationshipRecord,
  RelationshipStore,
  VowStore,
} from './api';
import { registerPendingJobPeeker, registerStoresDb } from './gossip';
import { ensureCognitionSchema, isFts5Available } from './schema';

export interface CognitionStoreOptions {
  newId?: () => string;
  now?: () => Date;
}

const MAX_JOB_ATTEMPTS = 3;
const PLAYER_ENTITY_ID_FALLBACK = 'player_you';

function clampAxis(n: number): number {
  return Math.max(-100, Math.min(100, n));
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function entityName(db: WorldDb, id: string): string {
  const row = db.prepare(`SELECT name FROM entities WHERE id = ?`).get(id) as
    | { name: string }
    | undefined;
  return row?.name ?? id;
}

function entityArchetype(db: WorldDb, id: string): string {
  const row = db
    .prepare(`SELECT data FROM components WHERE entity_id = ? AND kind = 'Appearance'`)
    .get(id) as { data: string } | undefined;
  if (!row) return 'unknown';
  try {
    const data = JSON.parse(row.data) as { archetype?: string };
    return data.archetype ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function dispositionFromRelationship(rel: RelationshipRecord | null): string {
  if (!rel) return 'Neutral';
  if (rel.trust > 30 && rel.affection > 30) return 'Warm toward you';
  if (rel.fear > 50) return 'Afraid of you';
  if (rel.trust < -30) return 'Distrusts you';
  return 'Neutral';
}

function memoryFromRow(row: {
  id: string;
  npc_id: string;
  tick: number;
  type: string;
  text: string;
  subjects: string;
  importance: number;
  created_at: string;
}): MemoryRecord {
  return {
    id: row.id,
    npcId: row.npc_id,
    tick: row.tick,
    type: row.type as MemoryRecord['type'],
    text: row.text,
    subjects: parseJsonArray(row.subjects),
    importance: row.importance,
    createdAt: row.created_at,
  };
}

function beliefFromRow(row: {
  id: string;
  npc_id: string;
  proposition: string;
  about_entity_ids: string;
  source: string;
  firsthand: number;
  confidence: number;
  observed_at_tick: number;
  received_at_tick: number;
  distortion_history: string;
}): BeliefRecord {
  return {
    id: row.id,
    npcId: row.npc_id,
    proposition: row.proposition,
    aboutEntityIds: parseJsonArray(row.about_entity_ids),
    source: row.source,
    firsthand: row.firsthand === 1,
    confidence: row.confidence,
    observedAtTick: row.observed_at_tick,
    receivedAtTick: row.received_at_tick,
    distortionHistory: parseJsonArray(row.distortion_history),
  };
}

function promiseFromRow(row: {
  id: string;
  terms: string;
  from_entity_id: string;
  from_name: string;
  to_entity_id: string;
  to_name: string;
  deadline_tick: number | null;
  status: string;
  created_at_tick: number;
}): PromiseView {
  return {
    id: row.id,
    terms: row.terms,
    fromEntityId: row.from_entity_id,
    fromName: row.from_name,
    toEntityId: row.to_entity_id,
    toName: row.to_name,
    deadlineTick: row.deadline_tick,
    status: row.status as PromiseView['status'],
    createdAtTick: row.created_at_tick,
  };
}

function receiptFromRow(row: {
  id: string;
  tick: number;
  text: string;
  event_ids: string;
}): ReceiptView {
  return {
    id: row.id,
    tick: row.tick,
    text: row.text,
    eventIds: parseJsonArray(row.event_ids),
  };
}

function claimFromRow(row: {
  id: string;
  proposition: string;
  about_entity_ids: string;
  source_entity_id: string;
  source_name: string;
  firsthand: number;
  at_tick: number;
}): ClaimView {
  return {
    id: row.id,
    proposition: row.proposition,
    aboutEntityIds: parseJsonArray(row.about_entity_ids),
    sourceEntityId: row.source_entity_id,
    sourceName: row.source_name,
    firsthand: row.firsthand === 1,
    atTick: row.at_tick,
  };
}

function jobFromRow(row: {
  id: string;
  kind: string;
  npc_id: string | null;
  payload: string;
  status: string;
  attempts: number;
  run_after_tick: number;
  last_error: string | null;
}): JobRecord {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    kind: row.kind as JobRecord['kind'],
    npcId: row.npc_id,
    payload,
    status: row.status as JobRecord['status'],
    attempts: row.attempts,
    runAfterTick: row.run_after_tick,
    lastError: row.last_error,
  };
}

function dialogueFromRow(row: {
  dialogue_id: string;
  npc_id: string;
  npc_name: string;
  patience: number;
  rapport: number;
  turns: number;
  ended: number;
  closing_line: string | null;
}): DialogueState {
  const state: DialogueState = {
    dialogueId: row.dialogue_id,
    npcId: row.npc_id,
    npcName: row.npc_name,
    patience: row.patience,
    rapport: row.rapport,
    turns: row.turns,
    ended: row.ended === 1,
  };
  if (row.closing_line != null) state.closingLine = row.closing_line;
  return state;
}

/** Sanitize free text into an FTS5 MATCH query (OR of tokens). */
export function ftsMatchQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

function recencyScore(tick: number, nowTick: number): number {
  const dist = Math.max(0, nowTick - tick);
  return Math.pow(0.5, dist / 300);
}

function subjectOverlap(memorySubjects: string[], querySubjects: string[]): number {
  if (querySubjects.length === 0) return 0;
  const set = new Set(memorySubjects);
  let hit = 0;
  for (const s of querySubjects) {
    if (set.has(s)) hit += 1;
  }
  return hit / querySubjects.length;
}

export function createCognitionStores(
  db: WorldDb,
  opts: CognitionStoreOptions = {},
): CognitionStores {
  ensureCognitionSchema(db);
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => new Date());
  const useFts = isFts5Available(db);

  const memories: MemoryStore = {
    append(record) {
      const id = newId();
      const createdAt = now().toISOString();
      db.prepare(
        `INSERT INTO memories (id, npc_id, tick, type, text, subjects, importance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        record.npcId,
        record.tick,
        record.type,
        record.text,
        JSON.stringify(record.subjects),
        record.importance,
        createdAt,
      );
      db.prepare(
        `INSERT INTO reflection_state (npc_id, importance_since) VALUES (?, ?)
         ON CONFLICT(npc_id) DO UPDATE SET
           importance_since = importance_since + excluded.importance_since`,
      ).run(record.npcId, record.importance);
      return { ...record, id, createdAt };
    },

    retrieve(query: MemoryQuery): MemoryRecord[] {
      const limit = query.limit ?? 12;
      const byId = new Map<string, MemoryRecord>();
      const ftsRaw = new Map<string, number>();

      const recent = db
        .prepare(
          `SELECT * FROM memories WHERE npc_id = ? ORDER BY tick DESC, id ASC LIMIT 50`,
        )
        .all(query.npcId) as Array<Parameters<typeof memoryFromRow>[0]>;
      for (const row of recent) byId.set(row.id, memoryFromRow(row));

      if (query.subjects && query.subjects.length > 0) {
        const allForNpc = db
          .prepare(`SELECT * FROM memories WHERE npc_id = ?`)
          .all(query.npcId) as Array<Parameters<typeof memoryFromRow>[0]>;
        const subjectSet = new Set(query.subjects);
        for (const row of allForNpc) {
          const mem = memoryFromRow(row);
          if (mem.subjects.some((s) => subjectSet.has(s))) {
            byId.set(mem.id, mem);
          }
        }
      }

      if (query.text && query.text.trim().length > 0) {
        if (useFts) {
          const match = ftsMatchQuery(query.text);
          if (match) {
            try {
              const rows = db
                .prepare(
                  `SELECT m.*, bm25(memories_fts) AS fts_rank
                   FROM memories_fts
                   JOIN memories m ON m.rowid = memories_fts.rowid
                   WHERE memories_fts MATCH ? AND m.npc_id = ?`,
                )
                .all(match, query.npcId) as Array<
                Parameters<typeof memoryFromRow>[0] & { fts_rank: number }
              >;
              for (const row of rows) {
                byId.set(row.id, memoryFromRow(row));
                ftsRaw.set(row.id, row.fts_rank);
              }
            } catch {
              // malformed MATCH — ignore FTS candidates
            }
          }
        } else {
          const like = `%${query.text.trim()}%`;
          const rows = db
            .prepare(
              `SELECT * FROM memories WHERE npc_id = ? AND text LIKE ? COLLATE NOCASE`,
            )
            .all(query.npcId, like) as Array<Parameters<typeof memoryFromRow>[0]>;
          for (const row of rows) {
            byId.set(row.id, memoryFromRow(row));
            ftsRaw.set(row.id, 0);
          }
        }
      }

      let candidates = [...byId.values()];
      if (query.types && query.types.length > 0) {
        const types = new Set(query.types);
        candidates = candidates.filter((m) => types.has(m.type));
      }

      const nowTickRow = db
        .prepare(`SELECT COALESCE(MAX(tick), 0) AS t FROM memories WHERE npc_id = ?`)
        .get(query.npcId) as { t: number };
      const nowTick = nowTickRow.t;

      // Normalize FTS ranks (bm25: lower is better) to 0..1 among matches.
      const ftsNorm = new Map<string, number>();
      if (query.text && ftsRaw.size > 0) {
        if (useFts) {
          const vals = [...ftsRaw.values()];
          const min = Math.min(...vals);
          const max = Math.max(...vals);
          for (const [id, rank] of ftsRaw) {
            ftsNorm.set(id, max === min ? 1 : (max - rank) / (max - min));
          }
        } else {
          for (const id of ftsRaw.keys()) ftsNorm.set(id, 1);
        }
      }

      const querySubjects = query.subjects ?? [];
      const scored = candidates.map((m) => {
        const ftsRank = ftsNorm.get(m.id) ?? 0;
        const subj = subjectOverlap(m.subjects, querySubjects);
        const rec = recencyScore(m.tick, nowTick);
        const imp = m.importance / 10;
        const score = 2.0 * ftsRank + 1.5 * subj + 1.0 * rec + 1.0 * imp;
        return { m, score };
      });

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0;
      });

      return scored.slice(0, limit).map((s) => s.m);
    },

    importanceSinceReflection(npcId) {
      const row = db
        .prepare(`SELECT importance_since FROM reflection_state WHERE npc_id = ?`)
        .get(npcId) as { importance_since: number } | undefined;
      return row?.importance_since ?? 0;
    },

    markReflected(npcId) {
      db.prepare(
        `INSERT INTO reflection_state (npc_id, importance_since) VALUES (?, 0)
         ON CONFLICT(npc_id) DO UPDATE SET importance_since = 0`,
      ).run(npcId);
    },
  };

  const beliefs: BeliefStore = {
    upsert(record) {
      const existing = db
        .prepare(`SELECT id FROM beliefs WHERE npc_id = ? AND proposition = ?`)
        .get(record.npcId, record.proposition) as { id: string } | undefined;
      const id = existing?.id ?? newId();
      db.prepare(
        `INSERT INTO beliefs (
          id, npc_id, proposition, about_entity_ids, source, firsthand,
          confidence, observed_at_tick, received_at_tick, distortion_history
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          about_entity_ids = excluded.about_entity_ids,
          source = excluded.source,
          firsthand = excluded.firsthand,
          confidence = excluded.confidence,
          observed_at_tick = excluded.observed_at_tick,
          received_at_tick = excluded.received_at_tick,
          distortion_history = excluded.distortion_history`,
      ).run(
        id,
        record.npcId,
        record.proposition,
        JSON.stringify(record.aboutEntityIds),
        record.source,
        record.firsthand ? 1 : 0,
        record.confidence,
        record.observedAtTick,
        record.receivedAtTick,
        JSON.stringify(record.distortionHistory),
      );
      return { ...record, id };
    },

    forNpc(npcId) {
      const rows = db
        .prepare(`SELECT * FROM beliefs WHERE npc_id = ? ORDER BY confidence DESC, id ASC`)
        .all(npcId) as Array<Parameters<typeof beliefFromRow>[0]>;
      return rows.map(beliefFromRow);
    },

    about(npcId, aboutEntityId) {
      return this.forNpc(npcId).filter((b) => b.aboutEntityIds.includes(aboutEntityId));
    },

    transmit(fromNpcId, toNpcId, beliefId, atTick) {
      const sourceRow = db
        .prepare(`SELECT * FROM beliefs WHERE id = ? AND npc_id = ?`)
        .get(beliefId, fromNpcId) as Parameters<typeof beliefFromRow>[0] | undefined;
      if (!sourceRow) return null;
      const source = beliefFromRow(sourceRow);
      const dup = db
        .prepare(`SELECT id FROM beliefs WHERE npc_id = ? AND proposition = ?`)
        .get(toNpcId, source.proposition) as { id: string } | undefined;
      if (dup) return null;
      return this.upsert({
        npcId: toNpcId,
        proposition: source.proposition,
        aboutEntityIds: [...source.aboutEntityIds],
        source: fromNpcId,
        firsthand: false,
        confidence: source.confidence * 0.85,
        observedAtTick: source.observedAtTick,
        receivedAtTick: atTick,
        distortionHistory: [...source.distortionHistory, fromNpcId],
      });
    },
  };

  const relationships: RelationshipStore = {
    get(npcId, otherId) {
      const row = db
        .prepare(`SELECT * FROM relationships WHERE npc_id = ? AND other_id = ?`)
        .get(npcId, otherId) as
        | {
            npc_id: string;
            other_id: string;
            trust: number;
            affection: number;
            fear: number;
            note: string;
            updated_at_tick: number;
          }
        | undefined;
      if (!row) return null;
      return {
        npcId: row.npc_id,
        otherId: row.other_id,
        trust: row.trust,
        affection: row.affection,
        fear: row.fear,
        note: row.note,
        updatedAtTick: row.updated_at_tick,
      };
    },

    forNpc(npcId) {
      const rows = db
        .prepare(`SELECT * FROM relationships WHERE npc_id = ?`)
        .all(npcId) as Array<{
        npc_id: string;
        other_id: string;
        trust: number;
        affection: number;
        fear: number;
        note: string;
        updated_at_tick: number;
      }>;
      return rows.map((row) => ({
        npcId: row.npc_id,
        otherId: row.other_id,
        trust: row.trust,
        affection: row.affection,
        fear: row.fear,
        note: row.note,
        updatedAtTick: row.updated_at_tick,
      }));
    },

    adjust(npcId, otherId, delta, note, atTick) {
      const prev = this.get(npcId, otherId);
      const next: RelationshipRecord = {
        npcId,
        otherId,
        trust: clampAxis((prev?.trust ?? 0) + (delta.trust ?? 0)),
        affection: clampAxis((prev?.affection ?? 0) + (delta.affection ?? 0)),
        fear: clampAxis((prev?.fear ?? 0) + (delta.fear ?? 0)),
        note,
        updatedAtTick: atTick,
      };
      db.prepare(
        `INSERT INTO relationships (npc_id, other_id, trust, affection, fear, note, updated_at_tick)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(npc_id, other_id) DO UPDATE SET
           trust = excluded.trust,
           affection = excluded.affection,
           fear = excluded.fear,
           note = excluded.note,
           updated_at_tick = excluded.updated_at_tick`,
      ).run(
        next.npcId,
        next.otherId,
        next.trust,
        next.affection,
        next.fear,
        next.note,
        next.updatedAtTick,
      );
      return next;
    },
  };

  const promises: PromiseStore = {
    create(input) {
      const id = newId();
      const fromName = entityName(db, input.fromEntityId);
      const toName = entityName(db, input.toEntityId);
      const view: PromiseView = {
        id,
        terms: input.terms,
        fromEntityId: input.fromEntityId,
        fromName,
        toEntityId: input.toEntityId,
        toName,
        deadlineTick: input.deadlineTick,
        status: 'open',
        createdAtTick: input.atTick,
      };
      db.prepare(
        `INSERT INTO promises (
          id, terms, from_entity_id, from_name, to_entity_id, to_name,
          deadline_tick, status, created_at_tick
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        view.id,
        view.terms,
        view.fromEntityId,
        view.fromName,
        view.toEntityId,
        view.toName,
        view.deadlineTick,
        view.status,
        view.createdAtTick,
      );
      return view;
    },

    open() {
      const rows = db
        .prepare(`SELECT * FROM promises WHERE status = 'open' ORDER BY created_at_tick ASC, id ASC`)
        .all() as Array<Parameters<typeof promiseFromRow>[0]>;
      return rows.map(promiseFromRow);
    },

    sweep(atTick) {
      const openRows = db
        .prepare(
          `SELECT * FROM promises
           WHERE status = 'open' AND deadline_tick IS NOT NULL AND deadline_tick < ?`,
        )
        .all(atTick) as Array<Parameters<typeof promiseFromRow>[0]>;
      if (openRows.length === 0) return [];
      const update = db.prepare(`UPDATE promises SET status = 'expired' WHERE id = ?`);
      const tx = db.transaction(() => {
        for (const row of openRows) update.run(row.id);
      });
      tx();
      return openRows.map((r) => ({ ...promiseFromRow(r), status: 'expired' as const }));
    },

    resolve(id, status, _atTick) {
      const row = db.prepare(`SELECT * FROM promises WHERE id = ?`).get(id) as
        | Parameters<typeof promiseFromRow>[0]
        | undefined;
      if (!row) return null;
      db.prepare(`UPDATE promises SET status = ? WHERE id = ?`).run(status, id);
      return { ...promiseFromRow(row), status };
    },
  };

  const claims: ClaimStore = {
    record(input) {
      const id = newId();
      db.prepare(
        `INSERT INTO claims (
          id, proposition, about_entity_ids, source_entity_id, source_name, firsthand, at_tick
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.proposition,
        JSON.stringify(input.aboutEntityIds),
        input.sourceEntityId,
        input.sourceName,
        input.firsthand ? 1 : 0,
        input.atTick,
      );
      return { ...input, id };
    },

    all() {
      const rows = db
        .prepare(`SELECT * FROM claims ORDER BY at_tick ASC, id ASC`)
        .all() as Array<Parameters<typeof claimFromRow>[0]>;
      return rows.map(claimFromRow);
    },
  };

  const receipts: ReceiptStore = {
    record(input) {
      const id = newId();
      db.prepare(
        `INSERT INTO receipts (id, tick, text, event_ids, delivered) VALUES (?, ?, ?, ?, 0)`,
      ).run(id, input.tick, input.text, JSON.stringify(input.eventIds));
      return { id, tick: input.tick, text: input.text, eventIds: input.eventIds };
    },

    drain() {
      const rows = db
        .prepare(
          `SELECT id, tick, text, event_ids FROM receipts WHERE delivered = 0 ORDER BY tick ASC, id ASC`,
        )
        .all() as Array<Parameters<typeof receiptFromRow>[0]>;
      if (rows.length === 0) return [];
      const mark = db.prepare(`UPDATE receipts SET delivered = 1 WHERE id = ?`);
      const tx = db.transaction(() => {
        for (const row of rows) mark.run(row.id);
      });
      tx();
      return rows.map(receiptFromRow);
    },

    all() {
      const rows = db
        .prepare(`SELECT id, tick, text, event_ids FROM receipts ORDER BY tick ASC, id ASC`)
        .all() as Array<Parameters<typeof receiptFromRow>[0]>;
      return rows.map(receiptFromRow);
    },
  };

  const jobs: JobQueue = {
    enqueue(kind, npcId, payload, runAfterTick) {
      const id = newId();
      const record: JobRecord = {
        id,
        kind,
        npcId,
        payload,
        status: 'pending',
        attempts: 0,
        runAfterTick,
        lastError: null,
      };
      db.prepare(
        `INSERT INTO jobs (id, kind, npc_id, payload, status, attempts, run_after_tick, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.kind,
        record.npcId,
        JSON.stringify(record.payload),
        record.status,
        record.attempts,
        record.runAfterTick,
        record.lastError,
      );
      return record;
    },

    claim(tick, n) {
      const claimOne = db.transaction((): JobRecord | null => {
        const row = db
          .prepare(
            `SELECT * FROM jobs
             WHERE status = 'pending' AND run_after_tick <= ? AND attempts < ?
             ORDER BY run_after_tick ASC, id ASC
             LIMIT 1`,
          )
          .get(tick, MAX_JOB_ATTEMPTS) as Parameters<typeof jobFromRow>[0] | undefined;
        if (!row) return null;
        const attempts = row.attempts + 1;
        db.prepare(
          `UPDATE jobs SET status = 'running', attempts = ?, last_error = NULL WHERE id = ? AND status = 'pending'`,
        ).run(attempts, row.id);
        const updated = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(row.id) as
          | Parameters<typeof jobFromRow>[0]
          | undefined;
        if (!updated || updated.status !== 'running') return null;
        return jobFromRow(updated);
      });

      const out: JobRecord[] = [];
      for (let i = 0; i < n; i++) {
        const job = claimOne();
        if (!job) break;
        out.push(job);
      }
      return out;
    },

    complete(id) {
      db.prepare(`UPDATE jobs SET status = 'done' WHERE id = ?`).run(id);
    },

    fail(id, error, retry) {
      const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
        | Parameters<typeof jobFromRow>[0]
        | undefined;
      if (!row) return;
      const canRetry = retry && row.attempts < MAX_JOB_ATTEMPTS;
      if (canRetry) {
        db.prepare(
          `UPDATE jobs SET status = 'pending', run_after_tick = run_after_tick + 20, last_error = ? WHERE id = ?`,
        ).run(error, id);
      } else {
        db.prepare(`UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?`).run(error, id);
      }
    },
  };

  const conversations: ConversationStore = {
    start(npcId, npcName, patience, rapport) {
      const dialogueId = newId();
      const state: DialogueState = {
        dialogueId,
        npcId,
        npcName,
        patience,
        rapport,
        turns: 0,
        ended: false,
      };
      db.prepare(
        `INSERT INTO conversations (
          dialogue_id, npc_id, npc_name, patience, rapport, turns, ended, closing_line
        ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
      ).run(dialogueId, npcId, npcName, patience, rapport, 0);
      return state;
    },

    get(dialogueId) {
      const row = db
        .prepare(`SELECT * FROM conversations WHERE dialogue_id = ?`)
        .get(dialogueId) as Parameters<typeof dialogueFromRow>[0] | undefined;
      return row ? dialogueFromRow(row) : null;
    },

    update(dialogueId, patch) {
      const cur = this.get(dialogueId);
      if (!cur) return null;
      const next: DialogueState = {
        ...cur,
        ...patch,
        dialogueId: cur.dialogueId,
        npcId: cur.npcId,
      };
      db.prepare(
        `UPDATE conversations SET
          npc_name = ?, patience = ?, rapport = ?, turns = ?, ended = ?, closing_line = ?
         WHERE dialogue_id = ?`,
      ).run(
        next.npcName,
        next.patience,
        next.rapport,
        next.turns,
        next.ended ? 1 : 0,
        next.closingLine ?? null,
        dialogueId,
      );
      return next;
    },

    end(dialogueId, closingLine) {
      return this.update(dialogueId, {
        ended: true,
        ...(closingLine !== undefined ? { closingLine } : {}),
      });
    },

    activeFor(npcId) {
      const row = db
        .prepare(
          `SELECT * FROM conversations WHERE npc_id = ? AND ended = 0 ORDER BY dialogue_id ASC LIMIT 1`,
        )
        .get(npcId) as Parameters<typeof dialogueFromRow>[0] | undefined;
      return row ? dialogueFromRow(row) : null;
    },
  };

  const vows: VowStore = {
    create(text, atTick) {
      const id = newId();
      db.prepare(
        `INSERT INTO vows (id, text, status, created_at_tick) VALUES (?, ?, 'active', ?)`,
      ).run(id, text, atTick);
    },

    setStatus(id, status) {
      db.prepare(`UPDATE vows SET status = ? WHERE id = ?`).run(status, id);
    },
  };

  const profile: ProfileStore = {
    getName() {
      const row = db.prepare(`SELECT value FROM profile WHERE key = 'name'`).get() as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    },

    setName(name) {
      db.prepare(
        `INSERT INTO profile (key, value) VALUES ('name', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(name);
    },
  };

  function playerEntityId(): string {
    const row = db
      .prepare(`SELECT player_entity_id FROM playthroughs LIMIT 1`)
      .get() as { player_entity_id: string } | undefined;
    return row?.player_entity_id ?? PLAYER_ENTITY_ID_FALLBACK;
  }

  function buildJournal(): Journal {
    const playerId = playerEntityId();

    const vowRows = db
      .prepare(`SELECT * FROM vows ORDER BY created_at_tick ASC, id ASC`)
      .all() as Array<{
      id: string;
      text: string;
      status: string;
      created_at_tick: number;
    }>;
    const vowViews: VowView[] = vowRows.map((r) => ({
      id: r.id,
      text: r.text,
      status: r.status as VowView['status'],
      createdAtTick: r.created_at_tick,
    }));

    const promiseRows = db
      .prepare(`SELECT * FROM promises ORDER BY created_at_tick ASC, id ASC`)
      .all() as Array<Parameters<typeof promiseFromRow>[0]>;
    const promiseViews = promiseRows.map(promiseFromRow);

    const receiptViews = receipts.all();
    const claimViews = claims.all();

    const relTowardPlayer = db
      .prepare(`SELECT npc_id FROM relationships WHERE other_id = ?`)
      .all(playerId) as Array<{ npc_id: string }>;
    const npcIds = new Set<string>(relTowardPlayer.map((r) => r.npc_id));
    for (const c of claimViews) npcIds.add(c.sourceEntityId);

    const people = [...npcIds]
      .filter((id) => id !== playerId)
      .sort()
      .map((npcId) => {
        const met = db
          .prepare(
            `SELECT first_met_tick, last_seen_tick FROM people_met WHERE npc_id = ? AND other_id = ?`,
          )
          .get(npcId, playerId) as
          | { first_met_tick: number; last_seen_tick: number }
          | undefined;
        const rel = relationships.get(npcId, playerId);
        const personClaims = claimViews.filter((c) => c.sourceEntityId === npcId);
        return {
          entityId: npcId,
          name: entityName(db, npcId),
          archetype: entityArchetype(db, npcId),
          firstMetTick: met?.first_met_tick ?? null,
          lastSeenTick: met?.last_seen_tick ?? null,
          disposition: dispositionFromRelationship(rel),
          claims: personClaims,
        };
      });

    const journal = {
      vows: vowViews,
      promises: promiseViews,
      receipts: receiptViews,
      people,
      claims: claimViews,
    };
    return JournalSchema.parse(journal);
  }

  const stores: CognitionStores = {
    memories,
    beliefs,
    relationships,
    promises,
    claims,
    receipts,
    jobs,
    conversations,
    vows,
    profile,
    buildJournal,
  };

  registerStoresDb(stores, db);
  registerPendingJobPeeker(stores, (kind) => {
    const row = db
      .prepare(`SELECT id FROM jobs WHERE kind = ? AND status = 'pending' LIMIT 1`)
      .get(kind) as { id: string } | undefined;
    return row !== undefined;
  });

  return stores;
}

/** Mark receipts delivered so a later drain() does not double-send them. */
export function markReceiptsDelivered(db: WorldDb, ids: string[]): void {
  if (ids.length === 0) return;
  const stmt = db.prepare(`UPDATE receipts SET delivered = 1 WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const id of ids) stmt.run(id);
  });
  tx();
}

/** Record that an NPC witnessed the player (people journal side table). */
export function notePeopleMet(
  db: WorldDb,
  npcId: string,
  otherId: string,
  tick: number,
): void {
  ensureCognitionSchema(db);
  const existing = db
    .prepare(`SELECT first_met_tick FROM people_met WHERE npc_id = ? AND other_id = ?`)
    .get(npcId, otherId) as { first_met_tick: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE people_met SET last_seen_tick = ? WHERE npc_id = ? AND other_id = ?`,
    ).run(tick, npcId, otherId);
  } else {
    db.prepare(
      `INSERT INTO people_met (npc_id, other_id, first_met_tick, last_seen_tick) VALUES (?, ?, ?, ?)`,
    ).run(npcId, otherId, tick, tick);
  }
}
