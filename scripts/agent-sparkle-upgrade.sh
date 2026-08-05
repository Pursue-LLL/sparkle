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
  pgrep -x Sparkle >/dev/null 2>&1 || fail "Sparkle not running after install"

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

if dist_version_matches && dist_signature_valid; then
  log "dist already $EXPECTED_VER with valid signature — install only"
  bash "$ROOT/scripts/install-sparkle-local.sh"
  if run_post_install_gates; then
    log "Done. Sparkle $EXPECTED_VER installed; all post gates PASS"
    exit 0
  fi
  log "Done. Sparkle $EXPECTED_VER installed; byte-death gate not yet PASS (see log above)"
  exit 0
fi

log "dist missing, stale, or unsigned — full upgrade (vite + dir + install + bootstrap gates)"
bash "$ROOT/scripts/upgrade-sparkle-local.sh"

log "Post-upgrade byte-death gate (${GATE_MINUTES}m window)..."
if "$TSX" "$ROOT/scripts/verify-byte-death-recovery-gate.mts" --minutes "$GATE_MINUTES"; then
  log "BYTE_DEATH_RECOVERY_GATE: PASS"
  log "AGENT_UPGRADE_RESULT: version=$EXPECTED_VER byte_death_gate=PASS"
  exit 0
fi

log "BYTE_DEATH_RECOVERY_GATE: FAIL"
log "AGENT_UPGRADE_RESULT: version=$EXPECTED_VER byte_death_gate=FAIL"
exit 0
