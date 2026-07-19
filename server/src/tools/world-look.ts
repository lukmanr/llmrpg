import type { Request, Response } from 'express';
import {
  ACTING_CONTEXT_KEY,
  ActingContextSchema,
  WorldLookInputSchema,
  type WorldLookResult,
} from '@llmrpg/shared';

export type WorldLookResponse = WorldLookResult & {
  referenced: WorldLookResult['entities'];
};

/**
 * In-memory idempotency cache for Phase 0.
 * TODO(phase-2): replace with durable job table in the world DB.
 */
export const worldLookIdempotencyCache = new Map<string, WorldLookResponse>();

/** Counts successful executions (cache misses). Exported for tests. */
export let worldLookExecutionCount = 0;

export function resetWorldLookState(): void {
  worldLookIdempotencyCache.clear();
  worldLookExecutionCount = 0;
}

const STUB_ENTITIES: WorldLookResult['entities'] = [
  { id: 'npc_bram', type: 'npc', name: 'Bram the Gatekeeper' },
  { id: 'loc_milltown_gate', type: 'location', name: 'Milltown Gate' },
];

const DEFAULT_DESCRIPTION =
  'Dusk settles over the gates of Milltown. A cobbled square opens before you; the old mill creaks on the far side, and a weathered noticeboard stands beside the gatehouse.';

function matchesTarget(
  target: string,
  entity: { id: string; name: string },
): boolean {
  const t = target.trim().toLowerCase();
  return (
    entity.id.toLowerCase() === t ||
    entity.name.toLowerCase() === t ||
    entity.name.toLowerCase().includes(t) ||
    t.includes(entity.name.toLowerCase())
  );
}

function buildResult(target: string | undefined): WorldLookResponse {
  let description = DEFAULT_DESCRIPTION;

  if (target) {
    const bram = STUB_ENTITIES[0]!;
    const gate = STUB_ENTITIES[1]!;
    if (matchesTarget(target, bram)) {
      description =
        'Bram the Gatekeeper leans on his spear by the Milltown gatehouse, a gruff figure in a worn cloak, watching the road as dusk deepens over the cobbled square.';
    } else if (matchesTarget(target, gate)) {
      description =
        'Milltown Gate is a stout timber-and-stone arch opening onto a cobbled square. Beyond, the mill turns slowly; a noticeboard flutters with scraps of parchment in the evening breeze.';
    }
  }

  return {
    description,
    entities: STUB_ENTITIES,
    referenced: STUB_ENTITIES,
  };
}

export function worldLookHandler(req: Request, res: Response): void {
  const skillShopHeaders = {
    userId: req.header('X-SkillShop-User-Id') ?? null,
    sessionId: req.header('X-SkillShop-Session-Id') ?? null,
    requestId: req.header('X-SkillShop-Request-Id') ?? null,
  };
  console.log('[world_look] skillshop headers', skillShopHeaders);

  const rawInput =
    req.body && typeof req.body === 'object' && 'input' in req.body
      ? req.body.input
      : req.body;

  const contextBlock =
    rawInput &&
    typeof rawInput === 'object' &&
    ACTING_CONTEXT_KEY in rawInput
      ? (rawInput as Record<string, unknown>)[ACTING_CONTEXT_KEY]
      : undefined;

  console.log('[world_look] acting context', contextBlock ?? null);

  if (contextBlock !== undefined) {
    const ctxParsed = ActingContextSchema.safeParse(contextBlock);
    if (!ctxParsed.success) {
      res.status(200).json({
        error: `Invalid ${ACTING_CONTEXT_KEY} context: ${ctxParsed.error.message}`,
      });
      return;
    }
  }

  const parsed = WorldLookInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    res.status(200).json({ error: parsed.error.message });
    return;
  }

  const input = parsed.data;
  const idempotencyKey =
    input[ACTING_CONTEXT_KEY]?.idempotencyKey ??
    skillShopHeaders.requestId ??
    null;

  if (idempotencyKey !== null) {
    const cached = worldLookIdempotencyCache.get(idempotencyKey);
    if (cached !== undefined) {
      console.log('[world_look] idempotent hit', idempotencyKey);
      res.status(200).json(cached);
      return;
    }
  }

  const result = buildResult(input.target);
  worldLookExecutionCount += 1;

  if (idempotencyKey !== null) {
    worldLookIdempotencyCache.set(idempotencyKey, result);
  }

  res.status(200).json(result);
}
