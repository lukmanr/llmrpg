import { z } from 'zod';
import {
  EntityViewSchema,
  LogLineSchema,
  PlayerViewSchema,
  TerrainSchema,
} from './types.js';
import { GameActionSchema } from './actions.js';
import { GameEventViewSchema } from './events.js';
import { ReceiptViewSchema } from './journal.js';

/**
 * Revision-stamped snapshot/delta protocol (DESIGN §4.2).
 *
 * - Every snapshot/response carries a monotonic world `revision`.
 * - The client submits actions against the revision it has rendered;
 *   a stale revision is rejected with `stale_revision` and the client
 *   recovers by fetching a fresh snapshot.
 * - `actionId` is the idempotency key: resubmitting the same actionId
 *   returns the recorded response without re-applying.
 * - Reconnect = GET snapshot. Turn-based Phase 1: all world changes are
 *   carried on action responses, so no push channel is needed yet.
 */
export const PROTOCOL_VERSION = 1;

/** Visibility payload: what the player currently sees (server-computed FOV). */
export const VisibleSetSchema = z.object({
  /** Flat indices (y * width + x) of tiles in the player's FOV. */
  tileIdx: z.array(z.number().int()),
  entities: z.array(EntityViewSchema),
});
export type VisibleSet = z.infer<typeof VisibleSetSchema>;

export const MapViewSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  /**
   * Explored-memory terrain, flat array length width*height;
   * null = never seen. Server persists explored per playthrough.
   */
  explored: z.array(TerrainSchema.nullable()),
});
export type MapView = z.infer<typeof MapViewSchema>;

export const SnapshotSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  worldId: z.string(),
  playthroughId: z.string(),
  revision: z.number().int(),
  tick: z.number().int(),
  map: MapViewSchema,
  visible: VisibleSetSchema,
  player: PlayerViewSchema,
  logTail: z.array(LogLineSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const ActionRequestSchema = z.object({
  actionId: z.string().min(1),
  revision: z.number().int(),
  action: GameActionSchema,
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/** Newly explored tiles, patched into the client's explored map. */
export const ExploredPatchSchema = z.object({
  idx: z.number().int(),
  terrain: TerrainSchema,
});
export type ExploredPatch = z.infer<typeof ExploredPatchSchema>;

export const WorldDeltaSchema = z.object({
  visible: VisibleSetSchema,
  exploredPatch: z.array(ExploredPatchSchema),
  player: PlayerViewSchema,
});
export type WorldDelta = z.infer<typeof WorldDeltaSchema>;

export const ActionErrorCodeSchema = z.enum([
  'stale_revision',
  'invalid_action',
  'blocked',
  'out_of_range',
  'not_found',
]);
export type ActionErrorCode = z.infer<typeof ActionErrorCodeSchema>;

export const ActionResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    revision: z.number().int(),
    tick: z.number().int(),
    events: z.array(GameEventViewSchema),
    log: z.array(LogLineSchema),
    delta: WorldDeltaSchema,
    /** Consequence receipts generated this turn (DESIGN §7.2). */
    receipts: z.array(ReceiptViewSchema).optional(),
  }),
  z.object({
    ok: z.literal(false),
    revision: z.number().int(),
    error: z.object({
      code: ActionErrorCodeSchema,
      message: z.string(),
    }),
  }),
]);
export type ActionResponse = z.infer<typeof ActionResponseSchema>;

/** REST surface (llmrpg server, proxied at the client under /api). */
export const GAME_API = {
  /** GET: create-or-resume the default playthrough; returns Snapshot. */
  SESSION: '/api/game/session',
  /** GET: fresh Snapshot for the current playthrough (reconnect path). */
  SNAPSHOT: '/api/game/snapshot',
  /** POST ActionRequest -> ActionResponse. */
  ACTIONS: '/api/game/actions',
  /** GET CharacterState / POST CharacterCreateRequest. */
  CHARACTER: '/api/game/character',
  /** GET Journal. */
  JOURNAL: '/api/game/journal',
  /** POST DialogueStartRequest -> DialogueState. */
  DIALOGUE_START: '/api/game/dialogue/start',
  /** POST DialogueTurnRequest -> DialogueTurnResponse. */
  DIALOGUE_TURN: '/api/game/dialogue/turn',
  /** GET ?dialogueId= -> DialogueState (refresh after a streamed reply). */
  DIALOGUE_STATE: '/api/game/dialogue/state',
} as const;
