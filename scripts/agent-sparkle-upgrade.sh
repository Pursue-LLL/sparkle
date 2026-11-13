#!/usr/bin/env bash
# Agent SSOT — Sparkle local upgrade: build (if needed) + install + post gates.
# Usage: bash scripts/agent-sparkle-upgrade.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { echo "[agent-sparkle-upgrade] $*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

# 入口互斥：两个 agent 升级同时跑会并发写 dist 与 /Applications（BUG-2026-11-13-004）。
# 内部 upgrade-sparkle-local.sh 自己也有锁，但入口层先拦住可以避免「先做一半准备工作再失败」。
ENTRY_LOCK_DIR="${SPARKLE_UPGRADE_ENTRY_LOCK_DIR:-${TMPDIR:-/tmp}/sparkle-agent-upgrade-entry.lock}"
ENTRY_LOCK_OWNER="$ENTRY_LOCK_DIR/owner"
acquire_entry_lock() {
  local owner_text owner active
  owner_text="$(node -e 'process.stdout.write(`pid=${process.pid} started=${Date.now()}\n`)')"
  if mkdir "$ENTRY_LOCK_DIR" 2>/dev/null; then
    printf '%s' "$owner_text" > "$ENTRY_LOCK_OWNER"
    return 0
  fi
  owner="$(cat "$ENTRY_LOCK_OWNER" 2>/dev/null || true)"
  active="$(node -e '
    const text = process.argv[1] || "";
    const pid = Number(/pid=(\d+)/.exec(text)?.[1] ?? 0);
    let alive = false;
    if (pid > 0) {
      try { process.kill(pid, 0); alive = true } catch { alive = false }
    }
    process.stdout.write(alive ? "1" : "0");
  ' "$owner")"
  if [[ "$active" == "1" ]]; then
    fail "another agent upgrade is already running ($owner) — refusing to start a second one"
  fi
  log "Stale entry lock ($owner) — taking over"
  rm -rf "$ENTRY_LOCK_DIR"
  mkdir "$ENTRY_LOCK_DIR" 2>/dev/null || fail "could not take over entry lock"
  printf '%s' "$owner_text" > "$ENTRY_LOCK_OWNER"
  return 0
}
release_entry_lock() { rm -rf "$ENTRY_LOCK_DIR" 2>/dev/null || true; }
handle_entry_signal() { release_entry_lock; exit 130; }
acquire_entry_lock
trap 'release_entry_lock' EXIT
trap 'handle_entry_signal' INT TERM

EXPECTED_VER="$(node -p "require('./package.json').version")"
DIST_APP="$ROOT/dist/mac-arm64/Sparkle.app"
TSX="$ROOT/node_modules/.bin/tsx"

log "Pre-install hygiene (journal truncate + disk pressure gate)..."
if ! "$TSX" "$ROOT/scripts/sparkle-pre-install-hygiene.mts"; then
  fail "pre-install hygiene blocked upgrade — free disk space or truncate ~/.sparkle journals"
fi

log "Pre-install GUI watchdog fuse gate..."
bash "$ROOT/scripts/test-gui-watchdog-fuse.sh"

dist_version_matches() {
  [[ -d "$DIST_APP" ]] || return 1
  local built_ver
  built_ver="$(defaults read "$DIST_APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "")"
  [[ "$built_ver" == "$EXPECTED_VER" ]]
}

dist_signature_valid() {
  codesign --verify --deep --strict "$DIST_APP" >/dev/null 2>&1
}

run_post_install_gates() {
  local installed_ver
  installed_ver="$(defaults read /Applications/Sparkle.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
  [[ "$installed_ver" == "$EXPECTED_VER" ]] || fail "installed version=$installed_ver expected=$EXPECTED_VER"

  log "Post-install data-plane readiness gate (Core Readiness Contract Phase D)..."
  "$TSX" "$ROOT/scripts/sparkle-data-plane-readiness.mts" || fail "data-plane readiness gate failed — mihomo or :7890 not live"

  local macos_major
  macos_major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
  if [[ "${macos_major:-0}" -ge 26 ]]; then
    log "macOS 26: Sparkle GUI may exit after headless bootstrap — checking proxy instead of pgrep"
    local proxy_ok=false
    for _ in $(seq 1 20); do
      if curl -sf --max-time 8 -x http://127.0.0.1:7890 https://www.gstatic.com/generate_204 >/dev/null; then
        proxy_ok=true
        break
      fi
      sleep 2
    done
    [[ "$proxy_ok" == true ]] || fail "macOS 26 post-install: proxy :7890 not reachable after retries"
  else
    pgrep -x Sparkle >/dev/null 2>&1 || fail "Sparkle not running after install"
  fi

  log "Post-install profile due-check..."
  "/Applications/Sparkle.app/Contents/MacOS/Sparkle" --sparkle-profile-update-due >/dev/null 2>&1 || true

  log "AGENT_UPGRADE_RESULT: version=$installed_ver data_plane=PASS"
}

install_profile_scheduler() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi
  log "Installing profile scheduler LaunchAgent (5m due-check)..."
  if bash "$ROOT/scripts/install-sparkle-profile-scheduler.sh"; then
    log "Profile scheduler LaunchAgent OK"
  else
    log "WARN: profile scheduler install failed (non-fatal)"
  fi
}

DIST_FRESH=0
if dist_version_matches && dist_signature_valid; then
  if "$TSX" "$ROOT/scripts/evaluate-sparkle-dist-freshness.mts" "$DIST_APP"; then
    DIST_FRESH=1
  else
    log "dist semver/signature OK but source fingerprint stale — full upgrade (DistFreshness gate)"
  fi
fi

if [[ "${SPARKLE_AGENT_FORCE_FULL_BUILD:-}" == "1" ]]; then
  log "SPARKLE_AGENT_FORCE_FULL_BUILD=1 — skipping dist-only install path"
  DIST_FRESH=0
fi

if [[ "$DIST_FRESH" == "1" ]]; then
  log "dist already $EXPECTED_VER with valid signature + fresh source fingerprint — install only"
  bash "$ROOT/scripts/install-sparkle-local.sh"
  install_profile_scheduler
  run_post_install_gates
  log "Done. Sparkle $EXPECTED_VER installed; all post gates PASS"
  exit 0
fi

log "dist missing, stale, unsigned, or source fingerprint drift — full upgrade (vite + dir + install + bootstrap gates)"
bash "$ROOT/scripts/upgrade-sparkle-local.sh"
install_profile_scheduler
log "AGENT_UPGRADE_RESULT: version=$EXPECTED_VER"
