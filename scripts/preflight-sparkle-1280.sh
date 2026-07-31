#!/usr/bin/env bash
# Post upgrade:verify 1.28.0 bundle — R-34 + G8 + close smoke + hygiene (observe-only, no marathon waste).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_VER="$(node -p "require('$ROOT/package.json').version")"
INSTALLED_VER="$(defaults read /Applications/Sparkle.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
APP_ASAR="/Applications/Sparkle.app/Contents/Resources/app.asar"
GUARD_PATCH="$HOME/.cursor-500-guard/patch-applied.json"
CONFIG_YAML="$HOME/Library/Application Support/sparkle/config.yaml"
APP_LOG="$(ls -t "$HOME/Library/Application Support/sparkle/logs"/app-*.log 2>/dev/null | head -1 || true)"

CLOSE_SMOKE_OK=false
for _ in $(seq 1 12); do
  if "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sparkle-mihomo-close-smoke.mts"; then
    CLOSE_SMOKE_OK=true
    break
  fi
  sleep 5
done

"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/run-sparkle-post-upgrade-preflight.mts" \
  "$INSTALLED_VER" \
  "$EXPECTED_VER" \
  "$APP_ASAR" \
  "${APP_LOG:-}" \
  "${GUARD_PATCH:-}" \
  "${CONFIG_YAML:-}" \
  "$CLOSE_SMOKE_OK"
