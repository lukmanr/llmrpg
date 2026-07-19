#!/usr/bin/env bash
# Stop all llmrpg / SkillShop dev processes. Always exits 0.
set +e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="${REPO_ROOT}/.dev/pids"

PORTS=(4001 4002 5173)
PID_NAMES=(skillshop server client)

kill_pid_if_alive() {
  local pid="$1"
  local label="$2"
  if [[ -z "${pid}" ]]; then
    return 0
  fi
  if kill -0 "${pid}" 2>/dev/null; then
    echo "Killing ${label} (PID ${pid})"
    kill -9 "${pid}" 2>/dev/null || true
  else
    echo "PID file for ${label} is stale (PID ${pid} not running)"
  fi
}

echo "=== llmrpg kill-all-processes ==="

# 1. Kill by PID files first
for name in "${PID_NAMES[@]}"; do
  pid_file="${PID_DIR}/${name}.pid"
  if [[ -f "${pid_file}" ]]; then
    pid="$(cat "${pid_file}" 2>/dev/null | tr -d '[:space:]')"
    kill_pid_if_alive "${pid}" "${name}"
    rm -f "${pid_file}"
    echo "Removed PID file ${pid_file}"
  fi
done

# 2. Sweep known ports (xargs tolerates empty input on macOS/BSD)
for port in "${PORTS[@]}"; do
  pids="$(lsof -ti:"${port}" 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Killing process(es) on port ${port}: ${pids}"
  else
    echo "Port ${port}: nothing listening"
  fi
  lsof -ti:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
done

# 3. Remove any remaining stale PID files
if [[ -d "${PID_DIR}" ]]; then
  for pid_file in "${PID_DIR}"/*.pid; do
    [[ -e "${pid_file}" ]] || continue
    rm -f "${pid_file}"
    echo "Removed stale PID file ${pid_file}"
  done
fi

echo "Done."
exit 0
