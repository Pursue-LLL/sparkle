# src/main/core — 模块架构

Electron 主进程核心：mihomo 控制、订阅与配置生成、自动选择延迟序、Cursor 专用组与路由规则。

用户可感知网络僵死 / TUN 恢复缺陷台账：[BUGFIX_LOG.md](../../BUGFIX_LOG.md)（例：BUG-2026-07-09-001 mihomo 出站池僵死）。

Cursor 相关范围仅限：`🎯 Cursor 专用` 组（成员、仅手动选择、默认节点）与 Cursor 路由 / DNS 规则。长流稳定性类逻辑（keepalive、quiesce、探针平面、恢复编排、质量基准等）已全部移除，Sparkle 不再按 Cursor 流量做任何运行时干预。

## 文件清单

### mihomo 控制与启动

| 文件 | 职责 |
| ---- | ---- |
| `manager.ts` | core 进程 start / stop / restart；service 模式走签名 API；`startCore` 在 `generateProfile` 与 `checkProfileWithRetry` 之后才停旧核 |
| `mihomoApi.ts` | mihomo REST 封装；delay 经 `mihomoProbeCoordinator` 并发槽；provider 叶子节点（不在 `/proxies`）经 `mihomoProviderLeafDelay` 单点拨测，不触发 provider 级体检/重载；`mihomoChangeProxy` 对 Cursor 专用组仅放行 `manual` / `bootstrap` |
| `mihomoControllerReadyCore.ts` | controller 就绪探测 `GET /version`（service 模式走签名请求）；独立成模块以避免 rolldown 把 `mihomoApi` 动态 import 错绑到 `index.js`（会导致 `runPostCoreBootstrap` 永不执行） |
| `mihomoProbeCoordinator.ts` | 全局 mihomo delay 并发槽（最多 2，等待上限 30s） |
| `mihomoProxyDelayCore.ts` | `isMihomoApiResourceNotFoundError` · `resolveProviderNameForLeaf` · `MihomoDelayPurpose` |
| `mihomoProviderDelayCore.ts` / `mihomoGroupMembersCore.ts` | 托盘取最近成功样本 · 组成员解析 |
| `proxyDelayVerdictCore.ts` | 延迟展示的单一判定规则（ok / flaky / failed / untested）：连续失败 ≥3 次才判超时；渲染进程经 `@sparkle-core` 引用 |
| `providerLeafProbeCore.ts` / `providerLeafProbe.ts` | 冷启动低并发（4）逐点拨测：`sparkle-fast` 启动探测 + 地区组预热后复测「超时/未测」节点（总时长上限 150s），取代 provider 级并发体检 |
| `postCoreBootstrap.ts` | core 就绪后单一入口：`sparkle-fast` 延迟序 → `initProfileUpdater` → Cursor 专用默认节点 → 地区 url-test 预热 |
| `coreReadinessGate.ts` / `coreReadinessGateCore.ts` | 冷启动 Readiness Contract：sidecar → profile 检查 → startCore → API → 数据面探测 |
| `coreLifecycle.ts` / `coreLifecycleCore.ts` | core 就绪后 fake-ip flush（cold / manual restart 后卫生） |
| `probeWarmupCore.ts` / `probeWarmupState.ts` | 内核启动后批量测速窗口标志（`postCoreBootstrap` 开始/结束，5 分钟兜底）；经 `probeWarmupChanged` 事件与 `getProbeWarmupActive` IPC 推给代理页，窗口内无可信样本的节点显示 loading |
| `networkStartupGraceCore.ts` | 内核就绪后重网络探测的启动宽限（45s） |

### 配置生成与订阅

| 文件 | 职责 |
| ---- | ---- |
| `factory.ts` | runtime config 生成（provider 拆分、分组、规则、DNS、sniffer）；首步调用 `logBuildDriftAtStartup` |
| `provider.ts` / `providerConfigCore.ts` / `vpsProviderSplitCore.ts` | 订阅节点 → provider 文件；VPS 与商用节点拆成 `{profileId}-vps` 与商用 provider；`applyVlessVisionMuxGuard` |
| `mergeProfileCore.ts` | 合并订阅：按地区白名单取多个订阅节点并集，策略组与规则沿用 base 订阅 |
| `profileUpdater.ts` / `profileUpdaterCore.ts` / `profileUpdateDueCli.ts` | 订阅定时更新；`--sparkle-profile-update-due` CLI 入口 |
| `profileConfigRecoveryCore.ts` / `profileConfigRecoveryPureCore.ts` | BUG-2026-09-03-003 空/损坏 `profile.yaml` 从 `.bak` + 磁盘 profiles 恢复 · 禁止 persist 空配置 |
| `profileCacheRefreshCore.ts` / `profileCacheRefreshPureCore.ts` | 无 URL 时从磁盘 cache reload provider · 缺失 URL 双语错误 |
| `profileSubscriptionDisplayCore.ts` | 订阅到期 / 更新时间展示 SSOT |
| `serviceCoreProviderParityCore.ts` | service 模式 disk / runtime `proxy-providers` 与 live mihomo 不一致时触发 `/core/restart`，优先 `mihomoUpdateProxyProviders` 热重载 |

### 自动选择与地区组

| 文件 | 职责 |
| ---- | ---- |
| `sparkleFastProviderCore.ts` | `自动选择` 的 `sparkle-fast` provider 文件生成（纯函数）：按 `proxySwitchPriority` 地区分段平铺，剔除 AnyTLS / 香港，传入 `delayMs` 时段内按延迟升序（无样本垫段尾）；BUG-2026-10-09-001 |
| `sparkleFastLatencyOrderCore.ts` / `sparkleFastLatencyOrder.ts` | 延迟序运行时：Core 把 provider 探测历史折算成「节点→延迟」并做迟滞判定（≥50ms 且 ≥30% 才换首选）；运行时在内核就绪后重排并解除 `自动选择` 固定，每 30 分钟复查；实测结果落盘 `sparkle-fast-delays.json`，订阅刷新重建 provider 时用作排序依据 |
| `defaultAutoSwitchProxy.ts` | `自动选择` = `type:fallback`（`use:[sparkle-fast]`，Gemini 探测 `interval:300` / `timeout:5000` / `lazy:true`）；`Sparkle-<地区>` = 仅手动选择的 `type:url-test`（`interval:300` + `tolerance:2000` + `lazy:true`，BUG-2026-09-15-007），不被 `自动选择` 引用 |
| `regionalAutoSelectGroupsCore.ts` / `regionalUrlTestWarmup.ts` / `regionalUrlTestWarmupCore.ts` | `Sparkle-<地区>` 组构建（排除 AnyTLS，无可用节点的地区不建组）与启动预热 |
| `autoSelectAnyTlsExclusionCore.ts` | url-test 自动选择组剔除 AnyTLS |
| `regionPriority.ts` | 地区优先级（台湾 → 日本 → 韩国 → 新加坡 → 美国） |
| `customProxyGroups.ts` / `profileGroupNormalize.ts` | 自定义组（Cursor 专用、香港过滤）注入与订阅主选择组归一 |

### Cursor 专用组与规则

| 文件 | 职责 |
| ---- | ---- |
| `cursorProxyGroup.ts` | Cursor 专用组名 / 成员过滤（`CURSOR_VPS_PROVIDER_FILTER`、`filterCursorEligibleVpsLeaves`）/ selector 解析 |
| `cursorDedicatedDefault.ts` | 启动恢复手选；无手选时默认节点 `CURSOR_DEFAULT_VPS_NODE` |
| `cursorDedicatedSelectionCore.ts` | 手选节点持久化（`writeCursorDedicatedManualSelection`） |
| `cursorDedicatedManualOnlyCore.ts` | Cursor 专用组仅允许手动 / 启动恢复切换，自动来源一律拒绝 |
| `cursorRuleInjection.ts` | Cursor DOMAIN / PROCESS-NAME 规则 → 🎯 Cursor 专用；可选 path-scoped AND 规则（`cursorBidiOptimize` 控制开关） |
| `cursorAppBundlePathsCore.ts` / `cursorPathPrefixProfileReloadCore.ts` | Cursor .app 路径前缀 SSOT · 前缀变更触发 profile 重生成 |
| `fakeIpRoutingIntegrity.ts` | fake-ip 路由一致性：Tier0 Cursor · Tier0 Direct · Tier1 Proxy · sniffer 完整性 |

### 网络与 DNS

| 文件 | 职责 |
| ---- | ---- |
| `network.ts` / `networkPublicDnsCore.ts` | 网卡与系统 DNS 管理；TUN 启动时设公共 DNS |
| `dnsFallbackIntegrity.ts` | DNS fallback 完整性 |
| `corporateDnsCore.ts` / `corporateDirectRules.ts` / `corporateDefaultInterface.ts` | 公司内网 DNS / 直连规则 / 默认网卡 |
| `tunStartupGuard.ts` / `tunStartupGuardCore.ts` | 识别 TUN adapter 监听成功 / 权限错误日志 |
| `vpsDirectBypass.ts` | VPS 服务器 IP 直连规则与 TUN / sniffer 排除 |
| `hongKongTrafficRuleInjection.ts` / `antigravityRuleInjection.ts` | 香港流量规则 · Antigravity 地区路由规则 |

## 启动数据流

```
startCore (manager.ts)
  → generateProfile (factory.ts) → checkProfileWithRetry → mihomo up
  → runPostCoreBootstrap (postCoreBootstrap.ts)
       ├ sparkle-fast 延迟序 bootstrap + 30min 复查
       ├ initProfileUpdater
       ├ applyCursorDedicatedVpsSelection（恢复手选 / 默认节点）
       └ NETWORK_MONITOR_STARTUP_GRACE_MS 后 warmupRegionalUrlTestGroups
```

## App 配置路径

| 路径 | 内容 |
|------|------|
| `~/Library/Application Support/sparkle/config.yaml` | UI 与行为开关 |
| `~/Library/Application Support/sparkle/sparkle-fast-delays.json` | `sparkle-fast` 延迟快照 |

修改 `config.yaml` 后须完全退出并重启 Sparkle 方生效（主进程内存缓存）。

## 测试

```bash
pnpm run test:node-quality
pnpm run agent:upgrade:mac   # Agent SSOT：build(if needed) + install + post gate
pnpm run upgrade:mac         # 本地装 /Applications + PostCoreBootstrap 门控（网络失败：SKIP_PREPARE=1）
```

## 构建标识（UI）

| 路径 | 职责 |
|------|------|
| `scripts/writeBuildStampCore.ts` | `YYYY.MMDD.HHMM` 格式 SSOT |
| `scripts/write-build-stamp.ts` | 写入 `src/shared/buildStamp.ts`（`dev` / `build:*` / upgrade 前），含 git commit 与 dirty |
| `src/shared/buildStamp.ts` | 生成物：`SPARKLE_BUILD_STAMP` + `SPARKLE_SEMVER` + `SPARKLE_GIT_COMMIT` + `SPARKLE_GIT_DIRTY` |
| `src/main/utils/ipc.ts` | `getBuildStamp` IPC |
| `src/renderer/src/pages/proxies.tsx` | 代理组标题旁 Chip 展示 build stamp |

### 构建漂移检测（R-52）

`com.sparkle.profile-scheduler` LaunchAgent 每 300s 直接执行 `/Applications/Sparkle.app`
的二进制（`--sparkle-profile-update-due`），绕开仓库执行 `generateProfile()`。源码改动
若未进入二进制，运行时仍执行旧逻辑且外部无信号——AnyTLS 剔除即因此被静默回退
（见 BUG-2026-10-01-002）。

判定 SSOT 在 `buildDriftPureCore`，`scripts` 与 `src` 共用，避免逻辑分叉：

| 组件 | 职责 |
|------|------|
| `src/main/core/buildDriftPureCore.ts` | 判定 SSOT：`detectBuildDrift` / `normalizeCommit` |
| `src/main/core/buildDriftCore.ts` | 运行时入口：读仓库 git 事实，写 `[BuildDrift]` 日志（进程内仅一次） |
| `src/main/core/factory.ts` | `generateProfileImpl` 首步调用 `logBuildDriftAtStartup` |
| `scripts/check-build-drift.ts` | `pnpm run check:drift` 主动查询，退出码 1 = 漂移 |

四种判定结果：`match`（一致）/ `commit_mismatch`（app 旧于仓库）/ `app_dirty`（构建时
工作区不干净，构建不可复现）/ `app_unknown`（无 commit 事实的旧构建）。仓库侧 dirty
**不算**漂移——commit 仍是权威标识，未提交改动本就不会进入 app。

详见 [src/shared/_ARCH.md](../shared/_ARCH.md)。
