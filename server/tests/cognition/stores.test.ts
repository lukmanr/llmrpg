import { JournalSchema } from '@llmrpg/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCognitionStores,
  ensureCognitionSchema,
  enqueueGossipEvery,
  type CognitionStores,
} from '../../src/cognition';
import { createWorldDb, type WorldDb } from '../../src/engine/db';

describe('cognition stores', () => {
  let db: WorldDb;
  let stores: CognitionStores;
  let idSeq: number;
  const fixedNow = new Date('2026-01-15T12:00:00.000Z');

  beforeEach(() => {
    db = createWorldDb(':memory:');
    idSeq = 0;
    stores = createCognitionStores(db, {
      newId: () => `id_${++idSeq}`,
      now: () => fixedNow,
    });
    db.prepare(`INSERT INTO entities (id, kind, name) VALUES (?, ?, ?)`).run(
      'player_you',
      'player',
      'You',
    );
    db.prepare(`INSERT INTO entities (id, kind, name) VALUES (?, ?, ?)`).run(
      'npc_wren',
      'npc',
      'Wren',
    );
    db.prepare(`INSERT INTO entities (id, kind, name) VALUES (?, ?, ?)`).run(
      'npc_bram',
      'npc',
      'Bram',
    );
    db.prepare(
      `INSERT INTO components (entity_id, kind, data) VALUES (?, ?, ?)`,
    ).run('npc_wren', 'Appearance', JSON.stringify({ archetype: 'miller', tags: [] }));
  });

  it('ensureCognitionSchema is idempotent', () => {
    expect(() => ensureCognitionSchema(db)).not.toThrow();
    expect(() => ensureCognitionSchema(db)).not.toThrow();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`)
      .get() as { name: string };
    expect(tables.name).toBe('memories');
  });

  it('memory append uses injected id and now', () => {
    const m = stores.memories.append({
      npcId: 'npc_wren',
      tick: 10,
      type: 'observation',
      text: 'Wren saw You pick up the bread loaf',
      subjects: ['player_you', 'item_bread'],
      importance: 3,
    });
    expect(m.id).toBe('id_1');
    expect(m.createdAt).toBe(fixedNow.toISOString());
  });

  it('hybrid retrieve: subject match beats unrelated recent', () => {
    for (let i = 0; i < 5; i++) {
      stores.memories.append({
        npcId: 'npc_wren',
        tick: 100 + i,
        type: 'observation',
        text: `unrelated chatter ${i}`,
        subjects: ['npc_bram'],
        importance: 1,
      });
    }
    stores.memories.append({
      npcId: 'npc_wren',
      tick: 50,
      type: 'observation',
      text: 'old but about the player',
      subjects: ['player_you'],
      importance: 2,
    });

    const hits = stores.memories.retrieve({
      npcId: 'npc_wren',
      subjects: ['player_you'],
      limit: 3,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.subjects).toContain('player_you');
    expect(hits[0]!.text).toContain('player');
  });

  it('hybrid retrieve: FTS text match ranks first', () => {
    stores.memories.append({
      npcId: 'npc_wren',
      tick: 200,
      type: 'observation',
      text: 'Wren saw Bram walk by the mill',
      subjects: ['npc_bram'],
      importance: 9,
    });
    stores.memories.append({
      npcId: 'npc_wren',
      tick: 10,
      type: 'observation',
      text: 'Wren saw You steal the ledger',
      subjects: ['player_you'],
      importance: 1,
    });

    const hits = stores.memories.retrieve({
      npcId: 'npc_wren',
      text: 'steal ledger',
      limit: 5,
    });
    expect(hits[0]!.text).toMatch(/ledger|steal/i);
  });

  it('importance accumulator triggers and resets on markReflected', () => {
    expect(stores.memories.importanceSinceReflection('npc_wren')).toBe(0);
    stores.memories.append({
      npcId: 'npc_wren',
      tick: 1,
      type: 'observation',
      text: 'a',
      subjects: [],
      importance: 10,
    });
    stores.memories.append({
      npcId: 'npc_wren',
      tick: 2,
      type: 'observation',
      text: 'b',
      subjects: [],
      importance: 10,
    });
    expect(stores.memories.importanceSinceReflection('npc_wren')).toBe(20);
    stores.memories.markReflected('npc_wren');
    expect(stores.memories.importanceSinceReflection('npc_wren')).toBe(0);
  });

  it('belief transmit: provenance, confidence decay, dedupe', () => {
    const src = stores.beliefs.upsert({
      npcId: 'npc_wren',
      proposition: 'You stole the bread',
      aboutEntityIds: ['player_you'],
      source: 'event_1',
      firsthand: true,
      confidence: 1,
      observedAtTick: 5,
      receivedAtTick: 5,
      distortionHistory: [],
    });

    const copied = stores.beliefs.transmit('npc_wren', 'npc_bram', src.id, 20);
    expect(copied).not.toBeNull();
    expect(copied!.firsthand).toBe(false);
    expect(copied!.source).toBe('npc_wren');
    expect(copied!.confidence).toBeCloseTo(0.85);
    expect(copied!.receivedAtTick).toBe(20);
    expect(copied!.distortionHistory).toEqual(['npc_wren']);

    const again = stores.beliefs.transmit('npc_wren', 'npc_bram', src.id, 21);
    expect(again).toBeNull();
    expect(stores.beliefs.forNpc('npc_bram')).toHaveLength(1);
  });

  it('promise sweep expires past-deadline opens', () => {
    const p = stores.promises.create({
      fromEntityId: 'player_you',
      toEntityId: 'npc_wren',
      terms: 'Meet at dusk',
      deadlineTick: 10,
      atTick: 1,
    });
    expect(p.status).toBe('open');
    expect(p.fromName).toBe('You');
    expect(p.toName).toBe('Wren');

    const changed = stores.promises.sweep(11);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.status).toBe('expired');
    expect(stores.promises.open()).toHaveLength(0);
  });

  it('receipt drain returns undelivered once', () => {
    stores.receipts.record({ tick: 1, text: 'Because you helped Wren…', eventIds: ['e1'] });
    stores.receipts.record({ tick: 2, text: 'Word spreads…', eventIds: [] });
    const first = stores.receipts.drain();
    expect(first).toHaveLength(2);
    expect(stores.receipts.drain()).toHaveLength(0);
    expect(stores.receipts.all()).toHaveLength(2);
  });

  it('job claim / complete / fail-retry respects max attempts', () => {
    const job = stores.jobs.enqueue('reflection', 'npc_wren', {}, 0);
    const claimed = stores.jobs.claim(0, 1);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(job.id);
    expect(claimed[0]!.status).toBe('running');
    expect(claimed[0]!.attempts).toBe(1);

    stores.jobs.fail(job.id, 'boom', true);
    const again = stores.jobs.claim(20, 1);
    expect(again).toHaveLength(1);
    expect(again[0]!.attempts).toBe(2);

    stores.jobs.complete(job.id);

    const j2 = stores.jobs.enqueue('gossip', null, {}, 0);
    let tick = 0;
    for (let a = 1; a <= 3; a++) {
      const c = stores.jobs.claim(tick, 1);
      expect(c).toHaveLength(1);
      expect(c[0]!.attempts).toBe(a);
      stores.jobs.fail(j2.id, 'x', true);
      tick += 20;
    }
    expect(stores.jobs.claim(tick + 100, 1)).toHaveLength(0);
  });

  it('conversation lifecycle', () => {
    const d = stores.conversations.start('npc_wren', 'Wren', 80, 10);
    expect(d.ended).toBe(false);
    expect(stores.conversations.activeFor('npc_wren')?.dialogueId).toBe(d.dialogueId);
    stores.conversations.update(d.dialogueId, { turns: 2, patience: 60 });
    const ended = stores.conversations.end(d.dialogueId, 'Farewell.');
    expect(ended?.ended).toBe(true);
    expect(ended?.closingLine).toBe('Farewell.');
    expect(stores.conversations.activeFor('npc_wren')).toBeNull();
  });

  it('buildJournal validates against JournalSchema', () => {
    stores.profile.setName('Ash');
    stores.vows.create('I will protect the mill', 1);
    stores.promises.create({
      fromEntityId: 'player_you',
      toEntityId: 'npc_wren',
      terms: 'Return the ledger',
      deadlineTick: null,
      atTick: 2,
    });
    stores.receipts.record({ tick: 3, text: 'Wren trusts you more.', eventIds: ['e2'] });
    stores.relationships.adjust('npc_wren', 'player_you', { trust: 40, affection: 35 }, 'grateful', 4);
    stores.claims.record({
      proposition: 'The ledger is under the floorboard',
      aboutEntityIds: ['item_ledger'],
      sourceEntityId: 'npc_wren',
      sourceName: 'Wren',
      firsthand: true,
      atTick: 5,
    });

    const journal = stores.buildJournal();
    expect(() => JournalSchema.parse(journal)).not.toThrow();
    expect(journal.vows).toHaveLength(1);
    expect(journal.people.some((p) => p.entityId === 'npc_wren')).toBe(true);
    const wren = journal.people.find((p) => p.entityId === 'npc_wren')!;
    expect(wren.disposition).toBe('Warm toward you');
    expect(wren.archetype).toBe('miller');
  });

  it('enqueueGossipEvery is idempotent while pending', () => {
    expect(enqueueGossipEvery(stores, 30, 30)).toBe(true);
    expect(enqueueGossipEvery(stores, 30, 30)).toBe(false);
    expect(enqueueGossipEvery(stores, 31, 30)).toBe(false);
  });
});
