#!/usr/bin/env bash
# Sparkle 安装/升级脚本共用路径的单一来源（source 后只设变量，无副作用）。
#
# 必须在 sparkle_pin_login_home（lib/login-home.sh）之后 source：先把 HOME 钉到登录用户的
# 真实家目录，再派生路径。沙箱 shell（IDE agent）会改写 $HOME，而 Sparkle 自己的配置、日志、
# 状态文件都在真实家目录下；从被改写的 HOME 派生路径，就是定时任务装到别处、门禁读空目录的根因。
#
# 每个变量都可由同名环境变量覆盖：生产默认值即下列表达式，测试用它把整条流水线指向临时目录。

: "${SPARKLE_STATE_DIR:=${HOME}/.sparkle}"
: "${SPARKLE_APP_DATA_DIR:=${HOME}/Library/Application Support/sparkle}"
: "${SPARKLE_LAUNCH_AGENTS_DIR:=${HOME}/Library/LaunchAgents}"
: "${SPARKLE_INSTALL_DEST:=/Applications/Sparkle.app}"

export SPARKLE_STATE_DIR SPARKLE_APP_DATA_DIR SPARKLE_LAUNCH_AGENTS_DIR SPARKLE_INSTALL_DEST
