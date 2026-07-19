import type { GameEvent } from '@llmrpg/shared';
import type { WorldState } from '../engine/state';
import type { WorldTurnHook } from '../engine/world';
import type { CognitionStores } from './api';
import { getStoresDb } from './gossip';
import { notePeopleMet } from './stores';

const SKIP_VERBS = new Set(['move', 'wait']);

const IMPORTANCE: Record<string, number> = {
  die: 9,
  attack: 7,
  give: 4,
  talk: 4,
  emote: 4,
  take: 3,
  drop: 3,
};

const REFLECTION_THRESHOLD = 25;

export interface PerceptionHookDeps {
  playerEntityId: string;
}

function entityDisplayName(world: WorldState, id: string | null): string {
  if (!id) return 'someone';
  return world.entities.get(id)?.name ?? id;
}

function verbPhrase(verb: string, actorName: string, targetNames: string[]): string {
  const target = targetNames.length > 0 ? targetNames.join(' and ') : null;
  switch (verb) {
    case 'die':
      return `${actorName} die`;
    case 'attack':
      return target ? `${actorName} attack ${target}` : `${actorName} attack`;
    case 'give':
      return target ? `${actorName} give ${target}` : `${actorName} give something`;
    case 'talk':
      return target ? `${actorName} talk to ${target}` : `${actorName} talk`;
    case 'emote':
      return target ? `${actorName} emote toward ${target}` : `${actorName} emote`;
    case 'take':
      return target ? `${actorName} pick up ${target}` : `${actorName} pick something up`;
    case 'drop':
      return target ? `${actorName} drop ${target}` : `${actorName} drop something`;
    default:
      return target ? `${actorName} ${verb} ${target}` : `${actorName} ${verb}`;
  }
}

function observationText(
  world: WorldState,
  witnessId: string,
  event: GameEvent,
): string {
  const witnessName = entityDisplayName(world, witnessId);
  const actorName = entityDisplayName(world, event.actorId);
  const targetNames = event.targetIds.map((id) => entityDisplayName(world, id));
  const phrase = verbPhrase(event.verb, actorName, targetNames);
  return `${witnessName} saw ${phrase}`;
}

function importanceFor(verb: string): number {
  return IMPORTANCE[verb] ?? 2;
}

function eventInvolvesPlayer(event: GameEvent, playerEntityId: string): boolean {
  if (event.actorId === playerEntityId) return true;
  return event.targetIds.includes(playerEntityId);
}

/**
 * Perception turn hook: witnesses gain observation memories; reflection jobs
 * enqueue when importance since last reflection exceeds the threshold.
 * Skips move/wait observations to control volume.
 */
export function createPerceptionHook(
  stores: CognitionStores,
  deps: PerceptionHookDeps,
): WorldTurnHook {
  return {
    name: 'perception',
    run(ctx) {
      const { playerEntityId } = deps;
      const tick = ctx.world.tick;
      const db = getStoresDb(stores);

      for (const event of ctx.events) {
        if (!event.actorId) continue;
        if (SKIP_VERBS.has(event.verb)) continue;

        const importance = importanceFor(event.verb);
        const subjects = [event.actorId, ...event.targetIds];
        const involvesPlayer = eventInvolvesPlayer(event, playerEntityId);

        for (const witnessId of event.witnessedBy) {
          if (witnessId === playerEntityId) continue;

          const text = observationText(ctx.world, witnessId, event);
          stores.memories.append({
            npcId: witnessId,
            tick: event.tick,
            type: 'observation',
            text,
            subjects,
            importance,
          });

          if (involvesPlayer && db) {
            notePeopleMet(db, witnessId, playerEntityId, event.tick);
          }

          if (stores.memories.importanceSinceReflection(witnessId) > REFLECTION_THRESHOLD) {
            stores.jobs.enqueue('reflection', witnessId, {}, tick);
            stores.memories.markReflected(witnessId);
          }
        }
      }
    },
  };
}
