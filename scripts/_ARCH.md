# scripts — 运维与构建脚本

Shell/TS 脚本：本地升级、安装门禁、断连 triage、post-upgrade 验收。

## 文件清单

| 文件 | 职责 |
| --- | --- |
| `agent-sparkle-upgrade.sh` | **Agent SSOT**：dist 就绪则仅 install，否则 full upgrade；装后 byte-death gate + preflight |
| `upgrade-sparkle-local.sh` | 本地 dev 一条龙：vite → electron-builder dir → asar gate → install → PostCoreBootstrap 门控 |
| `install-sparkle-local.sh` | 仅安装 `dist/mac-arm64/Sparkle.app` → `/Applications`（Marathon PRE-gate） |
| `verify-byte-death-recovery-gate.mts` | post-upgrade：max_byte_stall + R2 executed 硬判据 |
| `verify-sparkle-main-asar.mts` | Stage-B：app.asar 内 main bundle marker 门禁 |
| `verify-marathon-mutation-callers.mts` | Stage-A：startCore/restartCore allowlist + reload script guard marker 门禁（BUG-2026-08-29-001 R3） |
| `verify-marathon-data-plane-soak-gate.mts` | Post-install P3：guard defer 后零 mihomo cold start（BUG-2026-08-29-001 R3） |
| `verify-sparkle-bundle.mts` | Stage-A：vite 后 out/main bundle marker 门禁 |
| `lib/marathon-core-restart-guard.sh` | 马拉松期 install/upgrade PRE-gate；override `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1` |
| `triage-cursor-disconnect.sh` | Cursor 断连一键采集 |
| `marathonStabilityAttributionCore.ts` | Phase 0：从 core/app/stability 日志自动 L1/L2/L3/L7 归因（纯函数） |
| `marathon-stability-attribution-report.mts` | Phase 0 CLI：`tsx scripts/marathon-stability-attribution-report.mts [--hours 24]` |
| `marathonStabilityAttributionCore.test.ts` | Phase 0 归因单测 |
| `marathonStabilityLogPathsCore.ts` | 多 core/app Sparkle 日志文件发现（无 Cursor） |
| `marathonStabilitySparkleConservationCore.ts` | Sparkle-only 守恒报告 core |
| `marathon-stability-conservation-report.mts` | 默认 SSOT：`tsx scripts/marathon-stability-conservation-report.mts [--hours 24] [--full]` |
| `marathonStabilitySparkleConservationCore.test.ts` | Sparkle-only 守恒单测 |
| `open-sparkle-gui-macos26.sh` | macOS 26 SSOT：带 GUI 启动（`--sparkle-force-gui`） |
| `sparkle-profile-scheduler.sh` | LaunchAgent worker：远程订阅到期刷新 |
| `install-sparkle-profile-scheduler.sh` | 安装 profile scheduler LaunchAgent |
| `verify-marathon-mutation-callers.mts` | CI：静态审计 startCore/restartCore/reload 调用点 |

## Agent 升级（唯一入口）

```bash
cd /path/to/sparkle
bash scripts/agent-sparkle-upgrade.sh
# 马拉松紧急：SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 bash scripts/agent-sparkle-upgrade.sh
```

等价 `pnpm run agent:upgrade:mac`。禁止 Agent 裸跑 `pnpm build:mac` 或后台 build 后忘记 install。

## 依赖

- `package.json` version = 目标 semver
- `BUGFIX_LOG.md` §「Sparkle 本地安装」· §「AI Agent 操作约束」
