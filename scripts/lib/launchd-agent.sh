#!/usr/bin/env bash
# LaunchAgent 幂等安装库（source 后只定义函数，无副作用）。
#
# 「已加载」不等于「加载的是我们要的那份」：沙箱 shell 的 HOME 被改写时，plist 与 worker 会装进
# 沙箱家目录，launchd 却照样加载它——此后重装时 `launchctl print` 成功，脚本就误以为一切正常，
# 真正生效的仍是旧副本（曾经导致订阅定时任务一直跑着不认静默标记的旧 worker）。
# 所以幂等判定必须同时核对：worker 内容、plist 内容、已加载 job 的来源路径。

# 两个后台 job 的 label：安装脚本与装包前置检查共用，避免同一个字符串在三处各写一份。
# 常量在库里赋值、在 source 本库的脚本里读取。
# shellcheck disable=SC2034
SPARKLE_PROFILE_SCHEDULER_LABEL="com.sparkle.profile-scheduler"
# shellcheck disable=SC2034
SPARKLE_GUI_WATCHDOG_LABEL="com.sparkle.gui-watchdog"

# 已加载的 job 来自 `$2` 这份 plist（launchctl print 的 `path =` 行）。
launchd_agent_loaded_from() {
  local label="$1" plist_path="$2" loaded
  loaded="$(launchctl print "gui/$(id -u)/${label}" 2>/dev/null || true)"
  [[ "$loaded" == *"path = ${plist_path}"* ]]
}

# job 已加载、但来自别的 plist 时输出那份路径；未加载或来源一致时无输出。
# 来源不一致说明 launchd 仍在调度另一份旧 worker，刚部署的新 worker 永远不会被执行；
# 未加载则谁也不会调度，对安装是安全的，所以只有「加载自别处」才需要拦住。
launchd_agent_foreign_source() {
  local label="$1" plist_path="$2" loaded
  loaded="$(launchctl print "gui/$(id -u)/${label}" 2>/dev/null || true)"
  [[ -n "$loaded" && "$loaded" != *"path = ${plist_path}"* ]] || return 0
  sed -n '/^[[:space:]]*path = /{s///p;q;}' <<< "$loaded"
}

launchd_agent_unchanged() {
  local label="$1" worker_src="$2" worker_dst="$3" plist_path="$4" plist_content="$5"
  [[ -f "$worker_dst" && -f "$plist_path" ]] || return 1
  cmp -s "$worker_src" "$worker_dst" || return 1
  [[ "$(cat "$plist_path")" == "$plist_content" ]] || return 1
  launchd_agent_loaded_from "$label" "$plist_path"
}

# 参数：label · worker 源 · worker 目的地 · plist 路径 · plist 内容 · 装完是否 kickstart(1/0) · 日志标签。
# 内容与加载来源都一致时不做任何 bootout/bootstrap：每次都重装会重置调度相位与看门狗的崩溃台账。
launchd_agent_install() {
  local label="$1" worker_src="$2" worker_dst="$3" plist_path="$4" plist_content="$5"
  local kickstart="$6" tag="$7" domain
  domain="gui/$(id -u)"
  if launchd_agent_unchanged "$label" "$worker_src" "$worker_dst" "$plist_path" "$plist_content"; then
    echo "[${tag}] ${label} unchanged and loaded from ${plist_path} — skipping reinstall" >&2
    return 0
  fi
  cp "$worker_src" "$worker_dst"
  chmod +x "$worker_dst"
  printf '%s\n' "$plist_content" > "$plist_path"
  launchctl bootout "${domain}/${label}" 2>/dev/null || true
  launchctl bootstrap "$domain" "$plist_path"
  launchctl enable "${domain}/${label}"
  if [[ "$kickstart" == "1" ]]; then
    launchctl kickstart -k "${domain}/${label}" 2>/dev/null || true
  fi
  echo "[${tag}] Installed ${label} → ${plist_path}" >&2
}
