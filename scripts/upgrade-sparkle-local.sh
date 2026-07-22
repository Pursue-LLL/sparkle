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
log "Building Sparkle $EXPECTED_VER (electron-vite + electron-builder dir)..."

pnpm exec electron-vite build
npx electron-builder --publish never --mac dir

APP="$ROOT/dist/mac-arm64/Sparkle.app"
[[ -d "$APP" ]] || fail "missing $APP after build"

BUILT_VER="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "")"
[[ "$BUILT_VER" == "$EXPECTED_VER" ]] || fail "version mismatch: package.json=$EXPECTED_VER dist=$BUILT_VER"

# Guard against stale asar (vite rebuilt but asar from prior run).
node -e "
const asar = require('@electron/asar')
const fs = require('node:fs')
const path = require('node:path')
const appAsar = process.argv[1]
const tmp = fs.mkdtempSync('/tmp/sparkle-asar-verify-')
const mainRel = 'out/main/index.js'
try {
  asar.extractFile(appAsar, mainRel, tmp)
} catch {
  console.error('[upgrade-sparkle] asar missing out/main/index.js — rebuild failed')
  process.exit(1)
}
const mainPath = path.join(tmp, mainRel)
if (!fs.existsSync(mainPath)) {
  console.error('[upgrade-sparkle] asar extract produced no file at', mainRel)
  process.exit(1)
}
const src = fs.readFileSync(mainPath, 'utf8')
if (!src.includes('appendAppLog')) {
  console.error('[upgrade-sparkle] asar main bundle looks stale or corrupt')
  process.exit(1)
}
" "$APP/Contents/Resources/app.asar"

log "Build OK ($BUILT_VER). Installing..."
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

log "Done. Sparkle $VER running from /Applications/Sparkle.app"
