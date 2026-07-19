import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { worldLookHandler } from './tools/world-look';

function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  console.log(`${req.method} ${req.path}`);
  next();
}

/** Express app factory — exported for tests (no listen). */
export function createApp(): Express {
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

  return app;
}
