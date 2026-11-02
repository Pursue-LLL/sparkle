# Sparkle Version Log

> **基线用途**：Agent 迭代以本文档 **最新可用条目** 为 SSOT，避免能力回退、重复踩坑、反复返工。  
> **关联**：`BUGFIX_LOG.md`（缺陷明细）· `scripts/_ARCH.md`（Agent 升级入口）

---

## 2026-10-17 `自动选择` Gemini 真实地区解锁校验与「送中」节点自动剔除（@1.30.71）

| 项 | 内容 |
|---|---|
| 现象 | 访问 `https://gemini.google.com/u/3/?dest=create` 报错「Gemini 目前不支持你所在的地区。敬请期待！」，当时 `自动选择` 选中并固定在 `🇸🇬 日本 V0 \| 移动优化、新开机 \| 2x` |
| 根因 | ① mihomo 的 `fallback` / `url-test` / `health-check` 探测 `https://gemini.google.com` 时仅校验 HTTP 状态码是否为 2xx/3xx，而 Google 对锁区/送中 IP 访问 `gemini.google.com` 依然返回 `HTTP/2 200 OK`（锁区提示由前端根据 HTML 内嵌的 `window.WIZ_global_data.vXmutd` 地区码渲染）；② 订阅中 7 个名为日本/韩国/美国/德国的节点（如 `🇸🇬 日本 V0`、`🇯🇵 日本 I2`、`🇯🇵 日本 V3`、`🇰🇷 韩国 I1`、`🇺🇸 德国 B16`、`🇺🇸 美国 G2`、`🇺🇸 美国 V0`）出口 IP 被 Google GeoIP 判定为 `www.google.cn` / `vXmutd="ZZ"`（送中），静态名称过滤无法识别 |
| 实现 | ① 新增 `sparkleGeminiProbeCore.ts` + `sparkleGeminiProbe.ts`：复用本地隐藏探测监听器 `127.0.0.1:17899`（与邮件探测共享 `withLocalProbeChannelLock` 互斥锁防串台），发起带 `Accept-Encoding: gzip` 的流式 `GET https://gemini.google.com/app`，在前部 ~50–120KB 解压流中提取 `vXmutd` 地区码后立即断开连接；凡是 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或指向 `www.google.cn` 的节点判定为 `eligible: false` 并持久化至 `sparkle-gemini-nodes.json`（网络超时返回 `definitive: false`，绝不误杀正常节点）；② `sparkleFastProviderCore.ts`、`factory.ts`、`sparkleFastLatencyOrder.ts` 生成或重排 `sparkle-fast-proxies.yaml` 时自动剔除已知锁区/送中节点（保留全空兜底）；③ `autoSelectStickyPin.ts` 固定前与固定期间校验 `verifyNodeGeminiRegion`，发现送中节点立即拒绝/解除固定并热重载 `sparkle-fast`；`postCoreBootstrap.ts` 启动后台静默巡检提前剔除潜伏送中节点 |
| 单测 | `sparkleGeminiProbeCore.test.ts` · `sparkleFastProviderCore.test.ts`（并入 `pnpm run test:node-quality`） |

## 2026-10-16 `📧 邮件专用` 组与 993/465 真实端口探测（INSTALLED @1.30.71 · app.asar 2026-10-16 15:13）

| 项 | 内容 |
|---|---|
| 现象 | macOS **邮件** 收 Gmail 报 SSL `-9806`：Gmail 域名走 `🔍 Google` → `自动选择`，部分机场节点封 993/465/587，TLS 握手被掐断；163 等国内邮箱直连正常 |
| 根因 | ① 通用 Gemini/443 探测无法识别「仅封邮件端口」的节点；② mihomo `url-test` 若设 `https://imap.gmail.com:993` 会把 IMAP Banner 当非法 HTTP，**全节点判死** |
| 实现 | ① 组 `📧 邮件专用`（`url-test`，`use: sparkle-mail`，日常保活 `https://mail.google.com`）；② provider `sparkle-mail-proxies.yaml` 只含 Sparkle 主进程验证 **993 IMAP + 465 SMTP 双通** 的节点；③ 隐藏组 `__sparkle_mail_probe__` + 本地 mixed 监听器 `127.0.0.1:17899` 逐点探测，与业务组隔离；④ `mailTrafficRuleInjection.ts` 前置海外邮件收发域名规则；⑤ 缓存 `sparkle-mail-nodes.json`，`postCoreBootstrap` 启动 `bootstrapSparkleMailProvider` + 60min 复查 |
| 代码 | `sparkleMailProviderCore.ts` · `sparkleMailProbe.ts` · `mailTrafficRuleInjection.ts` · `customProxyGroups.ts` · `factory.ts` · `providerConfigCore.ts` · `cursorProxyGroup.ts` · `mihomo.d.ts`（`listeners`） |
| 单测 | `sparkleMailProviderCore.test.ts` · `mailTrafficRuleInjection.test.ts`（并入 `pnpm run test:node-quality`） |
| 线上验证 | 2026-10-16 GUI 启动日志 `[SparkleMailProbe]: fast-tier … newly_alive=9 active_pool=9`；`work/config.yaml` 含 `📧 邮件专用` 与 `sparkle-mail` provider；**Mail.app 收信需用户确认** |

## 2026-10-15 `自动选择` 粘性固定与单点复测保活（已装包 @1.30.71 · 线上运行观察中）

| 项 | 内容 |
|---|---|
| 现象 | 10-14 约 15 小时内 `自动选择` 切换 201–207 次（10-08 基线 17 次/天），38% 的切换离开了失败率 <20% 的健康节点 |
| 根因 | ① 原生 `fallback` 无迟滞：前序节点单次探测失败即被放弃，恢复后立即回切；② 周期重排（30 分钟）每次采用都 `DELETE /proxies/自动选择` 解除固定；③ 订阅刷新（`reloadMihomoProfileProviders`）漏热重载 `sparkle-fast`，旧失效节点触发 1,863 次全量并发体检风暴；同时 `sparkle-fast` 原配置使用非懒加载 `gstatic` 体检造成双倍并发压力；④ 若仅固定而不拦截单次探测误杀，每次并发体检超时都会造成单向不可逆降级；⑤ 高优先级地区全挂时，未测/死节点仍排在低优先级地区的活节点前面 |
| 修复 | ① `autoSelectStickyPinCore.ts` + `autoSelectStickyPin.ts`：每 3 秒检查 `自动选择`（纯本机内存读取，0 网络请求），`now` 连续 2 次稳定后 `PUT` 固定（无 Gemini 样本时先单点拨测验活）；固定被 mihomo 清除且节点仍在组内时，先单点独立复测 Gemini（并发度 1），存活则立即恢复固定（10 分钟冷却窗内再次丢固定则视为节点不稳不再救回）；清理孤儿固定；主动解锁同步重置记忆；② `sparkleFastLatencyOrder.ts` + `sparkleFastProviderCore.ts`：启动阶段若磁盘已有延迟快照则直接沿用（`hasPreferredUrlSamples` 要求 ≥80% 节点已探测，防冷启动少量节点刚测完触发残缺样本重排与 46s 全量重测）、仅当原固定节点不在存活表内才解除固定；周期重排保留固定；有实测延迟时将无样本节点全局垫底；③ `provider.ts` + `providerConfigCore.ts` + `vpsProviderSplitCore.ts`：订阅刷新同步热重载 `sparkle-fast`，`sparkle-fast` 对齐为 `Gemini + lazy: true`（mihomo 内部与 `自动选择` 自动按 URL 去重为单次任务），主订阅商业 provider 同样开启 `lazy: true` |
| 线上验证 | 2026-10-15 11:04 装包（CDHash `590cd0e8`）完成首次重排并记录 `[AutoSelectSticky]: pinned 🇨🇳 台湾 I0 | AI、动态IP | 2x`，随后 80 分钟内 0 次切换；13:24 二次装包（CDHash `d19fd1a18c4013367c42052db0719eae82dbb710`，`BuildDrift: app_commit=3b60710 app_dirty=0 drift=none`）：`work/config.yaml` 中主订阅 `1a11e783a18` 与 `sparkle-fast` 均生效 `lazy: true`；冷启动输出 `[SparkleFastOrder]: bootstrap using disk snapshot samples=43`（0 残缺重排、0 重复全量重测，原有健康固定节点 `台湾 I0` 保持不中断） |

## 2026-10-13 Cursor 主 / Latest 默认走 🎯 Cursor 专用（已装包 @1.30.71）

| 项 | 内容 |
|---|---|
| 变更 | 默认专用路由的 `.app` 前缀由 `Cursor-2` / `Cursor-3` 扩为 `Cursor`（主）/ `Cursor-Latest` / `Cursor-2` / `Cursor-3`；「节点选择」默认 bundle 列表置空（`CURSOR_NODE_SELECT_APP_PATH_PREFIXES`）。取代 BUGFIX_LOG 中「Cursor 主走自动选择」的旧约定 |
| 代码 | `cursorAppBundlePathsCore.ts`（前缀 SSOT）、`cursorRuleInjection.ts`（注释与分流语义）；`.test.ts` 同步：主 / Latest 现在断言落入 `🎯 Cursor 专用` 而非 `自动选择` |
| 验证 | 单元测试通过；线上运行配置（2026-10-13 11:38 生成）中 `Cursor.app`、`Cursor-Latest.app`、`Cursor-2.app`、`Cursor-3.app` 各 22 条规则（1 条路径规则 + 21 条域名 AND 路径规则）全部指向 `🎯 Cursor 专用`，指向 `节点选择` / `自动选择` 的为 0；未做真实 Cursor 流量的出口比对 |
| 说明 | `🎯 Cursor 专用` 仍是仅手动选择的 selector（当前 `Sparkle-日本`），不随 `自动选择` 的延迟序重排自动换节点 |

## 2026-10-12 订阅自动更新可靠化（已装包 @1.30.71 · 睡眠补更新待观察）

| 项 | 内容 |
|---|---|
| 现象 | 配置每日 07:00 更新，10-11、10-12 两天都没更新成功，合并版停在旧节点 |
| 根因 | Mac 睡眠时定时器在唤醒瞬间（DarkWake，网络未就绪）触发，两个订阅同秒 `getaddrinfo ENOTFOUND`；失败后直接排到次日 07:00，不重试（`profileUpdater.ts` 旧失败分支）。LaunchAgent 每 5 分钟兜底一直在跑，但只认 07:00~07:05 窗口，睡过就永远补不上。合并版（local）从未被调度，重建后也不写自身 `updated`，卡片上看不到更新时间 |
| 修复 | 判定改为「`updated` 早于最近一个计划时刻即到期」；GUI 去掉每订阅一个 `setTimeout`，改为 5 分钟心跳，与 LaunchAgent 共用同一入口；失败自动在下次心跳重试；单次更新 2 分钟超时；无 URL 的远程订阅不参与；合并版跟随来源（来源更新时重建、来源比它新时补重建），重建后写 `updated`，两处卡片显示「跟随来源 · 更新 N 分钟前」；比此刻还晚的 `updated`（系统时钟曾出错）视为未知，避免来源卡住不更新、合并版每个心跳都重建；检查读配置缓存而不强制重读 `profile.yaml`（强制重读会撞上非原子写入的半截文件并触发「读到空 → 从备份恢复写盘」） |
| 验证 | 单元测试覆盖睡过计划时刻、失败重试、手动更新、超时、并发共享；用真实 `profile.yaml` 模拟时间：现在仅合并版到期，10-13 07:00:01 起来源到期，07:13/23:59 仍到期 |
| 线上验证 | 2026-10-13 11:34 装包：GUI 心跳在启动后 60 秒触发，合并版重建一次（日志 `update succeeded id=1a11e783a18`），`updated` 由停在 10-09 变为 11:38:06，晚于两个来源的 07:00:00，故不再到期；之后 LaunchAgent 每 5 分钟检查均 `updated_count=0`，当天无 `update failed` / `heartbeat failed`。当天 07:00 的来源更新是 Mac 清醒时由旧版本完成的，**睡过计划时刻后的补更新尚未在真机出现过，待下一次睡眠后观察** |
| 说明 | 睡死/关机期间无法更新，唤醒联网后最多 5 分钟补上；装包后首个心跳已重建合并版一次（热重载 provider，样本由启动复测与 mihomo 5 分钟体检补回）。服务端持续不可用时每 5 分钟重试一次、无退避，单订阅每天最多约 288 次请求 |

## 2026-10-09 测速结论可信化（已装包 @1.30.71）

| 项 | 内容 |
|---|---|
| 现象 | 代理页大片「超时」。实测 32 个「超时」节点低并发重测：10 个其实可用（误报）、9 个仅 Gemini 不通、13 个真挂 |
| 根因 | 单点测速对 provider 叶子节点会触发**整个 provider 的体检/重载**（`refreshProviderLeafBeforeDelay` · `mihomoProxyDelayFromProvider`），组测速时每个节点都来一次；且 `pickLatestSuccessfulProviderDelay` 会把多分钟前的成功当作本次结果；界面只看最后一条样本 |
| 修复 | ① 叶子节点改走 provider 单点端点 `mihomoProviderLeafDelay`，删除 provider 级体检/重载/缓存路径与 `purpose` 参数；② `sparkle-fast` 启动探测与超时节点复测改为低并发（4）逐点拨测；③ 展示判定收敛为 `proxyDelayVerdictCore`：连续失败 ≥3 次才显示超时，否则显示上次成功 + 「最近失败」 |
| 二次修正 | 上一版在 mihomo 顶层 `history` 上判定，而该数组把各探测地址（通用网址 / Gemini）的样本按时间混在一起，Gemini 一直不通的节点被判成「波动」，界面零超时（线上 59 节点：旧口径 48 ok / 11 波动 / 0 超时）。改为按组实际探测地址读 `extra[url]`（`proxyProbeHistoryCore`），同一节点在多个 provider 的样本合并（两份记录曾互相矛盾，如台湾 I0 一份 Gemini=191ms、一份=0）；代理页、浮窗、两处托盘统一走 `judgeProxyForUrl`。同口径线上数据：43 ok / 9 波动 / 7 超时 |
| 三次修正 | 实测被判「超时」的 13 个节点：6 个真不通、5 个仅 Gemini 不通、2 个时好时坏（重测能通）。判定改为按近期窗口：窗口内一次都没成功才「超时」，最近失败但近期成功过为「不稳定」（卡片小字改为「N分前成功」，旧「最近失败」措辞让人看不出数字是旧的）；详情浮窗加「其它探测地址」区分「只对 Gemini 不通」与「整个节点不通」；启动复测范围扩到所有最近一次样本非成功的节点；周期重排会重载 provider 清空其记录，重排后立即逐点补测；同一目标的 http（体检）/ https（界面测速）两份记录改为按时间合并，修复新失败被旧成功盖住的问题 |
| 线上验证 | 2026-10-13 11:53（装包后约 20 分钟）：`自动选择` 63 个成员 = 45 正常 / 9 不稳定 / 9 超时 / 0 未测（11:49 时为 49 / 4 / 10，「不稳定」节点在两次采样间会跳动，属预期）；9 个超时中 8 个通用地址（`gstatic`）可用、仅 Gemini 不通，1 个（美国 G2）整个节点不通。「重排后立即补测」只在 30 分钟复查真的发生重排时才触发，尚未观察到；界面渲染未做目视验证 |
| 说明 | `自动选择` 与地区组以 Gemini 探测为准（香港为 grok），Gemini 不通即该组眼中的不可用，显示超时是预期语义，不是误报 |

## 📌 当前最佳基线（Agent 迭代 SSOT）· 2026-10-17 **13:50 CST**

| 项 | 值 |
|---|---|
| 版本 | **1.30.71** · 2026-10-17 装包（含 `sparkleGeminiProbe` 真实地区解锁校验与 `sparkleMailProbe` 993/465 双通校验） |
| 装包 | `/Applications/Sparkle.app`，GUI + mihomo + `:7890` 可用；实测 `自动选择` = `Fallback`（已剔除 8 个 `vXmutd="ZZ"` 送中节点，固定在真解锁节点 `🇯🇵 日本 I3 \| AI、Netflix(JP)、SVIP \| 3x`）；`📧 邮件专用` = `URLTest`；`🎯 Cursor 专用` = `Selector` |

**能力/行为基线（后续不得回退）**
- `自动选择` = mihomo 原生 **fallback**：成员 = `sparkle-fast` provider 文件（每次配置生成时把订阅节点按 `proxySwitchPriority` 排序平铺写入：默认 台湾→日本→韩国→新加坡→美国→其他国家，地区内按 Gemini 探测延迟升序，有实测延迟时无样本节点按地区序统一垫在文件末尾；**香港、AnyTLS 以及经 `sparkleGeminiProbe` 实测确认为 Gemini 锁区/送中（`vXmutd` 为 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或含 `www.google.cn`）的节点一律排除**；不区分其他节点类型，hy2 在所属地区的正常位置）。fallback 语义 = 按顺序用第一个可用节点；原生 fallback 无迟滞（高优先级节点恢复立刻回切、任一节点单次探测失败即被放弃）。**`自动选择` 粘性固定（pin）**：fallback 选出的存活节点连续稳定 2 次轮询（3 秒间隔）后由 `autoSelectStickyPin.ts` 固定（无 Gemini 样本时先单点拨测验活，并通过 `verifyNodeGeminiRegion` 确认非送中/锁区节点；若发现送中节点立即拒绝/解除固定并从 `sparkle-fast` 热移除），之后只有该节点真挂掉才换，高优先级节点恢复不回切；固定被 mihomo 清除时先做单点独立 Gemini 复测（过滤并发体检单次超时误杀，防止单向不可逆降级；10 分钟冷却窗口内再次丢固定则视为节点不稳不再救回）；固定节点已不在组内（订阅刷新 / cache.db 恢复旧固定）时立即解除，否则 mihomo 会一直返回首个成员而不判存活（BUG-2026-10-14-001 / BUG-2026-10-17-001）。内核就绪后按实测延迟重排文件序，仅当原固定节点不在实测存活表内时解除固定（`sparkleFastLatencyOrder.ts`，重排重载后自动回填 Gemini 样本），之后每 30 分钟复查，新首选须比当前首选快 ≥50ms 且 ≥30% 才换文件序，复查不解除固定（BUG-2026-10-09-001 / BUG-2026-10-14-001）。
- 探测：`gemini.google.com`（用户主用服务），interval 300s，timeout 5000ms，lazy=true（`自动选择` 组与 `sparkle-fast` provider 统一为此配置，组空闲时跳过定时探测，消除双倍并发风暴）；预热也用组自身探测目标。
- 地区组 `Sparkle-<地区>`（日本/台湾/韩国/新加坡/美国）= url-test（tolerance 2000，`exclude-type: anytls`），仅供手动选择，**不被 `自动选择` 引用**；没有可用节点的地区不建组（空组会被 mihomo 变成直连型 `COMPATIBLE`）。香港为专用组。
- **铁律**：`proxies` 里只能引用组名，不得按名字引用 provider 节点（mihomo 解析期不识别，自检必失败导致内核无法启动）；`sparkle-fast` 文件必须随每次配置生成重写并在订阅刷新（`reloadMihomoProfileProviders`）时同步热重载。
1. **不会因卡顿整核重启**：`restartCoreEmergency`/bridge/oscillation/smoke 已从代码删除；emergency 只决策+记录 `emergency_core_restart_removed`。
2. **选点防抖**：地区组 url-test `interval:300` + `tolerance:2000` + `lazy:true`；`自动选择` fallback 同为 `interval:300`、`timeout:5000`、`lazy:true`（`defaultAutoSwitchProxy.ts`）。**应用层不自动切换 `自动选择`**：`proxyHealthMonitor.ts` 已于 2026-09-29（`febdc08`）删除，其配置项（`autoProxySwitch` / `proxyHealthCheckInterval` / `proxyTimeoutThreshold` / `proxySwitchMaxTargetDelayMs` / `autoSelectMaxNodeDelayMs`）与 `isMarathonQuiesceProxyHealthPaused`、`proxy_health_monitor` 拨号类别已一并清理；应用层对 `自动选择` 只做固定与单点复测保活，不主动离开存活节点；节点切换只来自 mihomo fallback 在当前节点确认真挂掉时重选，以及启动重排发现原固定节点不存活时解除固定（见上方 `自动选择` 条目）。`proxySwitchPriority`（默认 台湾→日本→韩国→新加坡→美国）仍决定 `sparkle-fast` 与地区组的地区顺序。
3. **无应用层长流干预**：Marathon / quiesce / keepalive / 探针平面 / 恢复编排 / 质量基准全部移除（见下方 2026-10-09 条目）；Sparkle 不再按 Cursor 流量做运行时干预。
4. **构建门禁可信**：`DistFreshness` 已修（源码变即全量重编，杜绝 install-only 装旧包）；asar 门禁只校验 `appendAppLog` 存在、`[CoreReadiness]` 门控与无 PCRE 内联 flag 的非法正则；装后门禁只要求日志出现 `[PostCoreBootstrap]: mihomo API ready`。
5. **产品包不含仓库内部文档**（`!*.md` 等）。
6. **保留的 fork 功能**：Cursor 专用组、地区自动组、定时更新、TUN、订阅刷新。
7. **Antigravity 专用路由**（2026-10-04 用户裁决版 @1.30.71）：`DOMAIN-KEYWORD,cloudcode-pa` / `DOMAIN-SUFFIX,aicode.googleapis.com` / `DOMAIN-SUFFIX,generativelanguage.googleapis.com` 三条前置规则把纯 AI-API 端点送进**现有 `自动选择` fallback 组**（不新增组；`🎯 Cursor 专用` 归还 Cursor 原 select 语义，不再承载 agy）——用户裁决"agy 走自动选择，Cursor 专用是给 Cursor 用的"（KR VPS 不续费，固定物理出口架构失去地基）。**Google 按出口 IP 段判地域**（2026-10-04 机场 6 节点矩阵实测全 200：TW/JP/KR/SG/US/MO 出口 IP 均为 CF AS13335 共享段且节点内固定，hop 只换入站端口；`available-regions` 官方表含 TW/KR 但实际判定是 IP 段级、随会话/时段波动，同节点同日 400 与 200 并存）。`自动选择` 组缺席时注入跳过（安全降级）。mihomo 硬约束（实测 `mihomo -t` 报 `proxy not found`）：规则 target 不能直指 provider 节点，必须经组。**遇 400 时手动在 Sparkle 把 `自动选择` 切到其他节点**（矩阵实测其余节点当前均可用）。
8. **延迟展示口径**（2026-10-09 起，详见该日条目）：节点结论按组实际探测地址取样（`extra[url]`，同一目标的 http / https 记录按时间合并，同一节点在多个 provider 的样本合并），窗口内一次都没成功才显示「超时」，最近失败但近期成功过为「不稳定」，详情浮窗另列「其它探测地址」；代理页、浮窗、托盘、复测范围共用 `proxyDelayVerdictCore`，**不得回退到读混杂各地址样本的顶层 `history`**。
9. **订阅自动更新**（2026-10-12 起，详见该日条目）：远程订阅以「`updated` 是否早于最近一个计划时刻」判定到期，合并版以「任一来源的 `updated` 晚于自己」判定到期；GUI 5 分钟心跳与 LaunchAgent 共用 `createDueProfileUpdateRunner`，失败不推进 `updated`、下次心跳自动重试；合并版无独立定时。**不得改回按定时器触发时刻 / 固定时间窗口判断，心跳读 `profile.yaml` 不得强制重读**（非原子写入，强读可能读到半截文件并触发恢复写入）。
10. **邮件专用**（2026-10-16 起，详见该日条目）：`imap.gmail.com` / `smtp.gmail.com` 等海外邮件客户端域名 → `📧 邮件专用`；成员来自 `sparkle-mail` provider（Sparkle 主进程 **993+465 双通** 探测 + `sparkle-mail-nodes.json` 缓存）；组内 lazy url-test 用 `mail.google.com` 测 RTT。**不得**用 mihomo 直接 url-test IMAPS 端口，**不得**仅用 443 探测代替邮件端口筛选；国内邮箱与 Gmail 网页流量保持原路由。
11. **Gemini 真实地区解锁校验**（2026-10-17 起，详见该日条目与 BUG-2026-10-17-001）：mihomo 对 `https://gemini.google.com` 的健康检查只看 HTTP 200 状态码，无法识别「HTTP 200 但 HTML 内嵌 `vXmutd="ZZ"/"CN"/"HK"` 或 `www.google.cn`」的机场送中节点；Sparkle 主进程通过 `sparkleGeminiProbe.ts`（与邮件探测共享 `withLocalProbeChannelLock` 串行复用 `127.0.0.1:17899`）流式校验 `vXmutd` 国家码，在 `autoSelectStickyPin` 固定前拦截并在 `sparkle-fast-proxies.yaml` 生成/重排时自动剔除送中节点（持久化至 `sparkle-gemini-nodes.json`）。**铁律**：网络超时/连接错误必须返回 `definitive: false`（fail-open），绝不可把瞬时网络抖动的节点记入地区锁区黑名单。

**2026-10-09 移除 Cursor 长流子系统（待装包验证）**
- **保留**：`🎯 Cursor 专用` 组（成员、仅手动选择、默认节点）+ Cursor 路由 / DNS 规则（`cursorBidiOptimize`、`cursorProxyAppPathPrefixes`）。
- **移除**：Marathon 保护（quiesce / 数据面变更守卫 / core 重启守卫 / 协议契约）、api2 探针平面与 ledger、QUIC/HY2 恢复编排、节点质量基准与 24h 报告、断网定责探测、Cursor 网络异常通知、`cursorNetworkOptimize`（TUN/keepalive 强写、`cursorSysProxyLock` 系统代理锁）、`autoCloseConnection` 强制关闭迁移、相关 UI 与配置项（`networkAlert*` / `commercialNodeBenchmark*` / `cursorConnectionHygieneEnabled` / `cursorSysProxyLock`）。
- **脚本**：删除 marathon / G9 / p10 / triage / byte-death 脚本与门禁；`upgrade-sparkle-local.sh` / `install-sparkle-local.sh` / `agent-sparkle-upgrade.sh` 去掉 Marathon PRE-gate 与 Safe Window；就绪探测目标改为 `https://www.gstatic.com/generate_204`。
- **延迟序**：`sparkle-fast` 的延迟来源由 ledger 改为自有快照 `sparkle-fast-delays.json`（实测优先，实测为空时回落快照）。
- **回滚点**：tag `backup-before-cursor-removal`。

**已知边界（物理层，非代码可修）**：运营商国际出口丢包/抖动仍会导致境外变慢与 Cursor 长流卡顿；但**不会再被 Sparkle 放大为集体断连**。

---

## 2026-10-02 · **生产基线 @1.30.67 INSTALLED · BUG-2026-10-02-001 Antigravity 地域 400 根治（🎯 Antigravity 专用组 + 前置规则注入进代码）· LIVE-VERIFIED 2026-10-03 · 专用组部分已被取代**

| 字段 | 内容 |
| --- | --- |
| **当前状态** | 本条的「专用组」「专用组守卫」已不在代码中：专用组于 2026-10-03 删除（`97d328f`），三条前置规则现指向 `自动选择` fallback（`antigravityRuleInjection.ts:38`），`verify:agygeo` 改为断言 `自动选择`（`scripts/verify-antigravity-geo-routing.mts`）。以顶部「当前最佳基线」第 7 条为准；以下行保留为当时记录。 |
| **版本** | `/Applications/Sparkle.app` → **1.30.67**（installed=expected，装包入口 `pnpm run agent:upgrade:mac`；agent 场景需 `SPARKLE_UPGRADE_BREAK_GLASS=1` 跳过 safe-window idle 等待——agent 会话自身占活跃连接必然死锁） |
| **专用组** | `🎯 Antigravity 专用` = **fallback**：`use` = VPS provider、`filter (?i)-VPS-(Reality|HY2)$`（Reality 优先确定性、HY2 冷备、绝不 DIRECT），url `https://gemini.google.com`、interval 300、timeout 5000、lazy |
| **前置规则** | rules 数组最前注入 3 条：`DOMAIN-KEYWORD,cloudcode-pa` + `DOMAIN-SUFFIX,aicode.googleapis.com` + `DOMAIN-SUFFIX,generativelanguage.googleapis.com`（gemini CLI 未来同样受益；host 均纯 AI-API 端点零附带伤害） |
| **守卫** | 无 profileId / 无 VPS leaf → 组不建 + 注入跳过（安全降级）；幂等；`SPARKLE_INJECTED_GROUP_NAMES` 双副本（`customProxyGroups.ts` + `profileGroupNormalize.ts`）防删 |
| **门禁** | `pnpm run verify:agygeo`：读 active `work/config.yaml`，断言组（type/url/use/filter）+ 3 规则存在且行号先于通用 googleapis 规则。**沙箱注意**：`preflight-sparkle-1280.sh` 以 `$HOME` 拼路径，非真实 HOME 会假性 FAIL，用 `HOME=<真实 home>` 跑 |
| **验收** | tsc 0 · 改动文件 eslint 0 · 目标测试 **51/51**（新增 3+2 用例；修正 1 处 HEAD 既有陈旧断言）· **LIVE 验证（2026-10-03）**：`verify:agygeo` PASS（规则 594-596 < 通用 1433）；core 日志 `cloudcode-pa.googleapis.com` 与 `daily-cloudcode-pa.sandbox.googleapis.com` 均 `using 🎯 Antigravity 专用[KR-VPS-Reality]`、HTTP 404 无地域 400；`www.googleapis.com` 照旧走 `🔍 Google`；post-upgrade preflight `ALL PASS` |

---

## 2026-09-15 后续8 · **生产基线 @1.30.66 INSTALLED d493adb4** · BUG-007 选点防抖（tolerance 2000/interval 300/lazy + failover 2000/500 + 区域顺序）· 全量 707 项 0 新增失败 · 已被顶部基线取代（failover 监控 `proxyHealthMonitor.ts` 已于 2026-09-29 删除，区域顺序现为 台湾→日本→韩国→新加坡→美国）

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.66** · CDHash **`d493adb4f3b62a6ad082fa9f8573265c55e2d841`** |
| **选点防抖** | 生成配置实测含 `interval: 300` + `tolerance: 2000` + `lazy: true`；failover 触发 `proxyTimeoutThreshold=2000`、目标 `proxySwitchMaxTargetDelayMs=500`；顺序 新加坡→台湾→日本→韩国→美国 |
| **整核重启** | 代码删净（asar 内 `invokeEmergencyCoreRestart=false`）；装机后 `core_cold_restart_scheduled caller=restartCore` = **0**，`emergency_core_restart_removed` 689 次 |
| **去泄漏** | asar 内 repo 文档 = **0** |
| **验收** | GUI/mihomo/TUN(39)/`:7890` 200 · 全量 707 项 0 新增失败 · tsc/eslint 0 |

---

## 2026-09-15 后续6 · **生产基线 @1.30.66 INSTALLED 781195f1** · BUG-2026-09-15-004/005/006 删除整核冷重启 + 修复 DistFreshness 元凶 + 去文档泄漏 · 单测 707 项 0 新增失败 · 已被顶部基线取代

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.66** · CDHash **`781195f13f9eaf2336aedabb1a94808195ba0a6b`** |
| **T0** | 装包 2026-09-15 · GUI 运行 · mihomo 运行 · TUN · `:7890` HTTP 200 |
| **004 删重启** | 删除 `emergencyCoreRestartBridge` / `restartCoreEmergency` / `coldRestartOscillation*` / smoke CLI；`requestEmergencyCoreRecovery` 只决策+记录 `emergency_core_restart_removed`；JS 产物核对 `invokeEmergencyCoreRestart=false`；装机后整核重启 **0 次** |
| **005 元凶** | DistFreshness `git diff` 3MB 撑爆 1MB `maxBuffer` → 空哈希 → 永远 install-only 装旧包；已修（64MB + fail-safe 判 stale），实测 `fresh=0 source_tree_drift → full upgrade` |
| **006 泄漏** | asar 曾打包 `BUGFIX_LOG/VERSION_LOG/ARCHITECTURE/VPS-*` 等内部文档；已加 `!*.md !reports/** !temp-docs/**`；核对 asar 内 repo docs = **NONE** |
| **验收** | 全量 707 项 0 新增失败 · tsc/eslint 0 · asar 门禁 `missing_emergency_cold_restart_removed` PASS |

---

## 2026-09-15 后续 · **生产基线 @1.30.66 INSTALLED 871eac64** · BUG-2026-09-15-002 冷重启振荡退避（终结"每 5 分钟整核重启导致集体断"）· 已被 781195f1 取代

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.66** · CDHash **`871eac64f4c7e337f41aa751e1cd289afefc6ba3`** |
| **T0** | 装包 2026-09-15 · GUI 运行 · mihomo 运行 · TUN `utun4` 39 路由 · 代理 `:7890` HTTP 200 |
| **实测缺陷** | 当天 mihomo 核心 `Start initial configuration` **50 次**（median 5 分钟），`emergency_core_recovery_completed` 68 次；`restartCoreEmergency` 走 `stopCoreUnchecked+startCore` = **整核停机，所有 App 连接一起断** → 用户主诉"集体挂"（其他客户端不重启内核故无此现象） |
| **修复** | `coldRestartOscillationCore.ts` 振荡退避：首启照常；90min 内再次 → 指数退避 15→30min；模拟 3.5h 劣化窗口冷重启 **50 → ≤10 次**；被拦日志 `[ColdRestartOscillation]: outcome=blocked reason=cold_restart_oscillation_backoff` |
| **asar 验证** | `cold_restart_oscillation_backoff` / `cold_restart_backoff_elapsed` / `[ColdRestartOscillation]:` + 前版 3 个契约标记 → **6/6 命中** |
| **验收** | 全量 707 项 0 新增失败 · tsc/eslint 0 · asar 门禁新增 `missing_cold_restart_oscillation_guard` |

---

## 2026-09-15 12:08 CST · **生产基线 @1.30.66 INSTALLED 97e2c214** · BUG-2026-09-15-001 恢复子系统证据链加固 + 探针诚实性 + 报告窗口对齐 · 已被 871eac64 取代

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.66** · CDHash **`97e2c21491129f18589e18c5371b7b1edbed78ea`** · stamp `2026.0915.1159` |
| **Git** | 基于 `a86f154`（含工作区 BUG-011~016 WIP） |
| **T0** | 装包 2026-09-15 **12:08 CST** · Sparkle GUI 运行 · mihomo root · TUN `utun4` 39 路由 · 代理 `:7890` HTTP 200 |
| **关键改动** | ① `LongflowEvidence` 判别联合（measured/unknown），消除 `?? 0` 静默降级（3/4 生产调用点曾因此永不升级）② `selectLeafProbeTargets` 停止伪造 `leaf_probes=…:fail` ③ 报告按日历日选日志 + 30min 窗口 ④ asar 硬门 `missing_longflow_evidence_contract` |
| **物理根因（本次同证）** | 断网触发根因 = 本机**中国电信国际出口**劣化（出国段 10% 丢包 / 253ms 抖动 / 202.97＝1094ms）；本地 WiFi 0% 丢包；韩国 VPS 自证健康。代码层无法修复物理链路。 |
| **验收** | 707 项测试 0 新增失败 · tsc/eslint 我改文件 0 error · Stage-A/B bundle gate PASS · asar 契约标记 5/5 命中 |

---

## 2026-09-10 14:54 CST · **生产基线 @1.30.66 INSTALLED ba070123** · BUG-2026-09-10-001 外部锚点双重智能门禁 + 消除假阳性集体死亡误报 + 终结自愈轮询死循环 · 单测 47/47 PASS · **已被 2026-09-15 取代**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.66** · CDHash **`ba070123c6a8a9374ec37bf837113fa8a3170cd8`** |
| **Git** | stamp `2026.0910.1451` · break-glass 强制升级覆盖安装 |
| **T0** | 装包 2026-09-10 **14:54 CST** · Sparkle (PID 70690) · mihomo (PID 70943) 0s · proxy api2 **200 OK** |
| **状态** | **INSTALLED · 当前 Agent 最佳生产基线** — 彻底消除 1.30.65 误报 Collective Death 弹窗与自愈死循环 |

### 本版相对 1.30.65 新增/补全（BUG-2026-09-10-001）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| **外部锚点生命力降级兜底** | ✅ INSTALLED | `evaluateSidecarExternalVerification` 接入 `isVitalityConnectPathTrustworthy`（>=50ms），外部测速超时但物理链路活着时判定通过（`api2_anchor_fallback_trustworthy_vitality`），消除假死误判 |
| **双通道混合端口发包复测** | ✅ INSTALLED | `probeRecoveryApi2AnchorDetailed` 在控制器单点测速失败时，自动 fallback 到本地 Mixed 端口物理真实发包链路二次确认 |
| **放宽测速并发容错时间** | ✅ INSTALLED | `cursorApi2MihomoProbe.ts` 探测超时阈值由 5000ms 宽限至 8000ms，抗系统峰值抖动 |
| **自愈冷却控制与死循环终结** | ✅ INSTALLED | `hy2ParentSidecar.ts` 在紧急自愈检测后补充记录 `lastHy2ParentSidecarActionAtMs = nowMs`，彻底终结 5s 紧凑轮询空转 |
| **主力节点配置校准** | ✅ INSTALLED | 将兜底默认节点由旧的 `JP-VPS-HY2` 全面更正为当前系统实际运行的主力 `KR-VPS-HY2` |
| **工程规范与静态导入治理** | ✅ INSTALLED | 修复 ESLint restricted-syntax 动态导入问题，改为纯净静态引入，全模块 0 errors, 0 warnings，无 any 类型 |
| **单测套件覆盖** | ✅ **47/47** | 7 大核心套件（47 项测试用例全部绿色 PASS，包含兜底、死锁、熔断、冷却验证） |

### 1.30.65 装包后 live 证伪（为何需要本版）

| 时间 | 1.30.65 表现 | 根因与反思 |
| --- | --- | --- |
| 14:07:46 CST | 弹出 `Sparkle Collective Death Bug Report`（`recovery_circuit_open` / `api2_anchor_fail`） | **假阳性误报**：业务流量正顺畅转发（14:07:42 core.log），物理延时实测 439ms（14:07:46.678 app.log），但因系统瞬时负载大，管理接口 5s 测速超时，门禁一刀切判死刑，触发熔断开闸并错拉 14 小时前的陈旧日志展示。 |
| 持续空转 | `EmergencyCoreRecovery outcome=blocked reason=proxy_stack_alive_mixed_port_api2` 每 5s 紧凑重试 | **死循环空转**：自愈受阻分支未更新冷却时间戳，导致系统陷入 5 秒高频自检空转，狂刷日志消耗 CPU。 |

### 架构反思与防回归铁律（避免再次翻车）

1. **物理网络生命力延时具有最高仲裁权**：任何上层 HTTP 单点探针的失败，都不能推翻底层 QUIC/UDP 物理拨号成功且具有真实延时的客观事实。严禁“单点一票否决”。
2. **阻断必须有冷却，严禁空转**：所有自愈拦截、死锁保护分支必须强制更新时间戳并触发退避冷却，绝不能无间隔死循环重试。
3. **报警收集必须窗口对齐**：告警日志抓取必须对齐当前 incident 时间戳，严禁回溯十几小时前的陈旧死锁日志吓唬用户。

---

## 2026-09-03 16:15 CST · **开发基线 CODE-DONE @1.30.56** · BUG-007/008 集群检测 + 强制 UDP 刷新 + circuit bypass · **待装包**

| 字段 | 内容 |
| --- | --- |
| **版本** | git **1.30.56** · stamp `2026.0903.1615` |
| **007** | core log tail watcher（GUI + service 双路径）· 移除 ws/out 双 ingest 死代码 |
| **008** | 集群触发 **直接 close UDP parent**（不信任 vitality 探针假阳性）· circuit breaker bypass |
| **16:10 live** | circuit open `byte_death_udp_evidence_insufficient` 阻断 sidecar · 0 条 CursorDialFailureCluster |
| **VPS** | sing-box **1.14.0** 已替换二进制（config OK）· restart 待确认 |

---

## 2026-09-03 15:38 CST · **生产基线 @1.30.55 INSTALLED 7464c014** · BUG-006 age SSOT + failback 门控 + Reality 恶性循环 · 单测 46/46 · **已被 1.30.56 取代（待装）**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.55** · CDHash **`7464c014d110ebd9ec53b14c467376aec814d841`** |
| **Git** | commit **`eb71107`** · dist stamp `2026.0903.1534` · break-glass install |
| **T0** | 装包 2026-09-03 **15:38 CST** · mihomo 0s · proxy api2 **200** |
| **状态** | **INSTALLED · 当前 Agent 迭代基线** — 004/005 在 1.30.54 **部分生效**，本版补全闭环 |

### 本版相对 1.30.54 新增/补全（BUG-006）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| **failback 马拉松门控打通** | ✅ INSTALLED | `hy2_vitality_failback` → 允许 Reality/TLS→HY2（修 15:28 blocked_marathon_active） |
| **age SSOT 统一** | ✅ INSTALLED | `resolveEffectiveTransportLongevityAges` 进 quiesce/rotate/close 门控（修 8h emergency refresh 永不触发） |
| **Reality 上 suppress HY2 absent** | ✅ INSTALLED | live leaf=Reality 时 HY2 udp absent→unknown（修 15:29 恶性循环） |
| **004 vitality 反证** | ✅ 继承 | 1.30.54 |
| **005 dial 集群检测** | ✅ 继承 | 1.30.54 |
| **单测** | ✅ **46/46** | +failback gate · +birth emergency refresh · +Reality suppress |

### 1.30.54 装包后 live 证伪（为何需要本版）

| 时间 | 1.30.54 表现 | 根因 |
| --- | --- | --- |
| 15:28:18 | failback **failed** `blocked_marathon_active` | 004 failback 未接 marathon 门控豁免 |
| 15:28:53 | TransportLongevityTruth **age=0** vs sidecar **172M ms** | age SSOT 分裂 · rotate/quiesce 读 snapshot 零 |
| 15:29:53 | 已在 Reality 仍 emergency | HY2 absent 在 Reality 路径误升级 |

### VPS 对账（15:13 定论 · 006 文档化）

- 07:12–07:13 CST：VPS sing-box **HY2 入站 = 0** · 客户端 138+ deadline
- 07:14:30 恢复：UDP 端口 50703→61604 · 与 sidecar 精确对齐
- **L0 定论**：15:13 = **客户端 stale 66h QUIC**，非 VPS 宕机

### 已知遗漏（禁止声称 100% 全断连修复）

1. VPS QUIC 物理层根因（客户端已证伪「VPS 拒连」假设）
2. marathon 非活跃（cursor_conn<12）时 dial 集群 sidecar 弱路径
3. vitality 反证窗口仅 60s — 超时后仍可能误 absent（006 用 Reality suppress 缓解）
4. **30min 三端马拉松 soak 未完成**

### 同日版本迭代计数（防 regression 参考）

| 版本 | 时间 | 结果 |
| --- | --- | --- |
| 1.30.53 | 13:18 | 空白订阅修 · 当日 13:25/14:41/15:13 仍断 |
| 1.30.54 | 15:25 | 004/005 CODE · **15:28 又锁 Reality** |
| **1.30.55** | **15:38** | **006 补全 · 当前基线** |

---

## 2026-09-03 15:25 CST · **生产基线 @1.30.54 INSTALLED 1a48fd50** · BUG-004 + BUG-005 · **已被 1.30.55 取代**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.54** · CDHash **`1a48fd504ae71c14affe4257f2578648f6c2dc33`** |
| **Git** | commit **`82193a9`** · break-glass install（`SPARKLE_UPGRADE_BREAK_GLASS=1` + `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1`） |
| **T0** | 装包 2026-09-03 15:25 CST · mihomo 0s · proxy api2 **200** |
| **状态** | **INSTALLED · 待 30min soak** — 覆盖 13:25 误 failover + 14:41 Reality 锁死 + **15:13 HY2 deadline 静默断** |

### 核心能力（2026-09-03 004 + 005）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| **vitality UDP-absent 反证** | ✅ INSTALLED | absent→unknown · 不误 failover/emergency |
| **failover 60s soak** | ✅ INSTALLED | 13:25 式 5s 二次 emergency 已挡 |
| **HY2 auto failback** | ✅ INSTALLED | 读 **mihomo live now** · 非 stale selection.json |
| **dial 失败集群检测** | ✅ INSTALLED | ≥5/10s → sidecar bypass cooldown/circuit + toast |
| **TransportLongevity birth age** | ✅ INSTALLED | 66h 会话不再报 age=0 |
| **replay gate** | ✅ 5/5 | +`0903_false_udp_absent_vitality_counterproof` |

### 已知遗漏（禁止声称 100% 全断连修复）

1. VPS QUIC/443 物理层根因未穿透（需 VPS 日志）
2. marathon 非活跃（cursor_conn<12）时集群 sidecar 路径未覆盖
3. 30min 三端马拉松 soak 未完成（break-glass 跳过 idle wait）

---

## 2026-09-03 15:10 CST · **开发基线 CODE-DONE（未装包）** · BUG-2026-09-03-004 Failover 治理 · replay 5/5 · 单测 26/26

| 字段 | 内容 |
| --- | --- |
| **版本** | 生产仍为 **1.30.53 INSTALLED c0cba9f** · 本条目为 **git 工作区 CODE-DONE** |
| **Git** | 工作区未 commit · 待 bump **1.30.54** |
| **T0** | 代码完成 2026-09-03 15:10 CST · **未 agent:upgrade:mac** |
| **状态** | **待装包 + live soak** — 取代能力：误 UDP-absent failover 链 |

### 核心能力（2026-09-03 004 新增 · CODE-DONE）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| **vitality UDP-absent 反证** | ✅ CODE | `udp=0` + vitality<60s → `evidence_insufficient`，不 failover/emergency |
| **failover 60s soak** | ✅ CODE | 防止 13:25 式 5s 内二次 emergency |
| **HY2 auto failback** | ✅ CODE | Reality 锁死后 vitality 成功 → 自动切回 JP-VPS-HY2 |
| **dial-timeout 集群检测** | ❌ 未做 | 14:41 291 timeout 静默盲区仍在 |
| **replay gate** | ✅ 5/5 | +`0903_false_udp_absent_vitality_counterproof` |

### 已知遗漏（禁止声称 100% 全断连修复）

1. dial-timeout 集群检测未实现
2. VPS:443 物理拒连根因未穿透（无 VPS 日志）
3. failback SSOT 仅读 selection.json，未对账 mihomo 实时选中

---

## 2026-09-03 13:20 CST · **生产基线 @1.30.53 INSTALLED edf84174** · Sep2 tier0 SEL + 空白订阅恢复 + 集体死亡 toast · **待 soak**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.53** · CDHash **`edf841749dbd08b8c7dd84ae5c293a79cffb3077`** |
| **Git** | commit **`c0cba9f`** · dist stamp `2026.0903.1318` |
| **装包** | `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 SPARKLE_UPGRADE_BREAK_GLASS=1 pnpm run agent:upgrade:mac` · 2026-09-03 ~13:18 CST |
| **T0** | install 完成 · proxy :7890 **302 OK** · `generateProfile groups=32` · 订阅 `77caf1sub001` |
| **状态** | **当前最佳可用基线** — 取代 1.30.53 `199ff203` 观测-only 包；含 BUG-2026-09-03-001/002/003 |

### 核心能力（2026-09-03 新增）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| **Tier-0 marathon SEL** | ✅ INSTALLED | Sep2 84s stall parent proof → vitality+SEL（非 dead-end none） |
| **profile.yaml recovery** | ✅ INSTALLED | 空/wipe 自动从 `.bak` + 磁盘 profiles 恢复 |
| **sidebar refresh dnd fix** | ✅ INSTALLED | `profile-card` 刷新按钮可点击 |
| **disk cache refresh** | ✅ INSTALLED | 无 URL 时 reload 本地缓存；有 URL 远端更新 |
| **集体死亡 toast** | ✅ INSTALLED | 「复制 Bug 信息」clipboard IPC |

---

## 2026-09-02 14:20 CST · **生产基线 @1.30.53 INSTALLED 199ff203** · Marathon Stability Phase 0/0.5 + Phase 1S · **待 30min soak**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.53** · CDHash **`199ff203f33a7abec950a789439d133eea983b2c`** |
| **Git** | commit **`ba18b505`** · dist stamp `2026.0902.1416` |
| **装包** | `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 pnpm run agent:upgrade:mac` · 2026-09-02 ~14:16 CST |
| **T0** | install 完成 · proxy :7890 **OK** · Sparkle GUI **running** |
| **平台** | macOS 26 · headless bootstrap + `--sparkle-force-gui` |
| **状态** | **当前最佳可用基线** — 取代 1.30.52 观测/1S 能力；**1.30.52 recovery/fake-ip 能力保留未回退** |

### 版本谱系（防回退）

| 从 | 到 | 关系 |
| --- | --- | --- |
| 1.30.52 `17c22f70…` | 1.30.53 `199ff203…` | **增量**：观测脚本 + Phase 1S · **无删除** recovery coordinator / fake-ip sanitize |
| 1.30.52 | 1.30.53 | CDHash 变更 = 正常重装 · Gatekeeper 可能需 Control+Open 一次 |

### 核心能力（2026-09-02 新增）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| **Phase 0 归因脚本** | ✅ INSTALLED（scripts/） | `marathonStabilityAttributionCore` + CLI · 15 单测 · 多 core/app 扫描 · `resolveSparkleDataHome` |
| **Phase 0.5 Sparkle-only 守恒** | ✅ INSTALLED（scripts/） | **零 Cursor 日志依赖** · `marathon-stability-conservation-report.mts` |
| **Phase 1S data-plane busy gate** | ✅ INSTALLED（asar） | mihomo 活跃连接≥48 → profile-update defer + probe max 1 |
| **blocked 日志 5min 节流** | ✅ INSTALLED（asar） | `coreLifecycleBlockedLogThrottleCore` · 5min 窗口 + `blocked_summary` |
| **Cursor RID 桥接** | ❌ REMOVED | 删 `marathonStabilityRidCrosswalkCore` — 防技术债 · triage 脚本仍可用（手动） |
| **30min soak PASS** | ⏳ PENDING | T0=14:16 CST · 14:46 后验 blocked 频率 |

### 文件交付清单（Agent 勿删）

**scripts/**（观测 · 不进 asar 但 SSOT）：
- `marathonStabilityAttributionCore.ts` + `.test.ts`
- `marathonStabilityLogPathsCore.ts`
- `marathonStabilitySparkleConservationCore.ts` + `.test.ts`
- `marathon-stability-attribution-report.mts`
- `marathon-stability-conservation-report.mts`

**src/main/core/**（Phase 1S · 进 asar）：
- `mihomoDataPlaneLoadCore.ts` + `.test.ts`
- `mihomoDataPlaneLoadState.ts`
- `coreLifecycleBlockedLogThrottleCore.ts` + `.test.ts`
- 改动：`profileUpdateDueCli.ts` · `mihomoProbeCoordinator.ts` · `marathonCoreRestartGuard.ts`

### 变更摘要

| 模块 | 改了什么 | 解决什么 | 未解决 / 遗漏 |
| --- | --- | --- | --- |
| `scripts/marathonStability*` | 观测 + 守恒 CLI | stall vs 断连可拆分；C3 HOME 假阴性 | **不减少**真实断连频率 |
| `mihomoDataPlaneLoadCore` | busy 阈值 48 | 高负载少抢探测槽 | VPS 443 服务端仍 OPEN |
| `profileUpdateDueCli` | busy 提前 defer | 少进 readiness pipeline 撞 guard | 订阅更新可延迟数分钟 |
| `coreLifecycleBlockedLogThrottleCore` | 日志节流 | app.log 可读 | blocked 仍会发生，只是少刷 |
| `mihomoProbeCoordinator` | 动态 max 1/2 | 数据面忙时降并发 | 手动测速仍可用 |

### 物理证据（装包 @14:16）

| 证据 | 值 |
| --- | --- |
| `defaults read … CFBundleShortVersionString` | **1.30.53** |
| CDHash | `199ff203f33a7abec950a789439d133eea983b2c` |
| dist stamp | `2026.0902.1416` · git `ba18b505` |
| proxy :7890 → api2 | **200 OK** |
| 装包前 24h 守恒 | 61 用户断连（历史 Structured，已 decouple）· 476 probe 信号 |
| 装包前 2h Sparkle-only | 47 incident（L2:24 · L3:16） |

### 踩坑 SSOT（9/2 · 防复发）

1. **2917ms UI 延迟 ≠ 超时** — `delayTestTimeout=10000`；**0** 才是超时（`proxyDelayDisplayCore.ts`）
2. **13:05 JP deadline ≠ 终端断连根因** — RID `23981e68` = L7 慢池 90s（时间差 32min）
3. **只读 latest core** → 假阴性 · 必须扫全部 `core-*.log` / `app-*.log`
4. **Cursor 桥接进 Sparkle 运行时** → 技术债 · 已删；观测只用 Sparkle/mihomo 日志
5. **blocked 日志当事故** → 误报 · blocked=guard 正常工作 · 看 `blocked_summary`
6. **装包 ≠ 验 runtime** — 须 `defaults read` + CDHash + proxy curl 三证

### 反思（为何反复修不好）

- **根因**：以前只有 triage 手工脚本，无批量归因 → 每次断连靠猜 → 修 A 怪 B
- **本次策略**：先 **尺子**（Phase 0/0.5）再 **刹车**（Phase 1S）· 不耦合 Cursor 运行时
- **仍 OPEN**：VPS SSH 不通 · L7 慢池非 Sparkle 能修 · **100% 零断连不可承诺**

### 验收门禁

- [x] install 版本 **1.30.53** CDHash `199ff203…`
- [x] proxy :7890 → api2.cursor.sh **200**
- [x] Sparkle GUI **running**（`open-sparkle-gui-macos26.sh`）
- [x] VERSION_LOG + BUGFIX_LOG 已更新（BUG-2026-09-02-001/002）
- [x] 单测 **15 pass**（scripts 10 + core 5）
- [ ] T0+30min（~14:46 CST）：`core_cold_restart_blocked` 同类 ≤1/5min（+summary）
- [ ] T0+24h：JP connect error 率 ≤0.25% 且不升

---

## 2026-09-01 18:30 CST · **生产基线 @1.30.52 INSTALLED cb85a3b** · Recovery + fake-ip 三环闭合 · **已被 1.30.53 观测/1S 基线取代（recovery 能力保留）**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.52** · CDHash **`17c22f704c7cc88b5ee56188c4581c8e26f36072`** |
| **Git 链** | `d33cbf1` → `6e92e53` → `08b4153` → `252de75` → **`cb85a3b`（HEAD · 已装 asar）** |
| **装包** | `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 pnpm run agent:upgrade:mac` ×2（10:24 + 10:28 CST） |
| **T0** | `2026-09-01T10:29:11Z` · `[CoreLifecycle]: post_ready fake_ip_flush reason=cold_start` |
| **平台** | macOS **26** · service core · marathon active（cursor_conn 7–24 装包期） |
| **状态** | **当前最佳可用基线** — Agent 迭代以此为准；**禁止回退**到无 `recovery_coordinator` / 无 emoji-CIDR-sanitize 的 asar |

### 核心能力（2026-09-01 18:30 验证）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| **Emergency 120s cooldown + in-flight mutex** | ✅ INSTALLED | `emergency_cooldown_active` @10:08 · `d33cbf1` |
| **CircuitBreaker open/block only** | ✅ INSTALLED | 无 CB 并行 emergency admission |
| **RecoveryCoordinator failover-first** | ✅ INSTALLED | policy `failover_leaf` before emergency · `252de75` dispatch count |
| **R-31 failover bypass** | ✅ INSTALLED | `source=recovery_coordinator` · asar 3 hits · `08b4153` |
| **Tier0-Direct fake-ip-filter** | ✅ RUNTIME | `+.cn` / `+.qq.com` in `work/config.yaml` fake-ip-filter |
| **198.18 CIDR trap 移除** | ✅ RUNTIME | `generateProfile` @10:28:59 → `integrity_patches` · **TRAP_ABSENT** post-regen |
| **CoreLifecycle post-ready flush** | ✅ RUNTIME | cold_start + emergency 路径均见 `fake_ip_flush outcome=executed` |
| **T0 后零 emergency** | ✅ 短窗 | 10:29+ 无 `emergency_admitted` · 无 i/o timeout（18:29 窗） |
| **30min marathon soak** | ⏳ PENDING | T0+30min → 10:59+ 需零 emergency 循环 |
| **failover 实战** | ⏳ PENDING | 待下次 HY2 byte-death · 期望 `recovery_failover_lateral_escape` |
| **Cursor Network Diagnostic 10/10** | ⏳ PENDING | 用户可选 |

### Git 交付链（9/1 四轮迭代 · 同族第 4+ 轮）

| Commit | 模块 | 修复什么 | 遗漏/导致什么 |
| --- | --- | --- | --- |
| `d33cbf1` | emergency + CB | in-flight mutex · 120s cooldown · CB 仅 open | failover 仍被 R-31 拦 · 198.18 trap 仍在 |
| `6e92e53` | CoreLifecycle + Tier0 | post-ready flush · cn suffix filter | sanitize 不匹配 `🎯 Direct` → trap 每次 regen 写回 |
| `08b4153` | marathonProtocolContract | `recovery_coordinator` bypass lateral block | 未单独装包前 failover 仍 `source=manual` 被拒 |
| `252de75` | recoveryCoordinatorPolicy | failover 失败可重试 · 成功才锁 | — |
| `cb85a3b` | fakeIpRoutingIntegrity | 198.18/198.19 CIDR **无条件移除** | — |

### 架构 SSOT（Agent 必读 · 勿回退）

1. **RecoveryCoordinator** — 唯一 owner：failover（≤2 dispatch）→ emergency；CB 只计数/open
2. **CoreLifecycle** — 每次 core ready → `mihomoFlushFakeIpCache`
3. **ensureFakeIpRoutingIntegrity** — profile build 时 Tier0-Direct + **strip 198.18/198.19 CIDR（任意 outbound 名）**
4. **failover switch source** — 必须 `recovery_coordinator`（非 `manual`）才能 bypass R-31

### 踩坑 SSOT（9/1 血泪 · 防复发）

1. **sanitize 只匹配字面 `DIRECT`** — 订阅用 `🎯 Direct` → Layer1 从未生效 → **每次 generateProfile 写回陷阱**（BUG-001-R2）
2. **failoverAttempted 在 dispatch 时置 true** — 一次 R-31 拒绝 → **永久 emergency 路径**（BUG-003）
3. **failover 用 source=manual** — R-31 `blocked_suboptimal_lateral` HY2→Reality（BUG-003）
4. **装包 ≠ 验 runtime config** — Tier0 进 filter 但 CIDR trap 仍在 = **半生效假象**
5. **错误验收** — 「0 timeout 窄窗」「0 emergency 装包后 5min」≠ PASS；须 T0+30min + trap absent + failover 实战
6. **profile regen 被 marathon guard defer** — `--sparkle-profile-update-due` @ cursor_conn>0 → deferred queue；**generateProfile on cold_start 才是可靠路径**

### 变更计数

- **BUG-2026-09-01-001**：R0→**R2**（3 轮）· fake-ip 同族 **第 3 次** partial fix
- **BUG-2026-09-01-002**：R0→**R1**（2 轮）· emergency 同族 **第 2 轮** partial → 三环 cb85a3b
- **BUG-2026-09-01-003**：**新增** · failover R-31 + permanent lock
- **9/1 总 commit**：5（d33cbf1→cb85a3b）· **48× emergency_admitted** 装包前（10:00–10:23）

### 验收门禁（soak PASS 前勿标 DONE）

- [x] install CDHash `17c22f70…` · asar 含 `recovery_coordinator`
- [x] `work/config.yaml` 无 `198.18.0.0/16` IP-CIDR rule
- [x] T0 后 `fake_ip_flush outcome=executed`
- [ ] T0+30min 零 `emergency_admitted` @ cursor_conn>0
- [ ] 下次 HY2 stall → `failover_leaf outcome=executed`（非 `switch_blocked source=manual`）
- [ ] core log Direct i/o timeout 不增长
- [ ] Cursor Network Diagnostic 10/10（可选）

---

## 2026-09-01 17:30 CST · **Recovery + CoreLifecycle 双 SSOT @1.30.52 CODE-DONE** · fake-ip Direct + emergency 循环 · **已被 18:30 基线取代**

| 字段 | 内容 |
| --- | --- |
| **版本** | git **d33cbf1+** · prod 装包 CDHash 待更新 |
| **目标** | 马拉松期 Cursor/Codex 稳定 + 国内 Direct 不 timeout + core restart 不雪崩 |
| **状态** | ~~代码+单测 23/23 PASS · 装包+soak 进行中~~ → **部分交付 · 见 18:30 基线** |

### 交付清单

| 模块 | 能力 | 状态 |
| --- | --- | --- |
| RecoveryCoordinator | failover-first · emergency in-flight + 120s cooldown | ✅ d33cbf1 |
| CircuitBreaker | open/block only（无 duplicate emergency） | ✅ d33cbf1 |
| Tier0-Direct | cn suffix + Direct 规则 → fake-ip-filter | ✅ 6e92e53 |
| CoreLifecycle | post-ready fake-ip flush | ✅ 6e92e53 |

### 验收门禁

- [x] install 后 `[CoreLifecycle]: fake_ip_flush outcome=executed`
- [ ] 30min 无 emergency 循环 — **装包前 FAIL（48× admitted）**
- [ ] core log Direct fake-ip timeout 不增长 — **717 累计 · trap 未除**
- [ ] Cursor Network Diagnostic（用户可选）

---

## 2026-09-01 17:00 CST · **Phase-1 Recovery Convergence + Hotfix @1.30.53 CODE-DONE** · emergency 马拉松自激回归 · **待 install**

| 字段 | 内容 |
| --- | --- |
| **版本** | git **1.30.53**（待装）· prod `/Applications/Sparkle.app` → **1.30.52** · build `2026.0901.1605` |
| **平台** | macOS **26.5.2** · service core · marathon active |
| **状态** | Phase-1 **smoke PASS** · 马拉松 soak **FAIL（回归）** · hotfix **CODE-DONE 待装** |

### Phase-1 交付（1.30.52）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| Recovery Coordinator | ✅ | `recoveryCoordinator.ts` single entry |
| Emergency core recovery | ✅ smoke | `EmergencyRecoverySmoke outcome=PASS` @08:17 UTC |
| Byte-death verifier | ✅ | `recoveryByteDeathVerifierCore` |
| UDP absent bypass 移除 | ✅ | no birth-reset on absent |
| Circuit OPEN → emergency | ✅ | 能执行（旧 deadlock 闭合） |

### 回归 + Hotfix（1.30.53）

| 问题 | 修复 |
| --- | --- |
| 马拉松期每 2–3min core restart | `emergencyRecoveryInFlight` + 120s cooldown |
| UDP absent 跳过 failover | policy: cursor_conn>0 → `failover_leaf` 优先 |
| Coordinator + breaker 双触发 | admission 层 in-flight gate |

### 待验门禁

- [ ] `pnpm run agent:upgrade:mac` 装 1.30.53
- [ ] 马拉松 30min 零 `emergency_core_recovery_completed` 循环
- [ ] Cursor Network Diagnostic 10/10
- [ ] 手动：🎯 Cursor 专用切 **JP-VPS-TLS** 作即时止血

---

## 2026-08-29 23:31 CST · **生产基线 @1.30.40 INSTALLED** · Marathon Data-Plane Guard R3 · Cursor Reconnecting 闭合 · **P0–P3 PASS**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.40** · CDHash 装包于 **23:28 CST** · git 含 R3 Layer-0（与 asar 同步） |
| **平台** | macOS **26.5.2** · service core · headless + `macos26ForceGui: true` |
| **订阅** | `77caf1sub001` · providers `77caf1sub001` + `77caf1sub001-vps` |
| **会话** | composer `3d9338e6-094a-45ba-a652-53077afbc757` |
| **状态** | **当前最佳可用基线** — Agent 迭代以此为准；禁止回退到无 Layer-0 的 asar |

### 核心能力（2026-08-29 23:31 验证）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| **Marathon 数据面零突变** | ✅ P0–P3 | `verify-marathon-data-plane-soak-gate` PASS · defer_events=10 · 零 `mihomo core started` since T0 |
| ProfileUpdaterCli / second-instance | ✅ defer | `deferred data_plane_mutation_blocked cursor_conn=9–24` |
| reload-mihomo-via-service.mjs | ✅ defer | `reload_deferred { blockColdRestart: true }` |
| startCore Layer-0 | ✅ | `core_cold_restart_blocked caller=profile-update-cli/startCore` |
| CI 防回归 | ✅ | `verify-marathon-mutation-callers` in upgrade Stage-A |
| Deferred profile queue | ✅ | `deferred_profile_update_queued` → conn→0 补跑 |
| 代理 :7890 | ✅ | api2.cursor.sh / generate_204 |
| 单测 | ✅ 25+ | guard + Layer-0 + deferred + soak script |

### R3 架构改动（**已装 /Applications**）

| 层 | 模块 | 作用 |
| --- | --- | --- |
| **Layer-0** | `startCoreMutationGuardCore.ts` · `manager.startCore()` | 任何 caller 无法旁路 cold restart |
| **Caller SSOT** | `profileUpdateDueCli.ts` · `index.ts` second-instance | 共用 `runGuardedDueProfileUpdates*` |
| **Defer 统一** | `appConfigMihomoReloadGuardCore.ts` | conn>0 即 block（禁止 conn≥12 分裂） |
| **P2 Queue** | `deferredProfileUpdateDue.ts` | marathon 期 defer · idle 补跑 |
| **P1 CI** | `verify-marathon-mutation-callers.mts` | startCore/restartCore allowlist |
| **P3 Soak** | `verify-marathon-data-plane-soak-gate.mts` | post-install + agent upgrade gate |
| **脚本** | `reload-mihomo-via-service.mjs` | 读 `~/.sparkle/marathon-core-restart-guard.json` |

### 同会话其他 git 改动（**部分未装 asar · 待下次 upgrade**）

| BUG | 状态 | 说明 |
| --- | --- | --- |
| BUG-2026-08-29-002 | CODE-DONE git | ♻️→Sparkle 自动选择 — **需 regen 后 patch 或 reinstall** |
| BUG-2026-08-29-003 | MITIGATED | macos26ForceGui 偏好 |
| BUG-2026-08-29-004 | CODE-DONE git | service provider parity COMPATIBLE placeholder |
| BUG-2026-08-29-005 | CODE-DONE git | Cursor HY2 manual optimal 切换 |

### 已知遗漏（非 Reconnecting 阻塞）

| 优先级 | 项 |
| --- | --- |
| P1 | 002/004/005 git 补丁需 `agent:upgrade:mac` 与 R3 同包装入 asar |
| P2 | byte-death G3 attemptRate soak（独立 BUG-2026-08-06 族） |

### 踩坑 SSOT（Agent 必读）

1. **禁止 caller 层单独 guard** — mutation 必须经 `startCore/restartCore/stopCore` 或 mihomoApi provider guard。
2. **LaunchAgent 5min → second-instance** — 必须走 guarded path（22:48 事故主因）。
3. **装包** `pnpm run agent:upgrade:mac`；禁止 ditto；marathon 时 `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1`。
4. **验证三连**：`verify-marathon-mutation-callers` + soak gate + app-log 无 `mihomo core started` @ cursor_conn>0。
5. **Reconnecting 归因**：Sparkle 数据面突变 → ECONNRESET → `[nal_agent_retries]` UI；**非 Cursor 补丁 bug**。

### 变更计数

- **BUG-2026-08-29-001**：R0→R3（4 轮）· 同族 data-plane mutation 第 4+ 次 · **R3 架构闭合**
- **升级入口**：`scripts/agent-sparkle-upgrade.sh`（含 P3 soak gate）

---

## 2026-08-29 23:21 CST · **基线 @1.30.40 + git 未装包补丁** · 订阅自动选择 + macOS 26 GUI · **已被 23:31 基线取代**

| 字段 | 内容 |
| --- | --- |
| **版本** | **已安装** `/Applications/Sparkle.app` → **1.30.40** · **git 工作区** 含未安装补丁（见下） |
| **订阅** | `77caf1sub001`（新订阅）· providers `77caf1sub001` + `77caf1sub001-vps` |
| **平台** | macOS **26.5.2** · service core · headless 默认 + **`macos26ForceGui: true`** |
| **会话** | open-perplexity composer `3d9338e6-094a-45ba-a652-53077afbc757` |
| **状态** | **相对可用且较好** — 代理/GUI/自动选择均已验证；git 补丁 **未打入 asar**，regen 后 ♻️ 可能短暂回归 |

### 当前能力（已验证 2026-08-29 23:21）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 代理 :7890 | ✅ 204/200 | `curl -x :7890 generate_204` / `api2.cursor.sh` |
| Sparkle GUI | ✅ 运行中 | `pgrep -x Sparkle` · `macos26ForceGui: true` |
| 订阅 ♻️ → Sparkle 自动选择 | ✅ 运行时 | disk+runtime `♻️`=0 · `🔰 手动选择 now=自动选择` |
| Sparkle-自动-* 区域组 | ✅ GUI 可选 | `work/config.yaml` 各 select 组含区域 url-test |
| 🎯 Cursor 专用 | ✅ | 在 `自动选择` fallback 链末尾 · VPS HY2 manual（BUG-005 git） |
| 🇭🇰 香港节点 | ✅ | 非全局；域名规则注入 · 新订阅 HK 节点可见 |
| Service provider parity | ✅ git | 换订阅后 disk/runtime 不一致会触发 service restart（marathon 可 defer） |

### 本基线 git 改动（**未 install → /Applications**）

| 模块 | 改动摘要 | 文件 |
| --- | --- | --- |
| **订阅自动选择统一** | 删除 `♻️ 自动选择` url-test 组；引用/规则改 `自动选择`；select 组暴露 `Sparkle-自动-*` | `defaultAutoSwitchProxy.ts` · 单测 14/14 |
| **macOS 26 GUI 偏好** | `--sparkle-force-gui` / env 启动时持久化 `macos26ForceGui`；用户 config 已写 `true` | `macos26ForceGuiPreferenceCore.ts` · `index.ts` |
| **GUI 启动 SSOT** | `scripts/open-sparkle-gui-macos26.sh` | 备用 |
| **Service provider parity** | 换 profile 后 service core provider ID 不一致 → restart | `serviceCoreProviderParityCore.ts` · `manager.ts` |
| **Cursor HY2 手动切换** | 允许 manual 切到 `JP-VPS-HY2`（optimal VPS）· 仍拦 suboptimal 横向 | `marathonProtocolContractCore.ts` |
| **过渡热修脚本** | regen 后临时修复 config | `scripts/patch-work-config.ts` |

### 已知遗漏 / 待办（防止误判「已 100% 固化」）

| 优先级 | 项 | 说明 |
| --- | --- | --- |
| **P0** | **`pnpm run agent:upgrade:mac`** | ~~Layer-0~~ **R3 已装**；002/004/005 git 补丁仍待同包装入 |
| **P1** | **regen 不带 ♻️** | 装包前每次 headless/GUI bootstrap 可能还原 ♻️ → 需 `patch-work-config.ts` 或等 install |
| **P2** | **Marathon upgrade 等待** | `agent:upgrade:mac` 构建后可能等 safe window ~10min — Agent **禁止同步死等** |

### 踩坑 SSOT（本版本总结）

1. **macOS 26 默认 headless**：`open -a Sparkle` 无窗口 ≠ 未启动；看 `pgrep mihomo` + `:7890`。要 GUI：`macos26ForceGui: true` 或 `--sparkle-force-gui`。
2. **♻️ vs 自动选择**：订阅 `♻️ 自动选择` 是 flat url-test，与 Sparkle `自动选择`→`Sparkle-自动-*` **并行竞争**；必须 factory 层 rewrite，不能只靠 GUI 默认。
3. **换订阅 COMPATIBLE**：service 模式 mihomo 未 restart → runtime provider 旧 ID；cold restart 或 `serviceCoreProviderParityCore`。
4. **Agent 卡死**：禁止 `reload-mihomo-via-service.mjs` 无超时等待；禁止同步等 marathon install；大 yaml 用 `rg -c` 限 scope。
5. **HK 非全局**：仅 X/Grok/Stripe 等域名规则走 `🇭🇰 香港节点`；`自动选择` 区域优先级不含 HK。

### 变更历史计数（自 2026-08 马拉松期）

- **semver 线**：1.30.40（当前安装）· git 同版本未 bump
- **本夜缺陷条目**：BUG-2026-08-29-001 R3 闭合 + 002~005 · 见 BUGFIX_LOG
- **同族复发**：data-plane mutation @ active Cursor（BUG-001 第 4+ 次）— **R3 Layer-0 已闭合**（见 23:31 基线）

---

## 模板（后续版本追加在上方）

```markdown
## YYYY-MM-DD HH:MM TZ · 标题 @semver · 状态

| 字段 | 内容 |
| **版本** | |
| **状态** | |
| **能力** | |
| **改动** | |
| **遗漏** | |
```
