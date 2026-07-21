#!/usr/bin/env bash
# Apply IFM Guard workbench patches to Cursor-3.1.15.app.
# Policy (2026-07-21): Cursor 3.1.15 stays on stock workbench — this script is blocked by default.
# Restore stock: node cursor-agent-stability-patch.mjs /Applications/Cursor-3.1.15.app --restore-stock
set -euo pipefail

PATCH_CLI="/Users/yululiu/projects/AI/open-perplexity/tools/cursor-usage-watch/resources/patches/cursor-agent-stability-patch.mjs"
CURSOR_ROOT="${CURSOR_APP_ROOT:-/Applications/Cursor-3.1.15.app}"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: bash apply-guard-patches-315.sh [--force]

Cursor 3.1.15 workbench patching is DISABLED by default (stock-only policy).

  --force   Opt in: apply Guard workbench patches (requires explicit intent)
  env IFM_APPLY_WORKBENCH_PATCH=1  Same as --force

Restore official stock:
  node cursor-agent-stability-patch.mjs /Applications/Cursor-3.1.15.app --restore-stock
EOF
      exit 0
      ;;
  esac
done

if [[ "$FORCE" -ne 1 && "${IFM_APPLY_WORKBENCH_PATCH:-0}" != "1" ]]; then
  echo "[apply-guard-315] BLOCKED: Cursor 3.1.15 workbench patch policy is stock-only." >&2
  echo "[apply-guard-315] To restore stock: node $PATCH_CLI $CURSOR_ROOT --restore-stock" >&2
  echo "[apply-guard-315] To override (not recommended): IFM_APPLY_WORKBENCH_PATCH=1 $0 --force" >&2
  exit 2
fi

[[ -f "$PATCH_CLI" ]] || { echo "missing $PATCH_CLI — run: npm run build:patch in cursor-usage-watch" >&2; exit 1; }
[[ -d "$CURSOR_ROOT" ]] || { echo "missing $CURSOR_ROOT" >&2; exit 1; }

export CURSOR_APP_ROOT="$CURSOR_ROOT"
echo "[apply-guard-315] CURSOR_APP_ROOT=$CURSOR_APP_ROOT (forced apply)"
node "$PATCH_CLI"
echo "[apply-guard-315] Verify markers:"
rg -o "ifm-patch-366[^\"']*|ifm-patch-367[^\"']*" \
  "$CURSOR_ROOT/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js" | sort -u
