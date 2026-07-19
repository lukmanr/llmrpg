#!/usr/bin/env bash
# One-line status per llmrpg dev process.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="${REPO_ROOT}/.dev/pids"

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
  code="$(http_code "http://localhost:5173/api/health")"
  if [[ "${code}" =~ ^[23][0-9][0-9]$ ]]; then
    return 0
  fi
  if [[ "${code}" == "404" ]]; then
    local any
    any="$(http_code "http://localhost:5173/")"
    [[ "${any}" != "000" ]]
    return $?
  fi
  return 1
}

is_server_up() {
  local code
  code="$(http_code "http://localhost:4002/api/health")"
  [[ "${code}" =~ ^[23][0-9][0-9]$ ]]
}

is_client_up() {
  local code
  code="$(http_code "http://localhost:4001/")"
  [[ "${code}" != "000" ]]
}

read_pid() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "${pid_file}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "${pid}"
      return 0
    fi
  fi
  echo "-"
}

status_line() {
  local name="$1"
  local port="$2"
  local check_fn="$3"
  local pid_name="$4"
  local state="down"
  if "${check_fn}"; then
    state="up"
  fi
  local pid
  pid="$(read_pid "${pid_name}")"
  echo "${name}: port ${port} ${state} pid=${pid}"
}

status_line "SkillShop" 5173 is_skillshop_up skillshop
status_line "server" 4002 is_server_up server
status_line "client" 4001 is_client_up client
