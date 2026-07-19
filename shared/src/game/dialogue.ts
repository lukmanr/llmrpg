import { z } from 'zod';

/**
 * Hybrid dialogue (DESIGN §7.5): free text remains first-class; semantic acts
 * are accelerators that give the engine a reliable intent signal.
 * Phase 2: acts are chosen explicitly in the UI; unclassified free text is 'say'.
 */
export const DialogueActSchema = z.enum([
  'say',
  'ask',
  'accuse',
  'bargain',
  'promise',
  'comfort',
  'threaten',
  'reveal',
  'refuse',
  'farewell',
]);
export type DialogueAct = z.infer<typeof DialogueActSchema>;

export const DialogueStartRequestSchema = z.object({
  targetId: z.string(),
  /**
   * Spontaneous speech (typed into the always-on chat): the NPC only needs
   * to be within earshot (radius 4) rather than adjacent.
   */
  earshot: z.boolean().optional(),
});
export type DialogueStartRequest = z.infer<typeof DialogueStartRequestSchema>;

/** Earshot radius (Chebyshev) for spontaneous speech. */
export const EARSHOT_RADIUS = 4;

/** Conversation-discipline state exposed to the UI (DESIGN §6.4). */
export const DialogueStateSchema = z.object({
  dialogueId: z.string(),
  npcId: z.string(),
  npcName: z.string(),
  /** 0..100; at 0 the NPC ends the conversation. */
  patience: z.number(),
  /** -100..100 relationship-derived warmth. */
  rapport: z.number(),
  turns: z.number().int(),
  ended: z.boolean(),
  /** Set when the NPC ended the conversation (farewell text). */
  closingLine: z.string().optional(),
});
export type DialogueState = z.infer<typeof DialogueStateSchema>;

export const DialogueTurnRequestSchema = z.object({
  dialogueId: z.string(),
  act: DialogueActSchema,
  text: z.string().min(1).max(2000),
});
export type DialogueTurnRequest = z.infer<typeof DialogueTurnRequestSchema>;

/**
 * A turn kicks off a SkillShop streaming execution; the client streams the
 * reply from `sseUrl` (proxied) and afterwards refreshes DialogueState.
 */
export const DialogueTurnResponseSchema = z.object({
  executionId: z.string(),
  sseUrl: z.string(),
  state: DialogueStateSchema,
});
export type DialogueTurnResponse = z.infer<typeof DialogueTurnResponseSchema>;
