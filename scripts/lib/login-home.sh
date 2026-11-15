#!/usr/bin/env bash
# [INPUT] macOS 目录服务（`dscl` 读登录用户的 NFSHomeDirectory）
# [OUTPUT] sparkle_pin_login_home: 把 HOME 钉到登录用户的真实家目录（读不到或目录不存在就保持原值）
# [POS] 沙箱 shell（IDE agent）会改写 $HOME，而 Sparkle 自己的配置、日志、状态都写在真实家目录下；
#       读这些位置的安装/升级脚本必须先调用它，否则门禁检查的是一棵空目录。

sparkle_pin_login_home() {
  local login_home
  login_home="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: //')"
  if [[ -n "$login_home" && -d "$login_home" ]]; then
    export HOME="$login_home"
  fi
}
