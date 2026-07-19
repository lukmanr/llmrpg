# Development

Local development runs three processes. Start them with `npm run dev` from the repo root.

## Prerequisites

- **Node.js 22+** (`engines.node` in the root `package.json`)
- Install workspace deps at the repo root: `npm install`
- Install SkillShop deps (git submodule): `cd skill-shop && npm install`
- LLM keys for SkillShop: either set `ANTHROPIC_API_KEY` in your environment, or create `skill-shop/.env.secrets` (the ensure script will write `.env.secrets` from `ANTHROPIC_API_KEY` if the file is missing)

Do not rely on the ensure script to install packages — it will exit with a clear error if `node_modules` is missing.

## Process topology

| Process | Port | Start command | Health |
|---------|------|---------------|--------|
| SkillShop (agent platform) | 5173 | `npm run dev:server` inside `skill-shop/` | `GET /api/health` (or any HTTP response if that 404s) |
| llmrpg server | 4002 | `npm run dev --workspace server` from root | `GET /api/health` |
| llmrpg client | 4001 | `npm run dev --workspace client` from root | any HTTP response |

The Vite client on **4001** proxies:

- `/api/agent`, `/api/chat`, `/api/auth`, `/api/settings` → SkillShop `:5173`
- `/api` (everything else) → llmrpg server `:4002`

Use the client URL (`http://localhost:4001`) as the primary entry point.

## Start / stop / status

```bash
# Start (or ensure) all three processes — idempotent
npm run dev
# equivalent: ./scripts/ensure-dev.sh

# Stop everything (PID files + port sweep)
npm run kill:all
# equivalent: ./scripts/kill-all-processes.sh

# One-line status per process
./scripts/dev-status.sh
```

`ensure-dev.sh` starts SkillShop first (initializes the SQLite DB if missing, handles `.env.secrets`), waits up to 120s for health, then the llmrpg server (30s), then the client (30s).

## Logs and PIDs

Under the repo root (gitignored via `.dev/`):

- Logs: `.dev/logs/skillshop.log`, `.dev/logs/server.log`, `.dev/logs/client.log`
- PIDs: `.dev/pids/skillshop.pid`, `.dev/pids/server.pid`, `.dev/pids/client.pid`

## SkillShop database

On first boot, if `skill-shop/data/skillshop.sqlite` does not exist, `ensure-dev.sh` runs `npm run db:init && npm run db:load` inside `skill-shop/`.

To re-initialize from scratch:

```bash
cd skill-shop && npm run db:refresh
```

## Troubleshooting

- **Port already in use** — run `npm run kill:all`, then `npm run dev` again.
- **SkillShop slow on first boot** — cold start (DB + Vite/server) can take up to ~2 minutes; `ensure-dev.sh` waits 120s and tails the log on timeout.
- **Registration retries in the server log** — the llmrpg server registers agents/tools with SkillShop and retries until SkillShop is ready. Start SkillShop first (or use `npm run dev`); retries should stop once `:5173` is healthy.
- **Missing deps** — `npm install` at repo root and again inside `skill-shop/`. The ensure script will not auto-install.
- **LLM failures from SkillShop** — confirm `skill-shop/.env.secrets` exists or `ANTHROPIC_API_KEY` is exported before starting.
