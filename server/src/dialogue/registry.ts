/**
 * Execution identity registry (DESIGN §3.2 acting-entity identity).
 *
 * SkillShop forwards X-SkillShop-Session-Id to HTTP tools; for sessionless
 * executions that header carries the executionId, which we learn
 * synchronously from the execute-stream response — before the LLM's first
 * tool call can arrive. Tool endpoints resolve the acting NPC here; they
 * never trust model-provided identity.
 */
export interface ExecutionIdentity {
  npcId: string;
  npcName: string;
  dialogueId: string;
  playthroughId: string;
  registeredAt: number;
}

const registry = new Map<string, ExecutionIdentity>();

export function registerExecution(executionId: string, identity: Omit<ExecutionIdentity, 'registeredAt'>): void {
  registry.set(executionId, { ...identity, registeredAt: Date.now() });
  // Opportunistic GC: drop entries older than 10 minutes.
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of registry) {
    if (value.registeredAt < cutoff) registry.delete(key);
  }
}

export function resolveExecution(executionId: string | null | undefined): ExecutionIdentity | null {
  if (!executionId) return null;
  return registry.get(executionId) ?? null;
}

export function unregisterExecution(executionId: string): void {
  registry.delete(executionId);
}
