# src/main/core — 模块架构

Electron 主进程核心：mihomo 控制、订阅与配置生成、运行时配置与内核对账重载、自动选择延迟序、分组策略表与故障转移、Cursor / 邮件 / grok / agy 专用组与路由规则；邮件当前节点按需复测 993/465，grok 当前节点每 60 秒真实请求复核，agy 出口每 30min 就地复测、坏时按地区优先级修复，地区组按需预热。

缺陷台账：仓库级 [BUGFIX_LOG.md](../../../BUGFIX_LOG.md)（用户可感知的网络僵死 / TUN 恢复等，例：BUG-2026-07-09-001 mihomo 出站池僵死）；本目录按「模块 + 7 日」归档的缺陷日志为 `core_<起>_<止>_BUGFIX_LOG.md`，最新一份 [core_20261107_20261113_BUGFIX_LOG.md](core_20261107_20261113_BUGFIX_LOG.md)（版本与构建标识、根因、遗漏、踩坑清单、复发统计）。新缺陷先查同一周的文件，没有就按该命名新建。

Cursor 相关范围仅限：`🎯 Cursor 专用` 组（成员、仅手动选择、默认节点）与 Cursor 路由 / DNS 规则。Sparkle 不按 Cursor 流量做任何运行时干预（没有 keepalive / quiesce / 探针平面 / 恢复编排；故障转移引擎只依据内核按组上报的连续拨号失败告警，对 `Sparkle-<地区>` url-test 组一视同仁，不识别流量归属，也不改写 `🎯 Cursor 专用` 的选择）。

## 文件清单

### mihomo 控制与启动

| 文件                                                | 职责                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manager.ts`                                        | core 进程 start / stop / restart；service 模式走签名 API；`startCore` 在 `generateProfile` 与 `checkProfileWithRetry` 之后才停旧核                                                                                                                                                                                             |
| `process-control.ts` / `startup-chain.ts` / `startupHook.ts` / `coreHookWaiter.ts` | 内核进程与启动判定：`stopChildProcess` 先 `SIGINT`，3 s 后 `SIGTERM`，6 s 后 `SIGKILL`；`startup-chain` 给出内核环境变量 / 启动参数、provider 初始化跟踪与控制器监听 / 就绪 / TUN 权限错误的日志判定；`startupHook` 生成 `.up` / `.down` 钩子文件及 post-up / post-down 命令；`coreHookWaiter` 监听 `.up` 文件（30 s 超时，内核子进程提前退出即拒绝） |
| `profile-check.ts` / `profileCheckRetry.ts` | 启动前配置校验：`mihomo -t` 校验 work 配置（`SAFE_PATHS` 含订阅目录与用户 `safePaths`，失败抛出 `level=error` 行）；`checkProfileWithRetry` 仅在报错含 `not found`（provider 瞬时缺口）时重新生成配置并重试，最多 3 次、间隔 2 s |
| `permission.ts` / `permission-check.ts` | 内核授权（setuid）：`checkCorePermission` 以 `ls -l` 的 `s` 位判定，`manualGrantCorePermition` / `revokeCorePermission` 经 osascript / pkexec 授予与撤销（Windows 的授予经提权计划任务），用户取消提权统一抛 `UserCancelledError` 以区别于真实失败 |
| `mihomoApi.ts` | mihomo REST 封装；delay 经 `mihomoProbeCoordinator` 并发槽；provider 叶子节点（不在 `/proxies`）经 `mihomoProviderLeafDelay` 单点拨测，不触发 provider 级体检/重载；`mihomoChangeProxy` 对 Cursor 专用组仅放行 `manual` / `bootstrap`；`reloadMihomoConfigFromDisk` 整配置重载；WebSocket 数据流统一从 `mihomoStreams` 再导出 |
| `mihomoStreams.ts` / `managedStream.ts` / `listenerHub.ts` | mihomo WebSocket 数据流：`managedStream` 管单条数据流的连接生命周期（`start` 幂等、`stop` 同时终止进行中的建连与待执行的重连、`restart`；建连失败同样进入重连链，无限重试的告警流不会因一次建连失败而永久失联）；`listenerHub` 管订阅者广播（首个订阅者出现 / 最后一个离开时回调启停，单个订阅者抛错不影响其余）；`mihomoStreams` 只做接线：traffic / memory / logs / connections 随界面与内核生命周期启停（断线重连 10 次）；`subscribeMihomoLogs` 提供进程内日志订阅（邮件按需探测等活动判定使用）；`subscribeMihomoAlerts` 是故障转移专用的 warning 级日志流，级别固定、不受界面日志级别与日志源影响，随订阅者增减启停，断线持续重连 |
| `mihomoControllerReadyCore.ts`                      | controller 就绪探测 `GET /version`（service 模式走签名请求）；独立成模块以避免 rolldown 把 `mihomoApi` 动态 import 错绑到 `index.js`（会导致 `runPostCoreBootstrap` 永不执行）                                                                                                                                                 |
| `mihomoProbeCoordinator.ts`                         | 全局 mihomo delay 并发槽（最多 2，等待上限 30s）                                                                                                                                                                                                                                                                               |
| `mihomoProxyDelayCore.ts` | `isMihomoApiResourceNotFoundError`（内核返回 `Resource not found`）· `resolveProviderNameForLeaf`（叶子所在 provider）：叶子不在 `/proxies` 时据此改走 provider 单点拨测端点 |
| `mihomoGroupMembersCore.ts`                         | 组成员解析；同名节点在多个 provider 的样本经 `poolProxyInstances` 合并                                                                                                                                                                                                                                                         |
| `proxyProbeHistoryCore.ts`                          | 节点探测样本的唯一取数口径：按组实际探测地址读 `extra[url]`（忽略 http/https 差异，同一目标的多份记录按时间合并而非只取其一），不读混杂各地址样本的顶层 `history`；`poolProxyInstances` 合并同一节点多份样本；渲染进程经 `@sparkle-core` 引用                                                                                |
| `proxyDelayVerdictCore.ts`                          | 延迟展示的单一判定规则（ok / flaky=不稳定 / failed / untested）：在 `judgeProxyForUrl` 取到的单一探测地址样本上，最新一次成功显示真实延迟；最新一次失败或超时时有效延迟严格为 0（超时），绝不借用历史成功数字冒充当前健康，近期成功过在详情中保留上次成功样本供历史审计；代理页、详情浮窗、两处托盘、复测共用                                                                |
| `providerLeafProbeCore.ts` / `providerLeafProbe.ts` | 冷启动低并发（4）逐点拨测：`sparkle-fast` 启动探测 + 地区组预热发生时复测最近一次样本不是成功的节点（超时/不稳定/未测，总时长上限 150s），取代 provider 级并发体检                                                                                                                                                             |
| `postCoreBootstrap.ts` | core 就绪后单一入口（等控制器就绪后开测速预热窗口，各服务经 `guarded` 相互隔离，单个失败只记日志）：`runtimeConfigSync` 运行时配置对齐（未重载时 `autoSwitchPinRelease` 释放自动组固定）→ `sparkle-fast` 延迟序 → 后台并行 Gemini 地区审计 / 邮件探测 / grok 选路探针 / agy 巡检 → `autoSelectStickyPin` 粘性固定 → `groupFailover` 故障转移 → `initProfileUpdater` → Cursor 专用默认节点 → 启动宽限后地区 url-test 按需预热（仅活动/选中的组；未使用时不预热）并复测未确认的失败节点 |
| `coreReadinessGate.ts` / `coreReadinessGateCore.ts` | 冷启动 Readiness Contract：sidecar → profile 检查 → startCore → API → 数据面探测                                                                                                                                                                                                                                               |
| `coreLifecycle.ts` / `coreLifecycleCore.ts`         | core 就绪后 fake-ip flush（cold / manual restart 后卫生）                                                                                                                                                                                                                                                                      |
| `probeWarmupCore.ts` / `probeWarmupState.ts`        | 内核启动后批量测速窗口标志（`postCoreBootstrap` 开始/结束，8 分钟兜底）；经 `probeWarmupChanged` 事件与 `getProbeWarmupActive` IPC 推给代理页，窗口内无可信样本的节点显示 loading                                                                                                                                              |
| `networkStartupGraceCore.ts`                        | 内核就绪后重网络探测的启动宽限（45s）                                                                                                                                                                                                                                                                                          |

### 配置生成与订阅

| 文件                                                                     | 职责                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory.ts` | runtime config 生成流水线的编排与落盘：覆写 → 节点 provider 与基础配置 → VLESS Vision 防护 → Sparkle 分组与专用流量规则 → 规则目标修复 → 自动选路组 → 分组排序与成员清理 → provider 文件 → VPS 直连旁路 / Cursor、公司、AI 直连规则 / DNS 与 fake-ip 完整性 → agy 规则 → 国内直连基线 → 兜底 `MATCH` → QUIC 阻断 → 序列化写盘；首步调用 `logBuildDriftAtStartup` |
| `runtimeConfigSanitize.ts` / `overrideProfile.ts` / `overrideScript.ts` / `sparkleProviderFiles.ts` | 自 `factory.ts` 拆出：订阅配置清洗与分组 provider 引用去重（`dns.respect-rules` 在缺少 `proxy-server-nameserver` 时一并删除——内核会因此拒绝整份配置）· 覆写（全局 + 单订阅，YAML deepMerge 与 JS 脚本；`overrideScript` 是脚本沙箱运行器：脚本只能返回对象，`console` 输出经注入的写日志函数落盘）· 五个 sparkle provider 文件的尽力写盘 |
| `cnDirectBaseline.ts` | 订阅没有任何国内感知规则（`GEOSITE/GEOIP,CN` 或 `RULE-SET`）时，在最后一条 `MATCH` 前补 `GEOSITE,CN,DIRECT` 与 `GEOIP,CN,DIRECT`，避免国内流量全部走代理；已有则不动 |
| `runtimeConfigSyncCore.ts` / `runtimeConfigSyncEngine.ts` / `runtimeConfigSync.ts` | 运行时配置与内核对账（Engine 是注入依赖的串行状态机，`runtimeConfigSync.ts` 只做接线）：Core 对 `rules` / `sub-rules` / `rule-providers` / `proxy-groups` / `proxy-providers` 取指纹，并用 `GET /rules` 条数与磁盘对账（跨进程兜底），判定是否整配置重载；运行时串行执行 `PUT /configs?force=true`（采用磁盘 `config.yaml`，解析失败内核保持原配置），失败只记日志不重启内核，重载后释放自动组固定；`regenerateAndSyncProfile` 供订阅应用 / 缓存刷新使用，无变化时才退回 provider 热重载 |
| `provider.ts` / `providerConfigCore.ts` / `vpsProviderSplitCore.ts` / `vlessVisionMuxGuardCore.ts` | 订阅节点 → provider 文件；VPS 与商用节点拆成 `{profileId}-vps` 与商用 provider（均默认开启 `lazy:true` 体检）；`sparkle-fast` / `sparkle-mail` provider 分别使用 `Gemini` / `mail.google.com` + `lazy:true` 体检，并在订阅刷新（`reloadMihomoProfileProviders`）时同步热重载；订阅刷新热重载 provider 后释放孤儿固定（`releaseAutoSwitchPins('orphans')`）；`applyVlessVisionMuxGuard` 对 VLESS Vision 节点移除 `multiplex` 并显式写 `smux: false`（Vision 与 sing-mux 互斥）                                                          |
| `mergeProfileCore.ts`                                                    | 合并订阅：按地区白名单取多个订阅节点并集，策略组与规则沿用 base 订阅；同时把来源订阅的 `dns.proxy-server-nameserver` 按来源节点 `server` 域名写入 `proxy-server-nameserver-policy`，只影响来源自身域名、不覆盖 base DNS；无独立定时，来源订阅更新时重建（并写入自身 `updated`），来源比它新时由更新心跳补重建                                                     |
| `profileUpdater.ts` / `profileUpdaterCore.ts` / `profileUpdateDueCli.ts` | 订阅自动更新：判定「最近一个计划时刻之后是否成功更新过」，不依赖定时器恰好触发。GUI 每 5 分钟心跳（启动后 60s 首次）与 LaunchAgent（`--sparkle-profile-update-due`，同样每 5 分钟）共用 `createDueProfileUpdateRunner`：先更新到期的来源订阅，再补齐落后于来源的合并订阅；单次更新 2 分钟超时兜底，并发调用共享同一次执行；失败不推进 `updated`，下次心跳自动重试；核心重启会重复 `initProfileUpdater`，每次 init 换新一代并取代旧一代（旧一代在途检查结束后不再续排） |
| `profileConfigRecoveryCore.ts` / `profileConfigRecoveryPureCore.ts`      | BUG-2026-09-03-003 空/损坏 `profile.yaml` 从 `.bak` + 磁盘 profiles 恢复 · 禁止 persist 空配置                                                                                                                                                                                                                                                                    |
| `profileCacheRefreshCore.ts` / `profileCacheRefreshPureCore.ts` | 无 URL 时从磁盘 cache 重载：配置有变化走整配置重载，否则只热重载 provider（日志 `mode=config\|providers`）· 缺失 URL 双语错误 |
| `profileSubscriptionDisplayCore.ts`                                      | 订阅到期 / 更新时间展示 SSOT                                                                                                                                                                                                                                                                                                                                      |
| `subStoreApi.ts` | Sub-Store 查询：`subStoreSubs` / `subStoreCollections` 读 `/api/subs`、`/api/collections`（内置端口，或 `useCustomSubStore` 时的自定义地址） |
| `serviceCoreProviderParityCore.ts`                                       | service 模式 disk / runtime `proxy-providers` 与 live mihomo 不一致时触发 `/core/restart`，优先 `mihomoUpdateProxyProviders` 热重载                                                                                                                                                                                                                               |

### 自动选择与地区组

| 文件                                                                                            | 职责                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sparkleFastProviderCore.ts`                                                                    | `自动选择` 的 `sparkle-fast` provider 文件生成（纯函数）：按 `proxySwitchPriority` 地区分段平铺，剔除香港 / 已确认 Gemini 锁区或送中节点（`blockedNodeNames`）；传入非空 `delayMs` 时，有样本（存活）节点按地区分段 + 段内延迟升序排在前，无样本（超时/未测）节点按地区序统一垫在文件末尾；BUG-2026-10-09-001 / BUG-2026-10-14-001 / BUG-2026-10-17-001                                                                                                                                                                          |
| `sparkleGeminiProbeCore.ts` / `sparkleGeminiProbe.ts` / `sparkleGeminiStreamProbe.ts` | Gemini 真实地区解锁流式探测与缓存（`sparkle-gemini-nodes.json`）：`sparkleGeminiStreamProbe` 通过本地隐藏探测监听器 `127.0.0.1:17899`（与邮件探测共享 `withLocalProbeChannelLock` 串行互斥锁）流式读取 `https://gemini.google.com/app` 前部 `WIZ_global_data.vXmutd` 地区码；`sparkleGeminiProbe` 负责缓存与节点编排，将返回 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或 `www.google.cn` 的“送中/锁区”节点剔除出 `sparkle-fast-proxies.yaml` 并热重载；网络超时绝不误判为锁区 |
| `sparkleFastDelaySnapshotCore.ts`                                                               | `sparkle-fast-delays.json` 的纯数据层：provider 配置指纹（忽略 `history/alive/extra` 等运行时字段，按节点名排序，SNI/端口/服务器变化即失效）、当前成员覆盖率、v2 快照解析/序列化；旧格式、指纹不匹配、覆盖不足均返回空表，强制调用方补测                                                                                                                                                                                                                                                                                                   |
| `sparkleFastLatencyOrderCore.ts` / `sparkleFastLatencyOrder.ts`                                 | 延迟序运行时：Core 把 provider 成功探测历史折算成「节点→延迟」、校验成功样本覆盖率（≥80%）并做迟滞判定（≥50ms 且 ≥30% 才换首选）；运行时启动时先看内存成功覆盖，不足再看磁盘 v2 快照（指纹+覆盖均满足才沿用），仍不足则 `probeProviderLeavesGently` 全量补测后重排（仅在原固定节点不存活时解除固定）；每 30 分钟复查且不解除固定；实测结果按 v2 格式落盘，订阅刷新重建 provider 时用作排序依据                                                                                                                                             |
| `autoSelectStickyPinCore.ts` / `autoSelectStickyPin.ts`                                         | `自动选择` 粘性固定：Core 决策（fallback 选出的 `now` 连续稳定 2 次轮询即固定；原固定被清除时先触发单点独立复测过滤并发体检误杀，10 分钟冷却防死守抖动节点；固定节点已不在组内则解除）；运行时每 3 秒 `GET /proxies/自动选择`（不触发 lazy 体检），固定前确认 Gemini 存活且地区解锁（`verifyNodeGeminiRegion`），固定期间锁区复核按 5 分钟节流/节点变化立即复核，避免每 3 秒解析订阅文件；若发现送中/锁区节点立即拒绝或解除固定并从 `sparkle-fast` 剔除，主动解锁同步重置记忆，日志 `[AutoSelectSticky]: pinned X (left Y)` / `restored X` |
| `autoSwitchPinReleaseCore.ts` / `autoSwitchPinReleaseEngine.ts` / `autoSwitchPinRelease.ts` | 自动选路组（`自动选择` 与所有 URLTest 组）固定释放：Core 决定释放哪些固定，Engine 注入依赖逐组释放（单组失败不影响其余组），`autoSwitchPinRelease.ts` 只做接线，运行时在内核启动 / 整配置重载后释放全部（`all`，清掉 `store-selected` 从 `cache.db` 读回的历史选点），订阅刷新后只释放节点已不在组内的孤儿固定（`orphans`）；节点失活由内核原生保证（URLTest 仅在固定节点存活时遵循 `fixed`，Fallback 清除失活固定），Sparkle 不另设看门狗；`ProxyItem` 区分自动组锁定与解钉 |
| `autoSwitchPolicy.ts` | 分组「谁来切节点」的单一策略表：`resolveGroupRole` 按组名认出 Sparkle 自有分组、订阅分组按类型归类，`GROUP_POLICY` 声明每类是否参与故障转移、是否接受自动选路引用；订阅 select 组的自动选路引用与故障转移范围都只读这张表；源码扫描测试保证每个 `*_GROUP_NAME` 常量都有归属 |
| `groupFailoverCore.ts` / `groupFailoverEngine.ts` / `groupFailover.ts` | 故障转移引擎：Core 解析内核「连续拨号失败」告警、30 s 去重 + 180 s 窗口内两次计数即触发，并在组内挑最近一次探测成功（15 分钟内）、延迟最低的替代节点（用户固定且内核正在遵循的节点不动，非 url-test 组不处理）；Engine 以注入的控制器 / 日志 / 定时器串行编排「改选并固定 → 隔离失败节点 10 分钟 → 保留期满把组交还内核（固定已被改动则不覆盖；交还时读写内核失败则保留归属并顺延一个保留期重试，不会把自己的固定误认成用户固定）」，日志写入失败（`bestEffortLog`）不改变任何控制流，可脱离内核单测；`groupFailover.ts` 把真实控制器接上并由 `postCoreBootstrap` 启动；内核告警文案是它唯一的外部契约，升级或切换内核后运行 `pnpm run verify:failover` 复核 |
| `defaultAutoSwitchProxy.ts`                                                                     | `自动选择` = `type:fallback`（`use:[sparkle-fast]`，204 测速 `interval:300` / `timeout:5000` / `lazy:true`；Gemini 地区可用性由 `sparkleGeminiProbe` 在固定前把关）；`Sparkle-<地区>` = 由用户在父组手动选中的 `type:url-test`（组内自动选延迟最低的存活节点；`interval:300` + `tolerance:2000` + `lazy:true`），不被 `自动选择` 引用                                                                                                                                                                                                                                                          |
| `regionalAutoSelectGroupsCore.ts` / `regionalUrlTestWarmup.ts` / `regionalUrlTestWarmupCore.ts` | `Sparkle-<地区>` 组构建（无可用节点的地区不建组）与按需启动预热：只预热活动连接链路或当前被选中的组，未使用不扫描                                                                                                                                                                                                                                                                                                                                                                                                             |
| `regionPriority.ts`                                                                             | 地区优先级（台湾 → 日本 → 韩国 → 新加坡 → 美国）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `customProxyGroups.ts` / `profileGroupNormalize.ts` / `cursorDedicatedRuleRewrite.ts` | 自定义组（Cursor 专用、Grok 专用、香港过滤、📧 邮件专用、🎯 agy 专用、隐藏探测组 `__sparkle_mail_probe__`）注入与订阅主选择组归一；`cursorDedicatedRuleRewrite` 整理订阅规则里指向 Cursor 专用组的规则（旧组名迁移、非 Cursor 流量改回 `自动选择`）；`ruleSyntax.ts` 是规则文本解析与策略改写的单一出处（字段布局与 mihomo 一致、经 `mihomo -t` 与回环代理实测：`类型,载荷,策略[,参数…]`，兜底 `MATCH,策略`，载荷自带逗号的 AND / OR / NOT 与 `*-REGEX` 取最后一个字段，`SUB-RULE` 的子规则名不算策略；改写只换策略字段，`no-resolve`、`src` 等参数与其余字段原样保留，参数不在代码里枚举），`profileGroupNormalize` 修复指向不存在组的规则时认内置出口、订阅组和顶层内联节点为合法目标，兜底 `MATCH` 只回主选择组、不会落进默认直连的 Cursor 专用组，上述改写以及 `antigravityRuleInjection` / `fakeIpRoutingIntegrity` / `cursorRuleInjection`（清理未限定路径的 Cursor 规则）都经它读规则，不各自 `split(',')` 解析 |
| `proxyGroupOrder.ts`                                                                            | 分组展示顺序（写盘前统一）：`自动选择` → 四个专用组（Cursor / Grok / 邮件 / agy，隐藏探测组紧随邮件组）→ `Sparkle-<地区>` → 其余；同档位保持原有相对顺序，只重排不改内容                                                                                                                                                                                                                                                                                                                                                                          |

### 邮件专用组（macOS Mail / 海外 IMAP·SMTP）

| 文件                             | 职责                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sparkleMailProviderCore.ts`     | `sparkle-mail` provider 文件生成（纯函数）：仅收录通过 **IMAPS 993 + SMTPS 465** 双端口 TLS 握手与 Banner 校验的节点（缓存见 `sparkle-mail-nodes.json`）；冷启动无缓存时优先 Hysteria2/VLESS 候选兜底，**禁止空 provider**；`mailProviderMembershipChanged` 只比较成员集合（顺序变化不触发重载）；组配置 `buildMailGroupConfig` 产出 **`fallback`**（按 provider 地区顺序取首个存活节点，台湾优先；993/465 故障由当前节点探针剔除成员后触发切换）、隐藏探测组与 `listeners`（`127.0.0.1:17899` → `__sparkle_mail_probe__`） |
| `sparkleMailPortProbe.ts`        | 邮件 993/465 与 Gemini 地区探测共用的本地隐藏监听器通道：`withLocalProbeChannelLock` 串行切换 `__sparkle_mail_probe__` 节点，`probeSingleNodeMailPorts` 做单节点 IMAPS `* OK` + SMTPS `220` Banner 校验；端口/Banner 失败返回 `alive:false`，通道/API 异常抛出，调用方不得当成节点死亡                                                                                                                                   |
| `sparkleMailProbe.ts`            | 内核就绪后通过隐藏 mixed 监听器对订阅叶子逐点探测 `imap.gmail.com:993`（`* OK`）与 `smtp.gmail.com:465`（`220`），结果写入 `sparkle-mail-proxies.yaml`；provider 成员集合发生变化时才 `mihomoUpdateProxyProviders('sparkle-mail')` 热重载，失败保留 pending 由后续探测重试；先测 Hysteria2/VLESS 等优先候选，其余后台补测；每小时复查缓存过期节点                                                                        |
| `sparkleMailCurrentNodeProbe.ts` | 按需保护 `📧 邮件专用` 当前节点：邮件组最近有活动（`/connections` 链路或内核日志出现该组/收发域名）才复测当前节点 993/465；日志出现拨号失败后 30s 提前触发一次，另有 5 分钟周期兜底；失败立即标记 dead、写 provider 并在成员变化时热重载；完全未使用邮件时 0 次端口探测                                                                                                                                                  |
| `sparkleMailActivityCore.ts`     | 邮件活动判定纯函数：`connectionChainsIncludeGroup` · `nextMailActivityAtMs` · `isMailGroupRecentlyActive`（30 分钟观察窗口）                                                                                                                                                                                                                                                                                             |
| `mailTrafficRuleInjection.ts`    | 前置规则：`imap.gmail.com` / `smtp.gmail.com` / `pop.gmail.com` / `googlemail.com` / Outlook·iCloud·Yahoo 收发域名 → `📧 邮件专用`（**不**劫持 `gmail.com` 网页或国内邮箱）                                                                                                                                                                                                                                              |
| `cursorProxyGroup.ts`            | `MAIL_DEDICATED_GROUP_NAME` · `MAIL_DELAY_TEST_URL`（`https://mail.google.com`）· `resolveDelayTestUrl` 分支                                                                                                                                                                                                                                                                                                             |

**设计约束（实测）**：mihomo 健康检查（`url-test` / `fallback`）的 `url` **不能**设为 `https://imap.gmail.com:993`——底层 HTTP 客户端无法解析 IMAP Banner，会误判全节点超时；443 探测也无法筛掉「仅封邮件端口」的机场节点，故 Sparkle 主进程做真实 993/465 TLS 探测，组内日常保活才用 `mail.google.com`。当前节点只在邮件活动时由 `sparkleMailCurrentNodeProbe` 按需复测 993/465，未使用不探测；失败后依靠 provider 成员变化热重载触发切换。

### Antigravity / Code Assist 专用组（官方 agy CLI · 干净探测目录）

| 文件                          | 职责                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sparkleAgyProviderCore.ts`   | `sparkle-agy` provider 文件生成（纯函数）：只收录通过**真实 agy 请求（HTTP 200）**的节点；`agyProxyName` 是 agy 各模块里节点名归一化的唯一出处；节点指纹 `proxyNodeFingerprintCore.ts`；`classifyAgyProbeResponse`（200=可用 / 400 `location is not supported`=不可用 / 404·405=中止 / 其它=不下结论）；组配置 `buildAgyGroupConfig`（`select` + `use: sparkle-agy`）；`buildAgyProbeSnapshot`（代理页展示用的纯映射：只收录 usable 节点 → 名称/rtt/时间）；`orderAgyRepairProxies` 修复扫描排序 —— **严格地区优先**（台湾 → 日本 → 韩国 → 新加坡 → 美国 → 其余，与 `自动选择` 一致）；已确认不可用垫底；15 分钟内已尝试过的节点（含超时不下结论的）降级到「已尝试」组，保证下一轮先试未试候选、防止超时节点饿死后面地区；地区内最近 30 分钟验证过的按 rtt 优先 |
| `sparkleAgyProbeCache.ts`     | `sparkle-agy-nodes.json` 的唯一读写入口：可用 12h / 明确不可用 30min；`loadSparkleAgyProbeCache` 同时供 `factory` 生成 provider 时复用                                                                                                                                                                                                                    |
| `sparkleGrokProviderCore.ts`  | `sparkle-grok` provider 文件生成（纯函数）：只收录 **routed 验证通过**（真实 HEAD 200 且无 `cf-mitigated`）的节点，非香港优先、按 RTT 升序、最多 12 个；无缓存或全部失败时回退全量，**禁止空 provider**；`buildGrokProbeSnapshot` 把「节点名 → 真实请求结论（200 毫秒 / 403 挑战 / 超时原因）」映射给代理页；`orderGrokRepairCandidates` 把 15 分钟内试过的节点降级到队尾（防超时节点饿死后续候选）；`grokProviderMembershipChanged` 只比较成员集合（顺序变化不触发重载） |
| `sparkleGrokProbe.ts`         | `grok 专用`（select）的选路探针编排：以 **mixed-port 真实 HEAD 请求**（200 且无 `cf-mitigated`）为唯一口径；稳态 60 秒就地复核当前节点（网络超时重试一次），失败才按池内 RTT 顺序找下一个并**找到即停**；15 分钟内试过的候选降级队尾、单轮最多 6 个候选、全灭后按 1×/2×/3× 退避（与 agy 同一策略），发现阶段拿到 3 个可用即停；provider 不做周期体检 |
| `sparkleGrokRoutedCheck.ts`   | 判定口径：经 mixed-port（不可用时依赖 TUN 直连）HEAD `https://grok.com/`，只有 200 且无 `cf-mitigated: challenge` 才算可用；网络错误 / 超时的状态记 0 |
| `sparkleGrokGroupControl.ts`  | 对 `grok 专用` 组的操作：读当前节点、切换并断开旧连接、**每 5 分钟用非侵入式 `group-delay(expected=200)` 全量刷新池内延迟**（不切组、不断连，当前节点跳过由 HEAD 复核兜底；provider 还没有成员时无从刷新，也不占用刷新周期） |
| `sparkleGrokProviderSync.ts`  | `sparkle-grok` provider 文件落盘与热重载：只有成员集合变化才标记待重载（顺序变化不打断 mihomo），重载失败只记一次日志、之后每轮继续重试直到成功 |
| `sparkleGrokProbeCache.ts`    | `sparkle-grok-nodes.json` 的读写与结论写入（读取时整条丢弃字段不合法的记录）；`loadSparkleGrokProbeCache` 同时供 `sparkleProviderFiles` 生成 provider 时复用 |
| `sparkleGrokProbeSnapshot.ts` | 代理页展示用内存快照：每轮开始与结束按「探测缓存（含 403 / 超时原因）+ 当前订阅」整体重建，**只展示当前订阅里仍存在的节点**；`getSparkleGrokProbeSnapshot` 经 IPC 读取，不回读磁盘、不重新解析订阅 |
| `sparkleAgyProbeCore.ts`      | 巡检状态机（纯编排，无 I/O）：`runAgyAudit` 决定哪些节点被测、何时中止（致命错误 / 预算超时）、缓存如何演进，不可用不下结论；`shouldRepairAgyPin`：明确 400 或没有 pin 立即修复，超时连续 `AGY_PIN_UNKNOWN_STREAK_LIMIT`（2）轮才修复；`resolveAgyAuditBackoffMs` 全灭后按 1×/2×/3× 退避 |
| `sparkleAgyProbe.ts`          | 巡检编排：每 30min **pin 就地复测**（正常路径不切组、不关连接；pin 90s / repair 60s 超时）；400 先同节点二次确认、超时连续两轮才做**修复扫描**（扩 provider → 严格地区优先排序（带 15 分钟尝试记录，防饿死）→ 第一个 200 立即停，6 个上限 / 5min 预算）；全灭后按 1×/2×/3× 退避，**只有 pin 实测可用才清退避**（超时一轮不算恢复）；写 provider 前校验 profile 未切换                                                                                                                                                                                                                    |
| `sparkleAgyGroupControl.ts`   | 对 `🎯 agy 专用` 组的全部操作：归因安全的单节点探测（外部改过选择先补断旧连接；切组后必须 `mihomoCloseConnections`，断不掉就记 `unknown`，绝不把结果算到该节点头上）、provider 收敛（成员集合未变化不写盘不热重载）、切换选择（返回组最终所处的节点）                                                                                                                                                                                                                                                                                                           |
| `sparkleAgyCli.ts`            | 跑一次官方 `agy --print` 1-token 请求并归类成 HTTP 状态：干净 `--gemini_dir`（实测约 6.9k input）、剔除会话里的 API 覆盖环境变量、复用主目录 installation_id、清掉 24h 前的探测会话                                                                                                                                                                                                                                                                                                                              |
| `sparkleAgyProbeSnapshot.ts`  | 代理页展示用内存快照：缓存里的可用 / 已拒绝结论 + 最近一次失败的探测（超时 / 网络错误不写缓存，只能靠它与「未测」区分），每次按当前订阅整体重建，**已不在订阅里的节点不展示**；`getSparkleAgyProbeSnapshot` 经 IPC 读取，不回读磁盘、不重新解析订阅                                                                                                                                                                                                                                                                                                                                                                       |
| `antigravityRuleInjection.ts` | 前置规则：`DOMAIN-KEYWORD,cloudcode-pa` / `aicode.googleapis.com` / `generativelanguage.googleapis.com` / agy CLI 资格检查域名 `www.googleapis.com` → `🎯 agy 专用`（组缺席回退 `自动选择`），排在订阅通用 `googleapis.com` 规则之前；已有同类规则只改目标、不重复 |

**设计约束（实测）**：`daily-cloudcode-pa` 的地域校验发生在生成接口 `v1internal:streamGenerateContent`；`loadCodeAssist` / `fetchAvailableModels` 在地区被拒时仍返回 200（2026-11-07 实测：11:55:52 loadCodeAssist 成功、11:55:53 fetchAvailableModels 成功、11:56:27 streamGenerateContent 返回 `400 User location is not supported`）。因此 `gemini.google.com` 流式探测（`sparkleGeminiProbe`）无法筛出「网页可用但 Code Assist 被拒」的节点；只能由持有账号凭证的官方 agy CLI 做端到端判定。**归因硬约束**：mihomo 的 `select` 组只影响新建连接，长连接会继续复用旧出口，所以「切组 → 发请求」测到的可能是上一个节点（2026-11-03 实测：8 个节点同判可用，内核日志只有 6 条连接且全部走同一个土耳其出口）。任何切组必须紧跟 `mihomoCloseConnections('🎯 agy 专用')`，连接清不掉就记 `unknown`；只有切换扫描才切组，健康时只做 pin 就地复测，避免把生产流量拖到候选节点上。

### Cursor 专用组与规则

| 文件                                                                   | 职责                                                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cursorProxyGroup.ts` | Sparkle 分组名常量与判定谓词的单一出处（`AUTO_SELECT_GROUP_NAME`、各专用组名、`Sparkle-` 前缀判定）· Cursor 专用组成员过滤（`CURSOR_VPS_PROVIDER_FILTER`、`filterCursorEligibleVpsLeaves`）/ selector 解析 |
| `cursorDedicatedDefault.ts`                                            | 启动恢复手选；无手选时默认节点 `CURSOR_DEFAULT_VPS_NODE`                                                                                         |
| `cursorDedicatedSelectionCore.ts`                                      | 手选节点持久化（`writeCursorDedicatedManualSelection`）                                                                                          |
| `cursorDedicatedManualOnlyCore.ts`                                     | Cursor 专用组仅允许手动 / 启动恢复切换，自动来源一律拒绝                                                                                         |
| `cursorRuleInjection.ts`                                               | Cursor DOMAIN / PROCESS-NAME 规则 → 🎯 Cursor 专用；可选 path-scoped AND 规则（`cursorBidiOptimize` 控制开关）                                   |
| `cursorAppBundlePathsCore.ts` / `cursorPathPrefixProfileReloadCore.ts` | Cursor .app 路径前缀 SSOT（默认 主 / Latest / Cursor-2 / Cursor-3 全走 `🎯 Cursor 专用`，「节点选择」默认列表为空）· 前缀变更触发 profile 重生成 |
| `fakeIpRoutingIntegrity.ts`                                            | fake-ip 路由一致性：Tier0 Cursor · Tier0 Direct · Tier1 Proxy · sniffer 完整性                                                                   |

### 网络与 DNS

| 文件                                                                                                                      | 职责                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network.ts` / `networkPublicDnsCore.ts`                                                                                  | 网卡与系统 DNS 管理；TUN 启动时设公共 DNS                                                                                                                                                                                                                                                                           |
| `dnsFallbackIntegrity.ts`                                                                                                 | DNS fallback 完整性                                                                                                                                                                                                                                                                                                 |
| `corporateDnsCore.ts` / `corporateDirectRules.ts` / `corporateDefaultInterface.ts`                                        | 公司内网 DNS / 直连规则 / 默认网卡                                                                                                                                                                                                                                                                                  |
| `aiApiDirectRules.ts`                                                                                                     | 默认直连规则：`AI_API_DIRECT_HOSTS`（当前 `api.commandcode.ai` / `opencode.ai` / `open-design.ai`，含其子域）未被任何规则提及时前置 `DIRECT`（实测 p50 快 0.32s / 0.65s / 0.29s）；覆写或订阅用 `DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD` 提过同一域名、父域或其子域就完全让路（不改写、不重复）。新增域名只改该常量，单测按清单生成期望值 |
| `tunStartupGuard.ts` / `tunStartupGuardCore.ts`                                                                           | 识别 TUN adapter 监听成功 / 权限错误日志                                                                                                                                                                                                                                                                            |
| `vpsDirectBypass.ts`                                                                                                      | VPS 服务器 IP 直连规则与 TUN / sniffer 排除：服务器域名经 DNS 解析（3 s 超时，完成后不遗留定时器），只收公网 IPv4；已有直连规则按「规则类型 + 目标」精确判断，注释与 `SRC-IP-CIDR` 不会被当成已覆盖                                                                                                                  |
| `dedicatedTrafficRuleInjection.ts` / `mailTrafficRuleInjection.ts` / `antigravityRuleInjection.ts` / `aiApiDirectRules.ts` | 香港（X/Stripe）/ Grok / 海外邮件客户端 / Antigravity / AI API 直连前置分流规则                                                                                                                                                                                                                                                       |
| `quicTrafficRuleInjection.ts`                                                                                             | QUIC / STUN 泄漏防护前置规则：`AND,((DST-PORT,443),(NETWORK,UDP)),REJECT` 阻断 HTTP/3，`DOMAIN-SUFFIX,stun.cloudflare.com,REJECT` 阻断 WebRTC 探测；节点不支持 UDP 时浏览器 UDP 会回退 `DIRECT`，导致 TCP/UDP 出口 IP 分裂触发 Cloudflare WAF 拦截                                                                  |

## 启动数据流

```
index.ts → runCoreReadinessPipeline('gui') (coreReadinessGate.ts)
  → startCore (manager.ts)：generateProfile (factory.ts) → checkProfileWithRetry → 停旧核（service 常驻内核除外）→ TUN 权限检查 → 启动 mihomo
  → runPostCoreBootstrap(startPromise) (postCoreBootstrap.ts)：等内核初始化（上限 8 s）→ 等控制器就绪（上限 30 s，超时只记日志并放弃）→ 开测速预热窗口 → 各服务（相互隔离，单个失败只记日志）：
       ├ syncRuntimeConfigToCore（运行时配置与磁盘对账；已整配置重载则固定已释放，否则 releaseAutoSwitchPins('all')）
       ├ sparkle-fast 延迟序 bootstrap + 30min 复查
       ├ 后台并行（不阻塞后续服务）：
       │    Gemini 地区审计（30min 一轮）· 邮件（当前节点按需探测 → provider bootstrap → 60min 全量复查）· grok provider bootstrap + 60s 复核 · agy provider bootstrap + 30min pin 就地复测
       ├ startAutoSelectStickyPin（3s 本地状态轮询；固定节点地区码 5min/变化时复核）
       ├ startGroupFailover（订阅内核连续拨号失败告警，为 Sparkle-<地区> 组改选并隔离失败节点）
       ├ initProfileUpdater
       ├ applyCursorDedicatedVpsSelection（恢复手选 / 默认节点）
       └ NETWORK_MONITOR_STARTUP_GRACE_MS（45 s）后 warmupRegionalUrlTestGroups（仅活动/选中地区组）→ 有组被预热时 verifyUnconfirmedFailures → 关闭预热窗口
```

### 共用基础件（`src/main/utils` · `src/main/config`）

| 文件 | 职责 |
| --- | --- |
| `utils/bestEffortLog.ts` | 把注入的日志函数包成永不 reject 的版本；`runtimeConfigSyncEngine` / `groupFailoverEngine` / `autoSwitchPinReleaseEngine` / `postCoreBootstrap` 统一用它，日志写入失败不改变任何控制流 |
| `utils/errorMessage.ts` | `describeError`：失败路径的异常文本化，按 `message` 字段而非 `instanceof Error` 判断（跨执行环境的 Error 同样可读），自身永不抛 |
| `utils/log.ts` | 应用日志与内核日志：`appendAppLog` 永不 reject（落盘失败只丢这一段）；写入流出错时摘掉坏流、下次写入重开；`publishMihomoLog` 缓存内核日志并推送渲染进程；文件大小按记账控制、超限裁剪 |
| `utils/logFileSizeCore.ts` / `utils/logLineParseCore.ts` | 日志文件大小记账与按行裁剪的纯函数 · 内核 logfmt 输出行的解析（转义序列单趟解码） |
| `utils/yaml.ts` | YAML 读写入口：`parseYaml` 在文档树上把 Reality `reality-opts.short-id` 还原为原文（块 / flow / 锚点 / 合并键写法一致），纯数字写法不丢前导零、不变成数字或 Infinity |
| `config/profileFiles.ts` / `config/profileFilesCore.ts` | 订阅与工作目录内可编辑文件的读写：路径限定在受管目录，写入遇权限错误时按需提权修复；决策与命令转义在纯函数层 |

## 规则优先级（覆写 > 内置默认 > 订阅）

`generateProfile` 先应用覆写（`overrideProfile`：全局 + 单订阅，支持 YAML deepMerge 与 JS 脚本），再跑各注入步骤；注入的前置规则会排在订阅规则之前，因此内置默认必须"缺才加"：目标域名已有任何规则命中（按 mihomo 语义判断 `DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD`）时，`aiApiDirectRules` 一律让路，不改写、不重复。

`~/Library/Application Support/sparkle/work/config.yaml` 是 `generateProfile` 的**生成物**（内核启动 / 切换订阅 / 改设置都会整份重写），禁止手改；持久改动只有两条路：改注入代码，或写覆写。

## App 配置路径

| 路径                                                                       | 内容                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `~/Library/Application Support/sparkle/config.yaml`                        | UI 与行为开关                                                                                                 |
| `~/Library/Application Support/sparkle/sparkle-fast-delays.json`           | `sparkle-fast` 延迟快照 v2：`{version, providerFingerprint, samples}`；旧格式/指纹不匹配/覆盖不足时视为空快照 |
| `~/Library/Application Support/sparkle/sparkle-gemini-nodes.json`          | Gemini 真实地区解锁（`vXmutd` 国家码）探测缓存                                                                |
| `~/Library/Application Support/sparkle/sparkle-mail-nodes.json`            | 邮件 993/465 双通探测缓存（按节点指纹 TTL）                                                                   |
| `~/Library/Application Support/sparkle/profiles/sparkle-mail-proxies.yaml` | `📧 邮件专用` 的 provider 成员（仅双通节点）                                                                  |

修改 `config.yaml` 后须完全退出并重启 Sparkle 方生效（主进程内存缓存）。

## 测试

```bash
pnpm run test:node-quality   # 按 glob 跑 src/**、scripts/** 下全部 *.test.ts，新增测试文件无需登记
pnpm run agent:upgrade:mac   # Agent SSOT：build(if needed) + install + post gate
pnpm run upgrade:mac         # 本地装 /Applications + PostCoreBootstrap 门控（网络失败：SKIP_PREPARE=1）
```

随机化不变量测试（`*Invariants.test.ts` / `*Interleaving.test.ts`）用 `seededProperty.ts` 的 `forSeeds`：固定 seed 1..N，失败信息带 seed，可原样重放；`*Harness.ts` / `*Rig.ts` / `*World.ts` 是测试夹具，只被测试引用（`timerSpyHarness` 记录定时器的登记间隔与 `unref`，`syncFsPromisesRig` 把 `fs/promises` 换成同步实现让后台任务的每一步都在微任务里完成）。

涉及真实 I/O 的接线模块（如 `factory` / `mihomoApi` / `sparkleProviderFiles` / `profileFiles` / `overrideProfile` / `postCoreBootstrap` / Gemini 探测）用 `mock.module` 换掉依赖、临时目录承接落盘，要求 `--experimental-test-module-mocks`（已写进 `test:node-quality`；该标志不能放进 `NODE_OPTIONS`）。约定：① 同一说明符每进程只能 mock 一次，可变行为放进夹具的 `state` 对象；② 说明符按**调用文件**解析，夹具必须与被测文件同目录；③ `ws` / `axios` 这类双格式依赖要用 `mock.module(require.resolve('pkg'), { exports: { default: Fake } })` 指向 CJS 入口；④ 不要在 `afterEach` 里 `mock.restoreAll()` / `mock.reset()`，保留 spy 句柄各自 `.mock.restore()`；⑤ 被测模块有模块级状态（如 `factory` 的运行时配置）时，夹具在每个用例前 `delete require.cache[…]` 再 `require` 重新加载，用例之间互不依赖执行顺序（`import()` 会命中缓存，不能用来重载；功能拆成多个带状态的模块时要把它们全部清掉，否则旧模块的状态会带进下一个用例）；⑥ `exports` 选项的类型由 `src/main/nodeTestMock.d.ts` 补上（@types/node 25 尚未声明，声明后删除该文件）；`tsx` 不做类型检查，改完测试要跑 `pnpm run typecheck`。

## 构建标识（UI）

| 路径                                 | 职责                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `scripts/writeBuildStampCore.ts`     | `YYYY.MMDD.HHMM` 格式 SSOT                                                                    |
| `scripts/write-build-stamp.ts`       | 写入 `src/shared/buildStamp.ts`（`dev` / `build:*` / upgrade 前），含 git commit 与 dirty     |
| `src/shared/buildStamp.ts`           | 生成物：`SPARKLE_BUILD_STAMP` + `SPARKLE_SEMVER` + `SPARKLE_GIT_COMMIT` + `SPARKLE_GIT_DIRTY` |
| `src/main/utils/ipc.ts`              | `getBuildStamp` IPC                                                                           |
| `src/renderer/src/pages/proxies.tsx` | 代理组标题旁 Chip 展示 build stamp                                                            |

### 构建漂移检测（R-52）

`com.sparkle.profile-scheduler` LaunchAgent 每 300s 直接执行 `/Applications/Sparkle.app`
的二进制（`--sparkle-profile-update-due`），绕开仓库执行 `generateProfile()`。源码改动
若未进入二进制，运行时仍执行旧逻辑且外部无信号——AnyTLS 剔除即因此被静默回退
（见 BUG-2026-10-01-002）。

判定 SSOT 在 `buildDriftPureCore`，`scripts` 与 `src` 共用，避免逻辑分叉：

| 组件                                  | 职责                                                                |
| ------------------------------------- | ------------------------------------------------------------------- |
| `src/main/core/buildDriftPureCore.ts` | 判定 SSOT：`detectBuildDrift` / `normalizeCommit` / `isBinaryRelevantPath`（纯函数，不碰 git） |
| `src/main/core/buildDriftGit.ts`      | git 读取（运行时与脚本共用）：`createGitRunner` / `readRepoGitFacts` / `listPathsChangedSince`（`git diff --name-only <app 提交> HEAD`）/ `evaluateBuildDrift` |
| `src/main/core/buildDriftCore.ts`     | 运行时入口：定位仓库、调 `evaluateBuildDrift`，写 `[BuildDrift]` 日志（进程内仅一次） |
| `src/main/core/factory.ts`            | `generateProfileImpl` 首步调用 `logBuildDriftAtStartup`             |
| `scripts/check-build-drift.ts`        | `pnpm run check:drift` 主动查询（按内容读 app.asar 内的构建标记），退出码 1 = 漂移 |

五种判定结果：`match`（commit 相同）/ `non_binary_ahead`（commit 不同，但 app 构建提交之后
只改了文档、测试、`src/shared/buildStamp.ts`，二进制内容没变，不算漂移）/ `commit_mismatch`
（app 旧于仓库，有会进二进制的改动，或查不到差异）/ `app_dirty`（构建时工作区不干净，构建
不可复现）/ `app_unknown`（无 commit 事实的旧构建）。

- 「会进二进制」的判定偏保守：除 `*.md`、`*.test.*`、`buildStamp.ts` 外一律算；`extra/`、
  `resources/` 整目录算（随 `extraResources` 拷进 app，里面的文档也一样）。纯注释 / 格式化
  改动看不出来，会照常判为需要重建。
- app 构建提交在本仓库里解析不出来（被 gc、换了仓库）或 git 失败时不猜，按
  `commit_mismatch`（`ahead_check=unavailable`）处理。
- 仓库侧 dirty **不读也不算**漂移——commit 仍是权威标识，未提交改动本就不会进入 app。
- 构建流程「构建 → 安装 → 提交 buildStamp」会让 HEAD 比 app 的 commit 多一个提交，
  `non_binary_ahead` 就是为它而设，否则每次安装之后都会误报 `commit_mismatch`。

详见 [src/shared/\_ARCH.md](../../shared/_ARCH.md)。
