import { beforeEach, describe, expect, it } from 'vitest';
import { SnapshotSchema } from '@llmrpg/shared';
import { WorldService } from '../src/engine/world';

describe('WorldService', () => {
  let world: WorldService;
  let playthroughId: string;

  beforeEach(() => {
    world = new WorldService({
      dbPath: ':memory:',
      rngForPlaythrough: () => () => 0.5,
    });
    playthroughId = world.createOrResumePlaythrough();
  });

  it('buildSnapshot validates against SnapshotSchema', () => {
    const snap = world.buildSnapshot(playthroughId);
    expect(() => SnapshotSchema.parse(snap)).not.toThrow();
    expect(snap.protocolVersion).toBe(1);
    expect(snap.worldId).toBe('milltown');
    expect(snap.player.name).toBe('You');
    expect(snap.player.hp).toBe(10);
    expect(snap.map.explored.length).toBe(snap.map.width * snap.map.height);
  });

  it('rejects stale revision', () => {
    const snap = world.buildSnapshot(playthroughId);
    const res = world.handleAction(playthroughId, {
      actionId: 'stale-1',
      revision: snap.revision - 1,
      action: { verb: 'wait' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('stale_revision');
      expect(res.revision).toBe(snap.revision);
    }
  });

  it('same actionId returns identical response without double-applying', () => {
    const snap = world.buildSnapshot(playthroughId);
    const req = {
      actionId: 'idem-wait-1',
      revision: snap.revision,
      action: { verb: 'wait' as const },
    };
    const first = world.handleAction(playthroughId, req);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const mid = world.buildSnapshot(playthroughId);
    const second = world.handleAction(playthroughId, req);
    expect(second).toEqual(first);

    const after = world.buildSnapshot(playthroughId);
    expect(after.revision).toBe(mid.revision);
    expect(after.tick).toBe(mid.tick);
  });

  it('explored grows monotonically', () => {
    const snap0 = world.buildSnapshot(playthroughId);
    const explored0 = snap0.map.explored.filter((t) => t !== null).length;

    // Step east past Bram, then north toward the square to reveal new tiles.
    const path: Array<{ dx: number; dy: number }> = [
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: -1 },
    ];
    let revision = snap0.revision;
    for (let i = 0; i < path.length; i++) {
      const step = path[i]!;
      const res = world.handleAction(playthroughId, {
        actionId: `explore-${i}`,
        revision,
        action: { verb: 'move', dx: step.dx, dy: step.dy },
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      revision = res.revision;
    }

    const snap1 = world.buildSnapshot(playthroughId);
    const explored1 = snap1.map.explored.filter((t) => t !== null).length;
    expect(explored1).toBeGreaterThan(explored0);

    // Previously explored tiles remain explored
    for (let i = 0; i < snap0.map.explored.length; i++) {
      if (snap0.map.explored[i] !== null) {
        expect(snap1.map.explored[i]).toBe(snap0.map.explored[i]);
      }
    }
  });

  it('reconnect: second buildSnapshot returns explored memory', () => {
    let revision = world.buildSnapshot(playthroughId).revision;
    const path: Array<{ dx: number; dy: number }> = [
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: -1 },
    ];
    for (let i = 0; i < path.length; i++) {
      const step = path[i]!;
      const res = world.handleAction(playthroughId, {
        actionId: `recon-move-${i}`,
        revision,
        action: { verb: 'move', dx: step.dx, dy: step.dy },
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      revision = res.revision;
    }

    const first = world.buildSnapshot(playthroughId);
    const second = world.buildSnapshot(playthroughId);
    expect(second.map.explored).toEqual(first.map.explored);
    expect(second.revision).toBe(first.revision);
    expect(second.player).toEqual(first.player);
  });
});
