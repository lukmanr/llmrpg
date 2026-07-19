import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCognitionStores,
  runGossipJob,
  type CognitionStores,
} from '../../src/cognition';
import { createWorldDb } from '../../src/engine/db';
import type { WorldState } from '../../src/engine/state';

function makeWorld(): WorldState {
  const entities = new Map();
  entities.set('player_you', {
    id: 'player_you',
    kind: 'player' as const,
    name: 'You',
    components: new Map([['Position', { x: 0, y: 0 }]]),
  });
  entities.set('npc_wren', {
    id: 'npc_wren',
    kind: 'npc' as const,
    name: 'Wren',
    components: new Map([['Position', { x: 5, y: 5 }]]),
  });
  entities.set('npc_bram', {
    id: 'npc_bram',
    kind: 'npc' as const,
    name: 'Bram',
    components: new Map([['Position', { x: 6, y: 5 }]]), // Chebyshev dist 1 from Wren
  });
  entities.set('npc_far', {
    id: 'npc_far',
    kind: 'npc' as const,
    name: 'Farley',
    components: new Map([['Position', { x: 20, y: 20 }]]),
  });
  return {
    worldId: 'test',
    revision: 1,
    tick: 100,
    mapWidth: 40,
    mapHeight: 40,
    terrain: [],
    entities,
  };
}

describe('gossip job', () => {
  let stores: CognitionStores;

  beforeEach(() => {
    const db = createWorldDb(':memory:');
    stores = createCognitionStores(db, {
      newId: () => crypto.randomUUID(),
      now: () => new Date('2026-01-15T12:00:00.000Z'),
    });
  });

  it('adjacent NPCs exchange most-confident beliefs', () => {
    const world = makeWorld();
    stores.beliefs.upsert({
      npcId: 'npc_wren',
      proposition: 'The mill wheel is cracked',
      aboutEntityIds: ['item_wheel'],
      source: 'event_a',
      firsthand: true,
      confidence: 0.9,
      observedAtTick: 1,
      receivedAtTick: 1,
      distortionHistory: [],
    });
    stores.beliefs.upsert({
      npcId: 'npc_bram',
      proposition: 'Rain is coming',
      aboutEntityIds: [],
      source: 'event_b',
      firsthand: true,
      confidence: 0.8,
      observedAtTick: 2,
      receivedAtTick: 2,
      distortionHistory: [],
    });
    stores.beliefs.upsert({
      npcId: 'npc_far',
      proposition: 'Secret far away',
      aboutEntityIds: [],
      source: 'event_c',
      firsthand: true,
      confidence: 1,
      observedAtTick: 3,
      receivedAtTick: 3,
      distortionHistory: [],
    });

    const n = runGossipJob(stores, world, { tick: 100 });
    expect(n).toBeGreaterThanOrEqual(2);

    const bramBeliefs = stores.beliefs.forNpc('npc_bram').map((b) => b.proposition);
    const wrenBeliefs = stores.beliefs.forNpc('npc_wren').map((b) => b.proposition);
    expect(bramBeliefs).toContain('The mill wheel is cracked');
    expect(wrenBeliefs).toContain('Rain is coming');

    // Farley too distant — no exchange with Wren/Bram
    expect(stores.beliefs.forNpc('npc_far').map((b) => b.proposition)).toEqual([
      'Secret far away',
    ]);
    expect(bramBeliefs).not.toContain('Secret far away');
  });

  it('records receipt for player-subject belief transmits', () => {
    const world = makeWorld();
    stores.beliefs.upsert({
      npcId: 'npc_wren',
      proposition: 'You stole the bread',
      aboutEntityIds: ['player_you'],
      source: 'event_steal',
      firsthand: true,
      confidence: 1,
      observedAtTick: 1,
      receivedAtTick: 1,
      distortionHistory: [],
    });

    runGossipJob(stores, world, { tick: 50 });

    const receipts = stores.receipts.all();
    expect(receipts.some((r) => r.text.includes('Word spreads') && r.text.includes('about you'))).toBe(
      true,
    );

    const bramMems = stores.memories.retrieve({ npcId: 'npc_bram', types: ['belief'], limit: 5 });
    expect(bramMems.some((m) => m.text.includes('told me:') && m.text.includes('bread'))).toBe(
      true,
    );
  });

  it('does not duplicate transmit of the same proposition', () => {
    const world = makeWorld();
    stores.beliefs.upsert({
      npcId: 'npc_wren',
      proposition: 'Shared rumor',
      aboutEntityIds: ['player_you'],
      source: 'e1',
      firsthand: true,
      confidence: 1,
      observedAtTick: 1,
      receivedAtTick: 1,
      distortionHistory: [],
    });

    const first = runGossipJob(stores, world, { tick: 10 });
    expect(first).toBeGreaterThanOrEqual(1);
    const bramCount = stores.beliefs.forNpc('npc_bram').length;

    const second = runGossipJob(stores, world, { tick: 11 });
    // Wren→Bram already held; Bram may have nothing to send back about a new prop
    expect(stores.beliefs.forNpc('npc_bram')).toHaveLength(bramCount);
    expect(second).toBeLessThan(first);
  });
});
