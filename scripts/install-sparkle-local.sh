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

launch_sparkle_via_finder
sleep 5
if pgrep -x Sparkle >/dev/null 2>&1; then
  log "Done. Sparkle $VER GUI running from /Applications"
else
  log "WARN: GUI not running yet — retrying Finder launch..."
  launch_sparkle_via_finder
  sleep 5
  if pgrep -x Sparkle >/dev/null 2>&1; then
    log "Done. Sparkle $VER GUI running from /Applications"
  else
    log "WARN: GUI still not running."
    print_gatekeeper_hint
  fi
fi
