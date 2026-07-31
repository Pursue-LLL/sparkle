#!/usr/bin/env bash
# Shared PRE-gate for install/upgrade: block core cold restart during Cursor marathon.
# Reads ~/.sparkle/marathon-core-restart-guard.json (preferred) or mihomo /connections fallback.
set -euo pipefail

MARATHON_GUARD_STATE_FILE="${HOME}/.sparkle/marathon-core-restart-guard.json"
MARATHON_GUARD_SOCK="${MARATHON_GUARD_MIHOMO_SOCK:-/tmp/sparkle-mihomo-api.sock}"
MARATHON_GUARD_CONN_THRESHOLD="${MARATHON_GUARD_CONN_THRESHOLD:-12}"
MARATHON_GUARD_STATE_MAX_AGE_SEC="${MARATHON_GUARD_STATE_MAX_AGE_SEC:-120}"
MARATHON_GUARD_SNAPSHOT_CLI="${MARATHON_GUARD_SNAPSHOT_CLI:-}"
MARATHON_GUARD_LAST_CURSOR_CONN=""

marathon_guard_log() {
  echo "[marathon-core-restart-guard] $*" >&2
}

marathon_guard_fail() {
  marathon_guard_log "FAIL: $*"
  marathon_guard_log "Wait until Cursor Agent streams end (cursor_conn=0), then retry install/upgrade."
  marathon_guard_log "SPARKLE_FORCE_CORE_RESTART only bypasses conn threshold when cursor_conn=0 — it cannot override marathon quiesce or active Agent streams."
  exit 1
}

marathon_guard_count_cursor_connections() {
  if [[ -n "${MARATHON_GUARD_ROOT:-}" && -x "${MARATHON_GUARD_ROOT}/node_modules/.bin/tsx" ]]; then
    local count=""
    if count="$("${MARATHON_GUARD_ROOT}/node_modules/.bin/tsx" "${MARATHON_GUARD_ROOT}/scripts/marathon-mihomo-connections-count.mts" 2>/dev/null)"; then
      echo "$count"
      return 0
    fi
  fi
  python3 - "$MARATHON_GUARD_SOCK" <<'PY'
import json, subprocess, sys

sock = sys.argv[1]
try:
    raw = subprocess.check_output(
        ["curl", "-s", "--max-time", "3", "--unix-socket", sock, "http://localhost/connections"],
        text=True,
    )
except subprocess.CalledProcessError as exc:
    print(f"curl_failed:{exc.returncode}", file=sys.stderr)
    sys.exit(2)

data = json.loads(raw)
connections = data.get("connections") or []
count = 0
for conn in connections:
    metadata = conn.get("metadata") or {}
    process_path = str(metadata.get("processPath") or "")
    process_name = str(metadata.get("process") or "")
    if "/Cursor.app/" in process_path or "/Cursor-3.1.15.app/" in process_path:
        count += 1
        continue
    for name in ("Cursor", "Cursor Helper", "Cursor Helper (Plugin)", "Cursor Helper (Renderer)"):
        if process_name == name or process_name.startswith(f"{name} "):
            count += 1
            break
print(count)
PY
}

marathon_guard_read_live_cursor_conn() {
  local cursor_conn=""
  if cursor_conn="$(marathon_guard_count_cursor_connections 2>/dev/null || true)"; then
    :
  else
    echo ""
    return 1
  fi
  if [[ -z "$cursor_conn" || "$cursor_conn" =~ ^curl_failed: ]]; then
    echo ""
    return 1
  fi
  echo "$cursor_conn"
}

marathon_guard_resolve_snapshot_cli() {
  if [[ -n "$MARATHON_GUARD_SNAPSHOT_CLI" && -f "$MARATHON_GUARD_SNAPSHOT_CLI" ]]; then
    echo "$MARATHON_GUARD_SNAPSHOT_CLI"
    return 0
  fi
  if [[ -n "${MARATHON_GUARD_ROOT:-}" && -x "${MARATHON_GUARD_ROOT}/node_modules/.bin/tsx" ]]; then
    echo "${MARATHON_GUARD_ROOT}/node_modules/.bin/tsx ${MARATHON_GUARD_ROOT}/scripts/lib/marathonInstallCursorConnSnapshotCli.ts"
    return 0
  fi
  echo ""
}

marathon_guard_write_pre_quit_snapshot() {
  local caller="${1:-install}"
  local cursor_conn="${2:-0}"
  local cli=""
  cli="$(marathon_guard_resolve_snapshot_cli)"
  [[ -n "$cli" ]] || marathon_guard_fail "snapshot cli missing — run from sparkle repo root"
  # shellcheck disable=SC2086
  $cli write "$caller" "$cursor_conn" >/dev/null
  marathon_guard_log "snapshot caller=$caller cursor_conn=$cursor_conn"
}

marathon_guard_assert_pre_quit_snapshot_idle() {
  local caller="${1:-install}"
  if [[ "${SPARKLE_OVERRIDE_P23_MARATHON_INSTALL:-}" == "1" ]]; then
    marathon_guard_log "WARN: SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 — skip pre-quit snapshot idle gate (caller=$caller)"
    return 0
  fi
  if [[ "${SPARKLE_FORCE_INSTALL_DURING_MARATHON:-}" == "1" ]]; then
    marathon_guard_fail "$caller blocked: SPARKLE_FORCE_INSTALL_DURING_MARATHON is disabled (P23) — wait for cursor_conn=0"
  fi
  local cli=""
  cli="$(marathon_guard_resolve_snapshot_cli)"
  [[ -n "$cli" ]] || marathon_guard_fail "snapshot cli missing — run from sparkle repo root"
  # shellcheck disable=SC2086
  $cli assert "$caller"
  marathon_guard_log "snapshot PASS caller=$caller"
}

marathon_guard_clear_pre_quit_snapshot() {
  local cli=""
  cli="$(marathon_guard_resolve_snapshot_cli)"
  [[ -n "$cli" ]] || return 0
  # shellcheck disable=SC2086
  $cli clear >/dev/null 2>&1 || true
}

marathon_guard_assert_no_active_cursor_conn() {
  local caller="${1:-install}"
  local cursor_conn=""
  cursor_conn="$(marathon_guard_read_live_cursor_conn || true)"
  if [[ -z "$cursor_conn" ]]; then
    marathon_guard_log "WARN: live cursor_conn unavailable — skip live active-conn gate (caller=$caller)"
    MARATHON_GUARD_LAST_CURSOR_CONN=""
    return 0
  fi
  MARATHON_GUARD_LAST_CURSOR_CONN="$cursor_conn"
  if (( cursor_conn > 0 )); then
    marathon_guard_fail "$caller blocked: cursor_conn=$cursor_conn (active Agent Connect streams)"
  fi
  marathon_guard_log "PASS caller=$caller cursor_conn=$cursor_conn (no active Agent streams)"
}

marathon_guard_read_state_block() {
  [[ -f "$MARATHON_GUARD_STATE_FILE" ]] || return 1
  python3 - "$MARATHON_GUARD_STATE_FILE" "$MARATHON_GUARD_STATE_MAX_AGE_SEC" <<'PY'
import json, sys, time

path = sys.argv[1]
max_age = int(sys.argv[2])
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except OSError:
    sys.exit(1)

updated_ms = int(data.get("updatedAtMs") or 0)
if updated_ms <= 0:
    sys.exit(1)
age_sec = (time.time() * 1000 - updated_ms) / 1000.0
if age_sec > max_age:
    sys.exit(1)

if data.get("blockColdRestart") is True:
    print(
        "state_file:"
        f"quiesce={1 if data.get('quiesceActive') else 0} "
        f"cursor_conn={int(data.get('cursorConnectionCount') or 0)} "
        f"age_sec={age_sec:.1f}"
    )
    sys.exit(0)
sys.exit(1)
PY
}

marathon_guard_read_state_quiesce_active() {
  [[ -f "$MARATHON_GUARD_STATE_FILE" ]] || return 1
  python3 - "$MARATHON_GUARD_STATE_FILE" "$MARATHON_GUARD_STATE_MAX_AGE_SEC" <<'PY'
import json, sys, time

path = sys.argv[1]
max_age = int(sys.argv[2])
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except OSError:
    sys.exit(1)

updated_ms = int(data.get("updatedAtMs") or 0)
if updated_ms <= 0:
    sys.exit(1)
age_sec = (time.time() * 1000 - updated_ms) / 1000.0
if age_sec > max_age:
    sys.exit(1)
if data.get("quiesceActive") is True or data.get("blockColdRestart") is True:
    print(
        "state_file:"
        f"quiesce={1 if data.get('quiesceActive') else 0} "
        f"block={1 if data.get('blockColdRestart') else 0} "
        f"cursor_conn={int(data.get('cursorConnectionCount') or 0)} "
        f"age_sec={age_sec:.1f}"
    )
    sys.exit(0)
sys.exit(1)
PY
}

marathon_core_restart_guard_assert_idle() {
  local caller="${1:-install}"

  if [[ "${SPARKLE_OVERRIDE_P23_MARATHON_INSTALL:-}" == "1" ]]; then
    local cursor_conn=""
    cursor_conn="$(marathon_guard_read_live_cursor_conn || true)"
    marathon_guard_log "WARN: SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 — user override; proceeding despite marathon (caller=$caller cursor_conn=${cursor_conn:-unknown})"
    return 0
  fi

  if [[ "${SPARKLE_FORCE_INSTALL_DURING_MARATHON:-}" == "1" ]]; then
    marathon_guard_fail "$caller blocked: SPARKLE_FORCE_INSTALL_DURING_MARATHON is disabled (P23) — wait for cursor_conn=0"
  fi

  marathon_guard_assert_no_active_cursor_conn "$caller"

  if state_reason="$(marathon_guard_read_state_quiesce_active)"; then
    marathon_guard_fail "$caller blocked by fresh marathon guard state ($state_reason) — FORCE cannot override"
  fi

  if [[ "${SPARKLE_FORCE_CORE_RESTART:-}" == "1" ]]; then
    marathon_guard_log "WARN: SPARKLE_FORCE_CORE_RESTART=1 — bypassing conn threshold only (caller=$caller)"
  else
    if state_reason="$(marathon_guard_read_state_block)"; then
      marathon_guard_fail "$caller blocked by fresh guard state ($state_reason)"
    fi
  fi

  local cursor_conn=""
  cursor_conn="$(marathon_guard_read_live_cursor_conn || true)"
  if [[ -z "$cursor_conn" ]]; then
    cursor_conn="${MARATHON_GUARD_LAST_CURSOR_CONN:-0}"
    marathon_guard_log "mihomo socket missing — use last cursor_conn=$cursor_conn (caller=$caller)"
  fi

  if [[ "${SPARKLE_FORCE_CORE_RESTART:-}" == "1" ]]; then
    marathon_guard_log "PASS caller=$caller cursor_conn=$cursor_conn (FORCE threshold bypass)"
    return 0
  fi

  if (( cursor_conn >= MARATHON_GUARD_CONN_THRESHOLD )); then
    marathon_guard_fail "$caller blocked: cursor_conn=$cursor_conn threshold=$MARATHON_GUARD_CONN_THRESHOLD"
  fi

  marathon_guard_log "PASS caller=$caller cursor_conn=$cursor_conn threshold=$MARATHON_GUARD_CONN_THRESHOLD"
}

marathon_core_restart_guard_capture_pre_quit_snapshot() {
  local caller="${1:-install-sparkle-local-pre-quit}"
  if [[ "${SPARKLE_OVERRIDE_P23_MARATHON_INSTALL:-}" == "1" ]]; then
    marathon_guard_log "WARN: SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 — skip pre-quit snapshot write (caller=$caller)"
    return 0
  fi
  if [[ "${SPARKLE_FORCE_INSTALL_DURING_MARATHON:-}" == "1" ]]; then
    marathon_guard_fail "$caller blocked: SPARKLE_FORCE_INSTALL_DURING_MARATHON is disabled (P23) — wait for cursor_conn=0"
  fi
  local cursor_conn=""
  cursor_conn="$(marathon_guard_read_live_cursor_conn || true)"
  if [[ -z "$cursor_conn" ]]; then
    cursor_conn="${MARATHON_GUARD_LAST_CURSOR_CONN:-0}"
  fi
  marathon_guard_write_pre_quit_snapshot "$caller" "$cursor_conn"
}
