# src/main/core — 模块架构

Electron 主进程核心：mihomo 控制、订阅与配置生成、自动选择延迟序、Cursor / 邮件专用组与路由规则。

用户可感知网络僵死 / TUN 恢复缺陷台账：[BUGFIX_LOG.md](../../BUGFIX_LOG.md)（例：BUG-2026-07-09-001 mihomo 出站池僵死）。

Cursor 相关范围仅限：`🎯 Cursor 专用` 组（成员、仅手动选择、默认节点）与 Cursor 路由 / DNS 规则。长流稳定性类逻辑（keepalive、quiesce、探针平面、恢复编排、质量基准等）已全部移除，Sparkle 不再按 Cursor 流量做任何运行时干预。

## 文件清单

### mihomo 控制与启动

| 文件 | 职责 |
| ---- | ---- |
| `manager.ts` | core 进程 start / stop / restart；service 模式走签名 API；`startCore` 在 `generateProfile` 与 `checkProfileWithRetry` 之后才停旧核 |
| `mihomoApi.ts` | mihomo REST 封装；delay 经 `mihomoProbeCoordinator` 并发槽；provider 叶子节点（不在 `/proxies`）经 `mihomoProviderLeafDelay` 单点拨测，不触发 provider 级体检/重载；`mihomoChangeProxy` 对 Cursor 专用组仅放行 `manual` / `bootstrap`；`subscribeMihomoLogs` 提供进程内日志订阅（邮件按需探测等活动判定使用） |
| `mihomoControllerReadyCore.ts` | controller 就绪探测 `GET /version`（service 模式走签名请求）；独立成模块以避免 rolldown 把 `mihomoApi` 动态 import 错绑到 `index.js`（会导致 `runPostCoreBootstrap` 永不执行） |
| `mihomoProbeCoordinator.ts` | 全局 mihomo delay 并发槽（最多 2，等待上限 30s） |
| `mihomoProxyDelayCore.ts` | `isMihomoApiResourceNotFoundError` · `resolveProviderNameForLeaf` · `MihomoDelayPurpose` |
| `mihomoGroupMembersCore.ts` | 组成员解析；同名节点在多个 provider 的样本经 `poolProxyInstances` 合并 |
| `proxyProbeHistoryCore.ts` | 节点探测样本的唯一取数口径：按组实际探测地址读 `extra[url]`（忽略 http/https 差异，同一目标的多份记录按时间合并而非只取其一），不再读混杂各地址样本的顶层 `history`；`poolProxyInstances` 合并同一节点多份样本；渲染进程经 `@sparkle-core` 引用 |
| `proxyDelayVerdictCore.ts` | 延迟展示的单一判定规则（ok / flaky=不稳定 / failed / untested）：在 `judgeProxyForUrl` 取到的单一探测地址样本上，窗口内一次都没成功才判超时，最近失败但近期成功过判不稳定；`judgeOtherProbeUrls` 给出其它探测地址上的表现；代理页、详情浮窗、两处托盘、复测共用 |
| `providerLeafProbeCore.ts` / `providerLeafProbe.ts` | 冷启动低并发（4）逐点拨测：`sparkle-fast` 启动探测 + 地区组预热发生时复测最近一次样本不是成功的节点（超时/不稳定/未测，总时长上限 150s），取代 provider 级并发体检 |
| `postCoreBootstrap.ts` | core 就绪后单一入口：`sparkle-fast` 延迟序 → `autoSelectStickyPin` 粘性固定 → `sparkleMailProbe` 邮件端口探测（异步）→ `sparkleAgyProbe` agy 可用性巡检（异步）→ `initProfileUpdater` → Cursor 专用默认节点 → 地区 url-test 预热（仅活动/选中的组；未使用时不预热） |
| `coreReadinessGate.ts` / `coreReadinessGateCore.ts` | 冷启动 Readiness Contract：sidecar → profile 检查 → startCore → API → 数据面探测 |
| `coreLifecycle.ts` / `coreLifecycleCore.ts` | core 就绪后 fake-ip flush（cold / manual restart 后卫生） |
| `probeWarmupCore.ts` / `probeWarmupState.ts` | 内核启动后批量测速窗口标志（`postCoreBootstrap` 开始/结束，5 分钟兜底）；经 `probeWarmupChanged` 事件与 `getProbeWarmupActive` IPC 推给代理页，窗口内无可信样本的节点显示 loading |
| `networkStartupGraceCore.ts` | 内核就绪后重网络探测的启动宽限（45s） |

### 配置生成与订阅

| 文件 | 职责 |
| ---- | ---- |
| `factory.ts` | runtime config 生成（provider 拆分、分组、规则、DNS、sniffer）；首步调用 `logBuildDriftAtStartup` |
| `provider.ts` / `providerConfigCore.ts` / `vpsProviderSplitCore.ts` | 订阅节点 → provider 文件；VPS 与商用节点拆成 `{profileId}-vps` 与商用 provider（均默认开启 `lazy:true` 体检）；`sparkle-fast` / `sparkle-mail` provider 分别使用 `Gemini` / `mail.google.com` + `lazy:true` 体检，并在订阅刷新（`reloadMihomoProfileProviders`）时同步热重载；`applyVlessVisionMuxGuard` |
| `mergeProfileCore.ts` | 合并订阅：按地区白名单取多个订阅节点并集，策略组与规则沿用 base 订阅；无独立定时，来源订阅更新时重建（并写入自身 `updated`），来源比它新时由更新心跳补重建 |
| `profileUpdater.ts` / `profileUpdaterCore.ts` / `profileUpdateDueCli.ts` | 订阅自动更新：判定「最近一个计划时刻之后是否成功更新过」，不依赖定时器恰好触发。GUI 每 5 分钟心跳（启动后 60s 首次）与 LaunchAgent（`--sparkle-profile-update-due`，同样每 5 分钟）共用 `createDueProfileUpdateRunner`：先更新到期的来源订阅，再补齐落后于来源的合并订阅；单次更新 2 分钟超时兜底，并发调用共享同一次执行；失败不推进 `updated`，下次心跳自动重试 |
| `profileConfigRecoveryCore.ts` / `profileConfigRecoveryPureCore.ts` | BUG-2026-09-03-003 空/损坏 `profile.yaml` 从 `.bak` + 磁盘 profiles 恢复 · 禁止 persist 空配置 |
| `profileCacheRefreshCore.ts` / `profileCacheRefreshPureCore.ts` | 无 URL 时从磁盘 cache reload provider · 缺失 URL 双语错误 |
| `profileSubscriptionDisplayCore.ts` | 订阅到期 / 更新时间展示 SSOT |
| `serviceCoreProviderParityCore.ts` | service 模式 disk / runtime `proxy-providers` 与 live mihomo 不一致时触发 `/core/restart`，优先 `mihomoUpdateProxyProviders` 热重载 |

### 自动选择与地区组

| 文件 | 职责 |
| ---- | ---- |
| `sparkleFastProviderCore.ts` | `自动选择` 的 `sparkle-fast` provider 文件生成（纯函数）：按 `proxySwitchPriority` 地区分段平铺，剔除 AnyTLS / 香港 / 已确认 Gemini 锁区或送中节点（`blockedNodeNames`）；传入非空 `delayMs` 时，有样本（存活）节点按地区分段 + 段内延迟升序排在前，无样本（超时/未测）节点按地区序统一垫在文件末尾；BUG-2026-10-09-001 / BUG-2026-10-14-001 / BUG-2026-10-17-001 |
| `sparkleGeminiProbeCore.ts` / `sparkleGeminiProbe.ts` | Gemini 真实地区解锁流式探测与缓存（`sparkle-gemini-nodes.json`）：通过本地隐藏探测监听器 `127.0.0.1:17899`（与邮件探测共享 `withLocalProbeChannelLock` 串行互斥锁）流式读取 `https://gemini.google.com/app` 前部 `WIZ_global_data.vXmutd` 地区码，将返回 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或 `www.google.cn` 的“送中/锁区”节点剔除出 `sparkle-fast-proxies.yaml` 并热重载；网络超时绝不误判为锁区 |
| `sparkleFastLatencyOrderCore.ts` / `sparkleFastLatencyOrder.ts` | 延迟序运行时：Core 把 provider 探测历史折算成「节点→延迟」、校验完整探测覆盖率（≥80%）并做迟滞判定（≥50ms 且 ≥30% 才换首选）；运行时在内核就绪后若磁盘已有延迟快照则直接沿用（仅在原固定节点不存活时解除固定），免除冷启动重复全量拨测与重载；每 30 分钟复查且不解除固定；实测结果落盘 `sparkle-fast-delays.json`，订阅刷新重建 provider 时用作排序依据 |
| `autoSelectStickyPinCore.ts` / `autoSelectStickyPin.ts` | `自动选择` 粘性固定：Core 决策（fallback 选出的 `now` 连续稳定 2 次轮询即固定；原固定被清除时先触发单点独立复测过滤并发体检误杀，10 分钟冷却防死守抖动节点；固定节点已不在组内则解除）；运行时每 3 秒 `GET /proxies/自动选择`（不触发 lazy 体检），固定前确认 Gemini 存活且地区解锁（`verifyNodeGeminiRegion`），固定期间锁区复核按 5 分钟节流/节点变化立即复核，避免每 3 秒解析订阅文件；若发现送中/锁区节点立即拒绝或解除固定并从 `sparkle-fast` 剔除，主动解锁同步重置记忆，日志 `[AutoSelectSticky]: pinned X (left Y)` / `restored X` |
| `defaultAutoSwitchProxy.ts` | `自动选择` = `type:fallback`（`use:[sparkle-fast]`，Gemini 探测 `interval:300` / `timeout:5000` / `lazy:true`）；`Sparkle-<地区>` = 仅手动选择的 `type:url-test`（`interval:300` + `tolerance:2000` + `lazy:true`，BUG-2026-09-15-007），不被 `自动选择` 引用 |
| `regionalAutoSelectGroupsCore.ts` / `regionalUrlTestWarmup.ts` / `regionalUrlTestWarmupCore.ts` | `Sparkle-<地区>` 组构建（排除 AnyTLS，无可用节点的地区不建组）与按需启动预热：只预热活动连接链路或当前被选中的组，未使用不扫描 |
| `autoSelectAnyTlsExclusionCore.ts` | url-test 自动选择组剔除 AnyTLS |
| `regionPriority.ts` | 地区优先级（台湾 → 日本 → 韩国 → 新加坡 → 美国） |
| `customProxyGroups.ts` / `profileGroupNormalize.ts` | 自定义组（Cursor 专用、香港过滤、📧 邮件专用、🎯 agy 专用、隐藏探测组 `__sparkle_mail_probe__`）注入与订阅主选择组归一 |

### 邮件专用组（macOS Mail / 海外 IMAP·SMTP）

| 文件 | 职责 |
| ---- | ---- |
| `sparkleMailProviderCore.ts` | `sparkle-mail` provider 文件生成（纯函数）：仅收录通过 **IMAPS 993 + SMTPS 465** 双端口 TLS 握手与 Banner 校验的节点（缓存见 `sparkle-mail-nodes.json`）；冷启动无缓存时先排除 AnyTLS，优先 Hysteria2/VLESS 候选兜底，**禁止空 provider**；组配置 `buildMailGroupConfig`、隐藏探测组与 `listeners`（`127.0.0.1:17899` → `__sparkle_mail_probe__`） |
| `sparkleMailPortProbe.ts` | 邮件 993/465 与 Gemini 地区探测共用的本地隐藏监听器通道：`withLocalProbeChannelLock` 串行切换 `__sparkle_mail_probe__` 节点，`probeSingleNodeMailPorts` 做单节点 IMAPS `* OK` + SMTPS `220` Banner 校验 |
| `sparkleMailProbe.ts` | 内核就绪后通过隐藏 mixed 监听器对订阅叶子逐点探测 `imap.gmail.com:993`（`* OK`）与 `smtp.gmail.com:465`（`220`），结果写入 `sparkle-mail-proxies.yaml`；provider 成员集合发生变化时才 `mihomoUpdateProxyProviders('sparkle-mail')` 热重载（不再只在 `newly_alive>0` 时重载）；先测 Hysteria2/VLESS 等优先候选，其余后台补测；每小时复查缓存过期节点 |
| `sparkleMailCurrentNodeProbe.ts` | 按需保护 `📧 邮件专用` 当前节点：邮件组最近有活动（`/connections` 链路或内核日志出现该组）才复测当前节点 993/465；失败立即标记 dead、写 provider 并在成员变化时热重载；完全未使用邮件时 0 次端口探测 |
| `sparkleMailActivityCore.ts` | 邮件活动判定纯函数：`connectionChainsIncludeGroup` · `nextMailActivityAtMs` · `isMailGroupRecentlyActive`（30 分钟观察窗口） |
| `mailTrafficRuleInjection.ts` | 前置规则：`imap.gmail.com` / `smtp.gmail.com` / `pop.gmail.com` / `googlemail.com` / Outlook·iCloud·Yahoo 收发域名 → `📧 邮件专用`（**不**劫持 `gmail.com` 网页或国内邮箱） |
| `cursorProxyGroup.ts` | `MAIL_DEDICATED_GROUP_NAME` · `MAIL_DELAY_TEST_URL`（`https://mail.google.com`）· `resolveDelayTestUrl` 分支 |

**设计约束（实测）**：mihomo `url-test` 的 `url` **不能**设为 `https://imap.gmail.com:993`——底层 HTTP 客户端无法解析 IMAP Banner，会误判全节点超时；443 探测也无法筛掉「仅封邮件端口」的机场节点，故 Sparkle 主进程做真实 993/465 TLS 探测，组内日常保活才用 `mail.google.com`。

### Antigravity / Code Assist 专用组（magpie · agy）

| 文件 | 职责 |
| ---- | ---- |
| `sparkleAgyProviderCore.ts` | `sparkle-agy` provider 文件生成（纯函数）：只收录通过**真实 agy 请求（HTTP 200）**的节点；节点指纹 `proxyNodeFingerprintCore.ts`；`classifyAgyProbeResponse`（200=可用 / 400 `location is not supported`=不可用 / 404·405=中止 / 其它=不下结论）；组配置 `buildAgyGroupConfig`（`select` + `use: sparkle-agy`） |
| `sparkleAgyProbe.ts` | 内核就绪后借 magpie 本地网关 `127.0.0.1:3425` 逐节点发 1-token 真实请求，结果写 `sparkle-agy-nodes.json` 并重写 `sparkle-agy-proxies.yaml` + `mihomoUpdateProxyProviders('sparkle-agy')`；TTL 12h 可用 / 6h 不可用，30min 轮询检查是否过期，magpie 未启动直接跳过 |
| `antigravityRuleInjection.ts` | 前置规则：`DOMAIN-KEYWORD,cloudcode-pa` / `aicode.googleapis.com` / `generativelanguage.googleapis.com` → `🎯 agy 专用`（组缺席回退 `自动选择`） |

**设计约束（实测）**：`daily-cloudcode-pa` 的地域校验在认证之后——无凭证请求返回 `HTTP 401 CREDENTIALS_MISSING`，因此 `gemini.google.com` 流式探测（`sparkleGeminiProbe`）在原理上无法筛出「网页可用但 Code Assist 被拒」的节点；只能借持有账号凭证的 magpie 做端到端判定。巡检需要切换到候选节点，而 mihomo 只能切到 provider 内节点，故巡检窗口内 provider 临时扩为全量候选（不改当前选择），结束后收敛。

### Cursor 专用组与规则

| 文件 | 职责 |
| ---- | ---- |
| `cursorProxyGroup.ts` | Cursor 专用组名 / 成员过滤（`CURSOR_VPS_PROVIDER_FILTER`、`filterCursorEligibleVpsLeaves`）/ selector 解析 |
| `cursorDedicatedDefault.ts` | 启动恢复手选；无手选时默认节点 `CURSOR_DEFAULT_VPS_NODE` |
| `cursorDedicatedSelectionCore.ts` | 手选节点持久化（`writeCursorDedicatedManualSelection`） |
| `cursorDedicatedManualOnlyCore.ts` | Cursor 专用组仅允许手动 / 启动恢复切换，自动来源一律拒绝 |
| `cursorRuleInjection.ts` | Cursor DOMAIN / PROCESS-NAME 规则 → 🎯 Cursor 专用；可选 path-scoped AND 规则（`cursorBidiOptimize` 控制开关） |
| `cursorAppBundlePathsCore.ts` / `cursorPathPrefixProfileReloadCore.ts` | Cursor .app 路径前缀 SSOT（默认 主 / Latest / Cursor-2 / Cursor-3 全走 `🎯 Cursor 专用`，「节点选择」默认列表为空）· 前缀变更触发 profile 重生成 |
| `fakeIpRoutingIntegrity.ts` | fake-ip 路由一致性：Tier0 Cursor · Tier0 Direct · Tier1 Proxy · sniffer 完整性 |

### 网络与 DNS

| 文件 | 职责 |
| ---- | ---- |
| `network.ts` / `networkPublicDnsCore.ts` | 网卡与系统 DNS 管理；TUN 启动时设公共 DNS |
| `dnsFallbackIntegrity.ts` | DNS fallback 完整性 |
| `corporateDnsCore.ts` / `corporateDirectRules.ts` / `corporateDefaultInterface.ts` | 公司内网 DNS / 直连规则 / 默认网卡 |
| `aiApiDirectRules.ts` | 默认直连规则：`AI_API_DIRECT_HOSTS`（当前 `api.commandcode.ai` / `opencode.ai`，含其子域）未被任何规则提及时前置 `DIRECT`（实测 p50 快 0.32s / 0.65s）；覆写或订阅用 `DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD` 提过同一域名、父域或其子域就完全让路（不改写、不重复）。新增域名只改该常量，单测按清单生成期望值 |
| `tunStartupGuard.ts` / `tunStartupGuardCore.ts` | 识别 TUN adapter 监听成功 / 权限错误日志 |
| `vpsDirectBypass.ts` | VPS 服务器 IP 直连规则与 TUN / sniffer 排除 |
| `hongKongTrafficRuleInjection.ts` / `mailTrafficRuleInjection.ts` / `antigravityRuleInjection.ts` / `aiApiDirectRules.ts` | 香港 / 海外邮件客户端 / Antigravity / AI API 直连前置分流规则 |
| `quicTrafficRuleInjection.ts` | QUIC / STUN 泄漏防护前置规则：`AND,((DST-PORT,443),(NETWORK,UDP)),REJECT` 阻断 HTTP/3，`DOMAIN-SUFFIX,stun.cloudflare.com,REJECT` 阻断 WebRTC 探测；节点不支持 UDP 时浏览器 UDP 会回退 `DIRECT`，导致 TCP/UDP 出口 IP 分裂触发 Cloudflare WAF 拦截 |

## 启动数据流

```
startCore (manager.ts)
  → generateProfile (factory.ts) → checkProfileWithRetry → mihomo up
  → runPostCoreBootstrap (postCoreBootstrap.ts)
       ├ sparkle-fast 延迟序 bootstrap + 30min 复查
       ├ startAutoSelectStickyPin（3s 粘性固定轮询）
       ├ bootstrapSparkleMailProvider + 60min 邮件端口复查（异步，不阻塞上文）
       ├ initProfileUpdater
       ├ applyCursorDedicatedVpsSelection（恢复手选 / 默认节点）
       └ NETWORK_MONITOR_STARTUP_GRACE_MS 后 warmupRegionalUrlTestGroups
```

## 规则优先级（覆写 > 内置默认 > 订阅）

`generateProfile` 先应用覆写（`overrideProfile`：全局 + 单订阅，支持 YAML deepMerge 与 JS 脚本），再跑各注入步骤；注入的前置规则会排在订阅规则之前，因此内置默认必须"缺才加"：目标域名已有任何规则命中（按 mihomo 语义判断 `DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD`）时，`aiApiDirectRules` 一律让路，不改写、不重复。

`~/Library/Application Support/sparkle/work/config.yaml` 是 `generateProfile` 的**生成物**（内核启动 / 切换订阅 / 改设置都会整份重写），禁止手改；持久改动只有两条路：改注入代码，或写覆写。

## App 配置路径

| 路径 | 内容 |
|------|------|
| `~/Library/Application Support/sparkle/config.yaml` | UI 与行为开关 |
| `~/Library/Application Support/sparkle/sparkle-fast-delays.json` | `sparkle-fast` 延迟快照 |
| `~/Library/Application Support/sparkle/sparkle-gemini-nodes.json` | Gemini 真实地区解锁（`vXmutd` 国家码）探测缓存 |
| `~/Library/Application Support/sparkle/sparkle-mail-nodes.json` | 邮件 993/465 双通探测缓存（按节点指纹 TTL） |
| `~/Library/Application Support/sparkle/profiles/sparkle-mail-proxies.yaml` | `📧 邮件专用` 的 provider 成员（仅双通节点） |

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
