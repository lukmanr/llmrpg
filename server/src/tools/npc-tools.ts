import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { CognitionStores } from '../cognition/api';
import type { WorldService } from '../engine/world';
import { resolveExecution, type ExecutionIdentity } from '../dialogue/registry';

/**
 * NPC tool endpoints (Phase 2, DESIGN §6.7). Called by SkillShop during
 * npc_actor executions. Identity is NEVER taken from model output: it is
 * resolved from the execution registry via the X-SkillShop-Session-Id
 * header (executionId for sessionless executions). Unresolvable identity
 * -> JSON error the model can read.
 */
export interface NpcToolsDeps {
  stores: CognitionStores;
  world: WorldService;
  playerEntityId: string;
}

const ShareClaimInput = z.object({
  proposition: z.string().min(3).max(400),
  about: z.array(z.string()).default([]),
  firsthand: z.boolean().default(false),
});

const MakePromiseInput = z.object({
  terms: z.string().min(3).max(300),
  /** In-game deadline in ticks-from-now; omit for open-ended. */
  deadline_in_ticks: z.number().int().positive().max(2400).optional(),
});

const UpdateRelationshipInput = z.object({
  trust: z.number().min(-10).max(10).optional(),
  affection: z.number().min(-10).max(10).optional(),
  fear: z.number().min(-10).max(10).optional(),
  note: z.string().min(2).max(200),
});

const MemorySearchInput = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(8),
});

function toolInput(req: Request): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  return body && typeof body === 'object' && 'input' in body ? body.input : body;
}

function identityFor(req: Request): ExecutionIdentity | null {
  return resolveExecution(req.header('X-SkillShop-Session-Id'));
}

function jsonError(res: Response, message: string): void {
  res.status(200).json({ error: message });
}

export function createNpcToolsRouter(deps: NpcToolsDeps): Router {
  const { stores, world, playerEntityId } = deps;
  const router = Router();

  router.post('/share-claim', (req, res) => {
    const identity = identityFor(req);
    if (!identity) return jsonError(res, 'No active dialogue for this execution.');
    const parsed = ShareClaimInput.safeParse(toolInput(req) ?? {});
    if (!parsed.success) return jsonError(res, parsed.error.message);

    const tick = world.loadWorldState().tick;
    // Resolve loose "about" strings to known entity ids by name when possible.
    const state = world.loadWorldState();
    const aboutIds = parsed.data.about.map((a) => {
      for (const e of state.entities.values()) {
        if (e.id === a || e.name.toLowerCase() === a.toLowerCase()) return e.id;
      }
      return a;
    });

    const claim = stores.claims.record({
      proposition: parsed.data.proposition,
      aboutEntityIds: aboutIds,
      sourceEntityId: identity.npcId,
      sourceName: identity.npcName,
      firsthand: parsed.data.firsthand,
      atTick: tick,
    });
    res.json({
      success: true,
      message: 'Claim shared with the traveler (recorded in their journal).',
      created: [{ id: claim.id, type: 'claim', name: truncate(claim.proposition, 60) }],
    });
  });

  router.post('/make-promise', (req, res) => {
    const identity = identityFor(req);
    if (!identity) return jsonError(res, 'No active dialogue for this execution.');
    const parsed = MakePromiseInput.safeParse(toolInput(req) ?? {});
    if (!parsed.success) return jsonError(res, parsed.error.message);

    const tick = world.loadWorldState().tick;
    const promise = stores.promises.create({
      fromEntityId: identity.npcId,
      toEntityId: playerEntityId,
      terms: parsed.data.terms,
      deadlineTick: parsed.data.deadline_in_ticks ? tick + parsed.data.deadline_in_ticks : null,
      atTick: tick,
    });
    stores.memories.append({
      npcId: identity.npcId,
      tick,
      type: 'promise',
      text: `I promised the traveler: ${parsed.data.terms}`,
      subjects: [playerEntityId],
      importance: 6,
    });
    stores.receipts.record({
      tick,
      text: `${identity.npcName} made you a promise: ${parsed.data.terms}`,
      eventIds: [],
    });
    res.json({
      success: true,
      message: 'Promise recorded. Keep it — or live with the consequences.',
      created: [{ id: promise.id, type: 'promise', name: truncate(promise.terms, 60) }],
    });
  });

  router.post('/update-relationship', (req, res) => {
    const identity = identityFor(req);
    if (!identity) return jsonError(res, 'No active dialogue for this execution.');
    const parsed = UpdateRelationshipInput.safeParse(toolInput(req) ?? {});
    if (!parsed.success) return jsonError(res, parsed.error.message);

    const tick = world.loadWorldState().tick;
    const { note, ...deltas } = parsed.data;
    stores.relationships.adjust(identity.npcId, playerEntityId, deltas, note, tick);
    res.json({ success: true, message: 'Noted.' });
  });

  router.post('/memory-search', (req, res) => {
    const identity = identityFor(req);
    if (!identity) return jsonError(res, 'No active dialogue for this execution.');
    const parsed = MemorySearchInput.safeParse(toolInput(req) ?? {});
    if (!parsed.success) return jsonError(res, parsed.error.message);

    const memories = stores.memories.retrieve({
      npcId: identity.npcId,
      text: parsed.data.query,
      limit: parsed.data.limit,
    });
    res.json({
      results: memories.map((m) => ({ type: m.type, tick: m.tick, text: m.text })),
      count: memories.length,
    });
  });

  return router;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
