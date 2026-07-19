# `@llmrpg/server`

The llmrpg game server (Phase 0). Owns tool HTTP callbacks that SkillShop invokes during agent execution. Listens on port `4002` (`PORTS.LLMRPG_SERVER`; override with `LLMRPG_PORT`).

## Scripts

- `npm run dev` — `tsx watch` for local development
- `npm start` — run once
- `npm run check` — TypeScript check
- `npm test` — vitest

## SkillShop registration

On boot, after listen, the server calls `registerWithSkillShop()`:

1. `POST {SKILLSHOP_URL}/api/tools/register-http` — registers `world_look` pointing at `/api/tools/world-look`
2. `POST {SKILLSHOP_URL}/api/agent/agents/register` — registers the Bram placeholder NPC with that tool enabled

Registration retries up to 30 times (2s apart) so SkillShop can finish booting. Failure is logged; the server keeps running.

## Tool conventions (DESIGN.md §3.2)

1. **Acting-entity context** — SkillShop `X-SkillShop-*` headers identify the *user*. The acting game entity arrives under `_llmrpg` in the tool input (`ActingContextSchema`). Handlers log both and authorize against the context block, not headers alone. Invalid context returns HTTP 200 with `{ error }` (SkillShop expects JSON errors).

2. **Idempotency** — Prefer `context.idempotencyKey`, else `X-SkillShop-Request-Id`. Cached results are returned on retry without re-execution. Phase 0 uses an in-memory map; Phase 2 will use a durable job table.
