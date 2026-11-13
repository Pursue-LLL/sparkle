#!/usr/bin/env bash
# 内核 setuid 判定的可 source 库（无副作用，source 后只定义函数）。
#
# 为什么需要它：`ditto` 复制会丢掉 setuid 位（实测 `-rwsr-xr-x` → `-rwxr-xr-x`），
# 而 App 启动时 `tunStartupGuard` 会检查当前启用内核是否带 setuid，
# 缺了就经 `permission.ts` 弹系统密码框。本地安装必须自己补齐，否则每装一次、
# 每启动一次都要重新输密码。
#
# 为什么判定用纯 bash 而不是 `tsx -e`：权限位字符串以 `-` 开头（`-rwsr-xr-x`），
# 传给 `tsx -e` 会被 node 当成命令行选项并直接退出（`bad option: -rwxr-xr-x`），
# 让一次「检查」变成安装流程中途崩溃——而崩溃点往往在已经退出 App 之后。

CORE_SIDECAR_REL="Contents/Resources/sidecar"

# 当前启用的内核名。App 的 tunStartupGuard 只检查 config.yaml 的 `core`，
# 给未启用的内核提权只是凭空多一次密码。
enabled_core_name() {
  local cfg="${SPARKLE_APP_CONFIG_PATH:-$HOME/Library/Application Support/sparkle/config.yaml}"
  local name=""
  if [[ -f "$cfg" ]]; then
    name="$(sed -n 's/^core:[[:space:]]*\([A-Za-z0-9_-]*\).*$/\1/p' "$cfg" | head -1)"
  fi
  if [[ "$name" == "mihomo-alpha" ]]; then echo "mihomo-alpha"; else echo "mihomo"; fi
}

core_mode_of() {
  stat -f '%Sp' "$1" 2>/dev/null || true
}

# 权限位第 4 个字符（owner execute）为 s/S 即带 setuid。
is_setuid_mode() {
  local mode="$1"
  [[ "${#mode}" -ge 4 && ( "${mode:3:1}" == "s" || "${mode:3:1}" == "S" ) ]]
}

# 目标内核缺失时视为「无需修复」，避免把「没有这个内核」误报成权限缺陷。
core_setuid_intact() {
  local dir="$1" name file mode
  name="$(enabled_core_name)"
  file="$dir/$name"
  [[ -f "$file" ]] || return 0
  mode="$(core_mode_of "$file")"
  is_setuid_mode "$mode"
}

# 用一次提权把启用内核的 setuid 补齐并断言（与 build/pkg-scripts/postinstall 同口径）。
# 非交互模式下绝不弹框，直接失败并给出可手工执行的命令。
restore_core_setuid() {
  local app="$1"
  local sidecar="$app/$CORE_SIDECAR_REL"
  local core_name core_path
  [[ -d "$sidecar" ]] || { echo "[core-setuid] FAIL: missing sidecar dir: $sidecar" >&2; return 1; }
  core_name="$(enabled_core_name)"
  core_path="$sidecar/$core_name"
  if core_setuid_intact "$sidecar"; then
    echo "[core-setuid] setuid already intact ($core_name) — no elevation needed" >&2
    return 0
  fi
  if [[ "${SPARKLE_NONINTERACTIVE:-0}" == "1" ]]; then
    echo "[core-setuid] FAIL: $core_name lacks setuid and non-interactive mode forbids elevation — run: sudo chown root:admin \"$core_path\" && sudo chmod +sx \"$core_path\"" >&2
    return 1
  fi

  echo "[core-setuid] restoring setuid for $core_name (single prompt per install)" >&2
  if ! osascript -e "do shell script \"chown root:admin \\\"$core_path\\\" && chmod +sx \\\"$core_path\\\"\" with administrator privileges" >/dev/null 2>&1; then
    echo "[core-setuid] FAIL: could not restore setuid — run: sudo chown root:admin \"$core_path\" && sudo chmod +sx \"$core_path\"" >&2
    return 1
  fi
  xattr -cr "$sidecar" 2>/dev/null || true

  core_setuid_intact "$sidecar" || {
    echo "[core-setuid] FAIL: setuid still missing after elevation — refusing to hand over a build that would prompt again on launch" >&2
    return 1
  }
  echo "[core-setuid] setuid restored (app will not ask for kernel permission on launch)" >&2
  return 0
}
