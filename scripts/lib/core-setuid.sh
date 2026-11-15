#!/usr/bin/env bash
# [INPUT] lib/sparkle-paths.sh::SPARKLE_APP_DATA_DIR (POS: 安装/升级脚本共用路径的单一来源) ·
#         config.yaml 的 core / corePermissionMode · mihomo.yaml 的 tun.enable · 包内 sidecar 内核与
#         sparkle-service 二进制 · osascript（需要时一次提权）· SPARKLE_NONINTERACTIVE
# [OUTPUT] config_scalar · enabled_core_name · configured_core_permission_mode · effective_core_permission_mode ·
#          tun_enabled · is_setuid_mode · core_setuid_intact · core_setuid_required · core_setuid_satisfied ·
#          restore_core_setuid: 需要时一次提权补齐 setuid 并断言
# [POS] 内核权限判定与 setuid 补齐库（source 后只定义函数，无副作用）。
#
# 为什么需要它：内核拿到 TUN 权限有两条路——
#   elevated：内核二进制自带 setuid（root 属主），GUI 以普通用户直接拉起它；
#   service ：内核是 root 服务（sparkle-service）的子进程，天然有权限，**根本不看 setuid**。
# `ditto` 复制会丢掉 setuid 位（`-rwsr-xr-x` → `-rwxr-xr-x`）。所以只有「TUN 开启 且
# 走 elevated」时安装才必须补 setuid；service 模式下补它既无意义，还会把一个需要密码的特权步骤
# 塞进升级流程，成为升级中途失败的单点。
# 判定与 App 侧 tunStartupGuardCore.requiresCoreSetuid 同口径，由契约测试逐格对齐。
#
# 为什么判定用纯 bash 而不是 `tsx -e`：权限位字符串以 `-` 开头（`-rwsr-xr-x`），
# 传给 `tsx -e` 会被 node 当成命令行选项并直接退出（`bad option: -rwxr-xr-x`），
# 让一次「检查」变成安装流程中途崩溃。

# shellcheck source=sparkle-paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/sparkle-paths.sh"

CORE_SIDECAR_REL="Contents/Resources/sidecar"
SERVICE_BINARY_REL="Contents/Resources/files/sparkle-service"

# 读 YAML 文件的顶层标量（去注释、引号、空白）；文件或键不存在时输出空。
config_scalar() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}:[[:space:]]*\([^#[:space:]]*\).*$/\1/p" "$file" | head -1 | tr -d "'\""
}

# 当前启用的内核名。App 的 tunStartupGuard 只检查 config.yaml 的 `core`，
# 给未启用的内核提权只是凭空多一次密码。
enabled_core_name() {
  local name
  name="$(config_scalar "$SPARKLE_APP_DATA_DIR/config.yaml" core)"
  if [[ "$name" == "mihomo-alpha" ]]; then echo "mihomo-alpha"; else echo "mihomo"; fi
}

# 配置里写的权限模式；未配置或不是 service 一律按 App 的默认值 elevated。
configured_core_permission_mode() {
  if [[ "$(config_scalar "$SPARKLE_APP_DATA_DIR/config.yaml" corePermissionMode)" == "service" ]]; then
    echo "service"
  else
    echo "elevated"
  fi
}

# App 在 macOS 26+（Darwin ≥ 25）且包内带 sparkle-service 时，启动即把 elevated 改写为 service
# （macos26ElectronMitigationCore.computeMacOs26MitigationPatch）。安装要按「新包启动后的有效模式」
# 判断，否则升级前配置里还是 elevated 就会被误判为需要 setuid。
effective_core_permission_mode() {
  local app="$1" darwin_major="${2:-$(uname -r | cut -d. -f1)}" mode
  mode="$(configured_core_permission_mode)"
  if [[ "$mode" == "elevated" && -f "$app/$SERVICE_BINARY_REL" && "${darwin_major:-0}" -ge 25 ]]; then
    mode="service"
  fi
  echo "$mode"
}

# mihomo.yaml 的 tun 块里 enable 是否为 true（与 App 的 getControledMihomoConfig().tun.enable 同源）。
tun_enabled() {
  local cfg="$SPARKLE_APP_DATA_DIR/mihomo.yaml"
  [[ -f "$cfg" ]] || return 1
  awk '
    /^tun:[[:space:]]*\{.*enable:[[:space:]]*true/ { found = 1 }
    /^tun:/ { in_tun = 1; next }
    in_tun && /^[^[:space:]#]/ { in_tun = 0 }
    in_tun && /^[[:space:]]+enable:[[:space:]]*true([[:space:]#]|$)/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$cfg"
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

# 这个 App 启动后是否需要内核带 setuid：TUN 开启 且 不走 service。
core_setuid_required() {
  tun_enabled && [[ "$(effective_core_permission_mode "$1")" != "service" ]]
}

# 内核权限要求已满足：不需要 setuid，或需要且已具备。
core_setuid_satisfied() {
  local app="$1"
  core_setuid_required "$app" || return 0
  core_setuid_intact "$app/$CORE_SIDECAR_REL"
}

# 需要 setuid 时用一次提权补齐并断言（与 build/pkg-scripts/postinstall 同口径）；不需要时直接返回。
# 非交互模式下绝不弹框，直接失败并给出可手工执行的命令。
# 提权命令的 stderr 必须保留：用户取消、被策略拒绝等原因都只出现在这里。
restore_core_setuid() {
  local app="$1"
  local sidecar="$app/$CORE_SIDECAR_REL"
  local core_name core_path err
  [[ -d "$sidecar" ]] || { echo "[core-setuid] FAIL: missing sidecar dir: $sidecar" >&2; return 1; }
  core_name="$(enabled_core_name)"
  core_path="$sidecar/$core_name"
  if ! core_setuid_required "$app"; then
    echo "[core-setuid] setuid not required (TUN off or core runs under the service) — no elevation" >&2
    return 0
  fi
  if core_setuid_intact "$sidecar"; then
    echo "[core-setuid] setuid already intact ($core_name) — no elevation needed" >&2
    return 0
  fi
  if [[ "${SPARKLE_NONINTERACTIVE:-0}" == "1" ]]; then
    echo "[core-setuid] FAIL: $core_name lacks setuid and non-interactive mode forbids elevation — run: sudo chown root:admin \"$core_path\" && sudo chmod +sx \"$core_path\"" >&2
    return 1
  fi

  echo "[core-setuid] restoring setuid for $core_name (single prompt per install)" >&2
  err="$(mktemp "${TMPDIR:-/tmp}/sparkle-setuid-err.XXXXXX")"
  if ! osascript -e "do shell script \"chown root:admin \\\"$core_path\\\" && chmod +sx \\\"$core_path\\\"\" with administrator privileges" >/dev/null 2>"$err"; then
    echo "[core-setuid] FAIL: could not restore setuid ($(tr '\n' ' ' < "$err")) — run: sudo chown root:admin \"$core_path\" && sudo chmod +sx \"$core_path\"" >&2
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  xattr -cr "$sidecar" 2>/dev/null || true

  core_setuid_intact "$sidecar" || {
    echo "[core-setuid] FAIL: setuid still missing after elevation — refusing to hand over a build that would prompt again on launch" >&2
    return 1
  }
  echo "[core-setuid] setuid restored (app will not ask for kernel permission on launch)" >&2
  return 0
}
