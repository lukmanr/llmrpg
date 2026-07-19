import { z } from 'zod';

/**
 * Acting-entity context (DESIGN.md §3.2).
 *
 * Every agent execution carries this block in its `context`, and every tool
 * call receives it back in the tool input under the `_llmrpg` key. Tool
 * endpoints authorize against it — SkillShop's X-SkillShop-* headers identify
 * the *user*, never the acting game entity.
 */
export const AgentRoleSchema = z.enum(['npc', 'director', 'weaver', 'lore_master', 'system']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const CognitionTierSchema = z.enum(['reflex', 'converse', 'deliberate']);
export type CognitionTier = z.infer<typeof CognitionTierSchema>;

export const ActingContextSchema = z.object({
  actingEntityId: z.string().min(1),
  agentRole: AgentRoleSchema,
  cognitionTier: CognitionTierSchema.optional(),
  sceneId: z.string().optional(),
  worldId: z.string().min(1),
  /** Idempotency key: tool handlers must be safe under retry of the same key. */
  idempotencyKey: z.string().min(1),
});
export type ActingContext = z.infer<typeof ActingContextSchema>;

/** Key under which the acting context travels inside tool inputs. */
export const ACTING_CONTEXT_KEY = '_llmrpg' as const;
