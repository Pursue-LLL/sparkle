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

# 内核 setuid 恢复：ditto 不保留 root 属主与 setuid 位，不补的话 App 每次启动
# 都会判定「内核缺权限」再弹一次系统密码框。判定与提权实现见 lib/core-setuid.sh
# （可 source 的纯函数库，有独立测试；只修当前启用的内核）。
# shellcheck source=lib/core-setuid.sh
source "$ROOT/scripts/lib/core-setuid.sh"

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

# 幂等短路：dist 指纹一致 + CDHash 一致 + App 在跑 + 代理在线 + 内核 setuid 完整
# ⇒ 同样的字节已在 /Applications 里运行，再 quit/ditto/启动只会打断用户。
# 缺任一条都要走真实安装（setuid 缺失必须修，不能被「看起来已装好」掩盖）。
if [[ "${SPARKLE_FORCE_REINSTALL:-0}" != "1" ]] && [[ -n "$OLD_CDHASH" && "$OLD_CDHASH" == "$SRC_CDHASH" ]]; then
  app_running=0
  data_plane=0
  setuid_ok=0
  # 注意：`set -e` 下 `cmd && var=1` 在 cmd 失败时会让整行返回非零并终止脚本，
  # 而这些检查「失败」正是要走真实安装的合法路径，因此一律用 if 显式吞掉退出码。
  if pgrep -x Sparkle >/dev/null 2>&1; then app_running=1; fi
  if curl -sf --max-time 5 -x http://127.0.0.1:7890 https://www.gstatic.com/generate_204 >/dev/null 2>&1; then
    data_plane=1
  fi
  if core_setuid_intact "$DEST/$CORE_SIDECAR_REL"; then setuid_ok=1; fi
  # 判定用纯 bash：安装路径不依赖任何 `tsx -e` 传参（tsx 会把参数当 node 选项）。
  short_circuit=""
  if [[ "$app_running" != "1" ]]; then
    short_circuit="app_not_running"
  elif [[ "$data_plane" != "1" ]]; then
    short_circuit="data_plane_down"
  elif [[ "$setuid_ok" != "1" ]]; then
    short_circuit="core_setuid_missing"
  else
    short_circuit="skip"
  fi
  if [[ "$short_circuit" == "skip" ]]; then
    log "Same build already installed and healthy (CDHash $SRC_CDHASH) — nothing to do, app untouched"
    # 通知父级流程「这次是空操作」：标记文件让 agent-sparkle-upgrade.sh 跳过装后门禁，
    # 避免为一份没变的安装再起一次 --sparkle-profile-update-due 第二实例。
    if [[ -n "${SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER:-}" ]]; then
      : > "$SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER"
    fi
    exit 0
  fi
  log "Reinstall required: $short_circuit"
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
  # 先尝试直接发信号（同一用户/已授权时无需密码）；只有确实发不出去、且允许交互时才提权一次。
  killall sparkle-service 2>/dev/null || true
  sleep 1
  if pgrep -f "sparkle-service service run" >/dev/null 2>&1; then
    if [[ "${SPARKLE_NONINTERACTIVE:-0}" == "1" ]]; then
      log "WARN: sparkle-service still running and non-interactive mode forbids elevation — leaving it to the installer swap"
    else
      log "sparkle-service needs elevation to stop (one prompt)..."
      osascript -e 'do shell script "killall -9 sparkle-service 2>/dev/null || true" with administrator privileges' 2>/dev/null || true
    fi
    sleep 1
  fi
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

# 安装后立即补齐内核 setuid（ditto 会丢），这样 App 启动时不再弹「需要内核权限」。
# 放在 CDHash 校验之后：先把包换对，再动内核权限位。失败必须中止——带着缺 setuid
# 的包交付，用户下次启动就要再输一次密码。
restore_core_setuid "$DEST" || fail "core setuid not restored — aborting install (see [core-setuid] above)"

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
