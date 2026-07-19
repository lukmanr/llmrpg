import { z } from 'zod';

/** Player vows (DESIGN §7.8): commitments the Director must challenge, never resolve. */
export const VowViewSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(['active', 'kept', 'broken']),
  createdAtTick: z.number().int(),
});
export type VowView = z.infer<typeof VowViewSchema>;

/** Promises/appointments as tracked gameplay objects (DESIGN §7.3). */
export const PromiseViewSchema = z.object({
  id: z.string(),
  /** Human terms, e.g. "Meet Wren at the mill after dusk." */
  terms: z.string(),
  fromEntityId: z.string(),
  fromName: z.string(),
  toEntityId: z.string(),
  toName: z.string(),
  deadlineTick: z.number().int().nullable(),
  status: z.enum(['open', 'kept', 'broken', 'expired']),
  createdAtTick: z.number().int(),
});
export type PromiseView = z.infer<typeof PromiseViewSchema>;

/** Consequence receipts (DESIGN §7.2): event-grounded "Because you..." updates. */
export const ReceiptViewSchema = z.object({
  id: z.string(),
  tick: z.number().int(),
  text: z.string(),
  eventIds: z.array(z.string()),
});
export type ReceiptView = z.infer<typeof ReceiptViewSchema>;

/** Claims collected in dialogue, with provenance (DESIGN §7.4). */
export const ClaimViewSchema = z.object({
  id: z.string(),
  proposition: z.string(),
  aboutEntityIds: z.array(z.string()),
  sourceEntityId: z.string(),
  sourceName: z.string(),
  firsthand: z.boolean(),
  atTick: z.number().int(),
});
export type ClaimView = z.infer<typeof ClaimViewSchema>;

export const PersonViewSchema = z.object({
  entityId: z.string(),
  name: z.string(),
  archetype: z.string(),
  firstMetTick: z.number().int().nullable(),
  lastSeenTick: z.number().int().nullable(),
  /** Templated relationship summary, e.g. "Wary of you" / "Grateful". */
  disposition: z.string(),
  claims: z.array(ClaimViewSchema),
});
export type PersonView = z.infer<typeof PersonViewSchema>;

export const JournalSchema = z.object({
  vows: z.array(VowViewSchema),
  promises: z.array(PromiseViewSchema),
  receipts: z.array(ReceiptViewSchema),
  people: z.array(PersonViewSchema),
  claims: z.array(ClaimViewSchema),
});
export type Journal = z.infer<typeof JournalSchema>;

/** Character creation (Phase 2: name + vows; more in later phases). */
export const CharacterCreateRequestSchema = z.object({
  name: z.string().min(1).max(40),
  vows: z.array(z.string().min(3).max(200)).max(3),
});
export type CharacterCreateRequest = z.infer<typeof CharacterCreateRequestSchema>;

export const CharacterStateSchema = z.object({
  created: z.boolean(),
  name: z.string().optional(),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;
