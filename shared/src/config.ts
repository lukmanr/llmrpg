/**
 * Process topology constants (see docs/design/DESIGN.md §3.1).
 * Overridable via environment variables of the same name.
 */
export const PORTS = {
  CLIENT: 4001,
  LLMRPG_SERVER: 4002,
  SKILLSHOP: 5173,
} as const;

// This module is shared by node and browser code; read env without
// depending on node typings (in the browser `process` is undefined).
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

export const SKILLSHOP_URL =
  env.SKILLSHOP_URL ?? `http://localhost:${PORTS.SKILLSHOP}`;

export const LLMRPG_SERVER_URL =
  env.LLMRPG_SERVER_URL ?? `http://localhost:${PORTS.LLMRPG_SERVER}`;

/** Library tag for all llmrpg agents/tools registered in SkillShop. */
export const LLMRPG_LIBRARY = 'llmrpg';
