import {
  ActionRequest,
  ActionRequestSchema,
  ActionResponse,
  ActionResponseSchema,
  CharacterCreateRequest,
  CharacterCreateRequestSchema,
  CharacterState,
  CharacterStateSchema,
  DialogueStartRequestSchema,
  DialogueState,
  DialogueStateSchema,
  DialogueTurnRequest,
  DialogueTurnRequestSchema,
  DialogueTurnResponse,
  DialogueTurnResponseSchema,
  GAME_API,
  Journal,
  JournalSchema,
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

/** GET /api/game/character */
export async function getCharacter(): Promise<CharacterState> {
  const response = await fetch(GAME_API.CHARACTER);
  const json = await readJson(response);
  return CharacterStateSchema.parse(json);
}

/** POST /api/game/character */
export async function createCharacter(req: CharacterCreateRequest): Promise<CharacterState> {
  const body = CharacterCreateRequestSchema.parse(req);
  const response = await fetch(GAME_API.CHARACTER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  return CharacterStateSchema.parse(json);
}

/** GET /api/game/journal */
export async function getJournal(): Promise<Journal> {
  const response = await fetch(GAME_API.JOURNAL);
  const json = await readJson(response);
  return JournalSchema.parse(json);
}

/** POST /api/game/dialogue/start */
export async function dialogueStart(
  targetId: string,
  options?: { earshot?: boolean },
): Promise<DialogueState> {
  const body = DialogueStartRequestSchema.parse({
    targetId,
    earshot: options?.earshot,
  });
  const response = await fetch(GAME_API.DIALOGUE_START, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  return DialogueStateSchema.parse(json);
}

/** POST /api/game/dialogue/turn */
export async function dialogueTurn(req: DialogueTurnRequest): Promise<DialogueTurnResponse> {
  const body = DialogueTurnRequestSchema.parse(req);
  const response = await fetch(GAME_API.DIALOGUE_TURN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  return DialogueTurnResponseSchema.parse(json);
}

/** GET /api/game/dialogue/state?dialogueId=… */
export async function dialogueState(dialogueId: string): Promise<DialogueState> {
  const url = `${GAME_API.DIALOGUE_STATE}?dialogueId=${encodeURIComponent(dialogueId)}`;
  const response = await fetch(url);
  const json = await readJson(response);
  return DialogueStateSchema.parse(json);
}
