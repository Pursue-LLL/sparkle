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
if "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sparkle-mihomo-close-smoke.mts"; then
  CLOSE_SMOKE_OK=true
fi

MAIN_SRC=""
if [[ -f "$APP_ASAR" ]]; then
  MAIN_SRC="$("$ROOT/node_modules/.bin/tsx" -e "
    import asar from '@electron/asar';
    process.stdout.write(asar.extractFile(process.argv[1], 'out/main/index.js').toString('utf8'));
  " "$APP_ASAR")"
fi

GUARD_JSON=""
[[ -f "$GUARD_PATCH" ]] && GUARD_JSON="$(cat "$GUARD_PATCH")"
CONFIG_TEXT=""
[[ -f "$CONFIG_YAML" ]] && CONFIG_TEXT="$(cat "$CONFIG_YAML")"
LOG_TAIL=""
[[ -n "$APP_LOG" && -f "$APP_LOG" ]] && LOG_TAIL="$(tail -200 "$APP_LOG")"

"$ROOT/node_modules/.bin/tsx" -e "
  import { readFileSync } from 'node:fs';
  import {
    evaluateSparklePostUpgradePreflight,
    formatSparklePostUpgradePreflightReport,
  } from './scripts/sparklePostUpgradePreflightCore.ts';

  const result = evaluateSparklePostUpgradePreflight({
    installedVersion: process.argv[1],
    expectedVersion: process.argv[2],
    mainAsarSource: process.argv[3] ?? '',
    appLogTail: process.argv[4] ?? '',
    guardPatchAppliedJson: process.argv[5] ?? '',
    sparkleConfigYaml: process.argv[6] ?? '',
    mihomoCloseSmokeOk: process.argv[7] === 'true',
  });
  console.log(formatSparklePostUpgradePreflightReport(result));
  process.exit(result.ok ? 0 : 1);
" "$INSTALLED_VER" "$EXPECTED_VER" "$MAIN_SRC" "$LOG_TAIL" "$GUARD_JSON" "$CONFIG_TEXT" "$CLOSE_SMOKE_OK"
