#!/usr/bin/env bash
# Agent SSOT — Sparkle local upgrade: build (if needed) + install + post gates.
# Usage: bash scripts/agent-sparkle-upgrade.sh
# Marathon override: SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 bash scripts/agent-sparkle-upgrade.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { echo "[agent-sparkle-upgrade] $*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

EXPECTED_VER="$(node -p "require('./package.json').version")"
DIST_APP="$ROOT/dist/mac-arm64/Sparkle.app"
TSX="$ROOT/node_modules/.bin/tsx"
GATE_MINUTES="${SPARKLE_AGENT_GATE_MINUTES:-15}"

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
  local installed_ver gate_result preflight_ok=true
  installed_ver="$(defaults read /Applications/Sparkle.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
  [[ "$installed_ver" == "$EXPECTED_VER" ]] || fail "installed version=$installed_ver expected=$EXPECTED_VER"
  local macos_major
  macos_major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
  if [[ "${macos_major:-0}" -ge 26 ]]; then
    log "macOS 26: Sparkle GUI may exit after headless bootstrap — checking proxy instead of pgrep"
    local proxy_ok=false
    for _ in $(seq 1 20); do
      if curl -sf --max-time 8 -x http://127.0.0.1:7890 https://api2.cursor.sh/ >/dev/null; then
        proxy_ok=true
        break
      fi
      sleep 2
    done
    [[ "$proxy_ok" == true ]] || fail "macOS 26 post-install: proxy :7890 not reachable after retries"
  else
    pgrep -x Sparkle >/dev/null 2>&1 || fail "Sparkle not running after install"
  fi

  log "Post-install byte-death gate (${GATE_MINUTES}m window)..."
  if "$TSX" "$ROOT/scripts/verify-byte-death-recovery-gate.mts" --minutes "$GATE_MINUTES"; then
    gate_result=PASS
  else
    gate_result=FAIL
  fi
  log "BYTE_DEATH_RECOVERY_GATE: $gate_result"

  if [[ -f "$ROOT/scripts/preflight-sparkle-1280.sh" ]]; then
    log "Post-install preflight-sparkle-1280..."
    if ! bash "$ROOT/scripts/preflight-sparkle-1280.sh"; then
      preflight_ok=false
      log "WARN: preflight-sparkle-1280 failed (non-fatal for install)"
    fi
  fi

  log "AGENT_UPGRADE_RESULT: version=$installed_ver byte_death_gate=$gate_result preflight=$preflight_ok"
  [[ "$gate_result" == PASS ]]
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

if [[ "$DIST_FRESH" == "1" ]]; then
  log "dist already $EXPECTED_VER with valid signature + fresh source fingerprint — install only"
  bash "$ROOT/scripts/install-sparkle-local.sh"
  install_profile_scheduler
  if run_post_install_gates; then
    log "Done. Sparkle $EXPECTED_VER installed; all post gates PASS"
    exit 0
  fi
  log "Done. Sparkle $EXPECTED_VER installed; byte-death gate not yet PASS (see log above)"
  exit 0
fi

log "dist missing, stale, unsigned, or source fingerprint drift — full upgrade (vite + dir + install + bootstrap gates)"
bash "$ROOT/scripts/upgrade-sparkle-local.sh"
install_profile_scheduler

log "Post-upgrade byte-death gate (${GATE_MINUTES}m window)..."
if "$TSX" "$ROOT/scripts/verify-byte-death-recovery-gate.mts" --minutes "$GATE_MINUTES"; then
  log "BYTE_DEATH_RECOVERY_GATE: PASS"
  log "AGENT_UPGRADE_RESULT: version=$EXPECTED_VER byte_death_gate=PASS"
  exit 0
fi

log "BYTE_DEATH_RECOVERY_GATE: FAIL"
log "AGENT_UPGRADE_RESULT: version=$EXPECTED_VER byte_death_gate=FAIL"
exit 0
