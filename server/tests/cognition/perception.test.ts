import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCognitionStores,
  createPerceptionHook,
  type CognitionStores,
} from '../../src/cognition';
import { createWorldDb, type WorldDb } from '../../src/engine/db';
import type { TurnHookArgs } from '../../src/engine/world';
import type { WorldState } from '../../src/engine/state';
import type { GameEvent } from '@llmrpg/shared';

function makeWorld(tick: number): WorldState {
  const entities = new Map();
  entities.set('player_you', {
    id: 'player_you',
    kind: 'player' as const,
    name: 'You',
    components: new Map([['Position', { x: 5, y: 5 }]]),
  });
  entities.set('npc_wren', {
    id: 'npc_wren',
    kind: 'npc' as const,
    name: 'Wren',
    components: new Map([['Position', { x: 6, y: 5 }]]),
  });
  entities.set('item_bread', {
    id: 'item_bread',
    kind: 'item' as const,
    name: 'bread loaf',
    components: new Map(),
  });
  return {
    worldId: 'test',
    revision: 1,
    tick,
    mapWidth: 20,
    mapHeight: 20,
    terrain: [],
    entities,
  };
}

function makeEvent(partial: Partial<GameEvent> & Pick<GameEvent, 'verb' | 'actorId'>): GameEvent {
  return {
    id: partial.id ?? 'evt_1',
    worldId: 'test',
    tick: partial.tick ?? 1,
    revision: 1,
    verb: partial.verb,
    actorId: partial.actorId,
    targetIds: partial.targetIds ?? [],
    data: partial.data ?? {},
    causedBy: partial.causedBy ?? [],
    witnessedBy: partial.witnessedBy ?? [],
    narrativeTags: partial.narrativeTags ?? [],
    createdAt: '2026-01-15T12:00:00.000Z',
  };
}

function makeArgs(world: WorldState, events: GameEvent[]): TurnHookArgs {
  return {
    world,
    playthrough: {
      id: 'pt',
      playerEntityId: 'player_you',
      explored: [],
      log: [],
    },
    request: {
      actionId: 'a1',
      revision: 1,
      action: { verb: 'wait' },
    },
    events,
    log: [],
    receipts: [],
    applyNpcAction: () => ({
      ok: false as const,
      code: 'invalid_action' as const,
      message: 'n/a',
    }),
  };
}

describe('perception hook', () => {
  let db: WorldDb;
  let stores: CognitionStores;

  beforeEach(() => {
    db = createWorldDb(':memory:');
    stores = createCognitionStores(db, {
      newId: () => crypto.randomUUID(),
      now: () => new Date('2026-01-15T12:00:00.000Z'),
    });
  });

  it('stores observation for witness NPC, not for player', () => {
    const hook = createPerceptionHook(stores, { playerEntityId: 'player_you' });
    const world = makeWorld(3);
    const event = makeEvent({
      verb: 'take',
      actorId: 'player_you',
      targetIds: ['item_bread'],
      tick: 3,
      witnessedBy: ['player_you', 'npc_wren'],
    });
    hook.run(makeArgs(world, [event]));

    const wrenMems = stores.memories.retrieve({ npcId: 'npc_wren', limit: 10 });
    expect(wrenMems).toHaveLength(1);
    expect(wrenMems[0]!.type).toBe('observation');
    expect(wrenMems[0]!.text).toBe('Wren saw You pick up bread loaf');
    expect(wrenMems[0]!.subjects).toEqual(['player_you', 'item_bread']);

    const playerMems = stores.memories.retrieve({ npcId: 'player_you', limit: 10 });
    expect(playerMems).toHaveLength(0);
  });

  it('skips move observations', () => {
    const hook = createPerceptionHook(stores, { playerEntityId: 'player_you' });
    const world = makeWorld(4);
    const event = makeEvent({
      verb: 'move',
      actorId: 'player_you',
      tick: 4,
      witnessedBy: ['npc_wren'],
    });
    hook.run(makeArgs(world, [event]));
    expect(stores.memories.retrieve({ npcId: 'npc_wren', limit: 10 })).toHaveLength(0);
  });

  it('skips actorless events', () => {
    const hook = createPerceptionHook(stores, { playerEntityId: 'player_you' });
    const world = makeWorld(5);
    const event = makeEvent({
      verb: 'emote',
      actorId: null as unknown as string,
      witnessedBy: ['npc_wren'],
    });
    // Force null actor
    (event as { actorId: string | null }).actorId = null;
    hook.run(makeArgs(world, [event]));
    expect(stores.memories.retrieve({ npcId: 'npc_wren', limit: 10 })).toHaveLength(0);
  });

  it('enqueues reflection when importance since reflection exceeds 25', () => {
    const hook = createPerceptionHook(stores, { playerEntityId: 'player_you' });
    const world = makeWorld(10);

    // die=9 → need 3 dies to exceed 25
    for (let i = 0; i < 3; i++) {
      const event = makeEvent({
        id: `die_${i}`,
        verb: 'die',
        actorId: 'npc_bram_ghost',
        tick: 10 + i,
        witnessedBy: ['npc_wren'],
      });
      world.entities.set('npc_bram_ghost', {
        id: 'npc_bram_ghost',
        kind: 'npc',
        name: 'Bram',
        components: new Map(),
      });
      hook.run(makeArgs(world, [event]));
    }

    expect(stores.memories.importanceSinceReflection('npc_wren')).toBe(0);
    const jobs = stores.jobs.claim(10, 5);
    expect(jobs.some((j) => j.kind === 'reflection' && j.npcId === 'npc_wren')).toBe(true);
  });
});
