import { SKILLSHOP_URL } from '@llmrpg/shared';

export interface ExecuteAgentResult {
  response: string;
  toolsUsed: string[];
}

/**
 * Synchronous (non-streaming) SkillShop agent execution, used by
 * Deliberate-tier jobs (reflection, gossip rendering) where no user is
 * waiting on a stream. Template variables in the agent's system prompt are
 * filled from `context`.
 */
export async function executeAgent(
  agentName: string,
  message: string,
  context: Record<string, unknown> = {},
  timeoutMs = 60_000,
): Promise<ExecuteAgentResult> {
  const res = await fetch(`${SKILLSHOP_URL}/api/agent/agents/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName, message, context }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`executeAgent ${agentName} failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as {
    success: boolean;
    data?: { response?: string; toolsUsed?: string[] };
    error?: { message?: string };
  };
  if (!body.success || typeof body.data?.response !== 'string') {
    throw new Error(
      `executeAgent ${agentName} bad response: ${body.error?.message ?? 'missing data.response'}`,
    );
  }
  return {
    response: body.data.response,
    toolsUsed: body.data.toolsUsed ?? [],
  };
}
