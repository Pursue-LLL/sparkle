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
# shellcheck source=lib/login-home.sh
source "$ROOT/scripts/lib/login-home.sh"
sparkle_pin_login_home
SRC="${SPARKLE_INSTALL_SRC:-$ROOT/dist/mac-arm64/Sparkle.app}"
DEST="/Applications/Sparkle.app"
USER_COPY="${HOME}/Applications/Sparkle.app"
STATE_DIR="${HOME}/.sparkle"
CDHASH_FILE="${STATE_DIR}/last-sparkle-cdhash"

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

log "Mihomo API socket hygiene (remove zombie direct socket if probe fails)..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sparkle-stale-mihomo-socket-hygiene.mts" || true

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
log "Installed Sparkle $VER at $DEST (CDHash $NEW_CDHASH)"

if [[ "$(uname -s)" == "Darwin" ]]; then
  bash "$ROOT/scripts/install-sparkle-gui-watchdog.sh" || log "WARN: GUI watchdog install failed (non-fatal)"
fi

launch_sparkle_via_finder
sleep 8

is_macos_26_or_newer() {
  local major
  major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
  [[ "${major:-0}" -ge 26 ]]
}

if is_macos_26_or_newer; then
  log "macOS 26: headless bootstrap — GUI may exit; verifying mihomo + headless log..."
  wait_for_mihomo_after_install
  APP_LOG="$(ls -t "$HOME/Library/Application Support/sparkle/logs"/app-*.log 2>/dev/null | head -1 || true)"
  if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
    if grep -q '\[MacOs26Headless\]: bootstrap complete' "$APP_LOG" 2>/dev/null; then
      log "macOS 26 headless bootstrap log OK"
    else
      log "WARN: MacOs26Headless complete line not found yet in $APP_LOG"
    fi
  fi
  log "Done. Sparkle $VER installed (macOS 26 headless path)"
elif pgrep -x Sparkle >/dev/null 2>&1; then
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
