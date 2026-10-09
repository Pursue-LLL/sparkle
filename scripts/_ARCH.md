# scripts — 运维与构建脚本

Shell/TS 脚本：本地升级、安装门禁、post-upgrade 验收。

## 文件清单

| 文件 | 职责 |
| --- | --- |
| `agent-sparkle-upgrade.sh` | **Agent SSOT**：dist 就绪则仅 install，否则 full upgrade；装后数据面就绪门禁 + profile due-check |
| `upgrade-sparkle-local.sh` | 本地 dev 一条龙：vite → electron-builder dir → asar gate → install → PostCoreBootstrap `mihomo API ready` 门控（macOS 26 且未设 `macos26ForceGui` 走 headless 分支，否则走 GUI 就绪门禁） |
| `install-sparkle-local.sh` | 仅安装 `dist/mac-arm64/Sparkle.app` → `/Applications` |
| `verify-sparkle-main-asar.mts` | Stage-B：app.asar 内 main bundle marker 门禁 |
| `verify-sparkle-bundle.mts` | Stage-A：vite 后 out/main bundle marker 门禁 |
| `lib/login-home.sh` | `sparkle_pin_login_home`：把 `HOME` 固定为登录用户真实主目录（Agent 沙箱会改写 `HOME`，门禁/护栏需读真实日志与状态目录）；`upgrade-sparkle-local.sh` 构建后、`install-sparkle-local.sh` 开头调用 |
| `upgradeSparklePostInstallGateCore.ts` | 装包后门禁纯函数：按安装行偏移计 PostCoreBootstrap 失败 / API 就绪 / headless 引导完成 |
| `open-sparkle-gui-macos26.sh` | macOS 26 SSOT：带 GUI 启动（`--sparkle-force-gui`） |
| `sparkle-profile-scheduler.sh` | LaunchAgent worker：远程订阅到期刷新 |
| `install-sparkle-profile-scheduler.sh` | 安装 profile scheduler LaunchAgent |

## Agent 升级（唯一入口）

```bash
cd /path/to/sparkle
bash scripts/agent-sparkle-upgrade.sh
```

等价 `pnpm run agent:upgrade:mac`。禁止 Agent 裸跑 `pnpm build:mac` 或后台 build 后忘记 install。

## 依赖

- `package.json` version = 目标 semver
- `BUGFIX_LOG.md` §「Sparkle 本地安装」· §「AI Agent 操作约束」
