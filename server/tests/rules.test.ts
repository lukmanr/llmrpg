import { beforeEach, describe, expect, it } from 'vitest';
import { NPC_PLACEHOLDER_AGENT } from '@llmrpg/shared';
import { getComponent } from '../src/engine/state';
import { PLAYER_ENTITY_ID, WorldService } from '../src/engine/world';

function setPlayerPos(svc: WorldService, x: number, y: number): void {
  svc.db
    .prepare(
      `UPDATE components SET data = ? WHERE entity_id = ? AND kind = 'Position'`,
    )
    .run(JSON.stringify({ x, y }), PLAYER_ENTITY_ID);
}

describe('rules engine', () => {
  let worldSvc: WorldService;
  let playthroughId: string;

  beforeEach(() => {
    worldSvc = new WorldService({
      dbPath: ':memory:',
      rngForPlaythrough: () => () => 0.0, // attack damage = 1
    });
    playthroughId = worldSvc.createOrResumePlaythrough();
  });

  it('rejects move into a wall as blocked', () => {
    const rev = worldSvc.loadWorldState().revision;
    const result = worldSvc.handleAction(playthroughId, {
      actionId: 'move-wall',
      revision: rev,
      action: { verb: 'move', dx: 0, dy: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('blocked');
    }
  });

  it('move updates position and emits move event', () => {
    const worldBefore = worldSvc.loadWorldState();
    const posBefore = getComponent(
      worldBefore.entities.get(PLAYER_ENTITY_ID)!,
      'Position',
    )!;

    // East along the gate road — north is occupied by Bram (Blocker).
    const response = worldSvc.handleAction(playthroughId, {
      actionId: 'move-east-1',
      revision: worldBefore.revision,
      action: { verb: 'move', dx: 1, dy: 0 },
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.events.some((e) => e.verb === 'move')).toBe(true);
    expect(response.delta.player.x).toBe(posBefore.x + 1);
    expect(response.delta.player.y).toBe(posBefore.y);
  });

  it('take adjacent item puts it in inventory', () => {
    const coinPos = getComponent(
      worldSvc.loadWorldState().entities.get('item_copper_coin')!,
      'Position',
    )!;
    setPlayerPos(worldSvc, coinPos.x, coinPos.y + 1);

    const rev = worldSvc.loadWorldState().revision;
    const take = worldSvc.handleAction(playthroughId, {
      actionId: 'take-coin',
      revision: rev,
      action: { verb: 'take', itemId: 'item_copper_coin' },
    });
    expect(take.ok).toBe(true);
    if (!take.ok) return;
    expect(take.events.some((e) => e.verb === 'take')).toBe(true);
    expect(take.delta.player.inventory.map((i) => i.id)).toContain(
      'item_copper_coin',
    );
  });

  it('rejects take when item is distant', () => {
    const rev = worldSvc.loadWorldState().revision;
    const take = worldSvc.handleAction(playthroughId, {
      actionId: 'take-far',
      revision: rev,
      action: { verb: 'take', itemId: 'item_copper_coin' },
    });
    expect(take.ok).toBe(false);
    if (!take.ok) {
      expect(take.error.code).toBe('out_of_range');
    }
  });

  it('give transfers an inventory item to Bram', () => {
    // Player spawns adjacent to Bram at the gate.
    worldSvc.db
      .prepare(
        `DELETE FROM components WHERE entity_id = ? AND kind = 'Position'`,
      )
      .run('item_copper_coin');
    worldSvc.db
      .prepare(
        `UPDATE components SET data = ? WHERE entity_id = ? AND kind = 'Inventory'`,
      )
      .run(JSON.stringify({ itemIds: ['item_copper_coin'] }), PLAYER_ENTITY_ID);

    const rev = worldSvc.loadWorldState().revision;
    const give = worldSvc.handleAction(playthroughId, {
      actionId: 'give-bram',
      revision: rev,
      action: {
        verb: 'give',
        itemId: 'item_copper_coin',
        targetId: 'npc_bram',
      },
    });
    expect(give.ok).toBe(true);
    if (!give.ok) return;
    expect(give.events.some((e) => e.verb === 'give')).toBe(true);
    expect(give.delta.player.inventory.map((i) => i.id)).not.toContain(
      'item_copper_coin',
    );
    const bramInv = getComponent(
      worldSvc.loadWorldState().entities.get('npc_bram')!,
      'Inventory',
    );
    expect(bramInv?.itemIds).toContain('item_copper_coin');
  });

  it('attack cat until death emits die with causedBy chain; player witnesses', () => {
    const catPos = getComponent(
      worldSvc.loadWorldState().entities.get('creature_cat')!,
      'Position',
    )!;
    setPlayerPos(worldSvc, catPos.x + 1, catPos.y);

    let attackId: string | undefined;
    let dieRow: { caused_by: string; witnessed_by: string } | undefined;

    for (let i = 0; i < 3; i++) {
      const rev = worldSvc.loadWorldState().revision;
      const res = worldSvc.handleAction(playthroughId, {
        actionId: `atk-${i}`,
        revision: rev,
        action: { verb: 'attack', targetId: 'creature_cat' },
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const attack = res.events.find((e) => e.verb === 'attack');
      if (attack) attackId = attack.id;

      const die = res.events.find((e) => e.verb === 'die');
      if (die) {
        dieRow = worldSvc.db
          .prepare(`SELECT caused_by, witnessed_by FROM events WHERE id = ?`)
          .get(die.id) as { caused_by: string; witnessed_by: string };
      }
    }

    expect(dieRow).toBeDefined();
    expect(JSON.parse(dieRow!.caused_by)).toEqual([attackId]);
    expect(JSON.parse(dieRow!.witnessed_by)).toContain(PLAYER_ENTITY_ID);

    const deadCat = worldSvc.loadWorldState().entities.get('creature_cat')!;
    expect(getComponent(deadCat, 'Dead')).toEqual({});
    expect(getComponent(deadCat, 'Blocker')).toBeUndefined();
    expect(deadCat.name).toMatch(/\(dead\)/);
  });

  it('talk yields agentName event data', () => {
    const rev = worldSvc.loadWorldState().revision;
    const res = worldSvc.handleAction(playthroughId, {
      actionId: 'talk-bram',
      revision: rev,
      action: { verb: 'talk', targetId: 'npc_bram' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const talk = res.events.find((e) => e.verb === 'talk');
    expect(talk?.data).toEqual(
      expect.objectContaining({
        agentName: NPC_PLACEHOLDER_AGENT,
        displayName: 'Bram the Gatekeeper',
      }),
    );
  });

  it('use bread heals and consumes the item', () => {
    worldSvc.db
      .prepare(
        `DELETE FROM components WHERE entity_id = ? AND kind = 'Position'`,
      )
      .run('item_bread');
    worldSvc.db
      .prepare(
        `UPDATE components SET data = ? WHERE entity_id = ? AND kind = 'Inventory'`,
      )
      .run(JSON.stringify({ itemIds: ['item_bread'] }), PLAYER_ENTITY_ID);
    worldSvc.db
      .prepare(
        `UPDATE components SET data = ? WHERE entity_id = ? AND kind = 'Health'`,
      )
      .run(JSON.stringify({ hp: 5, maxHp: 10 }), PLAYER_ENTITY_ID);

    const rev = worldSvc.loadWorldState().revision;
    const res = worldSvc.handleAction(playthroughId, {
      actionId: 'use-bread',
      revision: rev,
      action: { verb: 'use', itemId: 'item_bread' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.delta.player.hp).toBe(7);
    expect(res.delta.player.inventory.map((i) => i.id)).not.toContain(
      'item_bread',
    );
    expect(worldSvc.loadWorldState().entities.has('item_bread')).toBe(false);
  });
});
