# @llmrpg/client

Phase 0 browser client for llmrpg. A dark fantasy-terminal chat UI to talk with the placeholder NPC **Bram the Gatekeeper** through the full three-process pipeline.

## Run

From the monorepo root (starts SkillShop, the llmrpg server, and this Vite client):

```bash
npm run dev
```

Or from this package after workspace deps are installed:

```bash
npm run dev -w @llmrpg/client
```

Client listens on **http://localhost:4001**.

## Proxy topology

Vite proxies same-origin `/api/*` so the browser never talks cross-origin:

| Path | Target | Purpose |
|------|--------|---------|
| `/api/agent` | SkillShop `:5173` | Agent execute-stream + SSE |
| `/api/chat` | SkillShop `:5173` | Chat APIs |
| `/api/auth` | SkillShop `:5173` | Auth |
| `/api/settings` | SkillShop `:5173` | Settings |
| `/api/*` (catch-all) | llmrpg server `:4002` | Game APIs (e.g. `/api/health`) |

Order matters: SkillShop-specific prefixes are registered before the catch-all.

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run check` — TypeScript (`tsc`)
- `npm run preview` — preview production build
