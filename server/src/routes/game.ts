import {
  ActionRequestSchema,
  GAME_API,
  type ActionResponse,
  type Snapshot,
} from '@llmrpg/shared';
import { Router, type Request, type Response } from 'express';
import type { WorldService } from '../engine/world';

export function createGameRouter(getWorld: () => WorldService): Router {
  const router = Router();

  router.get(GAME_API.SESSION, (_req: Request, res: Response) => {
    try {
      const world = getWorld();
      const playthroughId = world.createOrResumePlaythrough();
      const snapshot: Snapshot = world.buildSnapshot(playthroughId);
      res.status(200).json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Session failed';
      res.status(500).json({ error: message });
    }
  });

  router.get(GAME_API.SNAPSHOT, (_req: Request, res: Response) => {
    try {
      const world = getWorld();
      const playthroughId = world.createOrResumePlaythrough();
      const snapshot: Snapshot = world.buildSnapshot(playthroughId);
      res.status(200).json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Snapshot failed';
      res.status(500).json({ error: message });
    }
  });

  router.post(GAME_API.ACTIONS, (req: Request, res: Response) => {
    try {
      const world = getWorld();
      const parsed = ActionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const response: ActionResponse = {
          ok: false,
          revision: world.loadWorldState().revision,
          error: {
            code: 'invalid_action',
            message: parsed.error.issues.map((i) => i.message).join('; '),
          },
        };
        res.status(200).json(response);
        return;
      }

      const playthroughId = world.createOrResumePlaythrough();
      const response = world.handleAction(playthroughId, parsed.data);
      res.status(200).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
