import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createWorldDb, defaultWorldDbPath } from './engine/db';
import { WorldService, type WorldServiceOptions } from './engine/world';
import { createGameRouter } from './routes/game';
import { worldLookHandler } from './tools/world-look';

function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  console.log(`${req.method} ${req.path}`);
  next();
}

export interface CreateAppOptions {
  /** Injected World service (tests). */
  world?: WorldService;
  /** Path for the world SQLite DB; ignored if `world` is provided. */
  worldDbPath?: string;
  /** Extra WorldService options when constructing the default world. */
  worldOptions?: Omit<WorldServiceOptions, 'db' | 'dbPath'>;
}

/** Express app factory — exported for tests (no listen). */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(express.json());
  app.use(requestLogger);

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'llmrpg-server',
      time: new Date().toISOString(),
    });
  });

  app.post('/api/tools/world-look', worldLookHandler);

  // Lazy world init so Phase 0 routes/tests never open SQLite.
  let world: WorldService | undefined = options.world;
  const getWorld = (): WorldService => {
    if (!world) {
      world = new WorldService({
        db: createWorldDb(options.worldDbPath ?? defaultWorldDbPath()),
        ...options.worldOptions,
      });
    }
    return world;
  };

  app.use(createGameRouter(getWorld));

  return app;
}
