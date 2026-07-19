import { z } from 'zod';

/**
 * Player/NPC actions (DESIGN §5.2): the only way world state changes.
 * The rules engine validates and applies; LLMs and clients merely propose.
 */
export const GameActionSchema = z.discriminatedUnion('verb', [
  z.object({
    verb: z.literal('move'),
    dx: z.number().int().min(-1).max(1),
    dy: z.number().int().min(-1).max(1),
  }),
  z.object({ verb: z.literal('wait') }),
  z.object({ verb: z.literal('take'), itemId: z.string() }),
  z.object({ verb: z.literal('drop'), itemId: z.string() }),
  z.object({ verb: z.literal('give'), itemId: z.string(), targetId: z.string() }),
  z.object({ verb: z.literal('use'), itemId: z.string() }),
  z.object({ verb: z.literal('attack'), targetId: z.string() }),
  z.object({ verb: z.literal('talk'), targetId: z.string() }),
]);
export type GameAction = z.infer<typeof GameActionSchema>;
export type GameVerb = GameAction['verb'];
