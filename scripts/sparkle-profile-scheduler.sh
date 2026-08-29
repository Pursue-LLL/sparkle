#!/usr/bin/env bash
# LaunchAgent worker — ask Sparkle to refresh due remote subscriptions.
set -euo pipefail

SPARKLE_BIN="/Applications/Sparkle.app/Contents/MacOS/Sparkle"
STATE_DIR="${HOME}/.sparkle"
LOG_PREFIX="[sparkle-profile-scheduler]"

log() {
  echo "${LOG_PREFIX} $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "${STATE_DIR}/profile-scheduler.out.log"
}

if [[ ! -x "$SPARKLE_BIN" ]]; then
  log "WARN: Sparkle missing at $SPARKLE_BIN"
  exit 0
fi

if ! "$SPARKLE_BIN" --sparkle-profile-update-due >> "${STATE_DIR}/profile-scheduler.out.log" 2>> "${STATE_DIR}/profile-scheduler.err.log"; then
  log "WARN: profile update due command exited non-zero"
fi
