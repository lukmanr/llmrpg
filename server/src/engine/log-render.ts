import type { GameEvent, LogLine, LogTone } from '@llmrpg/shared';
import type { WorldState } from './state';

/**
 * Render causal events into human-readable log lines.
 * Second person when the actor is the player; otherwise use the actor name.
 */
export function renderEvents(
  events: readonly GameEvent[],
  playerEntityId: string,
  world: WorldState,
): LogLine[] {
  return events.map((event) => ({
    tick: event.tick,
    text: renderEventText(event, playerEntityId, world),
    tone: toneFor(event.verb),
  }));
}

function toneFor(verb: string): LogTone {
  if (verb === 'attack' || verb === 'die') return 'combat';
  if (verb === 'talk' || verb === 'emote') return 'dialogue';
  return 'info';
}

function actorLabel(
  event: GameEvent,
  playerEntityId: string,
  world: WorldState,
): { you: boolean; name: string } {
  if (event.actorId === playerEntityId) {
    return { you: true, name: 'You' };
  }
  if (event.actorId) {
    const e = world.entities.get(event.actorId);
    return { you: false, name: e?.name ?? 'Someone' };
  }
  return { you: false, name: 'Something' };
}

function entityName(world: WorldState, id: string | undefined, fallback: string): string {
  if (!id) return fallback;
  return world.entities.get(id)?.name ?? fallback;
}

function strData(event: GameEvent, key: string): string | undefined {
  const v = event.data[key];
  return typeof v === 'string' ? v : undefined;
}

function numData(event: GameEvent, key: string): number | undefined {
  const v = event.data[key];
  return typeof v === 'number' ? v : undefined;
}

function renderEventText(
  event: GameEvent,
  playerEntityId: string,
  world: WorldState,
): string {
  const actor = actorLabel(event, playerEntityId, world);
  const you = actor.you;

  switch (event.verb) {
    case 'move':
      return you ? 'You move.' : `${actor.name} moves.`;

    case 'wait':
      return you ? 'You wait.' : `${actor.name} waits.`;

    case 'take': {
      const item =
        strData(event, 'itemName') ??
        entityName(world, event.targetIds[0], 'something');
      return you
        ? `You pick up the ${item}.`
        : `${actor.name} picks up the ${item}.`;
    }

    case 'drop': {
      const item =
        strData(event, 'itemName') ??
        entityName(world, event.targetIds[0], 'something');
      return you
        ? `You drop the ${item}.`
        : `${actor.name} drops the ${item}.`;
    }

    case 'give': {
      const item =
        strData(event, 'itemName') ??
        entityName(world, event.targetIds[0], 'something');
      const target =
        strData(event, 'targetName') ??
        entityName(world, event.targetIds[1], 'someone');
      return you
        ? `You give the ${item} to ${target}.`
        : `${actor.name} gives the ${item} to ${target}.`;
    }

    case 'use': {
      const item =
        strData(event, 'itemName') ??
        entityName(world, event.targetIds[0], 'something');
      const effect = strData(event, 'effect');
      if (effect === 'heal') {
        const amount = numData(event, 'amount') ?? 2;
        return you
          ? `You eat the ${item} and recover ${amount} hp.`
          : `${actor.name} eats the ${item}.`;
      }
      const flavor = strData(event, 'flavor');
      if (flavor) return flavor;
      return you
        ? `You use the ${item}.`
        : `${actor.name} uses the ${item}.`;
    }

    case 'attack': {
      const target =
        strData(event, 'targetName') ??
        entityName(world, event.targetIds[0], 'someone');
      const damage = numData(event, 'damage') ?? 0;
      return you
        ? `You hit ${target} for ${damage} damage.`
        : `${actor.name} hits ${target} for ${damage} damage.`;
    }

    case 'die': {
      const name =
        strData(event, 'name') ??
        entityName(world, event.actorId ?? event.targetIds[0], 'Someone');
      const base = name.replace(/ \(dead\)$/, '');
      return `${base} dies.`;
    }

    case 'emote': {
      const text = strData(event, 'text') ?? '...';
      if (you) return text;
      return `${actor.name}: "${text}"`;
    }

    case 'talk': {
      const display =
        strData(event, 'displayName') ??
        entityName(world, event.targetIds[0], 'Someone');
      if (you) {
        return `You strike up a conversation with ${display}.`;
      }
      return `${actor.name} talks with ${display}.`;
    }

    default:
      return you ? `You ${event.verb}.` : `${actor.name} ${event.verb}s.`;
  }
}
