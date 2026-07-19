import { gameTime, type GameAction } from '@llmrpg/shared';
import type { Persona } from '../world/personas';
import { FOV_RADIUS, fov } from './fov';
import { chebyshev, getComponent } from './state';
import type { WorldTurnHook } from './world';

export interface ReflexHookDeps {
  personas: Persona[];
  playerEntityId: string;
  /** Returns [0,1). Used for the 2% visible-bark chance. */
  rng?: () => number;
}

function sign(n: number): number {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/**
 * One greedy step toward (tx, ty): prefer the axis of larger delta, then the
 * other axis, then diagonal. Rejections are ignored (caller handles).
 */
function greedyStepDeltas(
  x: number,
  y: number,
  tx: number,
  ty: number,
): Array<{ dx: number; dy: number }> {
  const adx = tx - x;
  const ady = ty - y;
  if (adx === 0 && ady === 0) return [];

  const sx = sign(adx);
  const sy = sign(ady);
  const absX = Math.abs(adx);
  const absY = Math.abs(ady);

  const deltas: Array<{ dx: number; dy: number }> = [];
  const pushUnique = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    if (!deltas.some((d) => d.dx === dx && d.dy === dy)) {
      deltas.push({ dx, dy });
    }
  };

  if (absX >= absY) {
    pushUnique(sx, 0);
    pushUnique(0, sy);
  } else {
    pushUnique(0, sy);
    pushUnique(sx, 0);
  }
  pushUnique(sx, sy);
  return deltas;
}

/**
 * Reflex tier (DESIGN §6.2 / §7.6): schedule movement + FOV-triggered barks.
 * No LLM. Runs once per player turn after the player's action applies.
 */
export function createReflexHook(deps: ReflexHookDeps): WorldTurnHook {
  const rng = deps.rng ?? Math.random;
  const previouslyVisible = new Map<string, true>();

  return {
    name: 'reflex',
    run(ctx) {
      const player = ctx.world.entities.get(deps.playerEntityId);
      const playerPos = player ? getComponent(player, 'Position') : undefined;
      if (!playerPos) return;

      const phase = gameTime(ctx.world.tick).phase;

      // (a) Schedule-move: one greedy step toward the phase target.
      for (const persona of deps.personas) {
        const entity = ctx.world.entities.get(persona.entityId);
        if (!entity) continue;
        if (getComponent(entity, 'Dead')) continue;
        const pos = getComponent(entity, 'Position');
        if (!pos) continue;

        const slot = persona.schedule[phase];
        if (pos.x === slot.x && pos.y === slot.y) continue;

        for (const { dx, dy } of greedyStepDeltas(pos.x, pos.y, slot.x, slot.y)) {
          const action: GameAction = { verb: 'move', dx, dy };
          const result = ctx.applyNpcAction(persona.entityId, action);
          if (result.ok) break;
        }
      }

      // (b) Visibility + barks (after movement).
      const visible = fov(
        ctx.world.terrain,
        ctx.world.mapWidth,
        ctx.world.mapHeight,
        playerPos.x,
        playerPos.y,
        FOV_RADIUS,
      );

      type BarkCandidate = {
        entityId: string;
        persona: Persona;
        dist: number;
      };
      const candidates: BarkCandidate[] = [];

      for (const persona of deps.personas) {
        const entity = ctx.world.entities.get(persona.entityId);
        if (!entity) continue;
        if (getComponent(entity, 'Dead')) continue;
        const pos = getComponent(entity, 'Position');
        if (!pos) continue;

        const idx = pos.y * ctx.world.mapWidth + pos.x;
        const isVisible = visible.has(idx);
        const wasVisible = previouslyVisible.has(persona.entityId);

        if (!isVisible) {
          previouslyVisible.delete(persona.entityId);
          continue;
        }

        const newlyVisible = !wasVisible;
        previouslyVisible.set(persona.entityId, true);

        const rollBark = newlyVisible || rng() < 0.02;
        if (!rollBark) continue;
        if (persona.barks.length === 0) continue;

        candidates.push({
          entityId: persona.entityId,
          persona,
          dist: chebyshev(playerPos.x, playerPos.y, pos.x, pos.y),
        });
      }

      if (candidates.length === 0) return;

      candidates.sort((a, b) => {
        if (a.dist !== b.dist) return a.dist - b.dist;
        return a.entityId.localeCompare(b.entityId);
      });
      const chosen = candidates[0]!;
      const barkIdx = ctx.world.tick % chosen.persona.barks.length;
      const bark = chosen.persona.barks[barkIdx]!;
      const entity = ctx.world.entities.get(chosen.entityId)!;

      const emoteResult = ctx.applyNpcAction(chosen.entityId, {
        verb: 'emote',
        text: bark,
      });
      if (!emoteResult.ok) return;

      // (c) Log only witnessed emotes from this hook's applyNpcAction calls.
      for (const event of emoteResult.events) {
        if (event.verb !== 'emote') continue;
        if (!event.witnessedBy.includes(deps.playerEntityId)) continue;
        ctx.log.push({
          tick: event.tick,
          text: `${entity.name}: "${bark}"`,
          tone: 'dialogue',
        });
      }
    },
  };
}
