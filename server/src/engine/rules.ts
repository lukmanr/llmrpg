import {
  TERRAIN_FLAGS,
  type ActionErrorCode,
  type GameAction,
  type GameEvent,
  type LogLine,
} from '@llmrpg/shared';
import { FOV_RADIUS, fov } from './fov';
import { renderEvents } from './log-render';
import { createSeededRng, rollInt, type Rng } from './rng';
import {
  chebyshev,
  entityAt,
  getComponent,
  removeComponent,
  setComponent,
  type EntityRecord,
  type PlaythroughState,
  type WorldState,
} from './state';

export type ApplySuccess = {
  ok: true;
  events: GameEvent[];
  log: LogLine[];
};

export type ApplyRejection = {
  ok: false;
  code: ActionErrorCode;
  message: string;
};

export type ApplyResult = ApplySuccess | ApplyRejection;

export interface ApplyActionOptions {
  actionId: string;
  rng?: Rng;
  now?: () => Date;
  newId?: () => string;
}

function reject(code: ActionErrorCode, message: string): ApplyRejection {
  return { ok: false, code, message };
}

/**
 * Validate and apply a player action against mutable world/playthrough state.
 * On success, mutates world (entities/components, revision, tick) and returns events + log.
 */
export function applyAction(
  world: WorldState,
  playthrough: PlaythroughState,
  action: GameAction,
  options: ApplyActionOptions,
): ApplyResult {
  const actor = world.entities.get(playthrough.playerEntityId);
  if (!actor) {
    return reject('invalid_action', 'Player entity missing');
  }

  const actorPos = getComponent(actor, 'Position');
  if (!actorPos) {
    return reject('invalid_action', 'Player has no position');
  }

  const rng = options.rng ?? createSeededRng(playthrough.id);
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  const revision = world.revision + 1;
  const tick = world.tick + 1;
  const causedByAction = [options.actionId];
  const events: GameEvent[] = [];

  const emit = (
    verb: string,
    args: {
      actorId: string | null;
      targetIds: string[];
      data?: Record<string, unknown>;
      causedBy?: string[];
      narrativeTags?: string[];
      location: { x: number; y: number };
    },
  ): GameEvent => {
    const id = newId();
    const event: GameEvent = {
      id,
      worldId: world.worldId,
      tick,
      revision,
      verb,
      actorId: args.actorId,
      targetIds: args.targetIds,
      data: args.data ?? {},
      causedBy: args.causedBy ?? causedByAction,
      witnessedBy: computeWitnesses(world, args.location.x, args.location.y),
      narrativeTags: args.narrativeTags ?? [],
      createdAt: now().toISOString(),
    };
    events.push(event);
    return event;
  };

  switch (action.verb) {
    case 'move': {
      const tx = actorPos.x + action.dx;
      const ty = actorPos.y + action.dy;
      if (tx < 0 || ty < 0 || tx >= world.mapWidth || ty >= world.mapHeight) {
        return reject('blocked', 'That way is out of bounds.');
      }
      const terrain = world.terrain[ty * world.mapWidth + tx];
      if (terrain === undefined || !TERRAIN_FLAGS[terrain].passable) {
        return reject('blocked', 'You cannot go that way.');
      }
      const blocker = entityAt(
        world,
        tx,
        ty,
        (e) => e.id !== actor.id && getComponent(e, 'Blocker') !== undefined,
      );
      if (blocker) {
        return reject('blocked', `${blocker.name} blocks the way.`);
      }
      setComponent(actor, 'Position', { x: tx, y: ty });
      emit('move', {
        actorId: actor.id,
        targetIds: [],
        data: { x: tx, y: ty, dx: action.dx, dy: action.dy },
        location: { x: tx, y: ty },
      });
      break;
    }

    case 'wait': {
      emit('wait', {
        actorId: actor.id,
        targetIds: [],
        location: { x: actorPos.x, y: actorPos.y },
      });
      break;
    }

    case 'take': {
      const item = world.entities.get(action.itemId);
      if (!item) return reject('not_found', 'There is no such item.');
      const itemComp = getComponent(item, 'Item');
      const itemPos = getComponent(item, 'Position');
      if (!itemComp || !itemPos) {
        return reject('not_found', 'That is not on the ground.');
      }
      if (!itemComp.carryable) {
        return reject('invalid_action', 'You cannot carry that.');
      }
      if (chebyshev(actorPos.x, actorPos.y, itemPos.x, itemPos.y) > 1) {
        return reject('out_of_range', 'That item is too far away.');
      }
      const inv = getComponent(actor, 'Inventory') ?? { itemIds: [] };
      inv.itemIds.push(item.id);
      setComponent(actor, 'Inventory', inv);
      removeComponent(item, 'Position');
      emit('take', {
        actorId: actor.id,
        targetIds: [item.id],
        data: { itemName: item.name },
        location: { x: actorPos.x, y: actorPos.y },
      });
      break;
    }

    case 'drop': {
      const inv = getComponent(actor, 'Inventory');
      if (!inv || !inv.itemIds.includes(action.itemId)) {
        return reject('not_found', 'You are not carrying that.');
      }
      const item = world.entities.get(action.itemId);
      if (!item) return reject('not_found', 'That item no longer exists.');
      inv.itemIds = inv.itemIds.filter((id) => id !== action.itemId);
      setComponent(actor, 'Inventory', inv);
      setComponent(item, 'Position', { x: actorPos.x, y: actorPos.y });
      emit('drop', {
        actorId: actor.id,
        targetIds: [item.id],
        data: { itemName: item.name },
        location: { x: actorPos.x, y: actorPos.y },
      });
      break;
    }

    case 'give': {
      const inv = getComponent(actor, 'Inventory');
      if (!inv || !inv.itemIds.includes(action.itemId)) {
        return reject('not_found', 'You are not carrying that.');
      }
      const item = world.entities.get(action.itemId);
      const target = world.entities.get(action.targetId);
      if (!item || !target) return reject('not_found', 'Target or item not found.');
      const targetPos = getComponent(target, 'Position');
      if (!targetPos) return reject('not_found', 'Target has no position.');
      if (chebyshev(actorPos.x, actorPos.y, targetPos.x, targetPos.y) > 1) {
        return reject('out_of_range', 'They are too far away.');
      }
      const targetInv = getComponent(target, 'Inventory');
      const canReceive = targetInv !== undefined || target.kind === 'npc';
      if (!canReceive) {
        return reject('invalid_action', 'You cannot give items to that.');
      }
      inv.itemIds = inv.itemIds.filter((id) => id !== action.itemId);
      setComponent(actor, 'Inventory', inv);
      const nextInv = targetInv ?? { itemIds: [] };
      nextInv.itemIds.push(item.id);
      setComponent(target, 'Inventory', nextInv);
      emit('give', {
        actorId: actor.id,
        targetIds: [item.id, target.id],
        data: { itemName: item.name, targetName: target.name },
        narrativeTags: ['social'],
        location: { x: actorPos.x, y: actorPos.y },
      });
      break;
    }

    case 'use': {
      const inv = getComponent(actor, 'Inventory');
      if (!inv || !inv.itemIds.includes(action.itemId)) {
        return reject('not_found', 'You are not carrying that.');
      }
      const item = world.entities.get(action.itemId);
      if (!item) return reject('not_found', 'That item no longer exists.');
      const itemComp = getComponent(item, 'Item');
      const kind = itemComp?.kind ?? 'item';

      if (kind === 'bread') {
        const health = getComponent(actor, 'Health');
        if (health) {
          health.hp = Math.min(health.maxHp, health.hp + 2);
          setComponent(actor, 'Health', health);
        }
        inv.itemIds = inv.itemIds.filter((id) => id !== action.itemId);
        setComponent(actor, 'Inventory', inv);
        world.entities.delete(item.id);
        emit('use', {
          actorId: actor.id,
          targetIds: [action.itemId],
          data: { itemKind: 'bread', effect: 'heal', amount: 2, itemName: item.name },
          location: { x: actorPos.x, y: actorPos.y },
        });
      } else if (kind === 'lantern') {
        emit('use', {
          actorId: actor.id,
          targetIds: [item.id],
          data: {
            itemKind: 'lantern',
            effect: 'flavor',
            itemName: item.name,
            flavor: 'The lantern glows warmly, pushing back the dusk.',
          },
          location: { x: actorPos.x, y: actorPos.y },
        });
      } else {
        emit('use', {
          actorId: actor.id,
          targetIds: [item.id],
          data: {
            itemKind: kind,
            effect: 'noop',
            itemName: item.name,
            flavor: `You fiddle with the ${item.name}, but nothing happens.`,
          },
          location: { x: actorPos.x, y: actorPos.y },
        });
      }
      break;
    }

    case 'attack': {
      const target = world.entities.get(action.targetId);
      if (!target) return reject('not_found', 'There is no such target.');
      const targetPos = getComponent(target, 'Position');
      const health = getComponent(target, 'Health');
      if (!targetPos || !health) {
        return reject('invalid_action', 'You cannot attack that.');
      }
      if (getComponent(target, 'Dead')) {
        return reject('invalid_action', 'It is already dead.');
      }
      if (chebyshev(actorPos.x, actorPos.y, targetPos.x, targetPos.y) > 1) {
        return reject('out_of_range', 'They are too far away.');
      }
      const damage = rollInt(rng, 1, 3);
      health.hp -= damage;
      setComponent(target, 'Health', health);

      const attackEvent = emit('attack', {
        actorId: actor.id,
        targetIds: [target.id],
        data: { damage, targetName: target.name, hp: health.hp },
        narrativeTags: ['violence'],
        location: { x: targetPos.x, y: targetPos.y },
      });

      if (health.hp <= 0) {
        health.hp = 0;
        setComponent(target, 'Health', health);
        removeComponent(target, 'Blocker');
        removeComponent(target, 'Talkable');
        setComponent(target, 'Dead', {});
        if (!target.name.endsWith(' (dead)')) {
          target.name = `${target.name} (dead)`;
        }
        emit('die', {
          actorId: target.id,
          targetIds: [target.id],
          data: { name: target.name },
          causedBy: [attackEvent.id],
          narrativeTags: ['violence'],
          location: { x: targetPos.x, y: targetPos.y },
        });
      }
      break;
    }

    case 'talk': {
      const target = world.entities.get(action.targetId);
      if (!target) return reject('not_found', 'There is no such person.');
      const talkable = getComponent(target, 'Talkable');
      const targetPos = getComponent(target, 'Position');
      if (!talkable || !targetPos) {
        return reject('invalid_action', 'They have nothing to say.');
      }
      if (chebyshev(actorPos.x, actorPos.y, targetPos.x, targetPos.y) > 1) {
        return reject('out_of_range', 'They are too far away.');
      }
      emit('talk', {
        actorId: actor.id,
        targetIds: [target.id],
        data: { agentName: talkable.agentName, displayName: target.name },
        narrativeTags: ['social'],
        location: { x: targetPos.x, y: targetPos.y },
      });
      break;
    }

    default: {
      const _exhaustive: never = action;
      return reject('invalid_action', `Unknown verb: ${JSON.stringify(_exhaustive)}`);
    }
  }

  world.revision = revision;
  world.tick = tick;

  const log = renderEvents(events, playthrough.playerEntityId, world);
  return { ok: true, events, log };
}

/**
 * Phase 1 approximation: compute FOV from the event tile; any entity with
 * Position standing on a visible tile (within radius) witnesses the event.
 */
export function computeWitnesses(
  world: WorldState,
  eventX: number,
  eventY: number,
): string[] {
  const visible = fov(
    world.terrain,
    world.mapWidth,
    world.mapHeight,
    eventX,
    eventY,
    FOV_RADIUS,
  );
  const witnesses: string[] = [];
  for (const e of world.entities.values()) {
    const pos = getComponent(e, 'Position');
    if (!pos) continue;
    const idx = pos.y * world.mapWidth + pos.x;
    if (visible.has(idx)) witnesses.push(e.id);
  }
  return witnesses;
}

/** Exported for tests that need to inspect entity helpers. */
export type { EntityRecord };
