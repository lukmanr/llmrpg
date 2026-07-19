import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { ensureCognitionSchema } from './cognition/schema';
import { createCognitionStores } from './cognition/stores';
import { createPerceptionHook } from './cognition/perception';
import { createPromiseHook } from './cognition/promises-hook';
import { createReceiptDrainHook } from './cognition/receipts-hook';
import { enqueueGossipEvery } from './cognition/gossip';
import { createJobRunner } from './cognition/runner';
import type { CognitionStores } from './cognition/api';
import { seedCognitionFromPersonas } from './cognition/seed';
import { DialogueOrchestrator } from './dialogue/orchestrator';
import { createWorldDb, defaultWorldDbPath } from './engine/db';
import { createReflexHook } from './engine/reflex';
import { DEFAULT_PLAYTHROUGH_ID, PLAYER_ENTITY_ID, WorldService, type WorldServiceOptions, type WorldTurnHook } from './engine/world';
import { createGameRouter } from './routes/game';
import { createPhase2Router } from './routes/phase2';
import { createNpcToolsRouter } from './tools/npc-tools';
import { worldLookHandler } from './tools/world-look';
import { PERSONAS, personaFullSheet, personaSummaryFor } from './world/personas';

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
  /** Disable the background job runner (tests). */
  disableJobRunner?: boolean;
}

export interface AppHandles {
  app: Express;
  /** Started lazily with the world; stop() for clean shutdown. */
  stopJobRunner: () => void;
}

/** Express app factory — exported for tests (no listen). */
export function createApp(options: CreateAppOptions = {}): Express {
  return createAppWithHandles(options).app;
}

export function createAppWithHandles(options: CreateAppOptions = {}): AppHandles {
  const app = express();
  let stopJobRunner: () => void = () => {};

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

  // Lazy world + cognition init so Phase 0 routes/tests never open SQLite.
  let world: WorldService | undefined = options.world;
  let stores: CognitionStores | undefined;
  const getWorld = (): WorldService => {
    if (!world) {
      world = new WorldService({
        db: createWorldDb(options.worldDbPath ?? defaultWorldDbPath()),
        ...options.worldOptions,
      });
    }
    if (!stores) {
      stores = wireCognition(world, options, (stop) => {
        stopJobRunner = stop;
      });
    }
    return world;
  };
  const getStores = (): CognitionStores => {
    getWorld();
    return stores!;
  };

  app.use(createGameRouter(getWorld));

  // Phase 2: cognition-backed routes. Constructed lazily on first game call;
  // mount a deferring router so ordering does not matter.
  const phase2 = express.Router();
  phase2.use('/api/game', (req, res, next) => {
    const w = getWorld();
    const s = getStores();
    if (!phase2Inner) {
      const orchestrator = new DialogueOrchestrator({
        stores: s,
        world: w,
        personas: {
          fullSheet: (id) => personaFullSheet(id),
          summary: (id) => personaSummaryFor(id),
        },
        playthroughId: DEFAULT_PLAYTHROUGH_ID,
        playerEntityId: PLAYER_ENTITY_ID,
      });
      phase2Inner = createPhase2Router({
        stores: s,
        orchestrator,
        currentTick: () => w.loadWorldState().tick,
      });
      npcToolsInner = createNpcToolsRouter({
        stores: s,
        world: w,
        playerEntityId: PLAYER_ENTITY_ID,
      });
    }
    phase2Inner(req, res, next);
  });
  let phase2Inner: express.Router | undefined;
  let npcToolsInner: express.Router | undefined;
  app.use(phase2);
  app.use('/api/tools/npc', (req, res, next) => {
    getStores();
    if (!npcToolsInner) {
      return res.status(503).json({ error: 'NPC tools not ready' });
    }
    npcToolsInner(req, res, next);
  });

  return { app, stopJobRunner: () => stopJobRunner() };
}

/** Construct stores, register turn hooks, start the job runner. */
function wireCognition(
  world: WorldService,
  options: CreateAppOptions,
  onRunner: (stop: () => void) => void,
): CognitionStores {
  ensureCognitionSchema(world.db);
  const stores = createCognitionStores(world.db, {});
  seedCognitionFromPersonas(stores, PERSONAS);

  const gossipEnqueueHook: WorldTurnHook = {
    name: 'gossip-enqueue',
    run: (ctx) => enqueueGossipEvery(stores, ctx.world.tick, 30),
  };

  world.setTurnHooks([
    createReflexHook({ personas: PERSONAS, playerEntityId: PLAYER_ENTITY_ID }),
    createPerceptionHook(stores, { playerEntityId: PLAYER_ENTITY_ID }),
    createPromiseHook(stores),
    gossipEnqueueHook,
    createReceiptDrainHook(stores),
  ]);

  if (!options.disableJobRunner) {
    const runner = createJobRunner({
      stores,
      getWorldState: () => world.loadWorldState(),
      personaSummaryFor: (npcId) => personaSummaryFor(npcId) ?? npcId,
    });
    runner.start();
    onRunner(() => runner.stop());
  }

  return stores;
}
