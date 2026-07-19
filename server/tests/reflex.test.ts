import { describe, expect, it } from 'vitest';
import { createReflexHook } from '../src/engine/reflex';
import { getComponent } from '../src/engine/state';
import { PLAYER_ENTITY_ID, WorldService } from '../src/engine/world';
import { LOCATIONS } from '../src/world/milltown';
import { PERSONAS, type Persona } from '../src/world/personas';

function setEntityPos(svc: WorldService, entityId: string, x: number, y: number): void {
  svc.db
    .prepare(
      `UPDATE components SET data = ? WHERE entity_id = ? AND kind = 'Position'`,
    )
    .run(JSON.stringify({ x, y }), entityId);
}

function stationaryPersona(base: Persona, x: number, y: number): Persona {
  const slot = { x, y, activity: 'holding still for the test' };
  return {
    ...base,
    schedule: {
      morning: slot,
      afternoon: slot,
      evening: slot,
      night: slot,
    },
  };
}

describe('reflex hook', () => {
  it('NPC takes one greedy step toward its schedule target', () => {
    const world = new WorldService({
      dbPath: ':memory:',
      rngForPlaythrough: () => () => 0.5,
      turnHooks: [
        createReflexHook({
          personas: PERSONAS,
          playerEntityId: PLAYER_ENTITY_ID,
          rng: () => 1,
        }),
      ],
    });
    const playthroughId = world.createOrResumePlaythrough();

    setEntityPos(world, 'npc_wren', LOCATIONS.farm.x, LOCATIONS.farm.y);
    const before = getComponent(
      world.loadWorldState().entities.get('npc_wren')!,
      'Position',
    )!;

    const rev = world.loadWorldState().revision;
    const res = world.handleAction(playthroughId, {
      actionId: 'reflex-step-1',
      revision: rev,
      action: { verb: 'wait' },
    });
    expect(res.ok).toBe(true);

    const after = getComponent(
      world.loadWorldState().entities.get('npc_wren')!,
      'Position',
    )!;
    const target = LOCATIONS.mill_yard;
    const distBefore = Math.max(
      Math.abs(before.x - target.x),
      Math.abs(before.y - target.y),
    );
    const distAfter = Math.max(
      Math.abs(after.x - target.x),
      Math.abs(after.y - target.y),
    );
    expect(distAfter).toBeLessThan(distBefore);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(after.x !== before.x || after.y !== before.y).toBe(true);
  });

  it('blocked NPC does not throw and stays put', () => {
    const osric = PERSONAS.find((p) => p.entityId === 'npc_osric')!;
    const trapped: Persona = {
      ...osric,
      schedule: {
        morning: { x: 0, y: 0, activity: 'impossible' },
        afternoon: { x: 0, y: 0, activity: 'impossible' },
        evening: { x: 0, y: 0, activity: 'impossible' },
        night: { x: 0, y: 0, activity: 'impossible' },
      },
    };

    const world = new WorldService({
      dbPath: ':memory:',
      rngForPlaythrough: () => () => 0.5,
      turnHooks: [
        createReflexHook({
          personas: [trapped],
          playerEntityId: PLAYER_ENTITY_ID,
          rng: () => 1,
        }),
      ],
    });
    const playthroughId = world.createOrResumePlaythrough();
    // Chapel NW interior corner: every greedy step toward (0,0) is a wall.
    const corner = { x: 4, y: 10 };
    setEntityPos(world, 'npc_osric', corner.x, corner.y);

    const rev = world.loadWorldState().revision;
    let res: ReturnType<WorldService['handleAction']> | undefined;
    expect(() => {
      res = world.handleAction(playthroughId, {
        actionId: 'reflex-blocked-1',
        revision: rev,
        action: { verb: 'wait' },
      });
    }).not.toThrow();
    expect(res?.ok).toBe(true);
    const pos = getComponent(
      world.loadWorldState().entities.get('npc_osric')!,
      'Position',
    )!;
    expect(pos).toEqual(corner);
  });

  it('emits a bark when an NPC enters player FOV', () => {
    const wren = PERSONAS.find((p) => p.entityId === 'npc_wren')!;
    // Same row as the player start; euclidean distance 10 > FOV_RADIUS 9.
    const perch = { x: 26, y: 22 };
    const persona = stationaryPersona(wren, perch.x, perch.y);

    const world = new WorldService({
      dbPath: ':memory:',
      rngForPlaythrough: () => () => 0.5,
      turnHooks: [
        createReflexHook({
          personas: [persona],
          playerEntityId: PLAYER_ENTITY_ID,
          rng: () => 1,
        }),
      ],
    });
    const playthroughId = world.createOrResumePlaythrough();
    setEntityPos(world, 'npc_wren', perch.x, perch.y);

    let rev = world.loadWorldState().revision;
    const wait = world.handleAction(playthroughId, {
      actionId: 'reflex-fov-wait',
      revision: rev,
      action: { verb: 'wait' },
    });
    expect(wait.ok).toBe(true);
    if (!wait.ok) return;
    expect(wait.events.filter((e) => e.verb === 'emote')).toHaveLength(0);
    rev = wait.revision;

    // Step east: distance becomes 9 → Wren enters FOV (road is clear of blockers).
    const enter = world.handleAction(playthroughId, {
      actionId: 'reflex-fov-enter',
      revision: rev,
      action: { verb: 'move', dx: 1, dy: 0 },
    });
    expect(enter.ok).toBe(true);
    if (!enter.ok) return;

    const emotes = enter.events.filter((e) => e.verb === 'emote');
    expect(emotes).toHaveLength(1);
    expect(emotes[0]!.actorId).toBe('npc_wren');
    expect(
      enter.log.filter((l) => l.tone === 'dialogue' && l.text.includes('Wren')),
    ).toHaveLength(1);
  });

  it('emits at most one bark per turn across all NPCs', () => {
    const world = new WorldService({
      dbPath: ':memory:',
      rngForPlaythrough: () => () => 0.5,
      turnHooks: [
        createReflexHook({
          personas: PERSONAS,
          playerEntityId: PLAYER_ENTITY_ID,
          rng: () => 1,
        }),
      ],
    });
    const playthroughId = world.createOrResumePlaythrough();
    const rev = world.loadWorldState().revision;
    const res = world.handleAction(playthroughId, {
      actionId: 'reflex-one-bark',
      revision: rev,
      action: { verb: 'wait' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.filter((e) => e.verb === 'emote')).toHaveLength(1);
  });

  it('NPC movement produces no log lines', () => {
    const osric = PERSONAS.find((p) => p.entityId === 'npc_osric')!;
    const world = new WorldService({
      dbPath: ':memory:',
      rngForPlaythrough: () => () => 0.5,
      turnHooks: [
        createReflexHook({
          personas: [osric],
          playerEntityId: PLAYER_ENTITY_ID,
          rng: () => 1,
        }),
      ],
    });
    const playthroughId = world.createOrResumePlaythrough();
    // Far from the gate player so the step cannot enter FOV this turn.
    setEntityPos(world, 'npc_osric', LOCATIONS.pond_path.x, LOCATIONS.pond_path.y);

    const rev = world.loadWorldState().revision;
    const res = world.handleAction(playthroughId, {
      actionId: 'reflex-silent-move',
      revision: rev,
      action: { verb: 'wait' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const after = getComponent(
      world.loadWorldState().entities.get('npc_osric')!,
      'Position',
    )!;
    expect(
      after.x !== LOCATIONS.pond_path.x || after.y !== LOCATIONS.pond_path.y,
    ).toBe(true);
    // Off-screen NPC moves are omitted from the client event list; log must stay silent.
    expect(res.log.some((l) => /moves/i.test(l.text))).toBe(false);
    expect(res.log.some((l) => l.text.includes('Osric'))).toBe(false);
    expect(res.events.some((e) => e.verb === 'emote')).toBe(false);
  });
});
