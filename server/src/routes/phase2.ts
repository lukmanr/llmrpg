import { Router } from 'express';
import {
  CharacterCreateRequestSchema,
  DialogueStartRequestSchema,
  DialogueTurnRequestSchema,
  type CharacterState,
} from '@llmrpg/shared';
import type { CognitionStores } from '../cognition/api';
import { DialogueError, type DialogueOrchestrator } from '../dialogue/orchestrator';

/** Character, journal, and dialogue routes (Phase 2). */
export function createPhase2Router(deps: {
  stores: CognitionStores;
  orchestrator: DialogueOrchestrator;
  currentTick: () => number;
}): Router {
  const { stores, orchestrator, currentTick } = deps;
  const router = Router();

  router.get('/character', (_req, res) => {
    const name = stores.profile.getName();
    const state: CharacterState = name ? { created: true, name } : { created: false };
    res.json(state);
  });

  router.post('/character', (req, res) => {
    const parsed = CharacterCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    stores.profile.setName(parsed.data.name);
    const tick = currentTick();
    for (const vow of parsed.data.vows) {
      stores.vows.create(vow, tick);
    }
    res.json({ created: true, name: parsed.data.name } satisfies CharacterState);
  });

  router.get('/journal', (_req, res) => {
    res.json(stores.buildJournal());
  });

  router.post('/dialogue/start', (req, res) => {
    const parsed = DialogueStartRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    try {
      res.json(orchestrator.start(parsed.data.targetId));
    } catch (err) {
      if (err instanceof DialogueError) {
        return res.status(err.code === 'not_found' ? 404 : 400).json({ error: err.message });
      }
      throw err;
    }
  });

  router.post('/dialogue/turn', async (req, res) => {
    const parsed = DialogueTurnRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    try {
      const { dialogueId, act, text } = parsed.data;
      res.json(await orchestrator.turn(dialogueId, act, text));
    } catch (err) {
      if (err instanceof DialogueError) {
        return res.status(err.code === 'not_found' ? 404 : 400).json({ error: err.message });
      }
      throw err;
    }
  });

  router.get('/dialogue/state', (req, res) => {
    const dialogueId = String(req.query.dialogueId ?? '');
    const state = orchestrator.getState(dialogueId);
    if (!state) return res.status(404).json({ error: 'No such conversation.' });
    res.json(state);
  });

  return router;
}
