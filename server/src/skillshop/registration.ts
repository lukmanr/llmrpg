import {
  LLMRPG_LIBRARY,
  LLMRPG_SERVER_URL,
  NPC_PLACEHOLDER_AGENT,
  SKILLSHOP_URL,
  WORLD_LOOK_TOOL,
} from '@llmrpg/shared';
import { BRAM_PERSONA_PROMPT } from './prompts';

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerTool(): Promise<void> {
  const res = await fetch(`${SKILLSHOP_URL}/api/tools/register-http`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: WORLD_LOOK_TOOL,
      displayName: 'World Look',
      description:
        'Look at the surroundings or a specific target in the game world. Returns a description and visible entities.',
      category: 'llmrpg',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'What to look at; omit for general surroundings',
          },
        },
      },
      httpEndpoint: `${LLMRPG_SERVER_URL}/api/tools/world-look`,
      httpMethod: 'POST',
      timeoutMs: 15000,
      library: LLMRPG_LIBRARY,
      entityTypes: [
        { name: 'npc', displayName: 'NPC', iconHint: 'user' },
        { name: 'location', displayName: 'Location', iconHint: 'folder' },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`tool register failed (${res.status}): ${body}`);
  }
}

async function registerAgent(): Promise<void> {
  const res = await fetch(`${SKILLSHOP_URL}/api/agent/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: NPC_PLACEHOLDER_AGENT,
      displayName: 'Bram the Gatekeeper (placeholder)',
      description: 'Phase 0 placeholder NPC proving the three-process pipeline',
      // Must be one of SkillShop's AGENT_CATEGORIES (shared/schema/agents.ts);
      // llmrpg agents are grouped via `library` instead.
      category: 'custom',
      library: LLMRPG_LIBRARY,
      defaultModel: 'claude-4-5-haiku',
      modelConfig: { temperature: 0.7, maxTokens: 1024 },
      enabledTools: [WORLD_LOOK_TOOL],
      memoryEnabled: false,
      isEnabledInSidebar: false,
      systemPromptTemplate: BRAM_PERSONA_PROMPT,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`agent register failed (${res.status}): ${body}`);
  }
}

/**
 * Register the Phase 0 tool + NPC agent with SkillShop.
 * Retries while SkillShop may still be booting; never throws to the caller.
 */
export async function registerWithSkillShop(): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await registerTool();
      await registerAgent();
      console.log(
        `[skillshop] registration ok (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `[skillshop] registration failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${msg}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error(
    `[skillshop] gave up after ${MAX_ATTEMPTS} attempts; server continues without SkillShop registration`,
  );
  return false;
}
