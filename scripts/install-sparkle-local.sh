#!/usr/bin/env bash
# Install locally built Sparkle.app to /Applications only (single canonical path).
# Removes ~/Applications/Sparkle.app duplicates that cause service/GUI split-brain.
#
# AI Agent: see BUGFIX_LOG.md §「AI Agent 操作约束」. Launch via Finder POSIX open (not open -a).
#
# Signing: pnpm run build:mac already deep-signs via afterSign (deepSignMac.cjs).
# Do NOT re-sign here — a second adhoc sign changes CDHash and invalidates Gatekeeper approval.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SPARKLE_INSTALL_SRC:-$ROOT/dist/mac-arm64/Sparkle.app}"
DEST="/Applications/Sparkle.app"
USER_COPY="${HOME}/Applications/Sparkle.app"
STATE_DIR="${HOME}/.sparkle"
CDHASH_FILE="${STATE_DIR}/last-sparkle-cdhash"
SPARKLE_CONFIG="${HOME}/Library/Application Support/sparkle/config.yaml"
CURSOR_PREFIX_PRESERVE="${STATE_DIR}/install-preserve-cursor-path-prefixes.yaml"

preserve_cursor_path_prefixes_before_quit() {
  node - <<'NODE'
const fs = require('fs')
const path = require('path')
const yaml = require('yaml')

const home = process.env.HOME
const cfgPaths = [
  path.join(home, 'Library/Application Support/sparkle/config.yaml'),
  path.join(home, 'Library/Application Support/sparkle/config.yaml.backup')
]
let prefixes = []
for (const cfgPath of cfgPaths) {
  if (!fs.existsSync(cfgPath)) continue
  const data = yaml.parse(fs.readFileSync(cfgPath, 'utf8')) || {}
  const value = data.cursorProxyAppPathPrefixes
  if (Array.isArray(value) && value.length > 0) {
    prefixes = value.map((item) => String(item).trim()).filter(Boolean)
    if (prefixes.length > 0) break
  }
}

const state = path.join(home, '.sparkle/install-preserve-cursor-path-prefixes.yaml')
if (prefixes.length > 0) {
  fs.writeFileSync(state, yaml.stringify({ cursorProxyAppPathPrefixes: prefixes }))
  console.error(`[install-sparkle] preserved cursorProxyAppPathPrefixes=${JSON.stringify(prefixes)}`)
} else {
  try {
    fs.unlinkSync(state)
  } catch {
    // ignore
  }
}
NODE
}

restore_cursor_path_prefixes_after_launch() {
  node - "$SPARKLE_CONFIG" "$CURSOR_PREFIX_PRESERVE" <<'NODE'
const fs = require('fs')
const yaml = require('yaml')

const cfgPath = process.argv[2]
const preservePath = process.argv[3]
if (!fs.existsSync(preservePath) || !fs.existsSync(cfgPath)) {
  process.exit(0)
}

const preserve = yaml.parse(fs.readFileSync(preservePath, 'utf8')) || {}
const wanted = preserve.cursorProxyAppPathPrefixes
if (!Array.isArray(wanted) || wanted.length === 0) {
  process.exit(0)
}

const data = yaml.parse(fs.readFileSync(cfgPath, 'utf8')) || {}
const current = data.cursorProxyAppPathPrefixes
if (Array.isArray(current) && current.length > 0) {
  process.exit(0)
}

data.cursorProxyAppPathPrefixes = wanted
fs.writeFileSync(cfgPath, yaml.stringify(data))
console.error(`[install-sparkle] restored cursorProxyAppPathPrefixes=${JSON.stringify(wanted)}`)
NODE
}

fail() { echo "[install-sparkle] FAIL: $*" >&2; exit 1; }
log() { echo "[install-sparkle] $*" >&2; }

get_cdhash() {
  codesign -dv --verbose=4 "$1" 2>&1 | awk '/^CDHash=/ { print substr($0, 8); exit }'
}

gatekeeper_assess() {
  spctl -a -t execute -vv "$1" 2>&1 | awk 'NR==1 { print $NF }'
}

launch_sparkle_via_finder() {
  # adhoc builds: `open -a` / double-click often exit=1 (flash crash). Finder POSIX open works.
  osascript -e 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"' 2>/dev/null || true
}

wait_for_mihomo_after_install() {
  local waited=0
  local max_wait=60
  while [[ $waited -lt $max_wait ]]; do
    if pgrep -f '/Applications/Sparkle.app/Contents/Resources/sidecar/mihomo' >/dev/null 2>&1; then
      log "mihomo core detected ${waited}s after GUI launch"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  log "WARN: mihomo not detected within ${max_wait}s — GUI startCore may still be running generateProfile"
}

print_gatekeeper_hint() {
  log ""
  log "Gatekeeper fallback: Finder → /Applications → Control+click Sparkle.app → Open → Open again."
  log "Menu bar tray icon = success (silentStart may hide the main window)."
  log ""
}

[[ -d "$SRC" ]] || fail "built app missing: $SRC (run: pnpm run build:mac)"

if ! codesign --verify --deep --strict "$SRC" >/dev/null 2>&1; then
  fail "source app signature invalid — rebuild: pnpm run build:mac (afterSign deepSignMac.cjs)"
fi

# shellcheck source=lib/marathon-core-restart-guard.sh
source "$ROOT/scripts/lib/marathon-core-restart-guard.sh"
export MARATHON_GUARD_ROOT="$ROOT"
marathon_core_restart_guard_assert_idle "install-sparkle-local-pre-quit"
marathon_core_restart_guard_capture_pre_quit_snapshot "install-sparkle-local-pre-quit"
preserve_cursor_path_prefixes_before_quit

SRC_CDHASH="$(get_cdhash "$SRC")"
[[ -n "$SRC_CDHASH" ]] || fail "could not read CDHash from $SRC"

OLD_CDHASH=""
if [[ -d "$DEST" ]]; then
  OLD_CDHASH="$(get_cdhash "$DEST" 2>/dev/null || true)"
fi

if pgrep -x Sparkle >/dev/null 2>&1; then
  log "Quitting Sparkle GUI..."
  osascript -e 'tell application "Sparkle" to quit' 2>/dev/null || true
  for _ in $(seq 1 20); do
    pgrep -x Sparkle >/dev/null 2>&1 || break
    sleep 1
  done
  if pgrep -x Sparkle >/dev/null 2>&1; then
    log "Force quitting Sparkle..."
    pkill -9 -x Sparkle 2>/dev/null || true
    sleep 2
  fi
  pgrep -x Sparkle >/dev/null 2>&1 && fail "Sparkle still running — quit manually and retry"
fi

if pgrep -f "sparkle-service service run" >/dev/null 2>&1; then
  log "Stopping sparkle-service..."
  killall sparkle-service 2>/dev/null || true
  pkill -9 -f "sparkle-service service run" 2>/dev/null || true
  osascript -e 'do shell script "killall -9 sparkle-service 2>/dev/null || true" with administrator privileges' 2>/dev/null || true
  sleep 1
fi

marathon_guard_assert_pre_quit_snapshot_idle "install-sparkle-local-post-quit"

if [[ -d "$USER_COPY" ]]; then
  BAK="${USER_COPY}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  log "Removing duplicate user install: $USER_COPY -> $BAK"
  mv "$USER_COPY" "$BAK" || fail "could not move $USER_COPY (close Sparkle and retry)"
fi

log "Installing $SRC -> $DEST (preserve build signature, no re-sign)"
if [[ -d "$DEST" ]]; then
  rm -rf "$DEST" || sudo rm -rf "$DEST" || fail "could not remove existing $DEST"
fi
if [[ -w "/Applications" ]]; then
  ditto "$SRC" "$DEST" || fail "ditto failed"
else
  sudo ditto "$SRC" "$DEST" || fail "ditto failed (try: sudo $0)"
  sudo chown -R "$(whoami):staff" "$DEST" || fail "chown failed — run: sudo chown -R $(whoami):staff $DEST"
fi

xattr -cr "$DEST" 2>/dev/null || sudo xattr -cr "$DEST" || true

if ! codesign --verify --deep --strict "$DEST" >/dev/null 2>&1; then
  fail "installed app signature invalid after ditto — do not adhoc re-sign here; rebuild from dist"
fi

NEW_CDHASH="$(get_cdhash "$DEST")"
[[ "$NEW_CDHASH" == "$SRC_CDHASH" ]] || fail "CDHash mismatch after install (expected $SRC_CDHASH, got $NEW_CDHASH)"

mkdir -p "$STATE_DIR"
VER="$(defaults read "$DEST/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo unknown)"
[[ -d "$USER_COPY" ]] && fail "duplicate still exists: $USER_COPY"

if [[ -n "$OLD_CDHASH" && "$OLD_CDHASH" != "$NEW_CDHASH" ]]; then
  log "CDHash changed ($OLD_CDHASH -> $NEW_CDHASH) — Gatekeeper may require one-time Control+Open"
fi

GK="$(gatekeeper_assess "$DEST" || true)"
if [[ "$GK" == "rejected" ]]; then
  log "spctl: rejected (normal for unsigned adhoc dev builds)"
  print_gatekeeper_hint
fi

echo "$NEW_CDHASH" > "$CDHASH_FILE"
marathon_guard_clear_pre_quit_snapshot
restore_cursor_path_prefixes_after_launch || true
log "Installed Sparkle $VER at $DEST (CDHash $NEW_CDHASH)"

launch_sparkle_via_finder
sleep 5
if pgrep -x Sparkle >/dev/null 2>&1; then
  log "Done. Sparkle $VER GUI running from /Applications"
  wait_for_mihomo_after_install
else
  log "WARN: GUI not running yet — retrying Finder launch..."
  launch_sparkle_via_finder
  sleep 5
  if pgrep -x Sparkle >/dev/null 2>&1; then
    log "Done. Sparkle $VER GUI running from /Applications"
    wait_for_mihomo_after_install
  else
    log "WARN: GUI still not running."
    print_gatekeeper_hint
  fi
fi
