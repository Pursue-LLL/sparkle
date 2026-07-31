#!/usr/bin/env bash
# Build Sparkle (vite + electron-builder dir) and install to /Applications.
# SSOT for local dev upgrades — avoids stale asar, Gatekeeper flash-exit, and ditto overlay.
#
# AI Agent: read BUGFIX_LOG.md §「Sparkle 本地安装」+ §「AI Agent 操作约束」 before any install.
# Do NOT edit BUGFIX_LOG_315.md for Sparkle issues.
#
# Usage: bash scripts/upgrade-sparkle-local.sh
# Requires: pnpm, network for electron-builder deps scan (~2min first time after clean)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "[upgrade-sparkle] FAIL: $*" >&2; exit 1; }
log() { echo "[upgrade-sparkle] $*" >&2; }

EXPECTED_VER="$(node -p "require('./package.json').version")"
DIST_ARM64="$ROOT/dist/mac-arm64"
APP="$DIST_ARM64/Sparkle.app"

log "Building Sparkle $EXPECTED_VER (electron-vite + electron-builder dir)..."

if [[ -f "$ROOT/extra/sidecar/mihomo" ]]; then
  export SKIP_PREPARE=1
  log "SKIP_PREPARE=1 (extra/sidecar/mihomo present — skip GitHub sidecar re-download)"
fi

pnpm run write-build-stamp

# shellcheck source=lib/marathon-core-restart-guard.sh
source "$ROOT/scripts/lib/marathon-core-restart-guard.sh"
export MARATHON_GUARD_ROOT="$ROOT"
marathon_core_restart_guard_assert_idle "upgrade-sparkle-local"

pnpm exec electron-vite build

log "Stage-A bundle gate (out/main, fail-fast before electron-builder)..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/verify-sparkle-main-bundle.mts" "$ROOT/out/main"

# Stale dist/mac-arm64 (e.g. interrupted packaging leaves Electron.app only) causes
# @electron/osx-sign "Sparkle.app could not be found" — always clean before dir build.
log "Cleaning $DIST_ARM64 (avoid stale Electron.app signing race)..."
rm -rf "$DIST_ARM64"

# Adhoc deep sign only — matches electron-builder.yml mac.identity: "-"
export CSC_IDENTITY_AUTO_DISCOVERY=false

run_electron_builder_dir() {
  npx electron-builder --publish never --mac dir
}

if ! run_electron_builder_dir; then
  log "electron-builder --mac dir failed — retry once after clean..."
  rm -rf "$DIST_ARM64"
  run_electron_builder_dir || fail "electron-builder --mac dir failed twice (see log above)"
fi

[[ -d "$APP" ]] || fail "missing $APP after build (dist may have Electron.app only — BUG-2026-07-23-005)"

BUILT_VER="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "")"
[[ "$BUILT_VER" == "$EXPECTED_VER" ]] || fail "version mismatch: package.json=$EXPECTED_VER dist=$BUILT_VER"

if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
  fail "dist app signature invalid after build — afterSign deepSignMac.cjs may have failed"
fi

# Stage-B bundle gate — same SSOT collector as stage A (scripts/sparkleMainAsarSourceCore.ts)
log "Stage-B bundle gate (app.asar, post electron-builder)..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/verify-sparkle-main-asar.mts" "$APP/Contents/Resources/app.asar"

log "Build OK ($BUILT_VER). Installing..."

SPARKLE_LOG_DIR="$HOME/Library/Application Support/sparkle/logs"
APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
BUG014_GATE_SINCE_LINE=0
if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
  BUG014_GATE_SINCE_LINE="$(wc -l < "$APP_LOG" | tr -d ' ')"
  log "BUG-014 gate: snapshot app log at line=$BUG014_GATE_SINCE_LINE ($APP_LOG)"
fi

bash "$ROOT/scripts/install-sparkle-local.sh"

log "Post-install checks..."
VER="$(defaults read /Applications/Sparkle.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
[[ "$VER" == "$EXPECTED_VER" ]] || fail "installed version=$VER expected=$EXPECTED_VER"

if ! pgrep -x Sparkle >/dev/null 2>&1; then
  fail "Sparkle not running after install — see install-sparkle log above"
fi

if [[ ! -S /tmp/sparkle-mihomo-api.sock ]]; then
  log "WARN: mihomo socket not ready yet (may appear in ~10s)"
else
  log "mihomo API socket OK"
fi

# Marathon readiness gate — PostCoreBootstrap must succeed or CTHC/keepalive blind (BUG-004).
if [[ -z "${SPARKLE_LOG_DIR:-}" ]]; then
  SPARKLE_LOG_DIR="$HOME/Library/Application Support/sparkle/logs"
fi
if [[ -z "${APP_LOG:-}" ]]; then
  APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
fi
if [[ -n "$APP_LOG" ]]; then
  post_core_fail="$(
    "$ROOT/node_modules/.bin/tsx" -e "
      import { readFileSync } from 'node:fs';
      import { countPostCoreBootstrapFailuresSinceLine } from './scripts/upgradeSparklePostInstallGateCore.ts';
      const text = readFileSync(process.argv[1], 'utf8');
      process.stdout.write(String(countPostCoreBootstrapFailuresSinceLine(text, Number(process.argv[2]))));
    " "$APP_LOG" "$BUG014_GATE_SINCE_LINE"
  )"
  if [[ "${post_core_fail:-0}" -gt 0 ]]; then
    fail "PostCoreBootstrap failed ${post_core_fail} time(s) since install line $BUG014_GATE_SINCE_LINE in $APP_LOG — marathon keepalive offline"
  fi
  log "Waiting for Api2ProbePlane ON (PostCoreBootstrap, up to 90s)..."
  probe_ok=false
  for _ in $(seq 1 18); do
    if [[ -f "$APP_LOG" ]]; then
      post_core_fail="$(
        "$ROOT/node_modules/.bin/tsx" -e "
          import { readFileSync } from 'node:fs';
          import {
            countPostCoreBootstrapFailuresSinceLine,
            hasApi2ProbePlaneOnSinceLine,
          } from './scripts/upgradeSparklePostInstallGateCore.ts';
          const text = readFileSync(process.argv[1], 'utf8');
          const since = Number(process.argv[2]);
          if (countPostCoreBootstrapFailuresSinceLine(text, since) > 0) {
            process.stdout.write('fail');
            process.exit(0);
          }
          process.stdout.write(hasApi2ProbePlaneOnSinceLine(text, since) ? 'ok' : 'wait');
        " "$APP_LOG" "$BUG014_GATE_SINCE_LINE"
      )"
      if [[ "$post_core_fail" == "fail" ]]; then
        fail "PostCoreBootstrap failed since install line $BUG014_GATE_SINCE_LINE in $APP_LOG — marathon keepalive offline"
      fi
      if [[ "$post_core_fail" == "ok" ]]; then
        probe_ok=true
        break
      fi
    fi
    sleep 5
    APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
  done
  [[ "$probe_ok" == true ]] || fail "Api2ProbePlane not ON within 90s — check $APP_LOG"
  log "PostCoreBootstrap OK (Api2ProbePlane ON)"

  log "BUG-014 gate: waiting 45s for post-install hung_scan sample..."
  sleep 45
  APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
  if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
    recent_fail="$(
      "$ROOT/node_modules/.bin/tsx" -e "
        import { readFileSync } from 'node:fs';
        import { countBug014RescueFailuresSinceLine } from './scripts/upgradeSparklePostInstallGateCore.ts';
        const text = readFileSync(process.argv[1], 'utf8');
        process.stdout.write(String(countBug014RescueFailuresSinceLine(text, Number(process.argv[2]))));
      " "$APP_LOG" "$BUG014_GATE_SINCE_LINE"
    )"
    if [[ "${recent_fail:-0}" -gt 0 ]]; then
      fail "BUG-014 gate: $recent_fail post-install Resource not found rescue failure(s) since line $BUG014_GATE_SINCE_LINE in $APP_LOG"
    fi
    log "BUG-014 gate OK (no post-install Resource not found on rescue paths since line $BUG014_GATE_SINCE_LINE)"
  fi

  log "Preflight 1.28.0 bundle (R-34 + G8 + close smoke)..."
  bash "$ROOT/scripts/preflight-sparkle-1280.sh" || fail "preflight-sparkle-1280 failed — see report above"
else
  log "WARN: no sparkle app-*.log yet — skip PostCoreBootstrap gate"
fi

log "Done. Sparkle $VER running from /Applications/Sparkle.app"
