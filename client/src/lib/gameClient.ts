import {
  ActionRequest,
  ActionRequestSchema,
  ActionResponse,
  ActionResponseSchema,
  GAME_API,
  Snapshot,
  SnapshotSchema,
} from '@llmrpg/shared';

export class GameApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(body || `Game API request failed (${status})`);
    this.name = 'GameApiError';
    this.status = status;
    this.body = body;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new GameApiError(response.status, text);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GameApiError(response.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
}

/** GET /api/game/session — create-or-resume default playthrough. */
export async function getSession(): Promise<Snapshot> {
  const response = await fetch(GAME_API.SESSION);
  const json = await readJson(response);
  return SnapshotSchema.parse(json);
}

/** GET /api/game/snapshot — fresh snapshot for reconnect. */
export async function getSnapshot(): Promise<Snapshot> {
  const response = await fetch(GAME_API.SNAPSHOT);
  const json = await readJson(response);
  return SnapshotSchema.parse(json);
}

/**
 * POST /api/game/actions. Generates actionId via crypto.randomUUID()
 * when the caller has not already set one.
 */
export async function submitAction(
  req: Omit<ActionRequest, 'actionId'> & { actionId?: string },
): Promise<ActionResponse> {
  const body: ActionRequest = ActionRequestSchema.parse({
    actionId: req.actionId ?? crypto.randomUUID(),
    revision: req.revision,
    action: req.action,
  });

  const response = await fetch(GAME_API.ACTIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  return ActionResponseSchema.parse(json);
}
