/**
 * Thin SkillShop client for eval runners (register / stream / sync / poll).
 */

import { LLMRPG_LIBRARY, SKILLSHOP_URL } from '@llmrpg/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVAL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const EVAL_REPORT_DIR = path.join(EVAL_ROOT, '.dev/eval');

export const PROBE_TIMEOUT_MS = 60_000;
export const POLL_INTERVAL_MS = 1_000;

export interface RegisterAgentOpts {
  name: string;
  displayName: string;
  description: string;
  systemPromptTemplate: string;
  defaultModel: string;
  temperature?: number;
  maxTokens?: number;
}

export async function registerAgent(opts: RegisterAgentOpts): Promise<void> {
  const res = await fetch(`${SKILLSHOP_URL}/api/agent/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: opts.name,
      displayName: opts.displayName,
      description: opts.description,
      category: 'custom',
      library: LLMRPG_LIBRARY,
      defaultModel: opts.defaultModel,
      modelConfig: {
        temperature: opts.temperature ?? 0.3,
        maxTokens: opts.maxTokens ?? 1024,
      },
      enabledTools: [],
      memoryEnabled: false,
      isEnabledInSidebar: false,
      systemPromptTemplate: opts.systemPromptTemplate,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(
      `register ${opts.name} failed (${res.status}): ${await res.text()}`,
    );
  }
}

/** Streaming execute → poll status until completed (or timeout). */
export async function executeStreamAndWait(
  agentName: string,
  message: string,
  context: Record<string, unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string> {
  const res = await fetch(`${SKILLSHOP_URL}/api/agent/execute-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName, message, context }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `execute-stream ${agentName} failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    success?: boolean;
    data?: { executionId?: string };
  };
  const executionId = body.data?.executionId;
  if (!executionId) {
    throw new Error(`execute-stream ${agentName}: missing executionId`);
  }
  return pollExecution(executionId, timeoutMs);
}

export async function pollExecution(
  executionId: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(
      `${SKILLSHOP_URL}/api/agent/status/${executionId}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) continue;
    const body = (await res.json()) as {
      data?: {
        status?: string;
        result?: { response?: string; error?: string };
      };
    };
    const status = body.data?.status;
    if (status === 'completed') {
      const response = body.data?.result?.response ?? '';
      if (!response || response === 'No response generated') {
        throw new Error(`execution ${executionId}: empty response`);
      }
      return response;
    }
    if (status === 'failed') {
      throw new Error(
        `execution ${executionId} failed: ${body.data?.result?.error ?? 'unknown'}`,
      );
    }
  }
  throw new Error(`execution ${executionId} timed out after ${timeoutMs}ms`);
}

/** Synchronous agent execute (judge). */
export async function executeSync(
  agentName: string,
  message: string,
  context: Record<string, unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string> {
  const res = await fetch(`${SKILLSHOP_URL}/api/agent/agents/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName, message, context }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(
      `execute ${agentName} failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    success?: boolean;
    data?: { response?: string };
    error?: { message?: string };
  };
  if (!body.success || typeof body.data?.response !== 'string') {
    throw new Error(
      `execute ${agentName}: ${body.error?.message ?? 'missing data.response'}`,
    );
  }
  return body.data.response;
}

export function writeReport(prefix: string, data: unknown): string {
  mkdirSync(EVAL_REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(EVAL_REPORT_DIR, `${prefix}-${stamp}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

export function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function fmt(n: number | null, digits = 2): string {
  return n === null ? '—' : n.toFixed(digits);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
