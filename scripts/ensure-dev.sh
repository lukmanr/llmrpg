#!/usr/bin/env bash
# Ensure the three-process llmrpg dev environment is running and healthy.
# Idempotent: skips any process whose health check already succeeds.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${REPO_ROOT}/.dev/logs"
PID_DIR="${REPO_ROOT}/.dev/pids"

SKILLSHOP_PORT=5173
SERVER_PORT=4002
CLIENT_PORT=4001

mkdir -p "${LOG_DIR}" "${PID_DIR}"

http_code() {
  local url="$1"
  local code
  # curl still writes 000 via -w on connection failure; ignore its exit status
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "${url}" 2>/dev/null)" || true
  if [[ -z "${code}" ]]; then
    echo "000"
  else
    echo "${code}"
  fi
}

is_skillshop_up() {
  local code
  code="$(http_code "http://localhost:${SKILLSHOP_PORT}/api/health")"
  if [[ "${code}" =~ ^[23][0-9][0-9]$ ]]; then
    return 0
  fi
  # /api/health may 404 on some SkillShop builds; any HTTP response means up
  if [[ "${code}" == "404" ]]; then
    local any
    any="$(http_code "http://localhost:${SKILLSHOP_PORT}/")"
    [[ "${any}" != "000" ]]
    return $?
  fi
  return 1
}

is_server_up() {
  local code
  code="$(http_code "http://localhost:${SERVER_PORT}/api/health")"
  [[ "${code}" =~ ^[23][0-9][0-9]$ ]]
}

is_client_up() {
  local code
  code="$(http_code "http://localhost:${CLIENT_PORT}/")"
  [[ "${code}" != "000" ]]
}

wait_for_health() {
  local name="$1"
  local check_fn="$2"
  local max_seconds="$3"
  local log_file="$4"
  local elapsed=0

  echo "Waiting for ${name} (up to ${max_seconds}s)..."
  while (( elapsed < max_seconds )); do
    if "${check_fn}"; then
      echo "${name} is healthy."
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "ERROR: ${name} failed to become healthy within ${max_seconds}s" >&2
  echo "---- last 20 lines of ${log_file} ----" >&2
  if [[ -f "${log_file}" ]]; then
    tail -n 20 "${log_file}" >&2 || true
  else
    echo "(log file not found)" >&2
  fi
  exit 1
}

require_node_modules() {
  local dir="$1"
  local label="$2"
  if [[ ! -d "${dir}/node_modules" ]]; then
    echo "ERROR: ${label} dependencies are missing (${dir}/node_modules not found)." >&2
    echo "Run: cd \"${dir}\" && npm install" >&2
    exit 1
  fi
}

ensure_skillshop_env_secrets() {
  local secrets_file="${REPO_ROOT}/skill-shop/.env.secrets"
  if [[ -f "${secrets_file}" ]]; then
    return 0
  fi
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" > "${secrets_file}"
    echo "Notice: wrote skill-shop/.env.secrets from ANTHROPIC_API_KEY in the environment."
  else
    echo "Warning: skill-shop/.env.secrets is missing and ANTHROPIC_API_KEY is unset." >&2
    echo "SkillShop may fail to call LLMs until you provide one of them." >&2
  fi
}

ensure_skillshop_db() {
  local db_file="${REPO_ROOT}/skill-shop/data/skillshop.sqlite"
  if [[ -f "${db_file}" ]]; then
    return 0
  fi
  echo "SkillShop SQLite DB missing; initializing (db:init && db:load)..."
  (
    cd "${REPO_ROOT}/skill-shop"
    npm run db:init
    npm run db:load
  )
}

start_skillshop() {
  require_node_modules "${REPO_ROOT}/skill-shop" "SkillShop"
  ensure_skillshop_db
  ensure_skillshop_env_secrets

  local log_file="${LOG_DIR}/skillshop.log"
  echo "Starting SkillShop on port ${SKILLSHOP_PORT}..."
  # Run from skill-shop/; nohup so the process survives this script exiting.
  nohup env \
    SKILLSHOP_SERVICE_MODE=true \
    VPS_ENABLED=false \
    MCP_ENABLED=false \
    DISABLE_AUTH=true \
    ALLOWED_ORIGINS=http://localhost:4001,http://localhost:4002 \
    LOG_LEVEL=info \
    npm --prefix "${REPO_ROOT}/skill-shop" run dev:server \
    >"${log_file}" 2>&1 &
  echo $! > "${PID_DIR}/skillshop.pid"
}

start_server() {
  require_node_modules "${REPO_ROOT}" "llmrpg (repo root)"

  local log_file="${LOG_DIR}/server.log"
  echo "Starting llmrpg server on port ${SERVER_PORT}..."
  nohup npm --prefix "${REPO_ROOT}" run dev --workspace server \
    >"${log_file}" 2>&1 &
  echo $! > "${PID_DIR}/server.pid"
}

start_client() {
  require_node_modules "${REPO_ROOT}" "llmrpg (repo root)"

  local log_file="${LOG_DIR}/client.log"
  echo "Starting llmrpg client on port ${CLIENT_PORT}..."
  nohup npm --prefix "${REPO_ROOT}" run dev --workspace client \
    >"${log_file}" 2>&1 &
  echo $! > "${PID_DIR}/client.pid"
}

echo "=== llmrpg ensure-dev ==="
echo "Repo root: ${REPO_ROOT}"
echo ""

# 1. SkillShop
if is_skillshop_up; then
  echo "SkillShop (port ${SKILLSHOP_PORT}): already running"
else
  start_skillshop
  wait_for_health "SkillShop" is_skillshop_up 120 "${LOG_DIR}/skillshop.log"
fi

# 2. llmrpg server
if is_server_up; then
  echo "llmrpg server (port ${SERVER_PORT}): already running"
else
  start_server
  wait_for_health "llmrpg server" is_server_up 30 "${LOG_DIR}/server.log"
fi

# 3. llmrpg client
if is_client_up; then
  echo "llmrpg client (port ${CLIENT_PORT}): already running"
else
  start_client
  wait_for_health "llmrpg client" is_client_up 30 "${LOG_DIR}/client.log"
fi

echo ""
echo "=== Dev environment ready ==="
echo "  SkillShop:  http://localhost:${SKILLSHOP_PORT}"
echo "  Server:     http://localhost:${SERVER_PORT}"
echo "  Client:     http://localhost:${CLIENT_PORT}"
echo ""
echo "Logs:"
echo "  ${LOG_DIR}/skillshop.log"
echo "  ${LOG_DIR}/server.log"
echo "  ${LOG_DIR}/client.log"
echo ""
echo "PIDs: ${PID_DIR}/*.pid"
