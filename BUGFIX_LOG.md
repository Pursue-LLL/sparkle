# Sparkle Bugfix Log

## 2026-09-15 复盘 · 为什么"同一个问题反复修不好"，这次到底改了什么

### 一、客观量级（追溯到本文档）
- 累计 BUG 条目 **134** 条；其中涉及"集体死亡 / byte-death / UDP absent 误报 / 自愈死循环"等**同类症状 65 条**。
- 仅 2026-08-31 → 09-15 就形成"接力式修复"：BUG-006 → 007/008 → 009 → 010 → 011 → 012 → 013（约 1–2 天一个 recovery 补丁），**每次都说修完，问题换个面貌再来**。

### 二、根因（为何反复修不好——不是运气，是结构）
| # | 结构性缺陷 | 本次证据 |
|---|---|---|
| 1 | **尺子失效**：`DistFreshness` 用 `git diff` 算树指纹，3MB 输出撑爆 1MB `maxBuffer` → 抛错被吞成空串 → 指纹恒为 `sha256("")` → **永远判 fresh → 永远装旧包** | 修复前 `collectCurrentBuildMeta` 指纹 = `…:e3b0c442…`（空串哈希）；修复后为真实值 |
| 2 | **执行器过强**：恢复动作选"整核 `stop+start`" → 一次断**所有 App**；劣化期每 ~5 分钟一次（当天核心启动 50 次） | `manager.ts restartCoreEmergency` → `stopCoreUnchecked(true)+startCore()`；日志 `Service core event: stopping` |
| 3 | **证据不可信**：可选数值 + `?? 0` 把"未知"当"健康"；持久化 truth 与内存真值漂移 | `outbound_hy2_session_age_ms=66622628` vs 文件 `max_byte_stall_ms:0` |
| 4 | **无单一仲裁**：93 个恢复模块、多条路径争抢升级 | 7 处 `restartCore(` 调用点 |
| 5 | **报警窗口错位**：报告用字典序选 `app-*.log` → 展示 **6 天前**旧事件 | `app-2026-9-9.log` 排在 `app-2026-9-15.log` 之后 |

### 三、这次的根治手段（每条都有可复现证据）
| 手段 | 证据 |
|---|---|
| 修好"尺子" | 指纹空哈希→真实值；升级日志 `fresh=0 source_tree_drift → full upgrade` |
| 删掉破坏性执行器 | asar `invokeEmergencyCoreRestart=false`；线上 `core_cold_restart_scheduled caller=restartCore` = 0 次 |
| 证据契约 | `LongflowEvidence = measured \| unknown`；对抗单测断言 unknown 不得当健康 0 |
| 探针诚实 | controller 不可达时不再伪造 `leaf_probes=KR:fail,…` |
| 报告窗口 | 按日历日选文件 + 30min 窗口 + 纳入 `[ProxyStackDeadlock]` |
| 选点防抖 | 生成配置实测 `interval: 300` + `tolerance: 2000` + `lazy: true`；failover 触发 2000 / 目标 500 |
| 去产品泄漏 | asar 内仓库文档 = 0 |

### 四、防再翻车铁律（后续 Agent 必读）
1. **尺子先自检**：任何门禁/指标都必须有对抗单测（例：`git diff` 失败 ≠ 干净树，必须判 stale）。
2. **绝不默认零**：未知必须显式 `unknown`，禁止 `?? 0` 进入决策。
3. **破坏性动作**：必须单一入口、默认降级/关闭、可一键回退（本轮已把"整核重启"从代码删除）。
4. **完成的定义**：每条修复必须附"产物/日志可复现证据"，否则不算完成。
5. **文档即基线**：以 `VERSION_LOG.md` 最新条目为 SSOT，代码与文档同步。

---

> **2026-11-02 最新**：**BUG-2026-11-02-001 CODE-DONE @1.30.71 git** · `tagss.pro` 报「Sorry, you have been blocked」：机场节点缺 `udp: true` → 浏览器 HTTP/3(UDP 443) 与 WebRTC STUN 回落 `DIRECT`，与 TCP 的台湾节点形成双出口 IP 分裂 → 新增 `quicTrafficRuleInjection.ts` 在规则链最前端注入 UDP 443 / `stun.cloudflare.com` 的 `REJECT`（浏览器按 RFC 9114 回退 HTTP/2 over TCP）· 运行态热修 + 全局 Override 持久化 · 干净浏览器实测拿到 `cf_clearance` · 单测 253/253 · **未装包（asar 仍为旧构建）**
> **2026-10-17 上一版**：**BUG-2026-10-17-001 @1.30.71** · `自动选择` 选中「名为日本/韩国/美国、实被 Google 送中（`vXmutd="ZZ"` / `google.cn`）」节点导致 `gemini.google.com` 报「目前不支持你所在的地区」：mihomo 探测仅看 `HTTP 200` 状态码无法识别应用层地区锁 → 新增 `sparkleGeminiProbeCore.ts` + `sparkleGeminiProbe.ts` 流式校验 `vXmutd` 国家码 + `autoSelectStickyPin` 固定前拦截 + `sparkle-fast` 自动剔除送中节点并热重载（网络抖动 fail-open 绝不误杀）· 单测 250/250 · ESLint 0 warning
> **2026-10-16 上一版**：**BUG-2026-10-16-001 INSTALLED @1.30.71** · macOS Mail 收 Gmail SSL `-9806`：Gmail IMAP/SMTP 走通用 `自动选择` 节点，部分机场封 993/465 → 新增 `📧 邮件专用` + `sparkle-mail` provider（Sparkle 主进程 993/465 TLS 双通探测 + 前置邮件域名规则）；mihomo 不可用 IMAPS 作 url-test 目标 · 单测 + `_ARCH`/`VERSION_LOG` 同步
> **2026-10-15 13:24 上一版**：**BUG-2026-10-14-001 INSTALLED @1.30.71 3b60710**（CDHash `d19fd1a1`）· `自动选择` 粘性固定与单点复测保活（连续 2 次轮询稳定即 `PUT` 固定、丢固定时单点独立 Gemini 复测过滤并发体检假超时、10 分钟防抖冷却、孤儿锁清理）+ `sparkle-fast` 体检统一对齐 `Gemini + lazy:true` 并在订阅刷新时同步热重载 + 主商业 provider 开启 `lazy:true` + 冷启动沿用磁盘快照防残缺样本重排 · 单测 236/236 · ESLint 0 warning
> **2026-09-15 后续7**：**BUG-2026-09-15-007** · AI 工具长流被"选点抖动"打断：url-test 组 60s 无迟滞切换（api2 实测在新/日/美/台间乱跳）→ 加 **`tolerance=200ms` 迟滞 + `interval=300` + `lazy`**；failover 目标改为 **只挑 ≤`proxySwitchMaxTargetDelayMs`(500ms)**；切换触发 `proxyTimeoutThreshold` 5000→**2000**；区域优先级改 **新加坡→台湾→日本→韩国→美国**
> **2026-09-15 后续5**：**BUG-2026-09-15-006** · 产品包泄漏内部文档：`electron-builder.yml` 未排除仓库 md，实包内含 `BUGFIX_LOG/VERSION_LOG/ARCHITECTURE/VPS-INFRA/…`；已加 `!*.md` + `!reports/**` + `!temp-docs/**`
> **2026-09-15 后续4**：**BUG-2026-09-15-005 元凶级修复** · DistFreshness 门禁因 `execFileSync` 默认 1MB `maxBuffer` 被 3MB 的 `git diff HEAD` 撑爆（ENOBUFS 被吞成空串）→ 树指纹恒为 `sha256("")` → **永远判 fresh → 永远 install-only 装旧包**。已提高上限并对"diff 不可用"做 fail-safe（判为 stale）。**这就是"一次次修复达不到预期"的根因。**
> **2026-09-15 后续4**：**BUG-2026-09-15-004** · 彻底删除"紧急整核冷重启"代码（`restartCoreEmergency`/bridge/oscillation/smoke CLI），升级只决策+记录（`emergency_core_restart_removed`），不再停内核
> **2026-09-15 后续2**：**BUG-2026-09-15-003** · 默认关闭"紧急整核冷重启"（`EMERGENCY_CORE_COLD_RESTART_ENABLED=false`）：整核 stop+start 会断所有 App，改为非破坏性恢复 + 显式报告 `emergency_core_restart_disabled`；需时可显式重新开启
> **2026-09-15 后续 上一版**：**BUG-2026-09-15-002** · 冷重启振荡退避：停止"每 5 分钟整核 stop+start"（实测 50 次/天，每次断所有 App），首启照常、振荡期指数退避（15→30min，3.5h 窗口自 50 次降至 ≤10 次）
> **2026-09-15 12:08 上一版**：**BUG-2026-09-15-001 INSTALLED @1.30.66 97e2c214** · 恢复子系统证据链加固：longflow 证据契约（消除 `?? 0` 静默降级整类缺陷）+ 探针诚实性（controller 不可达不再伪造叶子全挂）+ 集体死亡报告按日历日选日志文件与 30min 窗口对齐 · 单测 707 项（700 pass / 0 新增失败）· ESLint 0 新增
> **2026-09-10 14:54 上一版**：**BUG-2026-09-10-001 INSTALLED @1.30.66 ba070123** · 外部 API2 锚点探测超时与一刀切门禁导致假阳性集体死亡误报（recovery_circuit_open / api2_anchor_fail）· 物理生命力双重门禁 + 本地代理双通道重试 + 消除 5s 轮询死循环 · 单测 47/47 · ESLint 0 warning
> **2026-09-03 17:00 上一版**：**BUG-2026-09-03-010 CODE-DONE @1.30.58** · stale session 覆盖 vitality 假阳性 → emergency · circuit 不再对 absent 开熔断 · replay gate 7/7 · asar truth markers
> **2026-09-03 16:45 上一版**：**BUG-2026-09-03-009 BUNDLE_ONLY @1.30.57** · fallback_ladder 已装 asar · **LIVE 未验**（全日志 0 条 fallback_ladder）
> **2026-09-03 16:20 上一版**：**BUG-2026-09-03-007/008 CODE-DONE @1.30.56** · core log tail 集群检测 + 强制 close UDP parent + circuit breaker bypass · 16:10 断连时 circuit open 阻断全部恢复
> **2026-09-03 15:10 上一版**：**BUG-2026-09-03-004 CODE-DONE @git（未装包）** · 误报 UDP-absent → failover Reality 锁死 + 14:41 集体 dial timeout · failover 治理 + vitality failback
> **2026-09-03 13:20 上一版**：**BUG-2026-09-03-003 INSTALLED @1.30.53 c0cba9f** · profile.yaml 0B 空白订阅恢复 + 侧边栏刷新 dnd + 磁盘缓存 reload + 更新时间显示
> **2026-09-03 13:18 上一版**：**BUG-2026-09-03-001/002 INSTALLED @1.30.53 c0cba9f** · Sep2 tier0 SEL + 集体死亡 toast · profile recovery @856749f
> **2026-09-03 12:30 上一版**：**BUG-2026-09-03-002 CODE-DONE @git** · 集体死亡 GUI toast + 「复制 Bug 信息」· emergency/circuit/SEL exhausted 触发
> **2026-09-03 12:00 上一版**：**BUG-2026-09-03-001 CODE-DONE @git** · Sep2 84s marathon stall tier0 SEL + Aug31 blank subscription disk parity hot-reload · replay gate 4/4
> **2026-09-02 14:20 上一版**：**BUG-2026-09-02-002 INSTALLED @1.30.53 199ff203** · Phase 1S data-plane busy + blocked 日志节流 · **待 30min soak**
> **2026-09-02 14:20 上一版**：**BUG-2026-09-02-001 INSTALLED @1.30.53 199ff203** · Marathon Stability Phase 0/0.5 Sparkle-only 观测
> **2026-09-01 18:30 上一版**：**BUG-2026-09-01-001 R2 INSTALLED @1.30.52 cb85a3b** · 198.18 CIDR sanitize 不匹配 `🎯 Direct` → trap 每次 regen 写回
> **2026-09-01 18:30 上一版**：**BUG-2026-09-01-003 INSTALLED @1.30.52 cb85a3b** · failover R-31 拦截 + failoverAttempted 永久锁 → emergency 循环
> **2026-09-01 18:30 上一版**：**BUG-2026-09-01-002 R1 INSTALLED @1.30.52 cb85a3b** · emergency 马拉松自激 → 三环闭合 · **待 30min soak**
> **2026-09-01 17:30 上一版**：**BUG-2026-09-01-001 R1 CODE-DONE @1.30.52 git** · fake-ip Direct 冷启动 + CoreLifecycle SSOT + Tier0-Direct · **半生效 · 见 R2**
> **2026-09-01 17:00 上一版**：**BUG-2026-09-01-002 R0 CODE-DONE @1.30.52 git** · emergency 马拉松自激 restart → failover-first + in-flight + cooldown · **见 R1**
> **2026-09-01 16:30 上一版**：**BUG-2026-09-01-000 CODE-DONE @1.30.52 git** · Recovery Architecture Convergence Phase-1 — coordinator + emergency core recovery + byte-death verifier · live smoke PASS · **回归：马拉松期 emergency 循环**
> **2026-08-31 20:50 上一版**：**BUG-2026-08-31-007 INSTALLED @1.30.52** · Cursor 主走自动选择 · 仅 Cursor-2/3 走 🎯 Cursor 专用 · 移除已卸载的 Cursor-3.1.15.app
> **2026-08-31 19:35 上一版**：**BUG-2026-08-31-006 INSTALLED @1.30.46** · W3 bootstrap 死锁 — core 未启动时 `cursor_conn=-1` 不再永久拦截 profile-update-cli / macOS26 headless
> **2026-08-31 19:30 上一版**：**BUG-2026-08-31-005 CODE-DONE @1.30.47 git** · url-test 自动选择排除 AnyTLS（保留手动切换）· Codex SSE 不再被 01 节点 url-test 误选
> **2026-08-31 19:05 上一版**：**BUG-2026-08-31-004 HOTFIX @1.30.45** · `/(?i)-VPS-HY2$/` 非法 JS 正则导致 Sparkle 闪退 · 重装正确 bundle
> **2026-08-31 18:45 上一版**：**BUG-2026-08-31-003 R1 CODE-DONE @1.30.44 git** · 漏配 Cursor-3.app → api2.cursor.sh 落入 GFW Match · 补 path-scoped 规则
> **2026-08-31 18:25 上一版**：**BUG-2026-08-31-002 R1 CODE-DONE @1.30.43 git** · 三 Cursor 客户端默认走 🎯 Cursor 专用 · 组内可选 自动选择（切啥就走啥）
> **2026-08-31 17:30 上一版**：**BUG-2026-08-31-001 P1 CODE-DONE @1.30.41 git** · Recovery Circuit Breaker — CarrierQuiesce/sidecar 自激坏环熔断 · Codex SSE `decoding response body` 止损
> **2026-08-29 23:31 上一版**：**BUG-2026-08-29-001 R3 INSTALLED @1.30.40** · Layer-0 + CI + deferred + **P3 soak PASS** · Cursor Reconnecting 架构闭合 · **VERSION_LOG 基线 23:31**
> **2026-08-29 23:28 上一版**：**BUG-2026-08-29-001 R3 INSTALLED** · Layer-0 装包 · soak 待验
> **2026-08-29 23:21 上一版**：**BUG-2026-08-29-004 R1 CODE-DONE @1.30.40 git** · 换订阅 service 模式 disk/runtime provider 不一致 → COMPATIBLE placeholder · `serviceCoreProviderParityCore`
> **2026-08-29 23:21 上一版**：**BUG-2026-08-29-005 R1 CODE-DONE @1.30.40 git** · Cursor 专用 manual Reality→HY2 被 `blocked_suboptimal_lateral` 拦截
> **2026-08-29 23:21 上一版**：**BUG-2026-08-29-002 R1 CODE-DONE @1.30.40 git** · 订阅 ♻️ 自动选择 → Sparkle 自动选择 + Sparkle-自动-* · **RUNTIME OK · 待 install 固化**
> **2026-08-29 23:21 上一版**：**BUG-2026-08-29-003 R1 MITIGATED @1.30.40** · macOS 26 Dock 启动无 GUI · `macos26ForceGui: true` + persist 偏好 · **RUNTIME OK**
> **2026-08-29 23:17 更早**：**BUG-2026-08-29-001 R2 INSTALLED @1.30.40** · Cursor Agent Reconnecting · ProfileUpdaterCli/second-instance/reload 旁路 · **Layer-0 PENDING**
> **2026-08-16 上一版**：**BUG-2026-08-16-001 R6 CODE-DONE @1.30.40** · macOS 26 GUI 跳过 PostCoreBootstrap 观测栈（Api2Probe/agentTransportFailureSync/networkPathMonitor）· Electron 43.1.0
> **2026-08-16 上一版**：**BUG-2026-08-16-001 R5 INSTALLED @1.30.39** · Electron **43.1.0** · force-GUI 90s soak 间歇 PASS
> **2026-08-15 上一版**：**BUG-2026-08-15-001 CODE-DONE** · macOS 26 V8 ThreadIsolation SIGTRAP · GUI watchdog LaunchAgent + service decouple + log.fs sync + disableGPU
> **2026-08-07 14:00 上一版**：**BUG-2026-08-07-001 FIXED @1.30.32 prod** · JP-VPS OOM reboot + fail2ban SSH ban + VpsL4Probe SSH backoff · VPS swap 2.3G + fail2ban whitelist
> **2026-08-06 19:10 上一版**：**C-8.12 CODE-DONE @1.30.32**（git）· collateral gate + static mihomo import · **已装 prod** · G2/G3 soak PENDING
> **2026-08-06 18:50 上一版**：**prod 1.30.31 已装** · **BUG-2026-08-06-001 新失败模式** · C-8.11 `closed_count>0` ✅ · **collateral leaf close 掐 SSE** ❌ · G3 attemptRate **0%** · gate **未 PASS**
> **2026-08-06 16:00 上一版**：**prod 1.30.26 已装** · **BUG-2026-08-06-001 recurrence definitive** · 同族 **第 15+ 次** · ghost_udp 假修复路径 @ cursor_conn=158 · gate **未验 PASS**
> **2026-08-05 17:30 上一版**：**prod 1.30.17 已装** · gate **PENDING**（继承 byte-death `max_byte_stall=144500`）· Agent SSOT `agent-sparkle-upgrade.sh` 新增
> **2026-08-05 17:05 上一版**：**FIX CODE-DONE @1.30.17**（git）· SEL R2 bypass `active_inner` · 11/11 单测 PASS
> **2026-08-05 16:30 上一版**：**FIX CODE-DONE @1.30.16**（git）· post-install gate PARTIAL · R2 executed ❌ · bytes 144500 未降
> **2026-08-05 16:20 上一版**：**PARTIAL @1.30.15 已装** · bypass planned ✅ · R2 executed ❌ · bytes 144500 未降
> **2026-08-05 早版**：8/5 夜跑 16×Included · prod 1.30.1 · Plane B 半闭环
> **2026-08-04 上一版**：Marathon HY2-only @1.30.1 · MTIC-v2 @1.30.0

---

### BUG-2026-11-02-002 · magpie 的 agy 请求报 `User location is not supported`：`自动选择` 按延迟把流量钉在新加坡节点，而 gemini.com 探测测不出 cloudcode-pa 地域拒绝 · **CODE-DONE @1.30.71 git（未装包）**

| 字段 | 内容 |
| --- | --- |
| **发生与修复标识** | 发生版本：`1.30.71`（2026-11-02 15:43 / 16:07 / 16:08 / 17:57 CST 多次 400）；代码修复：本次（git，未装包）。 |
| **症状** | magpie 的 `antigravity/gemini-3.8-flash` 返回 `400 {"error":{"message":"Antigravity: User location is not supported for the API use."}}`；`~/.config/magpie/usage.jsonl` 与 Sparkle core 日志同秒对应。 |
| **证据链** | ① 规则：`work/config.yaml:305` `DOMAIN-KEYWORD,cloudcode-pa,自动选择`；② 连接：`core-2026-11-2.log` 17:57:59 `[TCP] ...(magpie) --> daily-cloudcode-pa.googleapis.com:443 match DomainKeyword(cloudcode-pa) using 自动选择[新加坡-优化2-GPT]`；③ 应用层：`usage.jsonl` 17:57:58 `status=400` 两条，同一节点；④ 出口 IP 实测：按同一规则请求 IP 回显得到 `66.90.98.146`（Singapore / FDCservers，ip-api 标记 `proxy:true, hosting:true`）。 |
| **根因（三层叠加）** | ① **选路层**：`自动选择` 是 fallback（`defaultAutoSwitchProxy.ts:205`），成员来自 `sparkle-fast` provider，按地区优先级分段 + 段内延迟升序（`sparkleFastProviderCore.ts:20-30`）；当日池内台湾/日本/韩国只有 `02` 节点且无延迟样本（垫到队尾），新加坡-优化2 以 325ms 成为首选，`autoSelectStickyPin` 再把它钉死。<br>② **探测层**：健康检查 URL 是 `https://gemini.google.com`，而 Gemini 网页对这类出口返回 200（探测缓存 `{eligible:true, countryCode:"SG"}`）；官方地区表（antigravity.google/docs/faq）本身就把 Singapore 列为支持地区 → 「Gemini 网页可达」「国家码合法」两条都不足以证明 Code Assist 可用。<br>③ **协议层**：`daily-cloudcode-pa` 的地域校验发生在认证之后——无凭证请求实测返回 `HTTP 401 CREDENTIALS_MISSING`，不存在可用的无凭证探测端点，因此任何 HTTP 探活都天然测不到这个 400。 |
| **归因实测** | 2026-11-02 当日 antigravity 请求按节点统计：新加坡-优化2-GPT / 新加坡-优化-GPT **6 次全部 400（100%）**；台湾 V1 / I0 **3831 次成功、13 次 400（0.34%）**；`自动选择` 15:40→17:50 换点 9 次。 |
| **2026-11-03 全域实测（推翻"节点级"归因）** | 逐节点切换生产 `自动选择`（走 Sparkle service 签名 API）并各发一条 1-token 真实 agy 请求，**11 个出口全部 400**：🇹🇼 台湾 02、🇯🇵 日本 02、🇰🇷 韩国 02、🇺🇸 美国 02、台湾-优化2-GPT、美国LA-优化2-GPT、新加坡-优化-GPT、🇮🇳 印度 B75（出口 `103.215.216.17` / IN / G-Core Labs）、🇹🇷 土耳其 B88（`5.188.190.19` / TR / G-Core Labs）、加拿大-优化2（`167.114.20.81` / CA / OVH）、英国-优化2（`51.195.241.196` / GB / OVH）。同刻用**官方 `agy` CLI + 原生模型**（`--model gemini-3.8-flash`，不经 magpie）复现同样的 400。跨 2 个账号（jinxiayang2025 / yululiu2018）结果一致。2026-11-02 16:00 之后累计 **42 次请求 0 成功**，此前 10:00–15:30 成功 3925 次。 |
| **结论修正** | **不是 magpie 的问题，也不是单个节点的问题**：出口国家（SG/JP/KR/US/TW/IN/TR/CA/GB）全部属于官方支持地区，却一律返回地域 400 → Google 的判定不基于国家，而是出口 IP 信誉/代理检测（这些出口均为 FDCservers / G-Core / OVH 数据中心 ASN）。仅靠代理组/换节点无法恢复；需要住宅/动态 IP 出口、干净 IP 的线路，或改用 Gemini API Key 通道。 |
| **修复** | ① 新组 `🎯 agy 专用`（`select`，`use: sparkle-agy`，不参与自动漂移）；② 新 provider `sparkle-agy-proxies.yaml` **只写通过真实 agy 请求（HTTP 200）的节点**——`sparkleAgyProbe.ts` 借 magpie 本地网关 `127.0.0.1:3425` 逐节点发 1-token 请求（200=可用 / 400 `location is not supported`=不可用 / 404·405=中止 / 429·超时=不下结论），结果持久化到 `sparkle-agy-nodes.json`；③ `antigravityRuleInjection.ts` 三条规则目标改指 `🎯 agy 专用`（组缺席回退 `自动选择`，旧目标规则原地改写不重复追加）；④ `postCoreBootstrap` 启动巡检 + 30min 轮询（TTL 12h/6h），magpie 未启动时跳过；⑤ 订阅刷新时 `provider.ts` 热重载 `sparkle-agy`。 |
| **验证** | `pnpm run test:node-quality` **267/267 PASS**（新增 `sparkleAgyProviderCore.test.ts`，重写 `antigravityRuleInjection.test.ts`）· `typecheck:node` 0 · 改动文件 eslint 0 · `mihomo -t` 对 `select + use: sparkle-agy` 形态 `test is successful` · 旧指纹函数合并为 `proxyNodeFingerprintCore.ts`（邮件 / Gemini / agy 三处共用）。**未装包，运行态未验证。** |
| **防再翻车铁律** | 1. **"目标站 HTTP 200 可达" ≠ "业务 API 可用"**：Google 对 Gemini 网页与 Code Assist API 使用的是两套地区/风险判定。<br>2. **地域校验在认证之后时，无凭证探测必须判定为"测不出"，不能当作"通过"**（本次 401 已证明）。<br>3. **不要把局部样本的相关性当因果**：用 6 个新加坡样本就推出"新加坡坏、换美国就好"，30 分钟后被美国 LA 的实测推翻；下结论前先做**全出口矩阵**（多国家 + 多 ASN + 官方 CLI 对照）。<br>4. **一个组解决的是"隔离 + 可切换 + 稳定出口"，不能凭空造出可用 IP**；若机场全部出口被判机房代理，只能换线路/上干净 VPS 或改用 API Key 通道。 |
| **合规提示** | Google 官方 FAQ 明确：用第三方软件（Claude Code / OpenCode 等）挂 Antigravity 登录违反 ToS，可能导致账号停用；该风险不因本修复消除。 |

---

### BUG-2026-11-02-001 · `tagss.pro` 报「Sorry, you have been blocked」：节点缺 UDP 支持 → HTTP/3 与 STUN 回落 `DIRECT` → TCP/UDP 双出口 IP 分裂被 Cloudflare 拦截 · **CODE-DONE @1.30.71 git（运行态热修已验证 · 未装包）**

| 字段 | 内容 |
| --- | --- |
| **发生与修复标识** | 发生版本：`1.30.71`（2026-11-02 11:30 CST 用户访问 `tagss.pro` 被 Cloudflare 阻断）；代码修复：`d008713`（2026-11-02 14:26 CST）；运行态生效：14:33 热加载 + 全局 Override 持久化；**未装包**（`/Applications/Sparkle.app/Contents/Resources/app.asar` 内 `grep -c quicTrafficRuleInjection` = 0）。 |
| **症状** | Arc 浏览器访问 `https://tagss.pro` 显示 Cloudflare「Sorry, you have been blocked / 安全验证」。Arc 历史库实测时间线：`11:30:19` 首次进入「安全验证」质询页 → `11:30:23` 标题变为「Attention Required! \| Cloudflare」，**4 秒内质询失败**。同期 `curl https://tagss.pro` 返回 `HTTP/2 403` + `cf-mitigated: challenge`。 |
| **根因（协议层）** | ① 主订阅 `profiles/1a11e783a18-proxies.yaml` 的 Trojan 节点**均无 `udp: true`**，mihomo 判定节点不支持 UDP；② 浏览器对 `tagss.pro` 同时发起 TCP(443) 与 UDP(443, HTTP/3) 及 UDP(3478, WebRTC STUN)，内核日志 `core-2026-11-2.log:35952/35955/35960` 显示 **TCP 走 `🐟 漏网之鱼 → 🚀 节点选择 → 🇨🇳 台湾 V1`，UDP 全部 `doesn't match any rule using DIRECT`**；③ 同一会话出现两套出口 IP（台湾机房 IP + 本地大陆宽带 IP），Cloudflare 判定代理伪造/自动化异常，质询直接失败。旁证：`stun.l.google.com:19302` 同样 6 次 `DIRECT`（WebRTC 泄漏未收敛）。 |
| **放大因素（非确定性）** | `11:30:23.290` 沉浸式翻译插件向 `ai.immersivetranslate.com` 发起请求，与页面跳变同秒；Turnstile 对质询页 DOM 完整性敏感。**该因素未被证伪，仅被消除**：修复后用干净 Chrome 配置（无扩展、非自动化）实测可过盾并拿到 `cf_clearance`，说明网络层已干净，扩展影响需用无痕窗口对照确认。 |
| **本次根治方案** | ① 新增 `src/main/core/quicTrafficRuleInjection.ts`：`AND,((DST-PORT,443),(NETWORK,UDP)),REJECT` + `DOMAIN-SUFFIX,stun.cloudflare.com,REJECT`，幂等、空规则数组安全；② `factory.ts:306` 在所有规则改写函数之后、写盘之前注入（避免被 `removeNonSubscriptionProxyGroups` / `rewriteMissingRuleProxyGroupTargets` 洗掉；`REJECT` 属 `RULE_BUILTIN_TARGETS` 不会被改写）；③ `package.json` 登记 `quicTrafficRuleInjection.test.ts` 进 `test:node-quality`（253/253 PASS）；④ 未装包期间的持久化：磁盘 `work/config.yaml` 写回 + 全局 Override `override/sparkle-quic-guard.js`（脚本异常时 `runOverrideScript` 兜底返回原配置，不会中断生成）。 |
| **物理证据** | ① 运行态命中：`core-2026-11-2.log` 自 `14:49:13` 起共 **666 条** `match AND(((DstPort,443) && (Network,udp))) using REJECT`；② 规则语法：`mihomo -t` → `test is successful`；③ 端到端：15:14:54 干净 Chrome 打开 `tagss.pro`，历史记录标题 `TAG Internet`，Cookies 出现 `.tagss.pro cf_clearance`（Cloudflare 放行凭证，仅质询通过才下发）。 |
| **防再翻车铁律** | 1. **改文件 ≠ 改运行态**：上一轮仅凭 `work/config.yaml` 被覆盖就断言"修复 0% 生效"，实际内核内存仍持有 14:33 加载的规则（`reload` 后配置再生不一定触发内核重载）。判定生效必须看**内核日志命中**，不能只看磁盘文件。<br>2. **代理节点缺 `udp: true` 时，任何 UDP 业务都会静默回落 `DIRECT`**：新增依赖 UDP 的能力前，先确认节点是否支持，否则等于把真实 IP 直连出去。<br>3. **Cloudflare 拦截页是"结果"不是"证据"**：`cf-mitigated: challenge` 只说明质询下发，失败原因需用「TCP/UDP 出口是否一致 + 浏览器是否被扩展篡改 + 出口 IP 信誉」三条分别验证，禁止单因归因。 |
| **未完成项** | 重装固化（停 root 权限 `sparkle-service` 需管理员密码，未擅自执行）；装包后应删除 `override/sparkle-quic-guard.js` 并复跑 UDP 443 探测 + 无痕窗口验证。 |

---

### BUG-2026-10-17-001 · `自动选择` 探测 `https://gemini.google.com` 通过的节点仍报「Gemini 目前不支持你所在的地区」（机场“送中”节点 HTTP 200 漏放） · **INSTALLED @1.30.71（2026-10-17）**

| 字段 | 内容 |
| --- | --- |
| **发生与修复标识** | 发生版本：`1.30.71`（2026-10-17 12:59 CST 触发切换，13:09 用户反馈）；修复版本：`1.30.71`（2026-10-17 13:50 CST 装包固化）。 |
| **症状** | 浏览器访问 `https://gemini.google.com/u/3/?dest=create` 报错「Gemini 目前不支持你所在的地区。敬请期待！」。日志 `app-2026-10-17.log:522-526` 显示 12:59:19 `自动选择` 因台湾节点偶发超时降级并由 `[AutoSelectSticky]` 固定到 `🇸🇬 日本 V0 \| 移动优化、新开机 \| 2x`，该节点在 mihomo 中针对 `https://gemini.google.com` 的探测状态为 `alive: true`（delay `334ms`）。 |
| **根因（双重机制盲区）** | ① **Mihomo 内核 `health-check` / `fallback` 仅校验 HTTP 状态码，不校验应用层内容**：mihomo 访问 `https://gemini.google.com` 时只要收到 `2xx/3xx` 即判 `alive: true`；然而 Google Gemini 即使面对不支持的地区（如香港 `HK`、中国大陆 `CN` 或 IP 归属未知的“送中”节点），服务器依然返回 **`HTTP/2 200 OK`**，地区封锁页面是由前端 `BardChatUi` 根据 HTML `<head>` 内嵌的 `window.WIZ_global_data.vXmutd` 国家码与 `TSDtV` 标志动态渲染的。② **静态名称过滤无法识别机场“IP 送中”节点**：`regionPriority.ts` 的 `isBlockedRegionNodeName` 只按名字过滤「香港/HK」的节点（澳门/MO、中国/CN、俄罗斯/RU 等由 `sparkleGeminiProbeCore.ts` 的 `BLOCKED_GEMINI_COUNTRY_CODES` 实测兜底）；但实测当前订阅 `sparkle-fast` 存活节点中，有 **8 个名为日本/韩国/美国/德国的节点**（`🇸🇬 日本 V0`、`🇯🇵 日本 I0`、`🇯🇵 日本 I2`、`🇯🇵 日本 V3`、`🇰🇷 韩国 I1`、`🇺🇸 德国 B16`、`🇺🇸 美国 G2`、`🇺🇸 美国 V0`）出口 IP（尤其是启用了脏 IPv6 的出口）已被 Google GeoIP 数据库标记为中国大陆/未知受限地区（访问 `www.google.com` 触发 `302 -> google.com.hk?pref=hkredirect`，访问 `gemini.google.com/app` 返回 `HTTP 200` 但内嵌 `vXmutd="%.@.\"ZZ\",..."` 且导航栏指向 `https://www.google.cn/intl/.../about/products`）。 |
| **同类问题历史回顾（修了多少次？为什么反复出现？）** | 围绕「Google / Gemini / Antigravity 地区限制与节点选择」已先后经历 **5 轮迭代**（横跨 `1.30.67` → `1.30.71`）：<br>1. **第 1 次（2026-09-15）**：手改运行时 `work/config.yaml` 分流，未入库，被 5 分钟配置再生冲掉（BUG-2026-10-02-001 记载）；<br>2. **第 2 次（2026-10-02 @1.30.67，BUG-2026-10-02-001）**：新建 `🎯 Antigravity 专用` 组绑 KR-VPS，但订阅刷新把 VPS 拆出商业列表导致 guard 误拦，且 KR-VPS 到期退场后失去固定出口地基；<br>3. **第 3 次（2026-10-03~04 @1.30.69~1.30.71）**：改走 `自动选择` 并用 `isBlockedRegionNodeName` 静态剔除名字含「香港」的节点，同时把探测 URL 设为 `https://gemini.google.com`——**当时误以为“探测 URL 设为 `gemini.google.com` 就能筛掉不支持 Gemini 的节点”，遗漏了 Google 对锁区 IP 依然返回 `HTTP 200` 的事实，也没考虑到机场非香港节点存在大量“IP 送中”**；<br>4. **第 4 次（2026-10-09 @1.30.71，BUG-2026-10-09-001）**：为 `sparkle-fast` 引入按 Gemini 探测延迟升序重排——**副作用：送中节点（如 `🇯🇵 日本 V3` 263ms、`🇸🇬 日本 V0` 334ms）往往因为走直连/隧道距离近，延迟反而比真解锁节点（`🇯🇵 日本 I3` 555ms）更低，被延迟序优先排到了日本段最前面！**<br>5. **第 5 次（2026-10-15 @1.30.71，BUG-2026-10-14-001）**：引入 `autoSelectStickyPin` 粘性固定——当台湾节点偶发超时后，fallback 顺位落到排在日本段最前面的送中节点 `🇸🇬 日本 V0`，粘性固定立即将其死死锁住，导致用户持续报错。<br>**深刻反思（为什么之前没修彻底）**：因为此前把「网络层 HTTP 200 可达」等同于「业务层服务可用」，且把「节点名字写的国家」等同于「Google GeoIP 判定的国家」（就像 BUG-2026-10-16-001 中曾误以为 443 通就代表 993/465 邮件端口通一样）。 |
| **本次根治方案（三层闭环）** | ① **流式真实地区解锁探测（`sparkleGeminiProbeCore.ts` + `sparkleGeminiProbe.ts`）**：复用本地隐藏探测监听器 `127.0.0.1:17899`（`__sparkle_mail_probe__`，通过新增的进程级互斥锁 `withLocalProbeChannelLock` 与邮件探测严格串行防串台），发起带 `Accept-Encoding: gzip` 的流式 `GET https://gemini.google.com/app`，在解压流前 ~50–120KB 匹配 `"vXmutd":"%.@.\"<CC>\""` 及 `www.google.cn` / `/dti=1/m=LQaXg` 标记，一旦命中立即断开连接（耗时 ~1.2s）；凡是 `<CC>` 属于 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或含 `google.cn` 的节点判定为 `eligible: false`，写入 `sparkle-gemini-nodes.json`（锁区缓存 6h，真解锁缓存 12h）。<br>② **源头剔除（`sparkleFastProviderCore.ts` + `factory.ts` + `sparkleFastLatencyOrder.ts`）**：`buildSparkleFastProviderDocument` 接收 `blockedNodeNames`，在生成和延迟重排 `sparkle-fast-proxies.yaml` 时直接剔除已确认送中/锁区的节点（若极端情况下全部被排除则回退保留原池，绝不生成空 provider）。<br>③ **粘性固定实时守卫与后台静默巡检（`autoSelectStickyPin.ts` + `postCoreBootstrap.ts`）**：`autoSelectStickyPin` 在固定前（`pin`）、恢复前（`verify-lost-pin`）与已固定状态（`group.fixed`）调用 `verifyNodeGeminiRegion`，一旦发现送中节点立即拒绝/解除固定并热重载 `sparkle-fast`；`postCoreBootstrap` 启动后台巡检 `bootstrapSparkleGeminiRegionAudit`（及每 30 分钟复查），提前将 `sparkle-fast` 中 `alive: true` 的潜伏送中节点剔除。 |
| **防再翻车铁律（踩坑经验）** | 1. **网络超时绝不当作地区锁区（Fail-Open on Network Blip, Fail-Closed on Confirmed Lock）**：流式探测若因瞬时丢包/超时未读到 `vXmutd` 标记，返回 `definitive: false`，绝不写入锁区黑名单（网络死活只归 mihomo 连通性探测管），避免网络波动把全订阅节点误拉黑。<br>2. **节点名含 `\|` 分隔符陷阱**：机场节点名普遍含 `\|`（如 `🇸🇬 日本 V0 \| 移动优化、新开机 \| 2x`），从指纹 `name\|type\|server\|port` 反解节点名时**严禁使用 `key.split('\|')[0]`**，必须按尾部 3 段（`slice(0, -3).join('\|')`）或直接存完整节点名，否则会导致黑名单匹配失效。<br>3. **单通道隐藏监听器必须加进程互斥锁**：任何复用 `127.0.0.1:17899`（`__sparkle_mail_probe__`）的探测任务必须走 `withLocalProbeChannelLock` 串行切换节点，严禁裸调 `mihomoChangeProxy(MAIL_PROBE_HIDDEN_GROUP_NAME, ...)`。 |
| **验证** | `pnpm run test:node-quality` 53 个套件 / 250 项单测全部 PASS（新增 `sparkleGeminiProbeCore.test.ts` 6 项 + `sparkleFastProviderCore.test.ts` 1 项）；`tsc` node/web 0 error；`eslint` 0 warning。真机 `:7890` 实测：8 个送中节点已从 `sparkle-fast-proxies.yaml` 剔除（39 → 31），`自动选择` 固定在 `🇯🇵 日本 I3 \| AI、Netflix(JP)、SVIP \| 3x`，请求 `https://gemini.google.com/u/3/?dest=create` 返回 `vXmutd="%.@.\"JP\",..."`、`ogb=https://www.google.co.jp/...`、`xqG9Nd=true`、`LQaXg=false`。 |
| **关联** | `src/main/core/sparkleGeminiProbeCore.ts` · `src/main/core/sparkleGeminiProbeCore.test.ts` · `src/main/core/sparkleGeminiProbe.ts` · `src/main/core/sparkleFastProviderCore.ts` · `src/main/core/sparkleFastLatencyOrder.ts` · `src/main/core/autoSelectStickyPin.ts` · `src/main/core/sparkleMailProbe.ts` · `src/main/core/factory.ts` · `src/main/core/postCoreBootstrap.ts` |

---

### BUG-2026-10-16-001 · macOS 邮件（Mail.app）收 Gmail 报 SSL `-9806`：机场节点封禁 993/465 邮件端口 + mihomo 无法用 IMAPS 做 url-test · **INSTALLED @1.30.71（2026-10-16）**

| 字段 | 内容 |
| --- | --- |
| **发生与修复标识** | 发生版本：`1.30.71`（2026-10-16 用户反馈）；修复版本：`1.30.71`（2026-10-16 15:13 CST 装包）。 |
| **症状** | macOS 自带「邮件」客户端收取 Gmail 报「发生 SSL 错误，无法建立与该服务器的安全连接（错误 `-9806`）」，而 163 邮箱正常。 |
| **根因** | ① `imap.gmail.com:993` / `smtp.gmail.com:465` 原先落入通用 Google 规则走 `自动选择`，而机场商业节点（尤其是 Trojan 节点）普遍封禁 993/465/587 防垃圾邮件滥用，在 TLS ClientHello 阶段直接 RST/EOF 掐断连接，触发 SecureTransport `-9806`；② 若将 mihomo `url-test` 的探测 `url` 设为 `https://imap.gmail.com:993`，mihomo 底层 HTTP 客户端会把 IMAPS 返回的 `* OK Gimap ready` 当作非法 HTTP 响应（`malformed HTTP response`），导致**所有节点 100% 被误判为死亡超时**。 |
| **修复** | ① 新增 `📧 邮件专用` 组（`type: url-test`，`use: ['sparkle-mail']`，日常保活 `url: https://mail.google.com`）；② 新增隐藏组 `__sparkle_mail_probe__` 与本地 mixed 监听器 `127.0.0.1:17899`（`sparkleMailProviderCore.ts`）；③ 新增 `sparkleMailProbe.ts`：在 Sparkle 主进程内通过 `127.0.0.1:17899` 对各节点实测 `imap.gmail.com:993`（校验 `* OK` Banner）与 `smtp.gmail.com:465`（校验 `220` Banner）双端口 TLS 握手，仅将 100% 双通的节点写入 `sparkle-mail-proxies.yaml` 并持久化到 `sparkle-mail-nodes.json`；④ 新增 `mailTrafficRuleInjection.ts`：前置注入 `imap.gmail.com` / `smtp.gmail.com` / `pop.gmail.com` / `googlemail.com` 及 Outlook/iCloud/Yahoo 收发域名指向 `📧 邮件专用`（不劫持 `gmail.com` 网页或国内邮箱）。 |
| **关联** | `src/main/core/sparkleMailProviderCore.ts` · `src/main/core/sparkleMailProbe.ts` · `src/main/core/mailTrafficRuleInjection.ts` · `src/main/core/customProxyGroups.ts` · `src/main/core/providerConfigCore.ts` |

---

### BUG-2026-10-14-001 · `自动选择` 对存活节点也频繁切换：fallback 无粘性 + 周期重排解除固定 · **INSTALLED（已装包 @1.30.71 · 线上固定已生效）**

| 字段 | 内容 |
| --- | --- |
| **症状** | 2026-10-14 约 15 小时内 `自动选择` 叶子切换 201–207 次（10-08 基线 17 次/天，约 12 倍）；按「被离开节点在其在用期间的拨号失败率」分桶：0% 41 次、<20% 36 次、20–50% 47 次、≥50% 77 次（共 201），即约 38% 的切换离开了基本健康的节点。预期是只有当前节点挂掉才切换。 |
| **根因** | ① `自动选择` 是平铺 `fallback`，每次都取文件序里第一个存活节点：任一在前节点单次探测失败即被放弃，恢复后立刻回切（BUG-2026-10-09-001 已记载，当时只靠重排缓解，未消除）。② 每次周期重排（10-14 当天 18 次采用）都 `DELETE /proxies/自动选择` 解除固定，等于强制 fallback 重选。③ 订阅刷新（`reloadMihomoProfileProviders`）重写了 `sparkle-fast-proxies.yaml` 却未热重载 `sparkle-fast` provider，旧节点/失效配置触发 mihomo 并发强制体检（1863 次），5 秒超时把健康节点误判为死亡；同时 `sparkle-fast` provider 原配置使用非懒加载 `gstatic` 体检，与 `自动选择` 的 `Gemini` 体检形成双倍全量并发探测风暴。④ 若仅固定而不拦截单次探测误判，每次并发体检误杀都会让节点单向不可逆地往后退化（台湾→日本→…→末尾）。⑤ 原地区分段排序仅在同地区段内将无延迟（死/超时）节点置后，高优先级地区全军覆没时死节点仍排在低优先级地区的活节点前面。 |
| **修复** | ① 新增 `autoSelectStickyPinCore.ts`（纯决策）+ `autoSelectStickyPin.ts`（轮询）：每 3 秒 `GET /proxies/自动选择`（本机内存读取，0 网络请求），fallback 选出的 `now` 连续稳定 2 次轮询即 `PUT` 固定（若尚无 `extra[Gemini]` 样本则先单点 Gemini 拨测验活，防止把仅 `gstatic` 通而 Gemini 不通的节点固定住）；**原固定节点被 mihomo 清除固定时（仍在组内），先做一次单点独立 Gemini 复测（并发度 1）：复测存活则立即恢复固定（过滤并发体检单次误报），同一节点 10 分钟冷却窗口内再次丢固定则视为确实不稳、不再救回**；固定节点已不在组内时 `DELETE` 解除；主动解除固定（`mihomoUnfixedProxy`）同步重置记忆。② `sparkleFastLatencyOrder.ts` + `sparkleFastProviderCore.ts`：`hasPreferredUrlSamples` 要求 ≥80% 节点已探测（防冷启动被少量初始样本骗过触发残缺重排与 46s 全量重测），冷启动若已有磁盘快照则直接沿用并仅在原固定节点不在存活表内时解除固定；有实测延迟样本时将所有无样本（超时/死）节点全局垫底。③ `provider.ts` + `providerConfigCore.ts` + `vpsProviderSplitCore.ts`：`reloadMihomoProfileProviders` 同步热重载 `sparkle-fast`；`sparkle-fast` 的 `health-check` 统一对齐为 `AUTO_SELECT_GEMINI_PROBE_URL` + `lazy: true`（mihomo 内部按 URL 自动去重），主订阅商业 provider 同样开启 `lazy: true`。 |
| **实测依据（mihomo v1.19.32 隔离实例，非线上）** | ① 固定节点存活时一直保持；挂掉时 `fixed` 自动清空，首次求值返回「固定节点的下一个成员」，随后回到首个存活成员（稠密采样观察到 0.5–1.5 秒的过渡节点）。② **单点复测保活**：节点 A 因单次探测失败变成 `alive: false` 且 `fixed` 被清为 `''` 后，调用 `/providers/proxies/P/A/healthcheck` 单点复测成功（110ms），mihomo 立即将 `extra[url].alive` 恢复为 `true`，`PUT /proxies/G` 立即恢复固定 `('A','A')`。③ 固定会写入 cache.db，内核重启后恢复。④ **孤儿固定**：固定节点被 provider 重载移除后，`fixed` 不清除，`now` 恒为首个成员，首个成员已死、其余存活时仍不切换，`DELETE` 后恢复——故必须解除。⑤ 同一脚本事件序列（依次杀/起 A、B、A、C）：纯 fallback 4 次切换（A→B、B→A、A→B、B→A）；固定后高优先级恢复不再回切，仅当前节点确认真死时切换。⑥ 否决方案：`fallback` 套地区 `url-test`——杀掉地区内当前节点时外层 fallback 会短暂跳到下一个地区约 5 秒再回来，不是真粘性。 |
| **验证** | `autoSelectStickyPinCore.test.ts` 8 条 + `sparkleFastLatencyOrderCore.test.ts` 7 条 + `sparkleFastProviderCore.test.ts` + `provider.split.test.ts` + `test:node-quality` 236 条全量通过；`tsc` node/web 通过；eslint 无告警。2026-10-15 11:04 装包（CDHash `590cd0e8`）输出 `[AutoSelectSticky]: pinned 🇨🇳 台湾 I0 | AI、动态IP | 2x` 且随后 80 分钟 0 切换；13:24 二次装包（CDHash `d19fd1a18c4013367c42052db0719eae82dbb710`），`app-2026-10-15.log:617,643` 实测 `BuildDrift: app_commit=3b60710 app_dirty=0 drift=none` 且冷启动输出 `[SparkleFastOrder]: bootstrap using disk snapshot samples=43`。 |
| **不能保证的** | 当前节点挂掉时首次求值可能把 1 个连接送到「固定节点的下一个成员」（可能是另一地区），随后回首个存活成员；高优先级地区恢复后不再自动回切（需重启或在 UI 解除固定）；3 秒轮询的窗口内若原节点瞬断又恢复仍可能切换一次；线上 lazy=true / interval=300 的真实时序未测。 |
| **验收指标** | 日志 `[AutoSelectSticky]: pinned X (left Y)` 与 `restored X after single probe blip` 的每日次数；core 日志 `using 🐟 漏网之鱼[<node>]` 的叶子切换次数与失败率分桶（基线 201 次/15 小时，38% 离开 <20% 失败率节点）。 |
| **关联** | `src/main/core/autoSelectStickyPinCore.ts` · `src/main/core/autoSelectStickyPin.ts` · `src/main/core/sparkleFastLatencyOrder.ts` · `src/main/core/sparkleFastLatencyOrderCore.ts` · `src/main/core/sparkleFastProviderCore.ts` · `src/main/core/providerConfigCore.ts` · `src/main/core/provider.ts` · `src/main/core/mihomoApi.ts`（`mihomoGroupDetail` / `mihomoUnfixedProxy`）· `src/main/core/postCoreBootstrap.ts` |

---

### BUG-2026-10-09-002 · 装包后门禁在 Agent 沙箱 / macOS 26 强制 GUI 下恒误报 FAIL · **FIXED（门禁逻辑已验证 · 全脚本端到端未重跑）**

| 字段 | 内容 |
| --- | --- |
| **症状** | `upgrade-sparkle-local.sh` 末尾报 `FAIL: macOS 26 headless bootstrap not logged — check `（后面的日志路径为空），`EXIT=1`；安装本身成功（版本、进程、`:7890` 均正常）。 |
| **根因** | ① Agent shell 的 `$HOME` 是 `/Users/yululiu/.cursor-latest`，Sparkle 实际在 `/Users/yululiu` 下写日志/配置/护栏状态；脚本与 `.mts` 用 `$HOME` / `os.homedir()` 拼路径，找不到日志目录（`APP_LOG` 为空）。同一错位还使 `install-sparkle-local.sh` 的 cursor 路径前缀「保留/恢复」读错配置而空转，`marathon-core-restart-guard.sh:6` 读错 `~/.sparkle/marathon-core-restart-guard.json`（该脚本注明状态文件缺失时退回 mihomo `/connections` 兜底）。② 用户配置 `macos26ForceGui: true`（`config.yaml:94`）→ app 走 GUI，不会产生 `[MacOs26Headless]: bootstrap complete`；门禁在 macOS ≥ 26 一律走 headless 分支。③ GUI 路径下 macOS 26 有意跳过 observability stack（`postCoreBootstrap.ts:214-218` 记 `macOS 26 GUI — observability stack skipped`），不会出现 `Api2ProbePlane ... ON`，原门禁等该行必超时。 |
| **修复** | ① 新增 `scripts/lib/login-home.sh`（`sparkle_pin_login_home`：按 passwd 记录把 `HOME` 固定为登录用户真实主目录，目录不存在则不动）；`upgrade-sparkle-local.sh` 在构建完成后调用（构建仍用原 `HOME`，避免工具链找不到），`install-sparkle-local.sh` 开头调用。子进程（`.mts`、`preflight-sparkle-1280.sh`）继承。② headless 分支仅在 macOS ≥ 26 **且** `macos26ForceGui` ≠ true 时启用，否则走 GUI 就绪门禁。③ 新增 `hasApi2ProbePlaneSettledSinceLine`（`Api2ProbePlane ON` 或上述「有意跳过」均算就绪），取代 `hasApi2ProbePlaneOnSinceLine`，用于 `upgrade-sparkle-local.sh` 与 `upgrade-sparkle-post-install-recovery.mts`。 |
| **验证** | `bash -n` 三个脚本通过；`upgradeSparklePostInstallGateCore.test.ts` 6/6（新增「GUI 跳过算就绪」用例）；eslint 无告警；用 2026-10-09 15:22 装包后的真实 app 日志按新逻辑评估：走 GUI 分支，`failed=0 apiReady=true probeSettled=true`；`HOME` 固定实测 `.cursor-latest` → `/Users/yululiu`，传入不存在的 `HOME` 也被纠正。 |
| **未验证** | 全脚本端到端未重跑。GUI 分支后续的 close smoke、45 秒 BUG-014 观察、`preflight-sparkle-1280.sh`（`:9-11` 用 `$HOME` 拼路径，作为子进程会继承固定后的 `HOME`，应同时消除 BUG-2026-10-02-001「验证」栏记载的沙箱 `HOME` 假性 FAIL）均未实跑。 |
| **关联** | `scripts/lib/login-home.sh` · `scripts/upgrade-sparkle-local.sh` · `scripts/install-sparkle-local.sh` · `scripts/upgradeSparklePostInstallGateCore.ts` · `scripts/upgrade-sparkle-post-install-recovery.mts` · 提交 `a380be8` |

---

### BUG-2026-10-09-001 · `自动选择` 频繁切节点：fallback 无迟滞 + 不稳节点排在最前 · **INSTALLED（2026-10-09 15:22 · 其中的「不固定 + 周期重排解除固定」已由上方 BUG-2026-10-14-001 升级为粘性固定与单点复测保活）**

| 字段 | 内容 |
| --- | --- |
| **症状** | `自动选择` 叶子节点切换：2026-10-08 全天 17 次，2026-10-09 25 分钟内 13 次；agy 偶发 Google 地域 400。 |
| **根因** | 切换发生在 mihomo 内核：`fallback` 取第一个存活成员，单次探测失败即降级、恢复后立刻回切（无迟滞）；旧 `sparkle-fast` 扁平文件把所有节点按地区排序，hy2（出口 IP 随端口跳跃漂移）与同地区 trojan 混排，网络劣化窗口里探测失败被放大成频繁来回切。Sparkle 应用层无自动切换（app 日志无对应记录）。 |
| **A/B 实测（同时段并行探测）** | 劣化窗口：旧方案成功率 75% / 12 次切换；hy2 优先 53% / 18 次；粘性 url-test 80% / 6 次。中等窗口：91% vs 93%，切换 4 vs 3。平稳窗口：各方案均 100%。结论依赖网络时段，且存在本地/运营商出口共模劣化，软件侧无法消除。 |
| **修复** | `自动选择` 保持原生 `fallback`，成员为平铺的 `sparkle-fast` 文件（按 `proxySwitchPriority`，默认台湾→日本→韩国→新加坡→美国；地区内按 Gemini 探测延迟升序，内核就绪后重排一次，之后每 30 分钟复查且新首选须快 ≥50ms 且 ≥30% 才换；剔除 AnyTLS 与香港，hy2 在正常位置）；`Sparkle-<地区>` 五个组改为仅手动选择的 url-test（`tolerance 2000`、Gemini 探测、`exclude-type: anytls`），不再被 `自动选择` 引用；没有可用节点的地区不建组；预热改用组自身探测目标；默认地区优先级台湾第一。 |
| **运行时重排（`sparkleFastLatencyOrder.ts`）** | 内核就绪后 `bootstrapSparkleFastLatencyOrder`（强制采用延迟序）：延迟取 provider 的 Gemini 探测历史（最近 5 次成功样本中位数），缺失时用 api2-probe-ledger 补；没有任何样本则先对 `sparkle-fast` 做 provider healthcheck（超时 120 秒，62 节点实测约 32 秒；默认 axios 15 秒会在探测完成前断开）再重排。重排 = 写 `sparkle-fast-proxies.yaml` → `PUT /providers/proxies/sparkle-fast` → `DELETE /proxies/自动选择` 解除固定。**不固定（pin）`自动选择`**：fallback 本就取文件序第一个存活节点，固定会盖过文件序并写入 `store-selected` 的 cache.db。之后每 30 分钟复查（`setInterval` + `unref`），仅当新首选比当前首选快 ≥50ms 且 ≥30% 才换；当前首选无样本则必换。冷启动配置生成时若 ledger 有样本则直接按延迟序写文件（商业节点 ledger 通常无样本，故主要靠上面的启动重排）。**Marathon 避让**：启动重排与 30 分钟复查在写文件之前先判 Marathon（与 `mihomoUpdateProxyProviders` 同一判据 `evaluateMarathonProviderMutationBlock`，另加 quiesce 静默期），命中则记 `[SparkleFastOrder]: deferred stage=… marathon_truth=… quiesce=… cursor_conn=…` 并顺延；启动重排被顺延时，下一轮复查（30 分钟后）改走完整启动流程（强制采用延迟序）。原因：重排会让 fallback 换节点；且 file provider 可能监视文件变更并自行重读（未实测），不能只靠 provider 更新处的拦截，必须先于写盘判断。 |
| **前置缺陷（已修）** | 重排最初从未执行：`postCoreBootstrap` 里 `await import('./mihomoApi')` 被 rolldown 错绑到 `index.js`（`mihomoVersion is not a function`），controller 就绪探测恒失败 → `DATA_PLANE_NOT_READY` → `runPostCoreBootstrap` 永不执行。改为 `mihomoControllerReadyCore.ts`（service 模式用签名请求探 `/version`），探测超时记 `controller probe last_error=`。ESLint 规则禁止 core 模块动态 import `mihomoApi`。 |
| **安装后实测（2026-10-09 15:22 装包）** | app 日志 15:24:40 `mihomo API ready` → `SparkleFastOrder: skipped, no probe samples yet` → healthcheck 约 36 秒完成（无超时报错）→ 15:25:16 `reordered by latency nodes=62 sampled=44 first=🇨🇳 台湾 I0 | AI、动态IP | 2x`。实时 `GET /proxies/自动选择`：`type=Fallback`、`now=台湾 I0`、`fixed=''`。**并发探测影响**：同一节点单独测 vs 全量 provider healthcheck 期间测（各 5 次，仅一轮）：台湾 I0 中位数 77→82ms、日本 I0 429→248ms，未见变差；单独测时也出现 667/722ms 离群值，说明波动来自节点网络而非并发（样本小，非结论）。 |
| **验证** | `tsx --test` 目标用例全过（含 `sparkleFastProviderCore`、`sparkleFastLatencyOrderCore`、`regionalAutoSelectGroupsCore`、`defaultAutoSwitchProxy`、预热）；`tsc` node/web 通过；eslint 无告警。`test:node-quality` 剩余 15 个失败（marathon / VPS / hy2 相关）在 `git archive HEAD` 干净导出上同样 15 个失败，与本次改动无关。 |
| **不能保证的** | 切换不会降到零：每个节点的探测失败仍会让当前选择移动，mihomo 的失败触发即时健康检查仍在；运营商级劣化无法靠软件修复；Google 对出口 IP 的地域判定无法离线验证；fallback 在高优先级节点恢复后会立即切回（无迟滞），这是旧版频繁切换的来源之一，本方案未消除；AnyTLS 不进入 `自动选择`（仍可手动选）；单节点延迟本身波动大（实测同一节点 70–700ms），「最低」只是近期中位数最低，不保证瞬时最低；更新 provider 会清空节点历史样本，重排后需等下一轮探测才有新数据；`nodeMatchesRegion` 以名称头部判地区，`🇯🇵 泰国 B1IEPL | 日本隧道` 会被归入日本（未修）。 |
| **验收指标** | `自动选择` 叶子节点日均翻转次数（基线 17 次/天）；`proxy_logs.db` 中 agy 地域 400 次数；日本节点出口占比。 |
| **关联** | `src/main/core/regionalAutoSelectGroupsCore.ts` · `src/main/core/defaultAutoSwitchProxy.ts` · `src/main/core/regionPriority.ts` · `src/main/core/regionalUrlTestWarmupCore.ts` · `src/main/core/sparkleFastProviderCore.ts` · `src/main/core/sparkleFastLatencyOrder.ts` · `src/main/core/sparkleFastLatencyOrderCore.ts` · `src/main/core/mihomoControllerReadyCore.ts` · `src/main/core/postCoreBootstrap.ts` |

---

### BUG-2026-10-08-001 · Cursor-3「Reconnecting」反复出现：mihomo v1.19.30 内置 sing-tun v0.4.22 的 system 栈 NAT 端口分配缺陷 · **INSTALLED（核心 v1.19.32）/ 验收未完成**

| 字段 | 内容 |
| --- | --- |
| **症状** | Cursor-3（自定义 HTTP2 传输 + `http.proxySupport: off`，只能经 TUN 出网）会话持续显示「重连 Reconnecting...」；换节点无效；点「刷新核心」后短暂恢复但会复发。Sparkle 的连接数/字节/握手类指标全部正常。 |
| **根因（代码机制已证实 · 内存级证据未取得）** | 安装的核心为官方原版 mihomo v1.19.30（`go version -m` 显示 sing-tun v0.4.22）。TUN 为 `stack: system`（darwin 下由 `cursorNetworkOptimize.ts:98` 强制）。system 栈 TCP 路径由 `TCPNat` 把客户端流映射到 `198.18.0.2:natPort`，`natPort` 是 10000–65535 上回绕的 `uint16` 计数器。v0.4.22 `Lookup()` 不检查端口占用 → 回绕后覆盖 `portMap[X]`，旧 key 仍留在 `addrMap`；`checkTimeout()` 只遍历 `portMap`，孤儿 key 永不回收。之后同一 key 的新 SYN 复用 X，`LookupBack(X)` 返回 nil → `processIPv4TCP` 报 "session not found" 静默丢弃 SYN-ACK：客户端停在 SYN_SENT，内核停在 SYN_RCVD。NAT 超时等于 `udp-timeout`（Sparkle 设为 3600s），死表项滞留 1–2 小时；Cursor 重试风暴加速计数器回绕。`core-2026-10-6.log`：6.7 小时内 57,120 条 TUN 流，计数器已回绕。上游修复：sing-tun `5c6a065`（#21，`allocatePortLocked`），含于 sing-tun v0.4.24、mihomo v1.19.31（pin v0.4.24）与 v1.19.32（pin v0.4.27，2026-09-30 发布）。**未取得**：root 权限下的内存级孤儿表项计数；该项由下面的「同端口恢复」实测作证伪判据。 |
| **为何此前反复修不好** | ① 修错层：历史修复都在应用层（探针/看门狗/门控），故障在数据面核心，应用层改不了；② 无黑盒探针：现有检测看连接数/字节/握手，无按 (源端口, 目标) 主动验证新建连接的探针，核心半瘫时指标全正常；③ 自愈被自己拦：`marathonCoreRestartGuardCore.ts` 在 `cursorConnectionCount>0` 时一律 `blocked:true`，先于 `forceOverride` 判断，`restartCore`（`manager.ts` 约 1227 行）静默 defer，故障态下恰好重启不了（app 日志 `app-2026-10-8.log` 561-562 行有拦截记录）；④ 升级流水线无单实例锁（见下）。 |
| **修复** | 仅升级核心二进制，Sparkle 业务/功能代码零改动：`extra/sidecar/mihomo` 由 v1.19.30 换为官方 v1.19.32（`extra/` 被 git 忽略，不入库）。升级脚本在该文件存在时设 `SKIP_PREPARE=1` 跳过下载；文件缺失时 `scripts/prepare.ts:66` 取 GitHub `releases/latest`（当前 ≥ v1.19.32，不会再拿到旧版）。`extra/sidecar/mihomo-alpha`（alpha-68ec4fa，同为 sing-tun v0.4.22）未替换：当前 `core: mihomo`，该文件未被使用；**若将来切到 alpha 核心，必须先确认其 sing-tun ≥ v0.4.24**。 |
| **验证（实测）** | 打包产物 `dist/mac-arm64/Sparkle.app/Contents/Resources/sidecar/mihomo -v` = `v1.19.32`，`codesign --verify --deep --strict` 通过，Stage-A/Stage-B 打包门控 OK；用真实运行配置 `mihomo -t`：新旧核心均 `test is successful`（需 `SAFE_PATHS` 与 `profiles` 软链，否则两者同样因 provider 路径报错，与版本无关）。已安装：`/Applications/Sparkle.app/.../sidecar/mihomo` 与 dist 内 sidecar sha256 一致（前 16 位 `d2e9975ee64060ef`），root 核心 PID 59319 于 14:33:27 起运行 v1.19.32。**同端口新建连接实测**（Cursor-3 自带 Node 运行时，`localPort` 58100–58139 → 52.21.130.202:443）：第 1 轮 **40/40 成功**（第 2 轮因 TIME_WAIT 全部 EADDRINUSE，无效，不计入）。 |
| **验收采样（2026-10-08 14:55–15:25，核心 PID 59319 运行 22–52 分钟，只读）** | api2 三个 IP（52.21.130.202 / 34.225.159.174 / 3.92.129.183）每 15 秒各新建一条 TCP:443 连接，随机源端口，3 秒超时：**360/360 成功（每 IP 120/120）**，持续 29.8 分钟，零超时（原始数据 `/tmp/accept_samples.jsonl`，探针 `/tmp/accept_sampler.js`）。Cursor-3 日志（`Cursor-3-data/logs/20261008T143828`，14:38 起约 47 分钟）「Retry exhausted」共 6 条，约 0.13 次/分钟，<5 次/分钟；此前会话日志单文件即 2200+ 条（如 `20261008T064224/.../Cursor Structured Logs.3.log` 2262 条）。**探针局限**：连接耗时仅 1–27ms，因为 system 栈由本机内核监听器接受 SYN，探针测的是 TUN 数据面 NAT 路径（正是本缺陷所在层），**不代表上游可达性**。 |
| **安装后门控 FAIL 归因** | `AGENT_UPGRADE_RESULT: version=1.30.71 byte_death_gate=FAIL marathon_data_plane_soak=FAIL preflight=true`（`/tmp/sparkle-upgrade-20261008-143015.log`）。① `BYTE_DEATH_RECOVERY_GATE`：15 分钟窗口内列出的所有事件时间戳 ≤ 06:30:45Z（14:30:45 本地），早于新核心启动（14:33:27 本地 = 06:33:27Z）；`max_byte_stall_ms=4754221`、`sidecar_dial failures 136` 均为旧核心时段数据，窗口未对齐核心重启点。② `verify-marathon-data-plane-soak-gate`：`FAIL: no defer events in soak window — run ProfileUpdaterCli while Cursor active`，判据是「窗口内必须出现 defer 事件」，与核心健康无关。两项 FAIL 均不能证明新核心有问题，但这两个门控本身在「换核心」场景下会误报，**属门控设计缺陷，尚未修改**。 |
| **未完成（如实记录）** | ① 采样仅 30 分钟、单一客户端、三个目标；原缺陷约 6.7 小时才回绕一轮计数器（57,120 流 / 55,536 端口），**30 分钟无法覆盖一轮回绕**，需核心持续运行 ≥12 小时再复测同一采样，才能对「回绕后不再卡死」下结论；② 稳固化方案未实施；③ 40/40 与 360/360 都不能单独证明根因已消除。 |
| **流程缺陷（本次暴露）** | 2026-10-08 14:03–14:33 至少 4 条升级流水线并发运行（日志 `/tmp/sparkle-upgrade-20261008-{140326,142035,142217,143015}.log`）。其中 14:03 一条被另一条的 `electron-vite build` 重写 `out/` 后首次 `electron-builder` 报 `ENOENT out/main/agentTransportFailureSync-*.js`，随后进程消失；14:20 一条在安全窗口等待中途消失。**无单实例锁**导致互相踩 `out/`、`dist/mac-arm64` 与 sidecar；本条目的 sidecar 替换也发生在其中一条打包期间。 |
| **待批准的稳固化方案（尚未实施）** | ① 启动断言：mihomo 内置 sing-tun < v0.4.24 拒绝启用 `stack: system` TUN；② 新建连接黑盒探针（按 (端口, 目标) 经 TUN 主动建连，失败即告警）；③ 重启保护改为「证据确凿（探针连续失败）时允许恢复」，不再无条件被 `cursorConnectionCount` 拦截；④ 升级脚本加单实例锁（`agent-sparkle-upgrade.sh` / `upgrade-sparkle-local.sh`）；⑤ 复核 `udp-timeout 3600` 与 system 栈 NAT 超时的耦合。不改业务与功能逻辑。 |
| **回滚** | 旧 App：`dist/rollback/Sparkle-1.30.71.app`（`codesign --verify` 通过）；旧核心：`dist/rollback/mihomo-v1.19.30`。`dist/` 被 git 忽略；回滚按本文「Sparkle 本地安装」整包 `rm -rf` + `ditto`，不得覆盖安装。 |
| **关联** | `src/main/core/cursorNetworkOptimize.ts:98` · `src/main/core/marathonCoreRestartGuardCore.ts` · `src/main/core/manager.ts`（`restartCore`）· `scripts/prepare.ts` · `scripts/agent-sparkle-upgrade.sh` · `scripts/upgrade-sparkle-local.sh` · `scripts/upgradeSafeWindowWaitCli.mts` |

---

### BUG-2026-10-02-001 · agy/Antigravity 地域 400 复发（9-15 手补规则被配置再生成冲掉）· **INSTALLED @1.30.67 / LIVE-VERIFIED · 专用组部分已被取代**

| 字段 | 内容 |
| --- | --- |
| **当前状态** | 下文「🎯 Antigravity 专用」组已于 2026-10-03 删除（`97d328f`），三条前置规则现指向 `自动选择` fallback（`antigravityRuleInjection.ts:38`），`verify:agygeo` 改为断言 `自动选择`。以 `VERSION_LOG.md` 当前基线第 7 条为准；下文保留为当时记录。 |
| **症状** | `agy` CLI 报 400 `User location is not supported for the API use.`（FAILED_PRECONDITION / UPSTREAM_ERROR）。proxy_logs.db（`~/.antigravity_tools/`）20:44 两条 400，上游 `cloudcode-pa.googleapis.com/v1internal`；core 日志同刻 `daily-cloudcode-pa.sandbox.googleapis.com:443 ... using 🔍 Google[🇹🇼 台湾 02]`，10-02 全天 173/183 条 googleapis 连接走台湾 02（hyster2 端口跳跃机场节点，落地 IP 动态漂移）；同刻两个账号同报 400 → 纯出口 IP 地域判定，非账号封禁。 |
| **根因** | Google Code Assist 边缘按**出口 IP 地域**硬限制。`DOMAIN-SUFFIX,googleapis.com` 通用规则把 AI API 流量送进 `🔍 Google` fallback → sparkle-fast 机场节点（台湾优先级第一），机场落地 IP 漂移踩中受限地区出口即整连接 400。**2026-09-15 曾手补两条规则进 mihomo 运行时配置**（`work/config.yaml.bak-agygeo-20260915-185248`），但从未进仓库代码 → BUG-2026-10-01-003 的 5 分钟配置再生把手补规则静默冲掉（旧规则指向的 `🚀 节点选择` 组也已不存在）→ 09-29 起复发。 |
| **修复** | 把手补规则升级为**代码能力**（配置再生后依然存在），仿 HK 注入模式（`hongKongTrafficRuleInjection.ts` + `customProxyGroups.ts`）：① 新组 `🎯 Antigravity 专用` = **fallback**（`use` = VPS provider、`filter (?i)-VPS-(Reality|HY2)$`，Reality 优先确定性、HY2 冷备，url `https://gemini.google.com`、interval 300、timeout 5000、lazy）——VPS 落地为固定地域（KR）非受限区，不受机场节点 IP 漂移影响；② 三条规则**前置注入** rules 数组最前（必然先于通用 googleapis 规则命中）：`DOMAIN-KEYWORD,cloudcode-pa`（一条盖全 3 个实测 host）+ `DOMAIN-SUFFIX,aicode.googleapis.com` + `DOMAIN-SUFFIX,generativelanguage.googleapis.com`，gemini CLI 未来同样受益，host 均为纯 AI-API 端点零附带伤害。 |
| **守卫** | 无 profileId 或无 VPS leaf → 组不建、注入跳过（安全降级到原通用规则）；注入幂等；组名加进 `customProxyGroups.ts` 与 `profileGroupNormalize.ts` 两处 `SPARKLE_INJECTED_GROUP_NAMES` 防 `removeNonSubscriptionProxyGroups` 删除。 |
| **验证** | `tsc` 0；改动文件 eslint 0；目标测试 **51/51**（新增 `antigravityRuleInjection.test.ts` 3 用例 + `customProxyGroups.test.ts` 2 用例；连带修正一处 HEAD 既有陈旧断言 `(?i)-VPS-HY2$` → `(?i)-VPS-(Reality|HY2)$`）；部署门禁 `pnpm run verify:agygeo`。**LIVE 已验（2026-10-03 装包 @1.30.67）**：`verify:agygeo` PASS（组+3 规则行 594-596 前置于通用 googleapis 规则 1433）；core 日志实测 `cloudcode-pa.googleapis.com` 与 `daily-cloudcode-pa.sandbox.googleapis.com` 均 `match DomainKeyword(cloudcode-pa) using 🎯 Antigravity 专用[KR-VPS-Reality]`，HTTP 404 正常响应（Google 边缘接受 KR 出口，无地域 400）；`www.googleapis.com` 照旧走 `🔍 Google`（零附带伤害）；post-upgrade preflight `ALL PASS`。注：装包门禁若在非真实 `$HOME` 沙箱跑会因 `preflight-sparkle-1280.sh:10` 的 `$HOME` 拼路径出现 `mihomo_close_api`/`connection_hygiene_off` 假性 FAIL，用 `HOME=<真实 home>` 重跑即 ALL PASS。 |
| **代码位置** | `src/main/core/antigravityRuleInjection.ts`（新）· `customProxyGroups.ts`（`buildAntigravityGroupConfig`）· `cursorProxyGroup.ts`（组名/测速 URL 常量）· `factory.ts`（注入调用）· `profileGroupNormalize.ts`（防删名单）· `scripts/verify-antigravity-geo-routing.mts`（新门禁） |
| **2026-10-04 用户裁决 @1.30.71** | KR VPS 不续费（"马上到期了，不要用了"）→ 固定物理出口架构失去地基；用户裁决"**别走 Cursor 专用，Cursor 专用是给 Cursor 用的。agy 走自动选择，我再试试**" → 回退 1.30.70 全部特有改动（commit `3289909`）：agy 三规则 target 回 `自动选择` 组、`🎯 Cursor 专用` 归还 Cursor 原 select 语义（删 fallback 顺位/furl 探测/`CURSOR_GROUP_FALLBACK_BASE`）。**技术边界（2026-10-04 机场 6 节点×5 样本矩阵实测，KR VPS 上跑）**：TW/JP/KR/SG/US/MO 全 200，出口 IP 分别 104.28.198.5/211.106/211.29/222.43/195.192/205.193（全 CF AS13335 共享段、节点内固定、hop 只换入站端口）；Google 地域判定为 **IP 段级**（官方 available-regions 表含 TW/KR 但实际判定随会话/时段波动，台湾 02 同日 400 与 200 并存、出口 IP 时段内固定）→ 微观不可预测，宏观可手动规避：**遇 400 时在 Sparkle 把 `自动选择` 手动切其他节点**（矩阵佐证其余节点当前可用）。无认证探测 cloudcode-pa 返回 401 先于地域判定、带认证探测不可行（sparkle 接管 Google OAuth + 探测风暴触发风控）→ 探针无法感知 400。VPS 订阅刷新后 provider 自然清空，`自动选择` 组注入 guard 与 VPS 无关 → 1.30.71 架构对 VPS 退场免疫。 |
| **2026-10-03 裁决** | **用户明确要求删除专用组**（「不要新增组，乱套了」），agy 流量改走**现有 `自动选择` fallback**：删 `buildAntigravityGroupConfig`/`ANTIGRAVITY_*` 常量/两处防删名单项；`antigravityRuleInjection.ts` 三条规则保留、目标组改 `自动选择`（`defaultAutoSwitchProxy.ts:65`）；门禁 `verify:agygeo` 改断言 `自动选择` 组 + 三规则前置。tsc/eslint 0，目标测试 34/34。**同日 A/B 对照归因**：10:02-10:34 KR-VPS-Reality 窗口 agy 20 条连接零报错；10:34 后台湾 02 窗口 21 条连接、11:00 报 400（Error ID 尾 22677）——三次 400 全落台湾 02 窗口。1.30.67 专用组方案另有实锤缺陷：订阅刷新流程把 VPS 节点 split 出主 leaf 列表 → 组构建 guard 拦截 → **组+规则被 10:34 配置再生冲掉**（即 11:00 400 的直接原因）。1.30.68 曾有注入时序 bug（guard 依赖的 `自动选择` 组建于 `auto_switch_groups` 步骤、注入原在 `injectHongKongTrafficRules` 后执行早于组构建 → guard 永假不注入）——1.30.69 修复：注入移至 `integrity_patches` 后（所有组构建完成后）。**LIVE-VERIFIED @1.30.69（12:01）**：`verify:agygeo` PASS（规则 479-481 前置于通用 1425）；core 日志 `cloudcode-pa.googleapis.com` → `match DomainKeyword(cloudcode-pa) using 自动选择`。**技术边界如实记录**：`自动选择` 第一顺位为台湾节点（三次 400 元凶）且 fallback 不感知应用层 400——400 若间歇复发，恢复路径=规则直指 `KR-VPS-Reality` 节点（同日 20 条连接零报错实证）。 |
| **2026-10-04 复发与实测根治** | 1.30.69 方案（走 `自动选择`）**实测证伪**：当天 agy 23 条连接 100% 走 `自动选择[🇹🇼 台湾 02]`，13:41 第 4 次 400（Error ID `59c05ec2-...-21881`）——完全按预告发生（fallback 首顺位=机场节点，且探测感知不到应用层 400）。**用户质疑归因证据 → 直接实测链**：① 用 agy 真实 OAuth token（refresh_token + 从 agy-native 二进制提取的 client_id/secret 刷新获得）对 Code Assist 端点 `v1internal:loadCodeAssist` 做认证实测；② `自动选择` 当时出口（日本 02）200、KR VPS 直连 200；③ **台湾 02 强制锁定出口（KR VPS 上起独立 mihomo 拨 hysteria2）连测 12 次全部 200** → 结论修正：台湾 02 不是坏节点，是** hysteria2 端口跳跃（ports 15001-16000、hop 15s）→ 出口 IP 池漂移 → 好坏 IP 段间歇抽签**（4 次 400 全落坏 IP 窗口）；④ `mihomo -t` 实测规则 target 直指 provider 节点报 `proxy [KR-VPS-Reality] not found` → 规则必须经组。**根治 @1.30.70**：`🎯 Cursor 专用` 组改 **fallback** 型（DIRECT 首位保留公司网/手动直连语义 + KR-VPS-Reality → KR-VPS-HY2 冷备；`appendRegionalAutoGroupsToCursorDedicated` 对 fallback 型组**不追加「自动选择」**——机场出口探测 gemini 主页 200 会偷住顺位但 Google API 对同 IP 仍 400）；agy 三规则 target 改指 `🎯 Cursor 专用`；`cursorProxyGroup.ts` 新增 `GEMINI_REACHABILITY_PROBE_URL`（SSOT）与 `isCursorDedicatedGroupType`（select + fallback 白名单，`resolveCursorStableSelectorGroup`/`isCursorDedicatedFailoverGroup` 放行 fallback——固定出口钉住语义）；`resolveGeneralProxySelectGroup` 刻意**不放行** fallback（「自动选择」fallback 不得被认作 stock Cursor 的手动选择组）。tsc 0 · 改动文件 eslint 0 · 目标测试 **41/41**（新增 fallback 组不挂自动选择 + fallback 类型放行 2 用例）。**LIVE-VERIFIED @1.30.70（14:14 装包）**：`verify:agygeo` PASS（规则 482-484 指向 `🎯 Cursor 专用`、前置于通用 googleapis 规则 1424；组块断言 fallback/use/DIRECT 全过）；core 日志实测 `cloudcode-pa.googleapis.com → match DomainKeyword(cloudcode-pa) using 🎯 Cursor 专用[KR-VPS-Reality]`；带真实 OAuth token 的 `loadCodeAssist` 认证实测 **HTTP 200**（固定 KR 出口被 Google 接受）。KR VPS 上测试残留（独立 mihomo + 临时文件）已清理。 |

---

### BUG-2026-10-01-001 · 删除全局 RecoveryCircuitBreaker（探针抖动压过物理证据 → 自愈被自己锁死）· **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **症状** | app log 实测 04:35:28→05:37:37 UTC 连续熔断 **735 条 blocked**，`consecutive_failures` 3→4→5→6→7→8→9 每轮精确 +600000ms；期间 `StallEscalationLadder` 的 `emergency_sidecar_dial` 全部 `outcome=skipped`，已卡死 86–90s 的 Cursor 连接无法自救。 |
| **根因** | ① `recordRecoveryFailure` 只累加 `consecutiveFailures`、**冷却到期不复位** → 熔断 10 分钟到期后第一次失败立即再次熔断，熔断从未真正恢复；② 更根本的是 09-03 已定性：**"应用层单点探针抖动不得判定通道死亡"**，而熔断器正是在物理 QUIC/UDP 握手有效（`connectPathDelayMs=290`）时因探针超时开闸，即 BUGFIX_LOG 所说的"没病被治出病"。 |
| **修复** | 彻底删除全局熔断器（6 文件 / -554 行）：`recoveryCircuitBreaker.ts` · `recoveryCircuitBreakerCore.ts` · 2 测试 · `bug20260831RecoveryCircuitReplayCore.ts`(+test)；5 处调用方改为直通——`hy2ParentSidecar` 去掉 gate 与 4 个 notify、`mihomoQuicSilentStallRecovery` 的 `parent_udp_refresh` 无条件 rotate、`recoveryByteDeathVerifier` 改由 `RecoveryCoordinator` 单点接收结果、`cursorDedicatedDialFailureClusterRuntime` 去强制清闸、`recoveryCoordinator` 去通知；连带清 `emergencyCoreRecoveryCore` 的 `byte_death_circuit_open` reason + `collectiveDeathBugReportCore` 的 marker/trigger、`verify-marathon-mutation-callers` allowlist、`verify-byte-death-recovery-gate` 的熔断窗口判据（改判"R2 未执行"）、`package.json` 测试清单。保留 `perLeafRecoveryCircuitCore`（per-leaf 隔离，非全局压制）。 |
| **验证** | `tsc -p tsconfig.node/web` 均 0；改动文件 eslint 0；全量测试 **before 10 fail / after 9 fail，diff 仅少一条已删测试，零新增失败**；全仓 grep `recoveryCircuitBreaker` 仅剩 `_ARCH.md` 的删除说明与两处 `doesNotMatch` 回归断言。 |
| **关联** | `recoveryCircuitBreaker*.ts`（已删）· `hy2ParentSidecar.ts` · `mihomoQuicSilentStallRecovery.ts` · `recoveryByteDeathVerifier.ts` · `recoveryCoordinator.ts` · `perLeafRecoveryCircuitCore.ts`（保留） |

---

### BUG-2026-10-01-002 · `自动选择` 的 AnyTLS 剔除靠负向断言，RE2 下从未生效 · **RUNTIME-VERIFIED**

| 字段 | 内容 |
| --- | --- |
| **症状** | `自动选择` 报 `proxies_removed=12` 但运行时 32 个成员里 6 个 AnyTLS 仍在；AnyTLS 节点被 fallback 选中（实测 `now=🇹🇼 台湾 01`，type=anytls），前序候选探测失败后一路退化。 |
| **根因** | `appendExcludeProxyNamesToProviderFilter` 给 `use:` 模式的 provider 改写 filter，拼出 `(?!^(A|B)$)(?:base)` 负向先行断言；mihomo 的 Go regexp 基于 **RE2，不支持 (?!...)**，过滤不成立。`自动选择` 前 5 位全是 AnyTLS → 静默失败 → fallback 退化到慢节点。 |
| **修复** | 剔除下沉到 `sparkleFastProviderCore`：`buildSparkleFastProviderDocument` 在排序前按 `type=anytls` 过滤，不写入 provider 文件（`自动选择` 的成员唯一来源，`defaultAutoSwitchProxy.ts:275` `use=[FAST_NODE_PROVIDER_ID]`）。删除 `appendExcludeProxyNamesToProviderFilter` 与 `resolveRegionFromSparkleAutoGroupName` 及其调用分支（-46 行）。`use:` 模式的区域组与全部 Selector 组不再改写 filter。 |
| **边界** | **仅 `自动选择` 剔除 AnyTLS**；`🔰手动选择`/`🤖AI`/`🔍Google`/`🧱GFW列表`/`Sparkle-*` 区域组按设计保留 AnyTLS 供手动点选。 |
| **验证** | 单测：新增 `sparkleFastProviderCore.test.ts` 4 例 + 关联 27 例全通过；全量 700 tests / 684 pass / 16 fail，与基线 diff 仅少已删测试文件。运行时（reload 后 `PUT /providers/proxies/sparkle-fast`）：`自动选择` 26 成员 AnyTLS **0**、4 个 Selector 各 40 成员 AnyTLS **7 全保留**、订阅 provider `77caf1sub001` 32 节点 AnyTLS 7 未被触碰。真实隧道 `www.google.com` TLS 握手 **261ms**（AnyTLS 时期 351ms）。 |
| **代码位置** | `sparkleFastProviderCore.ts` · `autoSelectAnyTlsExclusionCore.ts` · `defaultAutoSwitchProxy.ts:275` |

---

### BUG-2026-10-01-003 · 修复未进二进制被定时器静默回退（每 5 分钟必复发）· **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **症状** | BUG-002 的修复 19:24 落地，19:30 被覆盖回 32 节点 / 6 个 AnyTLS，间隔 6 分钟。日志 `[AutoSelectAnyTlsExclusion]: proxies_removed=12` —— 该标记只存在于已删除的旧代码。 |
| **根因** | `~/Library/LaunchAgents/com.sparkle.profile-scheduler.plist` `StartInterval=300` → `~/.sparkle/sparkle-profile-scheduler.sh` → **硬编码执行 `/Applications/Sparkle.app/Contents/MacOS/Sparkle`**，完全绕开仓库。旧二进制跑 `generateProfile()` 按旧逻辑写回。**必然复发，非偶然。** 放大因素：buildStamp 只含构建时间戳不含 commit，app 旧于仓库时外部零信号。 |
| **翻车入口全集** | `generateProfile()` 7 个调用点：`config/profile.ts:394`（★每 5 分钟定时订阅刷新）· `core/manager.ts:544`（core 重启）· `core/profileCheckRetry.ts:43`（校验失败重试）· `core/profileCacheRefreshCore.ts:24`（手动刷新）· `config/controledMihomo.ts:62`（controlled 变更）· `utils/ipc.ts:197`（设置保存）· `core/factory.ts:113`（定义）。任一触发即执行当前二进制内的逻辑。 |
| **修复** | 构建漂移检测（R-52）：`write-build-stamp` 写入 `SPARKLE_GIT_COMMIT` / `SPARKLE_GIT_DIRTY`；`factory` 启动写 `[BuildDrift]` 日志；`pnpm run check:drift` 主动查询（退出码 1 = 漂移）。判定 SSOT 在 `buildDriftPureCore`，`scripts` 与 `src` 共用。 |
| **判定语义** | `match` 一致 / `commit_mismatch` app 旧于仓库 / `app_dirty` 构建不可复现 / `app_unknown` 旧构建无 commit 事实 → 后三者均需 `pnpm run upgrade:mac`。**仓库侧 dirty 不算漂移**，commit 仍是权威。 |
| **验证** | `buildDriftPureCore.test.ts` 10 例覆盖四类判定 + 规范化边界；`tsc node/web` 均 0；全量 **710 tests / 694 pass / 16 fail**，与 BUG-002 前基线 diff 为空（零新增失败）。`check:drift` 当前如实报 `drift=unknown`（旧构建无 commit 事实）+ 退出码 1。 |
| **代码位置** | `buildDriftPureCore.ts` · `buildDriftCore.ts` · `scripts/check-build-drift.ts` · `scripts/write-build-stamp.ts` · `factory.ts` · `com.sparkle.profile-scheduler.plist` |

---

### BUG-2026-09-15-007 · 选点抖动打断 AI 长流（Cursor/opencode/Codex/Antigravity 通病）· **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **症状** | AI 工具的 agent 长连接频繁中断；core log 实测 `api2.cursor.sh` 落在 **新加坡/日本/美国/台湾不同节点**（342/110/47/22/13/5 次）→ 出口 IP 不停变。 |
| **根因** | 6 个 url-test 组（`Sparkle-自动-新/日/台/韩/美` + `🇭🇰 香港节点`）`interval: 60` 且 **`tolerance` 缺省为 0** → 只要另一个节点快 1ms 就换；`🤖 OpenAI`(select) 的选中成员是这些自动组，而 openai/anthropic/claude/gemini/**api2.cursor.sh** 全部指向 `🤖 OpenAI` → 所有 AI 工具共享抖动。 |
| **修复** | ① url-test 默认加 **`tolerance`（迟滞，终值 2000ms）** → 仅当另一节点快 >2000ms 才切；② `DEFAULT_URL_TEST_INTERVAL` **60 → 300**；③ 加 **`lazy: true`**（未使用的组不测）；④ failover 目标过滤由 `<=proxyTimeoutThreshold` 改为 **`<= proxySwitchMaxTargetDelayMs`（新增，默认 500）** → 只切到 <500ms 的节点；⑤ 配置：`proxyTimeoutThreshold 5000→2000`、`proxyHealthCheckInterval 60→300`、`proxySwitchPriority＝新加坡→台湾→日本→韩国→美国`；⑥ **`自动选择` 组重构（用户指出遗漏后补）**：由 `fallback`（原来只有 5 个区域组）改为 **`select`（可手动选）**，成员 = 5 个区域组 + `use: [商业 provider, VPS provider]`（**全部节点，含自建 VPS**）；实测生成配置为 `type: select` + `proxies: 5 区域组` + `use: [678a1sub001, 678a1sub001-vps]`；⑦ `proxyHealthMonitor` 受管组由"仅 Cursor 专用"扩为 **Cursor 专用 + 自动选择**，手动选中的节点变坏时同样按 2000/500 规则救回。 |
| **验证** | tsc/eslint 0；`proxyHealthMonitor`/`defaultAutoSwitchProxy` 15/15 测试通过；全量 707 项 0 新增失败。 |
| **关联** | `defaultAutoSwitchProxy.ts` · `proxyHealthMonitor.ts` · `src/shared/types/app.d.ts` · `config.yaml` |

---

### BUG-2026-09-15-005 · DistFreshness 门禁静默失效 → 永远装旧包（"修复不生效"元凶）· **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **症状** | 源码大改后执行升级，日志 `[DistFreshness] fresh=1 reason=ok` → `install only`，安装包内**不含新改动**（实测：asar 内 `emergency_core_restart_removed=false`）。 |
| **根因（实测）** | `sparkleDistFreshnessCore.ts` 用 `execFileSync('git', ['diff','HEAD','--'])` 计算工作树指纹，**未设 `maxBuffer`**（默认 1MB）；本仓 `git diff HEAD --` 输出 **3,119,009 字节** → 抛 `ENOBUFS` → `catch` **吞掉并返回空串** → `sha256('')` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` → 指纹恒为"干净树" → 与 dist 记录一致 → 永远 fresh。 |
| **修复** | ① `maxBuffer` 提升至 `64MB`（`GIT_MAX_BUFFER_BYTES`）；② 新增 `resolveWorkingTreeDiffText`：**diff 取不到时返回 `git_diff_failed@<commit>` 而非空串**（fail-safe：宁可重编，不可装旧包）。 |
| **验证** | 修复后 `collectCurrentBuildMeta` 指纹由 `…:e3b0c442…` 变为真实值 `…:1c7c91ae…`；实测升级日志转为 `fresh=0 reason=source_tree_drift → full upgrade`。对抗单测：diff 失败 ≠ 干净树；多 MB diff ≠ 空哈希。 |
| **关联** | `scripts/sparkleDistFreshnessCore.ts` · `scripts/sparkleDistFreshnessCore.test.ts` |

---

### BUG-2026-09-15-004 · 删除"紧急整核冷重启"代码（彻底消除集体断连源）· **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **改动** | 删除 `emergencyCoreRestartBridge.ts`、`manager.ts restartCoreEmergency` + 注册、`coldRestartOscillation{Core,}.ts`（退避已无对象）、`emergencyRecoverySmokeCli.ts` 及其 `index.ts` 接线与 `verify-emergency-core-recovery-smoke.mts`。`requestEmergencyCoreRecovery` 变为**只决策+记录**：`[EmergencyCoreRecovery]: outcome=blocked reason=emergency_core_restart_removed`，永不 `stopCoreUnchecked`。 |
| **保留** | 死锁门/长流证据/非破坏性恢复（vitality·sidecar·leaf）全部保留——只移除"停内核"这一破坏性动作。 |
| **验证** | 全仓 0 残留引用；tsc/eslint 0；全量 707 项 0 新增失败；`recoveryCircuitBreakerWiring.test` 改为断言"永不停内核"；asar 门禁改为 `missing_emergency_cold_restart_removed`。 |

---

### BUG-2026-09-15-003 · 紧急"整核冷重启"默认关闭（消除集体断连）· **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **背景** | `restartCoreEmergency`（`manager.ts:1252`）执行 `stopCoreUnchecked(true)+startCore()`，即**停掉整个 mihomo → 所有 App 的所有连接一起断**。实测当天核心启动 **50 次**（median 5 分钟），用户主诉"集体挂"。 |
| **为什么保留代码而非硬删** | 它是 mihomo 不暴露 HY2 UDP 父行时**唯一能重建隧道**的手段（BUG-009 的修复）——硬删会使"隧道真死"时 Cursor 无法自愈。 |
| **修复（默认关）** | 新增 `EMERGENCY_CORE_COLD_RESTART_ENABLED = false`（`emergencyCoreRecoveryCore.ts`）。`requestEmergencyCoreRecovery` 在开工前检查：默认禁止时**不探测、不 drain、不弹窗、不停内核**，直接记录 `[EmergencyCoreRecovery]: outcome=blocked reason=emergency_core_restart_disabled` 并返回失败（不伪装成功）。smoke/bypass 与显式开启时仍走原路径。 |
| **效果** | 生产默认**不再因卡顿整核重启**；系统只做非破坏性恢复（vitality/sidecar/leaf）并如实报告。需要时可一行开关复活（隧道真死场景）。 |
| **验证** | 对抗单测：`BUG-2026-09-15-003: disruptive emergency core cold restart stays disabled by default`；全量 708 项 0 新增失败；tsc/eslint 0；asar 门禁新增 `missing_emergency_cold_restart_disable`。 |
| **关联** | `emergencyCoreRecoveryCore.ts` · `emergencyCoreRecovery.ts` · `manager.ts` · `scripts/upgradeSparkleAsarGateCore.ts` |

---

### BUG-2026-09-15-002 · 紧急恢复的整核冷重启振荡 → 集体断连（每 5 分钟一次）· **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **状态** | **CODE-DONE**（构建+安装验证中）· 新增振荡退避门 + 对抗单测 |
| **症状（实测）** | 2026-09-15 当天 mihomo 核心 `Start initial configuration` **50 次**（median 间隔 **5 分钟**）、`emergency_core_recovery_completed` **68 次**；用户主诉"集体断连"，而其他客户端不会。 |
| **根因（代码级）** | `manager.ts:1252 restartCoreEmergency` 执行 `stopCoreUnchecked(true)` + `startCore()` —— **整核停机 = 所有 App 的所有连接全部断开**。出口丢包期间（本机实测出国段 10–16.7% 丢包 / p90 1256ms）Cursor 长流反复冻结 → 每条恢复路径都升级到整核重启 → 每 5 分钟一次集体断。且**无任何冷重启退避/限流**。 |
| **物理背景** | 触发冻结的是运营商国际出口劣化（本地 WiFi 段 0% 丢包）；韩国 VPS 自证健康（31.7ms mdev 0.03）。代码无法修复物理链路。 |
| **修复** | 新增 `coldRestartOscillationCore.ts`（纯函数）+ `coldRestartOscillation.ts`（运行时状态）：**首次冷重启照常允许**；若在 `CLEAR_WINDOW=90min` 内再次需要 → 抖动计数 +1 → 最小间隔指数退避 `15→30min`（`MAX=30min`）；被拦时日志 `[ColdRestartOscillation]: outcome=blocked reason=cold_restart_oscillation_backoff retry_after_ms=…` 并让调用方如实失败（不伪装成功）。接入点：`emergencyCoreRecovery.ts`（进 drain/toast 之前门控，`invokeEmergencyCoreRestart` 之前落账）。smoke/bypass 路径豁免。 |
| **效果** | 模拟 3.5h 劣化窗口（每 5 分钟请求一次）：冷重启自 **50 次 → ≤10 次**（对抗单测断言）。其他 App 不再被反复掐断。 |
| **验证** | 单测全绿（含 ADVERSARIAL：3.5h 窗口 ≤10 次；5 分钟二次冷重启必被拦）；全量 `test:node-quality` 707 项 0 新增失败；tsc/eslint 0；asar 门禁新增 `missing_cold_restart_oscillation_guard`。 |
| **关联** | `coldRestartOscillationCore.ts` · `coldRestartOscillation.ts` · `emergencyCoreRecovery.ts` · `manager.ts` · `scripts/upgradeSparkleAsarGateCore.ts` |

---

### BUG-2026-09-15-001 · 恢复子系统证据链加固（静默零填充 + 探针伪失败 + 报告读错文件）· **INSTALLED @1.30.66 97e2c214**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 INSTALLED @1.30.66** · 2026-09-15 **12:08 CST** · CDHash `97e2c21491129f18589e18c5371b7b1edbed78ea` · stamp `2026.0915.1159` · 单测 707 项（700 pass / 7 项为他人 WIP+环境，无新增）· ESLint 0 新增 · 代理 `:7890` HTTP 200 |
| **背景（物理根因）** | 2026-09-14/15 集体死亡复发的物理根因是**本机国际出口劣化**：本地 WiFi 段 0% 丢包，出国段 10% 丢包 + 253ms 抖动；`traceroute` 中国电信国际骨干 `202.97.34.74=1094ms`；从韩国 VPS 反向测三个"失败"商业节点端口全 OPEN。此层代码无法修复。 |
| **缺陷 1（P0 静默降级）** | `proxyStackDeadlockCore` 的 `maxByteStallMs?/frozenQuicCursorCount?` 为可选，`isCollectiveLongflowDeath` 用 `?? 0`，导致 3/4 生产调用点（`recoveryCoordinator` / `proactiveHy2HardRotate` / `cursorDedicatedDialFailureCluster`）漏传证据时被静默当成"健康 0"，长流升级**永不触发**。 |
| **缺陷 2（P1 死代码）** | `proxyStackDeadlockRuntime` 的 `longflow ?? readLongflowFromTruthSnapshot()` 兜底在生产永不可达（调用方恒传对象），且真相文件被 reset 硬写 0。 |
| **缺陷 3（P1 伪证据）** | `collectProxyStackDeadlockEvidence` 在 `controllerReachable=false` 时把叶子探针直接写死 `false`，产出 `leaf_probes=KR:fail,自动选择:fail,DIRECT:fail` 的"全挂了"假象。 |
| **缺陷 4（P1 报告）** | `collectiveDeathBugReport.readLatestAppLogLines` 用 `files.sort()` 字典序，`app-2026-9-9.log` 排在 `app-2026-9-15.log` **之后**，报告长期读取 6 天前文件 → 弹窗展示 09-09 陈旧日志；无窗口对齐。 |
| **修复** | ① `LongflowEvidence` 判别联合 `{kind:'measured'\|'unknown',reason}`，工厂遇 NaN/负数自动降级 unknown；`evaluateProxyStackDeadlockAdmission(evidence,longflow)` longflow **必填**；unknown 返回 `proxy_stack_longflow_evidence_unknown:<reason>`。② 删除死兜底。③ `selectLeafProbeTargets`：controller 不可达时不探不伪造。④ `orderAppLogNamesNewestFirst` 按日历日排序 + 支持跨零点读上一天尾部；`filterCollectiveDeathLogLines(lines, nowMs)` 30min 窗口剔除陈旧行；`[ProxyStackDeadlock]` 纳入报告标记。⑤ asar 装包硬门 `missing_longflow_evidence_contract`。 |
| **回归防护** | 对抗单测：unknown 不得被当健康 0 / 非有限值降级 unknown / 负数降级 unknown / controller 不可达不得伪造叶子失败；`0904_proxy_stack_deadlock_gate` 回放扩展断言；`upgradeSparkleAsarGateCore.test` 新增契约门缺失用例。 |
| **关联** | `proxyStackDeadlockCore.ts` · `proxyStackDeadlockRuntime.ts` · `emergencyCoreRecovery.ts` · `collectiveDeathBugReportCore.ts` · `collectiveDeathBugReport.ts` · `hy2ParentSidecar.ts` · `recoveryCoordinator.ts` · `proactiveHy2HardRotateRuntime.ts` · `cursorDedicatedDialFailureClusterRuntime.ts` · `scripts/upgradeSparkleAsarGateCore.ts` |
| **遗留（已分析，非本次范围）** | `transport-longevity-truth.json` 与运行时内存快照存在数值漂移（`resetTransportLongevityHy2ParentChainBirth` 写 0）——属**可观测性**问题（reset 后语义本就是"新会话"），非功能缺陷；建议后续按"证据契约"同样方式显式化 unknown，需评估 8 个消费者回退风险。 |

---

### BUG-2026-09-10-001 · 外部 API2 锚点探测超时与一刀切门禁导致假阳性集体死亡误报（recovery_circuit_open / api2_anchor_fail）· **INSTALLED @1.30.66**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 INSTALLED @1.30.66** · 2026-09-10 **14:54 CST** · CDHash `ba070123c6a8a9374ec37bf837113fa8a3170cd8` · 47/47 单测全 PASS · ESLint 0 warning · 代理实测 HTTP 200 |
| **发生版本** | **1.30.65 INSTALLED** · stamp `2026.0904.1515` · 2026-09-10 **06:07:46.445 UTC（14:07:46 CST）** |
| **严重度** | P1（假阳性告警误导 + 熔断自激阻断）— 实际业务流量 100% 毫秒级通畅，但 GUI 弹出吓人的「集体死亡」报警，且自愈逻辑因缺乏冷却而陷入 5 秒高频空转重试 |
| **症状** | 弹出 `Sparkle Collective Death Bug Report`；触发器 `recovery_circuit_open`；证据 `api2_anchor_rejected_api2_anchor_fail`；弹窗错误抓取了 14 小时前（前一天 15:59）的历史旧日志 |
| **物理证据（零猜测）** | 1. **业务流量全程正常**：[core-2026-9-10.log] 14:07:42（告警前4秒），`KR-VPS-HY2` 正常转发大量流量至 `api2direct.cursor.sh:443`、`marketplace.cursorapi.com:443`、`prod.authentication.cursor.sh:443`，无任何丢包断连。<br>2. **物理网络延时有效**：[app-2026-9-10.log:42558] 06:07:46.678Z（弹窗前 23ms），底层 `Hy2TunnelVitality` 物理拨号实测 `connect_path_delay_ms=439`，物理握手通畅。<br>3. **管理接口超时**：`probeRecoveryApi2AnchorDetailed` 调用的 Mihomo Controller HTTP 延迟测试在 5000ms 内未返回（`api2_anchor_ok=0`）。 |
| **根因链** | **L0** 06:07:46 UTC 触发 `CarrierQuiesceRefresh`（>4h UDP 连接例行平滑刷新）。<br>**L1** 刷新后触发外部锚点探测 `probeRecoveryApi2AnchorDetailed`，在系统处于高并发与服务进程高负载下，Mihomo Controller HTTP 单节点测试超时（5000ms 窗口）。<br>**L2** [recoveryApi2AnchorCore.ts:49] 原规则一刀切：只要 `!api2Ok` 就直接判定为 `api2_anchor_fail`，完全无视刚测得有效的物理 `connectPathDelayMs=439` 真实存活证据。<br>**L3** 连续失败累积触发 `RecoveryCircuitBreaker` 熔断开闸，调用弹窗警报，弹窗误抓取包含历史关键字的 14 小时前日志（15:59 core deadlock）。<br>**L4** 自愈逻辑在阻断后未记录冷却时间，导致每 5 秒一次紧凑轮询空转。 |
| **四重防御修复** | 1. **物理生命力证据降级兜底**：`recoveryApi2AnchorCore.ts` 加入 `isVitalityConnectPathTrustworthy(connectPathDelayMs)`（>=50ms），当外部 HTTP 测速超时但物理握手证明活着时，判定为 `api2_anchor_fallback_trustworthy_vitality`，不再误报失败。<br>2. **双通道重试机制**：`recoveryApi2Anchor.ts` 在控制器测速失败时，自动降级至本地 Mixed 端口真实发包链路（`probeRecoveryApi2MixedPortFallback`）复测二次确认。<br>3. **放宽瞬时容错窗口**：`cursorApi2MihomoProbe.ts` 超时阈值由 5000ms 放宽至 8000ms。<br>4. **终结死循环与节点校准**：`hy2ParentSidecar.ts` 补充 `lastHy2ParentSidecarActionAtMs = nowMs`，终结 5s 轮询死循环；fallback 默认节点更正为当前主力 `KR-VPS-HY2`；修复 ESLint restricted-syntax 动态引入。 |
| **反思：为什么历史同类 bug 反复出现？** | 回顾历史脉络：从 08-31（引入 Circuit Breaker）到 09-01（emergency 循环）、09-03（circuit open 阻断正常自愈），本模块已历经多次修补。<br>**翻来覆去修不好的根本原因在于：监控自检层的“判定权重大于物理事实证据”**。<br>以往多次修复只是在出现假死后打局部补丁，没有确立最核心的物理事实最高准则。一旦外部 HTTP 测速接口受系统并发、线程调度或单点抖动影响超时，整个自愈系统就会把“正常通路”当成“坏死”，并激活破坏性的熔断或强制重启，造成“没病被治出病”。<br>**根本解决之道**：确立**“物理网络生命力延时（Physical Vitality）具有不可撼动的最高事实仲裁权”**。只要底层 QUIC/UDP 物理握手延时有效，应用层单点探针无论如何报错，都绝不允许判定为通道死亡！ |
| **踩坑经验与防翻车铁律** | 1. **严禁在自愈门禁中设计“单点一票否决制”**：外部 HTTP 测速极易受单机瞬时高负载影响，必须有多维证据交叉仲裁。<br>2. **严禁将自愈阻断设计为无冷却紧凑轮询**：任何阻断分支必须强制记录冷却时间戳，否则必然造成 CPU 空转与日志风暴。<br>3. **警惕告警日志的时间跨度**：日志排查绝不能只看弹窗提取的片断，必须核查时间戳与业务链路日志对齐。 |
| **验收与测试** | [x] 47 个单元测试 100% PASS（`tsx --test ...` 418ms）<br>[x] ESLint 严格检查 0 errors, 0 warnings<br>[x] 打包全新 dist 并强制覆盖安装至 `/Applications/Sparkle.app`（1.30.66）<br>[x] 进程验证：Sparkle (PID 70690) + mihomo (PID 70943) 正常运行<br>[x] 代理实测：`curl -x http://127.0.0.1:7890 https://api2.cursor.sh/` 返回 HTTP 200 OK |
| **关联代码** | `recoveryApi2AnchorCore.ts` · `recoveryApi2AnchorCore.test.ts` · `recoveryApi2Anchor.ts` · `cursorApi2MihomoProbe.ts` · `hy2ParentSidecar.ts` |

---

---

### BUG-2026-09-03-009 · 1.30.56 dial 集群 recovery 死胡同（no_udp_parent → skipped）· **INSTALLED @1.30.57**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 BUNDLE_ONLY（Truth Label）** · 2026-09-03 **16:38 CST** · asar 含 fallback_ladder · **LIVE 未验**（`app-2026-9-3.log` 中 `fallback_ladder` 条数=0；装包前 skipped×5 为 1.30.56 实锤） |
| **发生版本** | **1.30.56 INSTALLED** · 2026-09-03 **16:19–16:21 CST** 三端 Cursor Network Diagnostic 10/10 FAIL |
| **严重度** | P0 — Cursor-2/3 专用 HY2 全路径 `context deadline exceeded` · TLS 握手失败 · circuit open 阻断 sidecar |
| **症状** | Network Diagnostic：HTTP/2/SSL/API/Ping/Chat/Agent/Marketplace/Auth/Downloads/CDN 全 FAIL · `Client network socket disconnected before secure TLS connection was established` · DNS/Cursor Tab/Agent Endpoint DNS 成功 |
| **物理证据** | app **08:19–08:21** `CursorDialFailureCluster outcome=skipped reason=no_udp_parent_found` ×3 · core **33+** 条 `dial 🎯 Cursor 专用 ... error: context deadline exceeded` · **08:11+** circuit `recovery_circuit_breaker_open last=byte_death_udp_evidence_insufficient` · 直连 api2 **200** · 经 :7890 **FAIL**（core 已停） |
| **根因链** | **L0** JP-VPS-HY2 隧道完全死亡（无 UDP parent 行）· **L1** 1.30.56 集群 recovery 仅 close UDP parent，找不到即 `skipped` · **L2** circuit breaker open 阻断常规 sidecar · **L3** 无 emergency 回退 → 集体断持续至 core stop |
| **修复** | `cursorDedicatedDialFailureClusterRuntime.ts`：`no_udp_parent_found` → **fallback ladder** ① `runHy2ParentSidecarIfDue(dialFailureClusterEscalation=true)` ② `requestEmergencyCoreRecovery(confirmed_udp_parent_absent)` · 新增 `DIAL_FAILURE_CLUSTER_UDP_ABSENT_REQUIRES_CORE_RESTART` |
| **为何 007/008 不够** | 008 假设存在 stale UDP parent 可 close；HY2 全死时 mihomo 无 UDP 行 → close 路径 noop · git 有 fallback 但未打入 1.30.56 asar |
| **验收** | [x] 打开 Sparkle → proxy api2 **200** [ ] 装 1.30.57 后复现 dial 集群须见 `fallback_ladder` 或 `emergency_core_recovery` 非 `skipped` |
| **代码位置** | `cursorDedicatedDialFailureClusterRuntime.ts` · `cursorDedicatedDialFailureClusterCore.ts` · `hy2ParentSidecar.ts` `dialFailureClusterEscalation` |

### BUG-2026-09-03-010 · stale HY2 session + vitality 假阳性 → circuit 熔断 · **CODE-DONE @1.30.58**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 CODE-DONE** · 待 `agent:upgrade:mac` 装包 · replay gate **7/7 PASS** |
| **发生版本** | **1.30.57 BUNDLE_ONLY** · 2026-09-03 **16:32 CST** 装包后 3min |
| **严重度** | P0 — sidecar fail + circuit open 10min · 用户「重启后仍断」实锤 |
| **物理证据** | app **08:32:40** `byte_death_udp_evidence_insufficient` + `outbound_hy2_session_age_ms=175961819` · **08:32:45** `RecoveryCircuitBreaker outcome=open cooldown_ms=600000` · 同秒 `Hy2TunnelVitality outcome=executed delay=1011ms`（测量衰减） |
| **根因链** | **L1** `planByteDeathParentMutation`：UDP absent + 60s 内 vitality 成功 → `evidence_insufficient` · **L2** `hy2ParentSidecar` 对 absent/insufficient 仍 `notifyRecoveryCircuitFailure` · **L3** 48h stale session 未被 age 覆盖 vitality counterproof |
| **修复** | `hy2ParentByteDeathRecoveryCore.ts`：`shouldOverrideVitalityCounterproofForStaleSession`（≥4h）→ `byte_death_udp_absent_requires_core_restart` · `hy2ParentSidecar.ts`：absent → 跳过 circuit + 直接 `requestEmergencyCoreRecovery` · replay + asar markers |
| **Truth Label** | CODE-DONE → BUNDLE（装包后）→ LIVE（须日志见 `emergency_core_recovery executed` 或 `fallback_ladder` 且 api2 恢复） |
| **验收** | [x] replay 7/7 [x] asar gate markers [ ] 装 1.30.58 [ ] live 断网复现 |
| **代码位置** | `hy2ParentByteDeathRecoveryCore.ts` · `hy2ParentSidecar.ts` · `bug20260903ReplayCore.ts` · `upgradeSparkleAsarGateCore.ts` |

### BUG-2026-09-03-001 · Sep2 赛中 84s 断网 + Aug31 空白订阅 · **INSTALLED @1.30.53 c0cba9f**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 INSTALLED** · 2026-09-03 13:18 CST · CDHash `edf841749dbd08b8c7dd84ae5c293a79cffb3077` · stamp `2026.0903.1318` |
| **发生版本** | **1.30.53 @856749f 前** · Sep2 84s stall · Aug31 provider parity |
| **修复版本** | **1.30.53 @c0cba9f** · commits `856749f` + `73035b3` + `c0cba9f` |
| **同族反复** | Aug31 空白订阅类 **第 2 次**（001 修 parity 未覆盖 profile.yaml wipe；见 **BUG-2026-09-03-003**） |
| **症状 1** | 2026-09-02 06:20 upgrade 期间 `MihomoQuicSilentStall` stall_ms=84003 → `marathon_active_zero_data_plane_mutation` → 15s `EmergencyCoreRecovery` 断网 |
| **根因 1** | P10「零 data-plane mutation」把 45–89s parent recovery proof 与 carrier 未达标一并 dead-end 为 `none`；critical host R-41 禁 close 但 SEL 需 vitality 先行；84s 时 vitality 未触发 |
| **修复 1** | `frozenSurgicalPruneCore`：parent recovery proof → `vitality_dial` + `marathon_tier0_*_sel`；`stallEscalationLadderCore`：parent proof @≥60s bypass vitality ineffective → emergency sidecar；`dataPlaneMutationTierCore` SSOT |
| **症状 2** | 2026-08-31 09:06 `defer service core provider reload expected=[] running=[77caf1sub001,...]` — UI 空白订阅，磁盘数据完好 |
| **根因 2** | `resolveServiceCoreLaunchAction` 在 `generateProfile()` 前读 in-memory `runtimeConfig`（空）→ parity 误判；marathon guard block 后无 Tier-0 hot-reload |
| **修复 2** | `resolveExpectedProxyProviderIds` disk fallback + marathon defer 时 `mihomoUpdateProxyProviders` Tier-0 hot-reload |
| **回归** | `bug20260903ReplayCore.ts`（Sep2 frozen_quic 84s · SEL R1 · Aug31 disk parity · parent_stale tier0） |
| **验收** | `node --test src/main/core/bug20260903ReplayCore.test.ts` + related unit tests · **禁止裸 build** · 装包 `pnpm run agent:upgrade:mac` |

### BUG-2026-09-03-002 · 集体死亡 GUI 提示 + 复制 Bug 信息 · **INSTALLED @1.30.53 c0cba9f**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 INSTALLED** · 2026-09-03 13:18 CST · 同包 BUG-2026-09-03-001 |
| **需求** | 集体死亡（emergency / circuit open / SEL exhausted）时 GUI 提示 + 一键复制 AI 可分析诊断 |
| **实现** | `collectiveDeathBugReportCore` 组装 report · `collectiveDeathAlert` forceToast + `actionKind=copy-bug-report` · IPC `getCollectiveDeathBugReport` |
| **触发** | `emergencyCoreRecovery` admitted · `recoveryCircuitBreaker` open · SEL `observe_exhausted` @ marathon |
| **UI** | Toast「复制 Bug 信息」→ clipboard · 用户向文案无技术泄漏 |
| **验收** | `collectiveDeathBugReportCore.test.ts` + 09-03-001 replay · live 触发 emergency 验证 copy |

### BUG-2026-09-03-003 · profile.yaml 被 wipe → 空白订阅 + 刷新无效 + 更新时间误导 · **INSTALLED @1.30.53 c0cba9f**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 INSTALLED** · 2026-09-03 13:18 CST · CDHash `edf841749dbd08b8c7dd84ae5c293a79cffb3077` |
| **发生版本/时间** | **1.30.53 @856749f 前** · 2026-09-03 10:34 CST `profile.yaml` → **0 字节** · 用户报「空白订阅」「刷新没反应」「更新 2 年前」 |
| **修复版本/时间** | **1.30.53** · git `856749f`（recovery）+ `73035b3`（refresh/cache）+ `c0cba9f`（pure re-export）· stamp `2026.0903.1318` |
| **同族反复** | 「空白订阅」类 **第 2 次独立根因**（001 修 Aug31 `expected=[]` parity；本次是 **索引文件 wipe**，非 provider mismatch） |
| **严重度** | P1 — UI 显示空白订阅 · 刷新无反馈 · 误导性更新时间 |
| **症状 1** | 侧边栏显示「空白订阅」；`profiles/77caf1sub001.yaml` 442KB 完好；`work/config.yaml` 无 proxy-providers |
| **根因 1** | `~/Library/Application Support/sparkle/profile.yaml` **0B** → `getProfileConfig()` → `{ items: [] }` → `getCurrentProfileItem()` fallback `空白订阅` |
| **症状 2** | 侧边栏刷新图标点击无反应（订阅页可能正常） |
| **根因 2** | `profile-card.tsx` 刷新按钮在 dnd-kit `{...listeners}` 内，缺 `data-no-dnd` / `stopPropagation`（`profile-item.tsx` 有） |
| **症状 3** | 恢复后显示「更新 2 年前」；用户期望「每日 07:00」 |
| **根因 3** | 磁盘恢复时 `updated` 误写 `1725255434000`（2024-09-02）；UI 仅显示相对时间，未展示 `updateTime` 定时 |
| **症状 4** | 无 URL 时刷新抛 `Empty URL`，Toast 不明显 |
| **根因 4** | `createProfile` remote 分支硬要求 `item.url`；恢复条目缺 URL |
| **修复** | `profileConfigRecoveryCore`：空 yaml → `.bak` + 磁盘 profiles 合并 + `syncProfileItemUpdatedFromDisk` · `setProfileConfig` 拒绝 persist 空配置 · `profile-card` dnd 修复 · `profileCacheRefreshCore` 无 URL 时磁盘 cache reload · `profileSubscriptionDisplayCore` 显示 `每日 07:00 · 更新 X 前` |
| **用户数据修复** | 写入 `77caf1sub001.url` = `https://cn-sub-qplmqkqycr.cn-shenzhen.fcapp.run/sub/77caf1dec00a79a2/clash?carrier=china_mobile` |
| **物理证据** | `profile.yaml` 0B mtime Sep 3 10:34 · `profile.yaml.bak-before-77caf1` 512B 完好 · 装包后 `generateProfile groups=32` · 订阅 URL fetch **200 / 442592B** |
| **单测** | `profileConfigRecoveryCore.test.ts` 3/3 · `profileCacheRefreshCore.test.ts` 1/1 · `profileSubscriptionDisplayCore.test.ts` +1 |
| **踩坑 / 防复发** | ① **空白订阅先查 profile.yaml 字节数**，不要只看 provider parity 日志 ② 恢复订阅必须保留 **url + updated=mtime** ③ 侧边栏 actionable 按钮必须 `data-no-dnd` ④ `stringifyYaml({items:[]})` ≠ 0B — wipe 来自空 write，recovery 必须处理 trim-empty |
| **未解决** | profile.yaml **谁写入 0B** 未抓到栈（mtime 10:34 无对应 app log）— 防写空已加，写入者待 observability |
| **验收** | 侧边栏显示「移动订阅」· 刷新转圈 · 远端更新 200 · 代理 302 OK · **待用户确认刷新 UI** |

### BUG-2026-09-03-004 · 误报 UDP-absent → failover Reality 锁死 → 14:41 集体 dial timeout · **INSTALLED @1.30.54 82193a9**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 部分 INSTALLED → R2 由 006 @1.30.55 补全** · 1.30.54 @15:25 · CDHash `1a48fd504ae71c14affe4257f2578648f6c2dc33` |
| **发生版本/时间** | **1.30.53 @c0cba9f INSTALLED** · 2026-09-03 **13:25 CST** emergency + **14:39–14:41 CST** 集体断 |
| **修复版本/时间** | **1.30.54** `82193a9`（部分）→ **1.30.55** `eb71107`（failback 门控补全）· replay **5/5** · 单测 **46/46** |
| **同族反复** | UDP-absent 误升级类 **第 3 次**（Aug/ Sep 001 emergency 循环 · Sep2 84s tier0 已修 · **本次是 failover→Reality 锁死新分支**） |
| **严重度** | P0 — 三端 Cursor 集体断 · 误 emergency toast · 1.5h Reality TCP:443 路径 |

#### 现象 ↔ 证据（1对1）

| 现象 | 物理证据 |
| --- | --- |
| 13:25 toast + emergency | app L14920–14951 · `EmergencyCoreRecovery admitted` → `core stopping` 13:25:48 |
| 13:25 failover Reality | app L14912 `failover_leaf target=JP-VPS-Reality` |
| 13:24 vitality HY2 存活 | app L14892 `connect_path_delay_ms=277 outcome=executed` |
| 13:25 误报 UDP absent | app L14907 `udp_leaf_strict=0 udp_full_scan=0` + `byte_death_udp_absent_requires_core_restart` |
| 14:39–41 集体断 | core log：**291** 条 `dial tcp 45.76.104.78:443: i/o timeout` · **0** 条 `Cursor专用[JP-VPS-Reality]` 成功 |
| 14:41 HY2 仍可用 | app L15909 `connect_path_delay_ms=532 outcome=executed` |
| 14:45 恢复 HY2 | core log `using 🎯 Cursor 专用[JP-VPS-HY2]` ×46/min |

#### 根因链（代码叶子）

| 层级 | 根因 | 代码/日志 |
| --- | --- | --- |
| L0 | `udpOnLeafStrict=0 && udpFullScanCandidates=0` 判为 `absent` | `hy2ParentByteDeathRecoveryCore.ts` **L128–129** |
| L1 | 未接 vitality 反证 | `recoveryCoordinator.ts` **L64**（修复前 `classifyUdpParentObservation` 直读） |
| L2 | UDP_PARENT_ABSENT → failover Reality | `recoveryCoordinatorPolicyCore.ts` **L140–155** |
| L3 | failover 后无 failback | 无 `attemptCursorDedicatedHy2FailbackIfDue`（修复前） |
| L4 | 5s 内二次误报 → emergency | app L14919（failoverAttempted 后仍 emergency）· soak 缺失 |
| L5 | Reality:443 dial 全 timeout | core log 291 条 · `vps-proxies.yaml` JP-VPS-Reality **port 443** |

#### 修复内容

| 模块 | 改动 |
| --- | --- |
| `recoveryFailoverGovernanceCore.ts` | vitality 反证降级 absent→unknown · 60s failover soak · failback 判定 |
| `hy2ParentByteDeathRecoveryCore.ts` | plan 时 vitality 成功 → `byte_death_udp_evidence_insufficient` |
| `recoveryCoordinatorPolicyCore.ts` | soak 窗口内 block UDP_PARENT_ABSENT 升级 |
| `recoveryCoordinator.ts` | buildFact 接 vitality · failover 完成写 `lastFailoverCompletedAtMs` |
| `recoveryCursorDedicatedFailback.ts` | Reality→HY2 自动 failback |
| `hy2TunnelVitality.ts` | 探针成功后触发 failback |
| `hy2ParentSidecar.ts` | evidence_insufficient 不 submit coordinator |
| `bug20260903ReplayCore.ts` | +1 fixture `0903_false_udp_absent_vitality_counterproof` |

#### 100% 修复边界（诚实）

| 范围 | 判定 | 依据 |
| --- | --- | --- |
| **Sep3 L0 误报链（13:25 场景）** | **INSTALLED 已修** | replay 5/5 · 45 单测 · `/Applications/Sparkle.app` @1.30.54 |
| **004 failback 执行** | **1.30.55 已修** | 1.30.54 有 failback 逻辑但 **15:28 live 被 marathon 门控挡** · 006 加 `hy2_vitality_failback` 豁免 |
| **14:41 dial-timeout 集群检测** | **INSTALLED 已修（005）** | `cursorDedicatedDialFailureClusterCore.ts` ≥5/10s → sidecar bypass + toast |
| **14:41 VPS:443 物理拒连根因** | **未定位** | 无 VPS ss/tcpdump · 客户端仅见 timeout |
| **生产生效** | **1.30.55** | 004 核心链 @1.30.54 · failback 门控 @1.30.55 |

#### 反复修复史（同族 UDP-absent / failover · 第 3 次独立根因 · 2 次当日 partial fix）

| 轮次 | 版本 | 修了啥 | 为何未 100% |
| --- | --- | --- | --- |
| R0 | Aug–Sep2 | tier0 SEL · 84s gate | 未覆盖 failover→Reality 新分支 |
| R1 | **1.30.54** | vitality 反证 · failback 读 live · dial 集群 | **failback 未接 marathon 门控** · live 15:28 仍锁 Reality |
| R2 | **1.30.55** | failback source 豁免 · Reality absent suppress | 待 soak |

#### 踩坑 / 防复发

① **vitality 成功 + udp 快照为零 = 证据不足，不是 absent** ② **failover 到 Reality 后必须 failback HY2** ③ **failover 后 60s soak 禁止二次 emergency** ④ 排查手册反模式 #2：不能只看 stall=0 断言健康 ⑤ **failback 必须读 mihomo live now** ⑥ **新增 recovery 路径必须接 marathonProtocolContract 门控单测** — 004 教训：写了 failback 但没测 `blocked_marathon_active`

#### 验收

- [x] 单测 46/46 · replay 5/5
- [x] INSTALLED @1.30.55 15:38 · proxy **200**
- [ ] T0 30min 三端马拉松 soak · 0 次 Reality 锁死 >60s

### BUG-2026-09-03-005 · HY2 66h 会话退化 + sidecar cooldown 锁死 → 15:12–15:14 集体 deadline exceeded · **INSTALLED @1.30.54 82193a9**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 部分 → R2 @1.30.55 补全** · 1.30.54 @15:25 |
| **发生版本/时间** | **1.30.53 @c0cba9f** · 2026-09-03 **15:12:03–15:14:30 CST** 集体断 |
| **修复版本/时间** | **1.30.54** `82193a9`（集群检测）→ **1.30.55** `eb71107`（age SSOT 进 rotate/quiesce） |
| **同族反复** | HY2 parent 老化 + 静默恢复盲区 **第 2 次当日**（14:41 Reality timeout · 15:13 HY2 deadline） |
| **严重度** | P0 — 三端 Cursor 集体断 ~2.5min · stall=0 无 emergency toast |

#### 现象 ↔ 证据（1对1）

| 现象 | 物理证据 |
| --- | --- |
| 15:12 起集体断 | core log 首条失败 **15:12:03** `context deadline exceeded` · 15:12/15:13 各 **175/130** 条相关行 |
| 末次成功 | **15:11:58** Cursor 专用 HY2 正常转发 |
| 15:14 恢复 | sidecar + vitality **15:14:29** · `outbound_hy2_session_age_ms=239434374`（≈66h） |
| 非 Reality 路径 | 错误在 **JP-VPS-HY2** · 非 14:41 的 `dial tcp 45.76.104.78:443: i/o timeout` |
| 15:07 sidecar 失败 | `byte_death_udp_absent` → **300s cooldown** 至 15:12:54 · 失败早发 51s |
| TransportLongevity 欺骗 | `age_ms=0` 而 `hy2_parent_chain_birth_ms` ≈66h → 4h sidecar gate 被挡 |

#### 根因链

| 层级 | 根因 | 模块 |
| --- | --- | --- |
| L3 | HY2 parent QUIC 会话 ~66h 退化 | VPS/QUIC 物理层 |
| L2a | 15:07 误报 byte_death 重置 cooldown | `hy2ParentSidecar.ts`（005：insufficient 不 reset） |
| L2b | TransportLongevityTruth 报 age=0 | `transportLongevityTruthCore.ts`（005：birth 强制 min age） |
| L2c | 无 dial 失败集群检测 | 新增 `cursorDedicatedDialFailureClusterCore.ts` |
| L1 | 仅 proactive sidecar @15:14:29 才恢复 | `cursorDedicatedDialFailureClusterRuntime.ts` bypass cooldown/circuit |

#### 修复内容

| 模块 | 改动 |
| --- | --- |
| `cursorDedicatedDialFailureClusterCore.ts` | ≥5 条/10s `deadline exceeded`/`i/o timeout` 集群分类 |
| `cursorDedicatedDialFailureClusterRuntime.ts` | 集群触发 sidecar bypass cooldown + circuit + toast |
| `hy2ParentSidecarCore.ts` | `resolveEffectiveHy2ParentChainAgeMs` · dial-failure cluster bypass |
| `transportLongevityTruthCore.ts` | birth 旧时强制 min age |
| `log.ts` | hook `publishTargetLogLines` → 集群 ingest |

#### 100% 修复边界（诚实）

| 范围 | 判定 |
| --- | --- |
| **15:13 静默 2.5min（L0 设计）** | **INSTALLED 已修** — 集群检测 + sidecar bypass |
| **66h HY2 会话物理退化** | **缓解未根治** — sidecar 会重启链，但 VPS QUIC 根因未穿透 |
| **marathon 非活跃时集群 sidecar** | **部分缺口** — 需 `cursor_conn≥12` 才走 marathon sidecar 路径 |
| **15:19 余波** | 旧包 1.30.53 期间仍有 deadline · **15:25 装 1.30.54 后 15:25–15:29 零 deadline** |

| **15:13 静默 2.5min** | **1.30.54 集群检测 + 1.30.55 age SSOT** | 005 修检测 · 006 修 8h refresh 永不触发 |
| **66h HY2 会话** | **1.30.55 缓解** | VPS 证伪：07:12–07:13 **零 HY2 入站** = 客户端 stale QUIC |
| **1.30.54 live 证伪** | **15:28 age=0 仍出现** | birth fix 未进 quiesce/rotate 读数路径 → 006 统一 |

#### 验收

- [x] 单测 46/46 · VPS SSH 对账
- [x] INSTALLED @1.30.55 · proxy **200**
- [ ] live dial 集群 + 8h refresh 触发（待 soak）

### BUG-2026-09-03-006 · age SSOT 分裂 + failback 马拉松门控 + Reality absent 恶性循环 · **INSTALLED @1.30.55 eb71107**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 INSTALLED** · 2026-09-03 **15:38 CST** · CDHash `7464c014d110ebd9ec53b14c467376aec814d841` |
| **发现版本/时间** | **1.30.54 @82193a9 装包后 3min** · 2026-09-03 **15:28–15:29 CST** live 证伪 004/005 未闭环 |
| **修复版本/时间** | **1.30.55** · git **`eb71107`** · 单测 **46/46 PASS** |
| **同族反复** | 004 failback **第 2 次修** · age=0 欺骗 **第 N 次**（Aug 4.1h parent · Sep3 66h） |
| **严重度** | P0 — 装 1.30.54 后仍锁 Reality + 误 emergency |

#### 现象 ↔ 证据

| 现象 | 证据 |
| --- | --- |
| failback 失败 | app 15:28:18 `switch_blocked blocked_marathon_active source=hy2_vitality_failback` |
| age SSOT 分裂 | 同秒：TransportLongevityTruth age=**0** · Hy2ParentSidecar age=**172134719** |
| Reality 恶性循环 | app 15:29:53 `EmergencyCoreRecovery admitted` · core 走 `JP-VPS-Reality` |
| VPS 15:13 定论 | sing-box 07:12–07:13 HY2=**0** · 07:14:30 恢复 UDP 50703→61604 |

#### 根因（代码叶子）

| 层级 | 根因 | 模块 |
| --- | --- | --- |
| L1 | `hy2_vitality_failback` 不在 marathon 豁免列表 | `marathonProtocolContractCore.ts` L237 |
| L2 | quiesce/rotate 读 snapshot age 不读 birth | `carrierQuiesceRefreshCore.ts` · `hy2ParentSidecar.ts` · `hy2ParentRotationCore.ts` |
| L3 | failover 到 Reality 后 HY2 udp 必然 absent → 又 emergency | `recoveryCoordinator.ts` buildFact 缺 live leaf 上下文 |

#### 修复内容

| 模块 | 改动 |
| --- | --- |
| `marathonProtocolContractCore.ts` | `hy2_vitality_failback` → 允许 Reality/TLS→HY2 |
| `hy2ParentSidecarCore.ts` | `resolveEffectiveTransportLongevityAges` SSOT |
| `carrierQuiesceRefreshCore.ts` | 8h emergency refresh 用 effective age |
| `hy2ParentSidecar.ts` / `hy2ParentRotationCore.ts` | rotate 门控用 effective age |
| `recoveryFailoverGovernanceCore.ts` | `shouldSuppressHy2UdpAbsentEscalation` |
| `recoveryCoordinator.ts` | buildFact 读 mihomo live leaf |

#### 为何 004/005 在 1.30.54 不够（反思）

1. **修 A 未测 B 集成**：failback 单测通过但未测 marathon 门控 live 路径
2. **两套 age SSOT**：sidecar dial 已用 effectiveAge（005）· quiesce/rotate 仍读 snapshot（006 才统一）
3. **装包≠验收**：15:25 装 1.30.54 · 15:28 即复现 — **必须 live 对账 + VPS 交叉验证**

#### 100% 边界

| 已修 | 未修 |
| --- | --- |
| failback 马拉松锁 · age 分裂 · Reality 恶性循环 | VPS QUIC 物理层 · 60s vitality 窗口外误 absent · marathon 非活跃集群路径 |

#### 踩坑 / 防复发

① **任何 mihomoChangeProxy 新 source 必须加 marathonProtocolContract 单测** ② **rotate/quiesce/sidecar 必须共用 `resolveEffectiveTransportLongevityAges`** ③ **failover 到 TCP leaf 后禁止对 HY2 leaf 做 absent 升级** ④ **装包后 5min 内查 core log 当前 leaf + failback 日志**

#### 验收

- [x] 单测 46/46
- [x] INSTALLED @1.30.55 15:38 · proxy **200**
- [ ] 30min soak · 0 次 Reality 锁死 · 0 次误 emergency

### BUG-2026-09-02-001 · Marathon 稳定性观测缺失 / Cursor 桥接技术债 · **INSTALLED @1.30.53 199ff203 · 待 soak**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R0 INSTALLED** · 2026-09-02 14:16 CST · CDHash `199ff203f33a7abec950a789439d133eea983b2c` |
| **发生版本/时间** | 全历史至 **1.30.52** · 2026-09-02 用户报告「Sparkle 又断了吗」+ 2917ms 误判 |
| **修复版本/时间** | **1.30.53** · git `ba18b505` · scripts 不进 asar · 2026-09-02 14:16 装包 |
| **同族反复** | **第 1 轮正式交付**（此前仅有 `triage-cursor-disconnect.sh` 手工 RID 流程） |
| **严重度** | P2 — 无法定量归因 · 误把 stall 当断连 · C3 HOME 假阴性 |
| **症状** | ① 用户问断连只能靠猜 ② 2917ms 被当超时 ③ 476 stall vs 61 断连混统计 ④ C3 Agent shell 报告 0 事件 |
| **根因** | 无自动化归因；守恒读 Cursor Structured Logs（运行时耦合）；CLI 只读 latest 单个 core 文件 |
| **物理证据** | `core-2026-9-1.log:67320` 13:05 JP deadline · RID `23981e68` = L7 慢池 90s（12:33）· 9866 success / 25 JP error |
| **修复内容** | Phase 0：`marathonStabilityAttributionCore` + CLI · Phase 0.5：`marathonStabilitySparkleConservationCore` · `resolveSparkleDataHome()` · 删 `marathonStabilityRidCrosswalkCore` |
| **解决了什么** | Sparkle-only 批量报告；stall/断连拆分；C3 假阴性；无 Cursor 运行时耦合 |
| **遗漏什么** | **不减少**真实断连；VPS 443 服务端 OPEN；L7 慢池非 Sparkle |
| **可能导致什么** | 无 runtime 风险（scripts only）· 误删 scripts 文件 = 能力回退 |
| **验收** | [x] 15 单测 pass [x] 604k 行扫描 [x] Sparkle-only 报告 [ ] 30min soak |
| **踩坑** | 2917≠超时 · 13:05 deadline≠RID 根因 · blocked≠失败 · 装包后须验 CDHash |
| **防复发** | VERSION_LOG 文件清单 · Agent 禁止删 scripts · 默认 `conservation-report` 不读 Cursor |
| **反思** | 以前「修网络」无「尺子」→ 每次争论节点 vs Sparkle · 本次先观测再 Phase 1S |

### BUG-2026-09-02-002 · 马拉松期 Sparkle 数据面自扰（probe/restart 日志洪水）· **INSTALLED @1.30.53 199ff203 · 待 soak**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R0 INSTALLED** · Phase 1S in asar · 2026-09-02 14:16 CST |
| **发生版本/时间** | **1.30.52 及更早** · 2026-09-02 24h：L2 incident **71+** · `core_cold_restart_blocked` 每 ~5min |
| **修复版本/时间** | **1.30.53** · git `ba18b505` |
| **同族反复** | 与 **BUG-2026-08-29-001** Layer-0 同族 · 本次 = **第 2 轮补漏**（busy gate + 日志节流，非扩 cursor_conn quiesce） |
| **严重度** | P1 — 高负载 probe 与转发争用 · 日志洪水误导排查 |
| **症状** | ① `profile-update-cli` 每 5min 尝试→blocked→刷 warning ② probe max 2 不随负载降 ③ 476 stall 检测事件 |
| **根因** | profile-update 未在 mihomo 高负载时提前 defer；blocked 无节流；probe 并发硬编码 2 |
| **物理证据** | app.log 大量 `core_cold_restart_blocked caller=profile-update-cli cursor_conn=5–22` · conservation L2:71/24h |
| **修复 R0（1.30.53）** | `mihomoDataPlaneLoadCore`（≥48 busy）· `profileUpdateDueCli` 提前 defer · `mihomoProbeCoordinator` max 1 · `coreLifecycleBlockedLogThrottleCore` 5min |
| **解决了什么** | 高负载少探测争用 · 少进 guard 撞墙 · 日志可读（summary 替代 spam） |
| **遗漏什么** | cursor_conn>0 仍 block restart（既有 guard）· L7/VPS 不管 · busy 阈值 48 待 soak 校准 |
| **可能导致什么** | 高负载时 profile 更新延迟 · 自动测速 stale（手动仍可用） |
| **历次修复为何未成功** | BUG-2026-08-29-001 R3 只 block cold restart，**未**减 probe 争用、**未**节流 blocked 日志 → 用户仍见「刷屏=不稳定」 |
| **验收** | [x] install [x] 5 单测 [ ] T0+30min blocked ≤1/5min [ ] probe 信号增速↓ |
| **踩坑** | blocked=guard 正常 · 勿当事故 · 看 `blocked_summary` · busy 阈值勿随意降（误 defer 更新） |
| **防复发** | 改 probe/guard 必须跑 `marathonStabilityAttributionCore.test.ts` + conservation 报告对比 |
| **反思** | Layer-0 guard 只「挡重启」不「减自扰」→ 用户感知仍差 · Phase 1S 补 busy+节流 |

---

### BUG-2026-09-01-001 · fake-ip Direct 冷启动 + 198.18 CIDR 陷阱 · **INSTALLED @1.30.52 cb85a3b · 待 soak**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R2 INSTALLED** · T0=10:29:11 · **待 30min soak PASS** |
| **同族反复** | **第 3 轮**（R0 Tier0 缺失 · R1 Tier0+flush 半生效 · **R2 emoji Direct CIDR**） |
| **严重度** | P1 — 国内 App `dial tcp 198.18.0.x i/o timeout` + 与 BUG-002 emergency 级联 |
| **症状** | QQMusic/Codex `198.18.0.x i/o timeout` · 9/1 累计 **737+** 次 core log |
| **根因 R0** | 无 Tier0-Direct · core restart 不 flush store-fake-ip（BUG-013 仅 TUN lost） |
| **根因 R1 遗漏** | `sanitizeFakeIpDirectCidrRules` 只匹配 `target === 'DIRECT' \|\| /直连/` · 订阅规则为 **`IP-CIDR,198.18.0.0/16,🎯 Direct`** → Layer1 **从未移除** · 每次 `generateProfile` 写回陷阱 |
| **证据 R2** | `work/config.yaml:3417` trap 在 6e92e53 装包后仍存在 · 手动删后 10:25 cold_start regen **又写回** · `fakeIpRoutingIntegrity.ts:153-154` 旧逻辑 |
| **修复 R0** | Tier0-Direct · CoreLifecycle post-ready flush · `6e92e53` |
| **修复 R2** | **`cb85a3b`**：198.18/198.19 IP-CIDR 在 fake-ip 模式下 **无条件移除**（不依赖 outbound 名） |
| **装包** | CDHash `17c22f704c7cc88b5ee56188c4581c8e26f36072` · post-regen **TRAP_ABSENT** |
| **验收** | [x] `integrity_patches` @ generateProfile [x] TRAP_ABSENT [ ] T0+30min timeout 零增长 |
| **踩坑** | **filter 有 +.cn ≠ 陷阱已除** — 必须 rg `198.18.0.0/16` on runtime config · 单测须覆盖 emoji Direct target |

### BUG-2026-09-01-002 · Phase-1 emergency 马拉松自激重启 · Cursor/Codex SSE 断流 · **INSTALLED @1.30.52 cb85a3b · 待 soak**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 INSTALLED** · cooldown 生效 · failover 路径就绪 · **待 HY2 stall 实战 + 30min soak** |
| **同族反复** | **第 2 轮**（R0 d33cbf1 仍循环 · R1 +003 failover 链） |
| **装包版本** | **1.30.52** · CDHash `17c22f70…` · git `d33cbf1`→`cb85a3b` |
| **症状** | `Connection failed repeatedly` / `stream disconnected … error decoding response body` · 装包前 **48× `emergency_admitted`**（09:44–10:23） |
| **根因 R0** | UDP absent → 跳过 failover · CB+Coordinator 双触发 · 无 cooldown → 每 2–3min core restart（cursor_conn=18–25） |
| **根因 R1 遗漏** | 见 **BUG-2026-09-01-003** — failover 从未成功 → 永久 emergency |
| **证据** | `app-2026-9-1.log:52028` 10:00 `request_emergency_core_recovery` cursor_conn=21 · `52297` cooldown block · T0 10:29+ **零 emergency** |
| **修复 R0** | `d33cbf1`：in-flight mutex · 120s cooldown · failover-first policy · CB open only |
| **修复 R1** | `08b4153`+`252de75`+`cb85a3b`（见 003） |
| **NOT** | Cursor 服务端 · api2 路由（restart 间隙 api2=200） |
| **待验** | T0+30min 零 emergency · HY2 stall → failover executed · Network Diagnostic 10/10 |

### BUG-2026-09-01-003 · failover R-31 拦截 + failoverAttempted 永久锁 · **INSTALLED @1.30.52 cb85a3b**

| 字段 | 内容 |
| --- | --- |
| **状态** | **INSTALLED** · 单测 PASS · **待 HY2 byte-death 实战验证** |
| **严重度** | P0 — 导致 BUG-002 emergency 循环 **无法被 failover 打断** |
| **症状** | 09:06 failover 一次失败后 · 10:00+ **永远** `request_emergency_core_recovery`（cursor_conn>0） |
| **根因 A** | `recoveryCoordinator.ts`（6e92e53）`mihomoChangeProxy` **`source: 'manual'`** → R-31 `blocked_suboptimal_lateral` HY2→Reality |
| **根因 B** | `recoveryCoordinatorPolicyCore` 在 **dispatch failover 时** `failoverAttempted=true` → 一次失败 **永久锁 emergency 路径** |
| **证据** | `app-2026-9-1.log:50173-50175` failover → `switch_blocked source=manual` · `:52028` 10:00 直 emergency（failoverAttempted 已 true） |
| **修复 A** | `08b4153`：`source=recovery_coordinator` + `marathonProtocolContractCore` escape path |
| **修复 B** | `252de75`：`MAX_FAILOVER_DISPATCHES=2` · 成功才设 `failoverAttempted=true` |
| **装包** | asar `recovery_coordinator` 3 hits · CDHash `17c22f70…` |
| **验收** | [ ] 下次 stall：`recovery_failover_lateral_escape` or `recovery_failover_protocol_upgrade` · 非 `switch_blocked source=manual` |
| **踩坑** | **policy 说 failover-first 不够** — switch source + attempt 语义必须一起修 · 否则「修了 failover 仍 emergency」 |
| **反思** | 同 bug **翻来覆去**：Phase-1 闭合 emergency deadlock 后 **过度 correction** → 未测 failover 实战路径 · 验收用窄窗假象 |

### BUG-2026-09-01-000 · Recovery Architecture Convergence Phase-1 · **CODE-DONE @1.30.52 · 部分 INSTALLED**

| 字段 | 内容 |
| --- | --- |
| **状态** | **CODE-DONE + smoke PASS** · **回归见 002/003** |
| **装包** | `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1` · build `2026.0901.1605` · CDHash `11918045…` |
| **交付** | `recoveryCoordinator` · `emergencyCoreRecovery` · byte-death verifier · fault injection gate · `--sparkle-emergency-recovery-smoke` |
| **闭合** | 旧链 `evaluateMarathonCoreColdRestart is not a function` + UDP absent birth-reset bypass + circuit OPEN 无 escalation |
| **回归** | emergency 在马拉松期 **过于激进** — 见 002 · failover 未通 — 见 003 |

### BUG-2026-08-31-007 · Cursor 主改走自动选择 · 仅 2/3 专用 · **INSTALLED @1.30.52**

| 字段 | 内容 |
| --- | --- |
| **状态** | **INSTALLED @1.30.52** · commit `9c16108` · force rebuild+install (`SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1` + `SPARKLE_UPGRADE_BREAK_GLASS=1`) · GUI force-open |
| **需求** | Cursor 主不走 🎯 Cursor 专用；仅 Cursor-2 / Cursor-3 走专用；`Cursor-3.1.15.app` 已卸载需移除 |
| **修复** | `CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES` = Cursor-2 + Cursor-3；`CURSOR_NODE_SELECT_APP_PATH_PREFIXES` = Cursor.app；删除 `MARATHON_CURSOR_APP_PATH_PREFIX` / markers 中的 3.1.15 |
| **验收** | 单测 15/15 · DistFreshness fresh · `work/config.yaml`：`Cursor.app` → `自动选择` · 无 `Cursor-3.1.15` · proxy `:7890` OK · Sparkle GUI running |

### BUG-2026-08-31-006 · bootstrap 死锁 core 起不来 · cursor_conn=-1 · **INSTALLED @1.30.46**

| 字段 | 内容 |
| --- | --- |
| **状态** | **INSTALLED @1.30.46** · commit `dd40c79` · `/Applications/Sparkle.app` CDHash `a4efd564…` |
| **症状** | 装包后 mihomo 未 bootstrap · app 日志 `core_cold_restart_blocked reason=cursor_conn_observation_unavailable cursor_conn=-1` |
| **PRIMARY** | profile-update-cli / macOS26 headless 在 startCore 前跑 marathon guard；core 未运行时 observation=-1 → 永久 defer（鸡生蛋） |
| **修复** | `evaluateBootstrapCoreStartGuard()` — 800ms probe，core 不在线则 skip guard 直接 startCore |
| **验收** | mihomo 0s 检测到 · `api2.cursor.sh` 经 `:7890` **HTTP 200** · asar gate stage=B OK · 单测 19/19 PASS |

---

### BUG-2026-08-31-004 · Sparkle 启动 SyntaxError · `/(?i)-VPS-HY2$/` · **HOTFIX @1.30.45**

| 字段 | 内容 |
| --- | --- |
| **状态** | **HOTFIX @1.30.45** · 源码 `a1de0ef+` 已用 `/-VPS-HY2$/i` · 坏包来自 63950fc 脏构建 |
| **症状** | `Uncaught Exception: SyntaxError: Invalid regular expression: /(?i)-VPS-HY2$/: Invalid group` · Sparkle 打不开 |
| **PRIMARY** | mihomo `(?i)` 语法误写入 JS RegExp literal |
| **修复** | `aiTrafficIsolationCore.ts` 使用 `/-VPS-HY2$/i` · 从 HEAD 重装 |

---

### BUG-2026-08-31-003 · Cursor-3.app 未命中 Cursor 专用 · api2 走 GFW Match · **R1 CODE-DONE @1.30.44**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 CODE-DONE @1.30.44 git** · **待 install + profile reload** |
| **症状** | `api2.cursor.sh` chains=`新加坡02→Sparkle-自动-新加坡→自动选择→🔰手动选择→🧱GFW列表` · `rule=Match` · `processPath=/Applications/Cursor-3.app/...` |
| **PRIMARY** | `@1.30.43` 只覆盖 `Cursor.app` / `Cursor-2.app` / `Cursor-3.1.15.app` · 本机 Marathon 实际为 `Cursor-3.app`（3.15.6） |
| **NOT** | 节点质量问题 · Cursor 专用组 UI 选项缺失 |

**修复（R1 @1.30.44）：** `CURSOR_3_APP_PATH_PREFIX` + dedicated/marathon/markers 同步

---

### BUG-2026-08-31-002 · 三 Cursor 客户端未走 Cursor 专用 · **R1 CODE-DONE @1.30.43**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 CODE-DONE @1.30.43 git**（2026-08-31）· 37/37 相关单测 PASS · **待 install** |
| **症状** | Cursor.app / Cursor-2 / Cursor-3.1.15 分别走 节点选择 / DIRECT / GFW 默认规则 · 用户在 Cursor 专用组切节点不生效 |
| **PRIMARY** | `CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES` 默认空 · `resolveGeneralProxySelectGroup` 不认 `自动选择` 别名 · 自动选择↔Cursor专用 双向嵌套循环 |
| **NOT** | 节点质量问题 · Codex 断流（见 BUG-2026-08-31-001） |

**修复（R1 @1.30.43）：**

- `cursorAppBundlePathsCore.ts` — 三客户端默认 `🎯 Cursor 专用`
- `defaultAutoSwitchProxy.ts` — Cursor 专用组追加 `自动选择` 选项，禁止反向嵌套
- `cursorProxyGroup.ts` — `自动选择` 作为 `🚀 节点选择` 别名
- `cursorRuleInjection.ts` — 默认 path-scoped 规则对齐

**验证：** `cursorRuleInjection` + `defaultAutoSwitchProxy` + `cursorDedicatedDefault` + `appCursorDefaultsCore` **37/37 PASS**

---

### BUG-2026-08-31-001 · CarrierQuiesce/sidecar 自激坏环 · Codex SSE 断流 · **P1 CODE-DONE @1.30.41**

| 字段 | 内容 |
| --- | --- |
| **状态** | **P1 CODE-DONE @1.30.41 git**（2026-08-31）· 10/10 单测 PASS · **待 `agent:upgrade:mac` install** |
| **症状** | Codex `stream disconnected … error decoding response body` · 16:30 `CarrierQuiesce` 每 5s 杀 parent UDP + `sidecar_dial` 失败循环 · 16:38 全站 timeout |
| **PRIMARY** | 无 Recovery Circuit Breaker — 恢复失败无限重试自伤 · SEL R2 `parent_udp_refresh` 旁路熔断器 |
| **NOT** | 新加坡节点 dial 失败（16:44 后 chatgpt dial 0 error）· Codex 软件 bug |

**修复（P1 @1.30.41）：**

- `recoveryCircuitBreakerCore.ts` — 3 次连续失败 → open 10min
- `recoveryCircuitBreaker.ts` — runtime gate + 用户 danger 通知
- `hy2ParentSidecar.ts` — 入口 gate + failure/success 记账 + probe-only 假成功防护
- `mihomoQuicSilentStallRecovery.ts` — SEL R2 尊重熔断器
- `bug20260831RecoveryCircuitReplayCore.ts` — 8/31 16:30 replay gate

**验证：** `recoveryCircuitBreakerCore` + `bug20260831` + `hy2ParentSidecar` **10/10 PASS**

---

### BUG-2026-08-29-002 · 订阅 ♻️ 自动选择 未走 Sparkle 区域自动选择 · **R1 CODE-DONE · 待 install**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 CODE-DONE @1.30.40 git**（2026-08-29 23:21 CST）· 单测 14/14 · **RUNTIME OK**（patch + verify）· **/Applications asar 未含补丁** |
| **症状** | 订阅 select 组首项为 `♻️ 自动选择`（flat url-test 全节点）；与 Sparkle `自动选择`→`Sparkle-自动-*` 并行；用户选 ♻️ 不走 ChatGPT 探针区域链 |
| **关联** | Sparkle **1.30.40 installed** · 订阅 `77caf1sub001` · composer `3d9338e6-094a-45ba-a652-53077afbc757` |
| **同族 recurrence** | **第 1 次记录**（结构性：订阅模板与 Sparkle factory 注入并存，非偶发 typo） |
| **PRIMARY** | `ensureSelectGroupsDefaultToAutoSwitch` 只处理订阅 `自动选择` url-test，**不处理** `♻️ 自动选择` 独立组名 |
| **NOT** | 香港硬编码全局 · provider 拉取失败 · marathon 切换拦截 |

**修复（R1 git）：**

- `rewriteLegacySubscriptionAutoSelectInGroups` — 删除 `♻️ 自动选择` 组；proxies 引用替换为 `自动选择`
- `rewriteLegacyAutoSelectRuleTargets` — 规则 policy 中 ♻️ → 自动选择
- `collectSparkleAutoSelectGroupRefs` — select 组 append `自动选择` + `Sparkle-自动-*` + `故障转移`
- 单测：`rewrites subscription ♻️ 自动选择 to Sparkle 自动选择 and exposes regional groups`

**验证（2026-08-29 23:21）：**

```text
work/config.yaml: ♻️ count = 0
mihomo runtime: manual_now = 自动选择, recycle groups = 0
proxy :7890 → 204
```

**为何未 100% 固化：**

- 已装 **1.30.40 asar 无 R1 代码**；每次 `generateProfile`（headless/GUI bootstrap）**会还原 ♻️**
- 过渡：`pnpm exec tsx scripts/patch-work-config.ts`（`HOME` 必须指向真实用户目录）
- **根治**：`pnpm run agent:upgrade:mac` 装 git 补丁

**踩坑 / 防复发：**

1. 换订阅后若见 COMPATIBLE placeholder → 先查 provider parity（BUG 同会话 serviceCoreProviderParityCore），再查 ♻️
2. Agent 禁止用旧 asar 逻辑推断 disk 已正确 — 必须 `rg ♻️ work/config.yaml` + mihomo API 双验
3. `patch-work-config.ts` 不是 SSOT 长期方案 — 仅 install 前过渡
4. **反思**：订阅兼容应 factory 一层消歧，不能靠 UI 默认或用户手动选第二个「自动选择」

**关联文件** · `defaultAutoSwitchProxy.ts` · `factory.ts` · `scripts/patch-work-config.ts` · `VERSION_LOG.md` 2026-08-29 基线条目

---

### BUG-2026-08-29-003 · macOS 26 Dock 启动「没启动」/ 无 GUI 窗口 · **R1 MITIGATED**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 MITIGATED @1.30.40**（2026-08-29 23:21 CST）· 用户 config `macos26ForceGui: true` · git persist 偏好 · **GUI 运行 verified** |
| **症状** | 用户 `open -a Sparkle` / Agent 启动后无窗口；以为未启动；实际 headless bootstrap 秒退，仅 mihomo/service 常驻 |
| **关联** | macOS **26.5.2** · Sparkle **1.30.40** · BUG-2026-08-16-001 同族（headless 为 SIGTRAP 缓解） |
| **同族 recurrence** | **第 3+ 次用户困惑**（设计如此但 UX 易误解；此前 session 曾 force-GUI 成功，普通 open 又 headless） |
| **PRIMARY** | `shouldUseMacOs26HeadlessBootstrap` 默认 true（`!forceGui`）· Dock 不带 `--sparkle-force-gui` |
| **NOT** | mihomo 未启动 · 代理挂了 · Sparkle.app 缺失 |

**修复（R1）：**

| 层 | 动作 |
| --- | --- |
| **用户 config（立即）** | `~/Library/Application Support/sparkle/config.yaml` → `macos26ForceGui: true` |
| **git** | `persistMacOs26ForceGuiIfRequested` — 曾用 flag/env 启动则写入 config |
| **脚本 SSOT** | `scripts/open-sparkle-gui-macos26.sh` → `open -a Sparkle --args --sparkle-force-gui` |

**验证：**

```text
pgrep -x Sparkle → running
PostCoreBootstrap log（非 MacOs26Headless-only 秒退）
macos26ForceGui: true in config.yaml
```

**Agent 卡死关联（本 bug 副产品）：**

- Agent 同步等 `agent:upgrade:mac` marathon safe window（~10min）→ 用户感知「卡死」
- `reload-mihomo-via-service.mjs` axios 30s 无响应 → 应 perl alarm / 短超时
- **禁止** Agent block_until >60s 等 install

**踩坑 / 防复发：**

1. macOS 26：**无窗口 ≠ 未启动** — 先 `curl -x :7890` + `pgrep mihomo`
2. 要 GUI：`macos26ForceGui: true`（推荐）或 `--sparkle-force-gui`
3. headless bootstrap 会 **regen profile** → 可能触发 BUG-002 ♻️ 回归（装包前）
4. watchdog macOS26 **不自动 relaunch GUI**（`macos26_no_relaunch: true`）— 勿依赖 watchdog 开窗口

**待 install 固化** · `macos26ForceGuiPreferenceCore.ts` · `index.ts`

---

### BUG-2026-08-29-004 · 换订阅后 HK/区域组 COMPATIBLE · service provider 不一致 · **R1 CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 CODE-DONE @1.30.40 git** · 同会话 verified 冷重启后 HK 节点正常 · **待 install** |
| **症状** | 切换订阅 `678a1sub001`→`77caf1sub001` 后 `🇭🇰 香港节点` 仅 **COMPATIBLE Compatible UDP** placeholder |
| **PRIMARY** | service 模式 `startCore()` 仅 regen disk config，**未 restart service mihomo** → runtime provider 仍为旧 ID |
| **修复** | `serviceCoreProviderParityCore.ts` + `manager.ts` — provider ID 不一致时 trigger service restart（marathon guard 可 defer） |
| **踩坑** | GUI 重启 ≠ mihomo cold restart；kill 用户态 mihomo 无效（root service）· 必须 service API 或 parity restart |

---

### BUG-2026-08-29-005 · Cursor 专用 manual 切 JP-VPS-HY2 被 marathon 拦截 · **R1 CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R1 CODE-DONE @1.30.40 git** · 单测 24/24 · 同会话 API bypass 临时生效 · **待 install** |
| **症状** | UI/API 切换 `JP-VPS-Reality`→`JP-VPS-HY2` 日志 `blocked_suboptimal_lateral` |
| **PRIMARY** | `marathonProtocolContractCore.ts` 禁止 suboptimal↔suboptimal 横向切换，未豁免 optimal VPS（HY2） |
| **修复** | manual 切到 `MARATHON_CURSOR_OPTIMAL_VPS_NODE`（JP-VPS-HY2）允许；仍拦 HY2↔TUIC 等 |
| **踩坑** | 临时 bypass：direct mihomo API + `~/.sparkle/cursor-dedicated-selection.json` — 非 SSOT，装包后走 contract |

---

### BUG-2026-08-29-001 · Cursor Agent Reconnecting · ProfileUpdaterCli 旁路 mihomo cold restart · **R3 INSTALLED · soak PENDING**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R3 INSTALLED @1.30.40**（2026-08-29 23:31 CST）· Layer-0 + CI + deferred queue · **P3 soak gate PASS**（defer_events=10 · 零 `mihomo core started` since T0） |
| **症状** | Cursor Agent 会话频繁 **Reconnecting...** · `[nal_agent_retries] attempt 1~5` · 用户 composer `3d9338e6-094a-45ba-a652-53077afbc757` |
| **关联产品** | Sparkle **1.30.40** · Cursor **3.x**（patch-315）· macOS **26.5** headless + service core |
| **A 时刻** | **2026-08-29 22:48:23 CST** ProfileUpdaterCli · **22:48:24** `mihomo core started` · **22:48:27** Cursor `ECONNRESET`/`socket hang up`（+3.3s）· **22:48:36~22:49:58** nal_agent_retries |
| **PRIMARY** | Sparkle **数据面冷突变**（mihomo process replace / TUN reset）在 Cursor 活跃连接存在时发生 → Agent SSE/TLS 被 RST |
| **amplifier** | Cursor 原生 `[nal_agent_retries]` 重连 UI（**非根因**，仅为症状放大器） |
| **NOT** | Cursor 原生 bug · Cursor 补丁 bug · BUG-MAIN-009（127.0.0.1 路由）· VPS 宕机 · max-steps-cap |
| **同族 recurrence** | **第 4+ 次**「马拉松/活跃 conn 期 data-plane mutation 自伤」— 前序：BUG-2026-07-28-025（L3 restartCore）· BUG-2026-07-28-024（force install）· BUG-2026-08-06-001（byte-death collateral close）· 本次为 **P10 guard 已存在但 caller 旁路** |

**A 时刻证据链（Sparkle app-2026-8-29.log + Cursor renderer）：**

| ts CST | 组件 | 信号 |
| --- | --- | --- |
| 22:45:58 | CoreLifecycle | `core_cold_restart_blocked cursor_conn=2`（restartCore 门禁 **有效**） |
| 22:48:23 | ProfileUpdaterCli | `bootstrap start` → `generateProfile done` |
| 22:48:24 | CoreLifecycle | `mihomo core started pid=35922`（**冷重启成功**） |
| 22:48:27 | Cursor transport | `ECONNRESET` / `socket hang up` → `agentn.global.api5.cursor.sh` |
| 22:48:36~49:58 | nal_agent_retries | attempt 1~5 · UI **Reconnecting...** |
| 22:49:58 | Cursor | `conversation_action_abort`（用户 /jx） |

**根因（架构级，非单点 typo）：**

1. **Guard 是 caller 层 opt-in**，不是 data-plane 层 opt-out — 每新增入口就漏一个旁路。
2. **阈值分裂**：`shouldDeferAppConfigMihomoReload` 曾 defer @ conn≥12，而 cold restart guard @ conn>0 — conn=7 时热 reload 不被拦。
3. **LaunchAgent 5min 定时器** 对已运行 Sparkle 走 **`second-instance`** 路径，直接 `runDueProfileUpdates('cli')` **完全绕过** P10 guard（22:48 主因）。
4. **`profileUpdateDueCli` cold 路径**、**`macos26HeadlessBootstrap`**、**`reload-mihomo-via-service.mjs`** 亦曾无 guard。

**修复历程（为何前几轮「修了个屁」）：**

| 轮次 | 版本 | 改了什么 | 为何未闭合 |
| --- | --- | --- | --- |
| R0 | ≤1.30.39 | P10 `restartCore`/`stopCore` guard + guard JSON | 仅覆盖 manager 显式 restart；ProfileUpdaterCli 仍 `startCore()` |
| R1 | 1.30.40 git | 统一 defer SSOT → `shouldBlockMarathonCoreColdRestart`；CLI/headless/reload 脚本补 guard | **遗漏 `second-instance`**；未装包前用户仍 hit 旧 asar |
| **R2** | **1.30.40 installed** | `runGuardedDueProfileUpdatesSecondInstance()` · `/Applications` 装包 · E2E defer @ cursor_conn=9 | **仍缺 Layer-0**：`startCore()` 入口无硬门禁；无 CI 审计 |
| **R3** | **1.30.40 installed** | Layer-0 `startCore` mutation guard · `verify-marathon-mutation-callers.mts` in upgrade pipeline · `deferredProfileUpdateDue` queue · second-instance defer + `deferred_profile_update_queued` E2E | **30min soak**（app-log 零 `mihomo core started` while cursor_conn>0）**PENDING** |

**R2 代码面（git @1.30.40）：**

- `appConfigMihomoReloadGuardCore.ts` — defer 统一 SSOT（conn>0 即 block）
- `profileUpdateDueCli.ts` — CLI guard + **`runGuardedDueProfileUpdatesSecondInstance`**
- `index.ts` — second-instance 改走 guarded path
- `macos26HeadlessBootstrap.ts` — headless bootstrap guard
- `scripts/reload-mihomo-via-service.mjs` — 读 `~/.sparkle/marathon-core-restart-guard.json`
- `marathonCoreRestartGuardCore.ts` — caller 类型扩展

**R3 代码面（git @1.30.40 · installed 23:28 CST）：**

- `startCoreMutationGuardCore.ts` + `manager.startCore()` Layer-0 guard（caller=`startCore`）
- `scripts/verify-marathon-mutation-callers.mts` — upgrade Stage-A CI 门禁
- `deferredProfileUpdateDueCore.ts` / `deferredProfileUpdateDue.ts` — conn→0 补跑
- `marathonQuiesce.ts` — idle 时 `maybeExecuteDeferredProfileUpdateDue`

**R3 装包后 E2E（2026-08-29 23:28 CST）：**

```text
[verify-marathon-mutation-callers] OK
[ProfileUpdaterCli]: second-instance deferred ... cursor_conn=10
[ProfileUpdaterCli]: deferred_profile_update_queued source=second-instance
reload_deferred { blockColdRestart: true }
```

**仍待验证（生产 soak）：**

| 项 | 说明 |
| --- | --- |
| **P3 Soak gate** | `verify-marathon-data-plane-soak-gate.mts` — **PASS** @ 23:31 CST（t0=15:17:55Z · defer_events=10 · 5× stress reload_deferred · 零 core start） |

**如何避免再次翻车（踩坑 SSOT）：**

1. **禁止**在 caller 层单独写 guard — 一切 mutation 必须经 `manager.startCore/restartCore/stopCore` 或 `mihomoApi` provider guard。
2. **禁止**新增 `PUT /configs?force=true` 脚本而不读 guard JSON。
3. LaunchAgent / second-instance / CLI **共用同一 guarded 函数**（`runGuardedDueProfileUpdates*`），禁止复制粘贴路径。
4. 阈值 **单一 SSOT**：`shouldBlockMarathonCoreColdRestart`（conn>0 / quiesce / recent lifecycle），禁止再出现 conn≥12 分裂。
5. 装包 **必须** `pnpm run agent:upgrade:mac` + 验证 asar 含 guard 字符串 + E2E defer 日志。
6. **反思**：同 bug 反复因「每修一个入口加一个 if」— 正确做法是 **mutation 层硬门禁 + CI 防回归**。

**关联** · `marathonCoreRestartGuardCore.ts` · `profileUpdateDueCli.ts` · `index.ts` second-instance · open-perplexity 会话 `3d9338e6-094a-45ba-a652-53077afbc757`

**状态结论**：P0–P3 全部 INSTALLED + 自动化 gate PASS（2026-08-29 23:31 CST）。Sparkle 侧 Reconnecting 根因已闭合；若仍断连需查 Cursor/VPS 非 Sparkle 路径。

---

### BUG-2026-08-16-001 · macOS 26.5 GUI crash-loop · watchdog fuse broken · **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **状态** | **R6 CODE-DONE @1.30.40** · macOS 26 GUI 跳过 45s 后观测栈 · 待 install + 3min soak |
| **症状** | 1.30.39 force-GUI ~60s 仍退出（PostCoreBootstrap 45s 后 Api2ProbePlane ON → 日志截断） |
| **PRIMARY** | Electron macOS26 ARM64 V8 ThreadIsolation SIGTRAP（上游 open：#49522 / Chromium 499332110） |
| **R5** | Electron 42→43.1.0 — **部分缓解，非 100%** |
| **R6** | `shouldSkipMacOs26GuiPostCoreObservabilityStack` — GUI 路径跳过 Api2ProbePlane / agentTransportFailureSync / networkPathMonitor |
| **R4** | macOS 26 默认 headless（代理不断） |
| **验证** | 单测 + force-GUI 180s 无 crash + 日志含 `observability stack skipped` |

---

### BUG-2026-08-15-001 · macOS 26.5 GUI SIGTRAP · V8 ThreadIsolation · **CODE-DONE**

| 字段 | 内容 |
| --- | --- |
| **状态** | **CODE-DONE**（git）· 待 `agent:upgrade:mac` 装包 + 48h soak |
| **症状** | macOS 弹「Sparkle 意外退出」· DiagnosticReports `EXC_BREAKPOINT/SIGTRAP` · 8/14+8/15 栈 100% 相同 |
| **根因** | Electron 42 / V8 `ThreadIsolation::JitPageReference::AllocationContaining` CHECK 失败 @ macOS 26.5 ARM64（同族 electron#49522） |
| **放大** | `corePermissionMode: elevated` → GUI 崩溃连带 mihomo 子进程死亡；主进程 hot path async fs（log.ts stat 回调） |
| **修复** | ① LaunchAgent GUI watchdog（`scripts/sparkle-gui-watchdog.sh` + crash-loop 熔断）② macOS≥26 自动 `corePermissionMode: service` + `disableGPU` ③ log.fs 热路径改 sync + 内存计大小 ④ 正常退出写 `gui-graceful-quit.stamp` |
| **禁止** | ❌ 依赖 in-process `app.relaunch()` 处理 SIGTRAP（进程已被 exc handler 杀死） |
| **验证** | 单测 PASS · 装包后 `launchctl print gui/$UID/com.sparkle.gui-watchdog` · 模拟 SIGTRAP 后 mihomo 仍活（service mode）· GUI 10s 内自动 reopen · 48h DiagnosticReports 零新增或 ledger 有记录且代理不断 |

---

### BUG-2026-08-07-001 · JP-VPS leaf 全红 + SSH ban · OOM reboot · **FIXED @1.30.32**

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（VPS 加固 + Sparkle 1.30.32 装包）· byte-death gate **PENDING**（marathon 中） |
| **发生版本** | Sparkle **1.30.31 hot-patch** → **1.30.32 prod** · JP-VPS Tokyo 1GB |
| **A 时刻** | ~09:47 CST VPS 整机 reboot（`uptime -s` 2026-08-07 01:46:49 UTC） |
| **PRIMARY** | **VPS OOM** → reboot → HY2 父链僵死 → UI 四 leaf delay=0 |
| **amplifier** | `VpsL4Probe` 300s SSH + 手动诊断 SSH → **fail2ban**（maxretry=3）→ Mac IP DROP |
| **NOT** | cron/timer 重启 sing-box · TUN 常态 +200ms 加税 · 切节点问题 |
| **修复** | VPS：`/swapfile` 2.3G · swappiness=10 · fail2ban ignoreip IPv6+IPv4 maxretry=10 · Sparkle：`VpsL4Probe` SSH 失败≥3 → 3600s 间隔（`vpsL4ProbeCore.ts`） |
| **验证** | ssh jp-vps OK · api2 VPS ~0.5s · Mac :7890 ~1.0s · `connect_path_delay_ms=284` · sing-box active 未重启 |
| **复发条件** | swap 被删 / fail2ban 白名单丢失 / 回滚 1.30.31 且无 backoff / 新 OOM（>2GB 压力） |
| **踩坑** | 密码 SSH 已禁用（`prohibit-password`）· 面板 root 密码**仅 Console** · Agent SSH 重试会**续封** fail2ban |

**如何避免：** 1GB VPS 必须有 swap · VpsL4Probe 禁 hammer · 诊断 SSH 用 backoff · 勿把 leaf 全红当 sing-box 定时重启。

---

### BUG-2026-08-06-001 · C-8.11 @1.30.31 · 18:20 CST · collateral close 新暴露 · **非 ghost_udp 复发**

| 字段 | 内容 |
| --- | --- |
| **状态** | **NEW FAILURE MODE** · execute 链路通（`closed_count=38` post-install）· **marathon SSE 被手术关流** · G3 **0%** |
| **发生版本** | Sparkle **1.30.31** · Cursor **3.1.15** · leaf **JP-VPS-HY2** |
| **A 时刻** | **18:20:07 CST** `closed_count=4` · **18:36:00 CST** `closed_count=1` |
| **PRIMARY** | **L3** C-8.11 byte-death leaf close → `mihomoCloseConnection` → agent SSE RST → Included 碎片计费 |
| **amplifier** | `udp_full_scan=0` 全程 · parent 未 mutate · byte-death **每 ~90s 复发** |
| **amplifier 2** | `TypeError: mihomoGetConnections is not a function`（dynamic import 打包丢失）· stale snapshot 选 target |
| **VPS @ A** | sing-box `stream canceled by **remote**` @ 18:21:21 · conntrack 565/7680 · **非 VPS 踢连接** |
| **NOT** | max-steps-cap · ghost_udp（1.30.31 已删）· probe_only 假成功 · VPS 宕机 |

**Goodhart 证据：** G2 目标 `closed_count>0` 达成 → 用户目标（G3 attemptRate≥90%、单次 userMessage 长跑）**更差**（20×Included 碎片）。

**待修复 C-8.12：** ~~static import mihomoApi · collateral gate（禁关 active_inner SSE）· udp_full_scan=0 三轮后 parent birth reset · G3 gate 作 ship 硬门槛~~ → **CODE-DONE @1.30.32**：udp absent → `reset_parent_chain_birth`（禁 leaf close）· refresh fail abort · verify gate 拒 collateral。

### C-8.12 @1.30.32 · collateral gate · **CODE-DONE 待装**

| 字段 | 内容 |
| --- | --- |
| **状态** | **CODE-DONE** · 单测 PASS · **未装 prod** · G2/G3 **PENDING** |
| **修复** | `udp_full_scan=0` → `reset_parent_chain_birth` 替代 `close_leaf_connections` · 删除非 frozen fallback · static `mihomoGetConnections`/`mihomoCloseConnection` · refresh fail 立即 abort |
| **ship gate** | verify-byte-death：拒 `closed_count>0 && udp_full_scan=0` · 接受 `reset_parent_chain_birth` 为有效 R2 |

**禁止声称 FIXED** 直至：G2 PASS（post-install window only）+ G3 attemptRate≥90% + 30min soak 零 collateral ECONNRESET。

---

### BUG-2026-08-06-001 · recurrence · RIDs 0708f0d4 / b1f8b685 / 7420f6dc · 15:33+15:46 CST · prod **1.30.26** · 同族 **第 15+ 次**

| 字段 | 内容 |
| --- | --- |
| **状态** | **RECURRENCE definitive** · 1.30.13–1.30.17 链路 **未闭合** · **假修复路径 ghost_udp** 在高 conn 暴露 |
| **发生版本** | Sparkle **1.30.26**（`/Applications` 实测）· Cursor **3.1.15** · leaf **JP-VPS-HY2** |
| **A 时刻** | **A1** 2026-08-06 **15:33:29 CST**（07:33:29 UTC）五路批量 · **A2** **15:46:38 CST**（07:46:38 UTC）两路（0708+7420 重试代） |
| **RID 映射** | `b1f8b685`→composer `d167548f`（A1）· `0708f0d4`→`224b8673`（A1+A2）· `7420f6dc`→`b1f07aad`（A1+A2）· 注：generationUUID 非 originalRequestId |
| **PRIMARY** | **L3** JP-VPS-HY2 global byte-death（`max_byte_stall_ms=286504` @A1 · `161994` @A2）→ Connect TLS 批量 ECONNRESET |
| **amplifier（本次新暴露）** | `findOldestHy2UdpOutboundConnectionId` → **no_udp_outbound** @ cursor_conn=158 → 走 **ghost_udp_parent_birth_reset**（仅 birth reset · **无 UDP close**）→ `Hy2ParentSidecar sidecar_dial outcome=failed` |
| **amplifier 2** | `MarathonRescueDial connect_partition skipped_admission err=global_control_inflight` @ 07:33:11 · 07:46:22 |
| **amplifier 3** | `MihomoQuicStallRecovery skipped reason=marathon_active_zero_data_plane_mutation` — R-34 prune 全拒 |
| **NOT** | max-steps-cap · Cursor 服务端随机 · L4 VPS（sing-box active · curl 200 · 无 restart）· L0/L1 Sparkle 误杀 |

**A 时刻证据链（节选）：**

| ts UTC | 信号 | 原文要点 |
| --- | --- | --- |
| 07:33:04 | CarrierQuiesceRefresh | `reason=ghost_udp_parent_birth_reset_before_sidecar_dial` `max_byte_stall_ms=286504` `active_inner=142` |
| 07:33:04 | Hy2ParentSidecar | `outcome=failed action=sidecar_dial` |
| 07:33:11 | MarathonRescueDial | `skipped_admission err=global_control_inflight` |
| 07:33:29 | renderer | 4× `ECONNRESET host=api2.cursor.sh` · 5 composer generation-ended |
| 07:46:20 | events snapshot | 四 leaf 同时 `delay=0` @ 15:46:20 |
| 07:46:38 | renderer | 4× ECONNRESET · 0708+7420 generation-ended |

**对比成功 vs 失败（同文件同日）：**

| 时刻 | max_byte_stall | active_inner | Recovery 路径 | 结果 |
| --- | --- | --- | --- | --- |
| 02:24:30 UTC | 120503 | 15 | `carrier_quiesce_parent_udp_refresh` + `close_udp_outbound` | bytes 恢复 |
| 07:33:04 UTC | 286504 | 142 | **ghost_udp** + sidecar_dial failed | 五路断连 |

**为何 1.30.16/1.30.17「修完」仍复发 — 不是骗你，是半修复被当全修复：**

1. **1.30.13–15** 只开了 bypass **判定**，R2 execute 链路未通（BUG-2026-08-05-001 已记录 gate FAIL）
2. **1.30.16** 修 age gate，但 **未覆盖** `no_udp_outbound` 分支（`hy2ParentSidecar.ts` L350-372 ghost 回退）
3. **1.30.17+** 未加 integration test：`active_inner≥100` + byte-death + `no_udp_outbound` → 必须 real UDP refresh
4. **Ship 纪律违反**：git CODE-DONE / 单测 PASS 被当作「100% 修完」· **G2 gate + G9 soak 从未 PASS** · prod 1.30.26 仍走 ghost 路径

**同族反复统计更新：** HY2 byte-freeze/split-brain **第 15+ 次** triage · 针对 active_inner/R2 的 coded fix **第 6 轮**（1.30.6→…→1.30.17→**1.30.26 仍 FAIL**）· **0 次** G9 soak PASS · **0 次** gate PASS 后交付

**待修复（1.30.28 目标 · 未 CODE-DONE）：**

① byte-death + `no_udp_outbound`：**禁止** ghost_udp 回退 · 强制 alternate parent UDP discovery 或 mihomo 全量 scan UDP outbound  
② `connect_partition` + stale_rids：**绕过** `global_control_inflight`（rescue 永不 defer）  
③ byte-death + frozen_quic + connect_ping_failures≥4：允许 R-34 frozen surgical prune（override `marathon_active_zero_data_plane_mutation`）  
④ integration test + `verify-byte-death-recovery-gate.mts` 新增 case：`cursor_conn≥150` + bytes≥90000  
⑤ triage 脚本补扫 `Cursor-3.1.15-data/logs`

**踩坑（给后续的人）：**

- `ghost_udp_parent_birth_reset` 日志看起来像 Recovery executed，**实际零数据面 mutation** — 比不修更误导
- `carrier_recovered=1` + probe 283ms 绿 **≠** Connect 长流活着 — split-brain 仍是 PRIMARY 症状
- **唯一「修完」定义**：gate PASS + post-incident max_byte_stall 降 ≥50% + G9 attemptRate≥90% — 缺一禁止说修完

---

### META · 2026-08-05 诚实审计 — 改了多少版？为何越修越严重？

| 指标 | 实测 |
| --- | --- |
| **1.30.x 微版本（8/4–8/5）** | **1.30.0 → 1.30.15** = **16 个 commit 级 fix**（含 1.30.3 Plane B · 1.30.6 CarrierQuiesce · 1.30.12 SEL proof · 1.30.13–15 byte-death bypass） |
| **生产 `/Applications` 实际版本** | **1.30.15**（8/5 **16:13:56 CST** 安装 · `PostCoreBootstrap` @ 08:13:56 UTC） |
| **同族 HY2 byte-freeze 复发** | **第 14+ 次** triage（自 BUG-2026-07-20-001 起）· **装 1.30.15 后仍 byte-frozen** |
| **8/5 单日 Included 浪费（样本）** | 夜跑 **16** + S4 日间 **10** = **26+** 行（同一 chronic 根因） |
| **G9 soak 门禁通过次数** | **0** |
| **rolling100 attemptRate @ 14:58** | **0/100** early_disconnect（`max-steps-rate-snapshot.jsonl`） |

**为何「修了个屁、越修越严重」— 不是撒谎，是机制：**

| # | 机制 | 证据 |
| --- | --- | --- |
| 1 | **半修复当全修复** | 1.30.15 已装 · `marathon_global_byte_death_bypass` **planned** ✅ · R2 **executed** ❌ · bytes **144500 未降** · 用户体感仍 = 断连 |
| 2 | **半闭环发版放大症状** | R-41 禁 inner close → freeze 饿死替代 prune kill → Included **更碎**（29s 段见 14:54:19） |
| 3 | **1.30.12 开 R1 门闩未开 R2** | stall proof bypass 让 sidecar **更频繁** · R2 仍 active_inner skip → **更频繁断连** |
| 4 | **古德哈特** | vitality/SEL `executed`↑ · RecoveryHonesty `carrier_recovered=1` + bytes 仍 144500 |
| 5 | **验收真空** | 零 G9 PASS 即当「CODE-DONE」· attemptRate 从不 blocking |
| 6 | **birth reset 假年轻** | 05:45 reset 后 age=0 · stall 仍 144500 70min+ · 运维误判「parent 年轻」 |

**重构目标对齐：** 避免「修一个冒一个」→ **gate PASS + bytes 下降 + G9 soak 作唯一「修完」条件** · 1.30.15 已装但 gate FAIL = **未修完** · 禁止再 partial ship。

**反复修复统计（本条目族）：** BUG-2026-08-05-001 单日内 **4 次爆发**（00:00 / 14:38 / 14:53 / **16:13 升级后仍 frozen**）· 1.30.1→1.30.15 **16 次微 fix** · **1 次** 装包后 gate 验证 **FAIL** · **0 次** G9 PASS。

**Sparkle 修复完了吗？— 诚实答案：没有。**

| 验收项 | 1.30.15 @16:13 后 | 通过？ |
| --- | --- | --- |
| `/Applications` = 1.30.15 | ✅ | ✅ |
| `marathon_global_byte_death_bypass_active_inner` | 08:17–08:19 连续 planned | △ 门闩开 |
| R2 `parent_udp_refresh outcome=executed` | **0 条** post-upgrade | ❌ |
| `max_byte_stall_ms` 30s 内 <45000 | 仍 **144500**（+ CarrierQuiesce 观测 276552） | ❌ |
| `verify-byte-death-recovery-gate.mts --minutes 15` | **FAIL** | ❌ |
| G9 soak attemptRate≥90% | 未跑 / 0 PASS | ❌ |

---
### BUG-2026-08-05-001 · v1.30.1（生产）· 8/5 00:00–03:00 CST 夜跑 · 16 Included 碎计费 + 1.72M tok/段（同族第 11+ 次）

| 字段 | 内容 |
| --- | --- |
| **状态** | **PARTIAL @1.30.15 已装（16:13 CST）** · bypass ✅ · bytes/R2 ❌ · **待 1.30.16 + G9 soak + gate PASS** |
| **发生版本** | Sparkle **1.30.1** · Cursor **3.1.15** · Guard **0.17.3** · leaf **JP-VPS-HY2** |
| **事故窗口** | 2026-08-05 **00:00–03:00 CST**（UTC 2026-08-04 16:00–19:00）· Dashboard **16 Included** · 均 **~1.72M tok** · ≥30M/40M/50M **0%** |
| **composer 样本** | `2758ce91-877b-425b-a90a-f144285ff81f` — **35** unique `originalRequestId` · 全部 **attempt=0** |
| **PRIMARY 根因** | **L3** — Mac→JP-VPS-HY2 **HY2 parent QUIC 链 4.1h+ 未轮换**（`hy2_parent_chain_birth_ms=1785844384050` 自 8/4 11:53 起单调老化）→ **silent byte-freeze** → Connect SSE `silent_generation_end` |
| **amplifier L7** | `marathon_active=0`  while `cursor_conn=16` → **4h proactive sidecar gate 失效** · `Hy2ParentSidecar outcome=failed` **18/19** |
| **amplifier L2** | Guard `night_auto_continue` trigger=`sparkle_critical_stall` → 每条 Continue = **新 Included 行**（非用户手动发 16 次） |
| **NOT** | max-steps-cap（`earlyDisconnectAttempts=98/100` `attemptRatePct=2%`）· Cursor 服务端随机 · VPS sing-box crash（@A SSH 0 ERROR）· Sparkle TUN 系统性加延迟（HY2 p50=308ms）· frozen_surgical_prune 误杀（8/5 日志 **0 次** — R-41 生效） |
| **证据链** | `app-2026-8-5.log:1,4,5,10,113` · `agent-transport-failures.jsonl` silent_generation_end **136** 条 · `max-steps-rate-snapshot.jsonl` attemptRate=**2%** · validated-ledger median segment **1533975ms（~25.5min）** |
| **与旧案关系** | **同族第 11+ 次** HY2 byte-freeze/split-brain（延续 BUG-2026-08-04-001 · BUG-018 · BUG-014）· **R-41 改变症状未改根因**（从 prune kill → freeze 饿死） |

**「15–25 分钟」澄清（纠正 2026-08-05 早先表述）：**

| 指标 | 实测 | 含义 |
| --- | --- | --- |
| `MihomoQuicSilentStall` 观测间隔 p50 | **~0.78 min** | byte-freeze **检测**频率（604 次/夜） |
| `RecoveryHonesty ineffective` 间隔 p50 | **~0.48 min** | rescue 短探针频繁失败 |
| Dashboard Included 段寿命 median | **~25.5 min** | **SSE _carrier 早死 → 计费切段**频率 |
| 以前 3000万+ 单段 | **~117 min**（BUG-018 50.07M tok） | parent chain 未老化或断连更少 |

**不是「某次改坏了 freeze 周期」— 是 chronic 根因 + 近期放大器叠加：**

| 时间/版本 | 改了什么 | 对 8/5 的影响 |
| --- | --- | --- |
| **≤1.28.x** | HY2 马拉松 + parent rotation **Plane B 半闭环**（BUG-015） | 根因已存在；57h chain 先例 |
| **1.29.0 R-41** | 禁 critical host close | 8/5 **零 prune** ✅ · 但 SSE 改由 freeze 饿死，Included 仍碎 |
| **1.29.1 @8/4 14:50** | `protocol_upgrade_executed` HY2→TLS | TLS reset 放大；parent chain 未刷新 |
| **1.30.0 MTIC-v2** | 禁马拉松中 HY2→TLS | 阻止恶化，**不 heal 已有 4h chain** |
| **1.30.1 HY2-only** | 冷启动 TLS→HY2 | 协议层稳定 ✅ · **Plane B / marathon_truth 未修** |
| **未装 1.30.2** | purge TLS canary | 与 8/5 PRIMARY 无关 |

| **待修复（1.30.3 目标）** | ① `marathonSSETruthCore`：`cursor_conn≥12` → `marathonTruthActive=true` ② `hy2ParentSidecar`：emergency **close_udp_outbound upstream** + vitality redial ③ `dialAdmissionArbiterCore`：`emergency_parent_refresh` bypass ④ `recoveryHonestyCore`：carrier byte 恢复判据 ⑤ `observability_probe` admission 分级 ⑥ G9 pre-install + soak `attemptRate≥90%` ship gate |
| **修复版本** | **FIX CODE-DONE @1.30.3**（2026-08-05）· **待 cursor_conn=0 upgrade:mac + G9 soak 40min** |
| **验证方式** | G9 soak strict ≥40min · `[MaxStepsRate] attempt_rate_pct≥90` · 零同窗 silent_generation_end · marathon 中 `parent_chain_age<4h` · Dashboard 单段 ≥30M 命中率恢复 |
| **会导致什么** | 16×Included 碎计费 · 均 1.72M tok · ≥30M 阈值 0% · attemptRate 2% |

**同族反复反思（为何修上百次仍复发）：**

| 机制 | 问题 |
| --- | --- |
| **半闭环发版** | R-41/MTIC/HY2-only 修 **症状层**（禁 close/禁 TLS switch）· **Plane B parent upstream 自 R-35 起 CODE-DONE 但 dial 18/19 failed** |
| **古德哈特** | `vitality_dial executed` / SEL `executed` 计数涨 · 8/5 **387 ineffective vs 5 success** · `attemptRate` 仍 2% |
| **测量衰减** | sidecar `executed` 可 reset birth_ms · 物理 UDP 链未换 · parent_chain_age 日志可「假年轻」 |
| **向上失明** | 目标应是 **单段 SSE ≥90min · ≥30M tok** · 优化 rescue executed 而非 segment 寿命 |
| **验收真空** | 零 G9 soak PASS 即 ship · rolling100 **2%** 非 blocking |

**踩坑（给后续维护者）：**

1. **「15–25 min byte-freeze」是错误表述** — freeze 检测 ~47s 级起，**计费切段 ~25min** 是 SSE 累积死亡，别混口径。
2. **`marathon_active=0` + `cursor_conn>0`** 等于 proactive rotation 全灭 — 查 stall 必先查此 gate。
3. **`Hy2ParentSidecar outcome=failed`** 不是无动作 — SEL 在跑但 **upstream 未接** 等于假修复。
4. **R-41 生效 ≠ 马拉松稳定** — 只保证不被 Sparkle kill，不保证 HY2 QUIC 不断粮。
5. **装 1.30.1/1.30.2 ≠ Plane B 闭环** — 必须 G9 数字说话。

**反复统计更新：** HY2 byte-freeze/split-brain 同族 **第 13+ 次** triage · 1.30.0–1.30.15 **16 微版本** partial fix · **0 次** G9 soak 门禁通过 · prod 滞后 git **3 版本**（1.30.12 vs 1.30.15）。

---

### BUG-2026-08-05-001 · recurrence · S4 `dd04a4d2` · 14:38–14:58 CST · v1.30.12（生产）· 同族日内第 2–3 次爆发

| 字段 | 内容 |
| --- | --- |
| **状态** | **PARTIAL @1.30.15 已装** · 1.30.13 bypass 生效 · R2/bytes 未闭环 · 待 1.30.16 |
| **发生版本** | Sparkle **1.30.12** · Cursor **3.1.15**（`Cursor-3.1.15-data`）· Guard observe-only · leaf **JP-VPS-HY2** |
| **事故窗口 A** | 2026-08-05 **14:38–14:43 CST**（UTC 06:38–06:43）· **5 Included** |
| **事故窗口 B** | 2026-08-05 **14:53–14:58 CST**（UTC 06:53–06:58）· **5 Included** |
| **composer** | **S4** `dd04a4d2-b002-4826-a866-2dd95c29c91f` · **同一 userMessage 马拉松** |
| **PRIMARY（最底层可修复）** | **L3** — `max_byte_stall_ms=144500` 自 **05:45 UTC** 起饱和 **>70min** → R2 `parent_udp_refresh` **skip** `active_inner_critical_flows`（`carrierQuiesceRefreshCore` 4h gate · prod 无 `marathon_global_byte_death`） |
| **amplifier** | R1 vitality/sidecar `executed` 但 `RecoveryHonesty ineffective` · `connection_recovery_cooldown` 叠加 · birth reset 后 age=0 但 stall 仍 144500 |
| **NOT** | max-steps-cap · Cursor 3.1.15 服务端 · VPS sing-box @A · 315 补丁（observe-only SSE audit）· 用户手动连发 10 条 |

**genUUID 链（renderer @ `20260805T141929/window1/renderer.log`）：**

| CST | 切换 | generation-ended |
| --- | --- | --- |
| 14:38:44 | 603de15e→8a7db0f8→… | （见 §M.0.22） |
| 14:53:50 | 5cce370c→**e56b8844** | wakelock id=10 |
| 14:54:19 | e56b8844→**41145997** | wakelock id=11 · **寿命 29s** |
| 14:57:49 | 41145997→**8333b62c** | wakelock id=12 |
| 14:58:48 | 8333b62c→**ea82d5e4** | wakelock id=13 |

**Sparkle A 时刻铁证：**

| UTC | 日志 |
| --- | --- |
| 06:39:14 | `[StallEscalationLadder]: skip parent_udp_refresh reason=…active_inner_critical_flows stall_ms=177001` |
| 06:41:29 | 同上 stall_ms=291498 |
| 06:43:29 | 同上 stall_ms=207497 |
| 06:54:25 | 同上 stall_ms=261000 + `connection_recovery_cooldown` |
| 06:58:29 | 同上 stall_ms=125496 |

**fix 链（git · 未装）：**

| 版本 | commit | 修复什么 | 遗漏什么 |
| --- | --- | --- | --- |
| **1.30.13** | `4ef6eea` | `isMarathonGlobalByteDeath()` → bypass active_inner @ byte-death | R2 执行后 bytes 是否真降 — 需 gate 验 |
| **1.30.14** | `644acc9` | byte-death 期间 bypass SEL/rotation/connection cooldown · defer birth reset | recovery 风暴风险（C-2 待做） |
| **1.30.15** | `56575ea` | bypass sidecar_action_cooldown · `verify-byte-death-recovery-gate.mts` | 无 full integration e2e · 无 G9 PASS |

**导致了什么（若误装 1.30.12 而未升级）：** 1.30.12 的 stall proof bypass **只加强 R1** · R2 仍 skip → **断连频率可高于 1.30.11**。

**踩坑：**

1. **「又断连 = 新 bug」** — 本次与 14:38 **同一 chronic 状态机**（05:45 起 stall=144500），不是新根因。
2. **装 1.30.12 ≠ 修 R2 skip** — 1.30.12 修 SEL 门闩 · **未修** quiesce 4h active_inner。
3. **git CODE-DONE ≠ 用户体感** — 必须 `/Applications`=1.30.15 + gate PASS 才算交付。
4. **Continue/自动续跑不能替代不断连** — 每 genUUID = Included · 目标是 **R2 在断连前解冻**。

**同族反复次数：** 本 BUG 条目 **日内 3 次**（00:00 / 14:38 / 14:53）· 全族 **第 13+ 次** · 1.30.13–15 为 **第 4 轮**针对 active_inner skip 的 coded fix（前序：1.30.6 CarrierQuiesce · 1.30.8 emergency 8h · 1.30.12 stall proof — 均 partial）。

**如何避免再翻车：** ① upgrade 1.30.15 一次 ② gate.mts 15min **FAIL=不交付** ③ G9 40min attemptRate≥90% ④ FAIL 则继续修到 PASS，**禁止让用户当小白鼠反复试 partial fix**。

---

### BUG-2026-08-05-001 · recurrence · 1.30.15 安装后 · 16:13–16:19 CST · **PARTIAL FIX — 未修完**

| 字段 | 内容 |
| --- | --- |
| **状态** | **PARTIAL @1.30.15 已装** · bypass 门闩 ✅ · **bytes 未恢复** · R2 未 executed · **待 1.30.16+** |
| **发生版本（升级前）** | Sparkle **1.30.12** · 同 chronic `max_byte_stall_ms=144500` 自 05:45 UTC |
| **安装版本** | Sparkle **1.30.15**（commit `56575ea`）· 安装 **2026-08-05 16:13:56 CST**（UTC 08:13:56 `PostCoreBootstrap`） |
| **事故窗口** | 升级后 **16:13–16:19 CST**（UTC 08:13–08:19）· marathon 多路仍 byte-frozen |
| **PRIMARY（未消除）** | **L3** — inner HTTP/2 carrier byte-death **持续** · `TransportLongevityTruth max_byte_stall_ms=144500` 70min+ 未降 |
| **1.30.13–15 已解决部分** | `carrierQuiesceRefreshCore` → `reason=marathon_global_byte_death_bypass_active_inner` · **不再** `active_inner_critical_flows skip`（08:17–08:19 连续 planned） |
| **1.30.13–15 未解决部分** | R2 仅 `CarrierQuiesceRefresh outcome=planned` · **零** `[Hy2ParentRotation]: outcome=executed` / `parent_udp_refresh outcome=executed` post-upgrade · `token_gap_rescue outcome=ineffective` 连发（`carrier_recovered=1` + `gap_reduced_enough=0`） |
| **1.30.16 根因（代码实锤 · 先前遗漏）** | `hy2ParentSidecar.ts` `resolveProactiveUdpClosePlan` L92-97：**4h proactive rotate age gate 在 carrier quiesce bypass 之前** · birth reset 后 `http_parent_chain_age_ms=0` → `rotatePlan.action=none` reason=`session_and_http_chain_below_proactive_rotate` · 但 L183-196 仍打 `outcome=planned`（**日志假阳性**）→ `shouldAct=false` → 永不 close UDP |
| **amplifier（Guard · 跨仓）** | 16:15:07 Guard `night_auto_continue` ×4 composer trigger=`silent_stop`（Sparkle 重启闪断 **71s** 后）· 用户体感「没点发送自动续跑」— **非 Sparkle bug 但浪费 Included** |
| **NOT** | max-steps-cap · Cursor 服务端随机关流 · VPS sing-box crash · 用户手动 Send |

**post-upgrade 铁证（`app-2026-8-5.log`）：**

| UTC | 日志 | 含义 |
| --- | --- | --- |
| 08:13:56 | `[PostCoreBootstrap]: mihomo API ready` | 1.30.15 进程启动 |
| 08:14:58 | `token_gap_rescue outcome=success gap_reduced_enough=1` | 重启后短暂成功 |
| 08:15:33+ | `token_gap_rescue outcome=ineffective` ×N | bytes 再次 frozen |
| 08:17:44+ | `CarrierQuiesceRefresh reason=marathon_global_byte_death_bypass_active_inner outcome=planned` | **1.30.13 fix 生效** |
| 08:18:31 | `TransportLongevityTruth max_byte_stall_ms=144500 http_parent_chain_age_ms=0` | **bytes 未降** · birth reset 后 age=0 与 stall 144500 分裂 |
| 08:19:28 | `token_gap_nudge outcome=attempted_on_stale_rid max_gap_ms=4551894` | rescue 仍 ineffective |

**G2 门禁（刚跑）：** `verify-byte-death-recovery-gate.mts --minutes 15` → **FAIL** · `08:08:14 R2 still blocked by active_inner`（含升级前窗口）

**版本改了什么 / 修复了什么 / 遗漏了什么：**

| 版本 | 改了什么 | 修复了什么 | 遗漏了什么 | 导致了什么 |
| --- | --- | --- | --- | --- |
| **1.30.13** | `isMarathonGlobalByteDeath()` bypass active_inner | quiesce **判定** 不再 parent≥4h 拒绝 | planned→executed 执行链未通 | bypass 日志有了，bytes 仍死 |
| **1.30.14** | cooldown/birth-reset bypass @ byte-death | 减少 R2 被 cooldown 挡 | R2 仍不 execute | 可能加剧 recovery 风暴 |
| **1.30.15** | sidecar cooldown bypass + gate 脚本 | 装包后可自动验 | **无** R2 execute 集成测 · **无** bytes 恢复判据 hard gate | 用户以为「修完了」实际 semi-fix |

**同族反复次数：** 本 BUG **日内第 4 次爆发** · 全族 **第 14+ 次** · 针对 active_inner skip 的 coded fix **第 5 轮**（1.30.6→1.30.8→1.30.12→1.30.13–15）· **装包后首次 gate 验证仍 FAIL**

**为何同样 bug 翻来覆去修不好（反思）：**

| # | 根因 | 说明 |
| --- | --- | --- |
| 1 | **修 gate 不修 execute** | 1.30.13 bypass 在 `carrierQuiesceRefreshCore` · **`resolveProactiveUdpClosePlan` 仍有前置 4h age gate**（L92-97）· planned 日志误导 |
| 2 | **古德哈特验收** | `carrier_recovered=1` / bypass planned 当成功 · bytes 144500 不变 |
| 3 | **测量分裂** | CarrierQuiesce 见 stall 276552 · TransportLongevityTruth 卡 144500 · age=0 与 marathon context 分裂 |
| 4 | **16 微版本无 soak blocking** | 零 G9 PASS 即 ship partial fix |
| 5 | **升级本身触发断连** | 16:13 重启 → Guard auto-continue → 用户体感恶化（跨仓 Guard 0.17.6 待修） |

**踩坑（给后续维护者）：**

1. **「1.30.15 已装 = 修好了」是谎言** — 必须 gate PASS + max_byte_stall 下降 + G9 soak。
2. **bypass planned ≠ R2 executed** — grep 必须三条：`bypass_active_inner` + `parent_udp_refresh executed` + `max_byte_stall_ms<45000`。
3. **RecoveryHonesty carrier_recovered=1 不可信** — 必须 `gap_reduced_enough=1` 且 renderer generation-ended 不再连发。
4. **Sparkle 升级会闪断 marathon** — 升级窗口 Guard 应 suppress auto-continue（非 Sparkle 仓但影响 Included）。
5. **下一 fix 目标 1.30.16** — 闭合 planned→executed 链路 + recoveryHonesty 硬判据 + failing integration test「bypass 后 30s bytes 必降」。

**待修复（1.30.16 目标 · CODE-DONE git · 未装）：**

① ~~`resolveProactiveUdpClosePlan` L92-97 age gate 在 byte-death 时跳过~~ ✅ `hy2ParentSidecar.ts` @1.30.16  
② ~~planned 日志假阳性~~ ✅ 仅 `rotatePlan=close_udp_outbound` 时打 planned  
③ `hy2ParentSidecarUdpClosePlan.test.ts` 3 cases PASS  
④ 待装包 + 重启：`verify-byte-death-recovery-gate.mts` PASS + G9 soak 40min  
⑤ recoveryHonesty 硬判据（后续 1.30.17 如 gate 仍 FAIL）  

---

### BUG-2026-08-05-001 · fix · 1.30.16 · resolveProactiveUdpClosePlan age gate · CODE-DONE

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.30.16**（git）· prod **1.30.15** · **待您说「可以重启」后装包验收** |
| **修复什么** | `hy2ParentSidecar.ts` `resolveProactiveUdpClosePlan`：`isMarathonGlobalByteDeath()` 时跳过 L92-97 4h age gate + L99-101 rotate cooldown；`runHy2ParentSidecarIfDue` planned 日志仅 rotatePlan=close_udp 时输出 |
| **为何能抑制 PRIMARY** | 1.30.13 bypass 判定 true 但 age=0 仍卡 rotatePlan=none → 1.30.16 闭合 planned→close_udp 链路 |
| **测试** | `hy2ParentSidecarUdpClosePlan.test.ts` 3/3 PASS · carrierQuiesce 6/6 PASS |
| **遗漏** | recoveryHonesty 古德哈特 · Guard upgrade quiesce（跨仓 0.17.6）· G9 soak 未跑 |
| **会导致什么（若误报修完）** | 用户继续浪费 Included · gate FAIL 被忽略 |

**踩坑：** bypass planned 日志 ≠ R2 executed — 1.30.15 因此误判 semi-fix 为 progress。

---

### Marathon HY2-only @1.30.1 · 2026-08-04 14:50 definitive class-fix

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.30.1** · **待 cursor_conn=0 upgrade:mac** |
| **A 时刻** | 2026-08-04 **14:50:09 CST** · Sparkle 1.29.1 install → `protocol_upgrade_executed` HY2→TLS |
| **PRIMARY** | **L7** `MarathonProtocolContract` + `cursorDedicatedDefault` SSOT treated HY2 as suboptimal → auto TLS canary |
| **amplifier** | **L3** JP-VPS-TLS `:18443` — agent-transport-failures **1054** tls-reset vs HY2 **152** |
| **symptom** | auth/analytics TLS handshake ERROR · generation 提前结束 → 额外 Included 计次 |
| **NOT** | Cursor 服务端 · max-steps-cap · ghost double-billing |
| **修复** | `marathonHy2OnlyCore.ts` — deny all HY2→TLS · cold-start TLS→HY2 downgrade · `CURSOR_DEFAULT_VPS_NODE=JP-VPS-HY2` |
| **验证** | `marathonHy2OnlyCore.test.ts` · `marathonProtocolContractCore.test.ts` HY2-only matrix · asar gate `MarathonHy2Only` |
| **Ship** | upgrade:mac **1.30.1** · G9 soak |

### MTIC-v2 @1.30.0 · transport mutation gate · 2026-08-04 14:50 recurrence class-fix

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.30.0** · **待 cursor_conn=0 upgrade:mac** |
| **A 时刻** | 2026-08-04 **14:50:09 CST** · Sparkle 1.29.1 install cold restart |
| **PRIMARY** | **L7** `MarathonProtocolContract protocol_upgrade_executed` HY2→TLS @ `cursor_conn=0` while HY2 parent chain age **576s+** + quarantine **554s** remaining |
| **symptom** | JP-VPS-TLS auth/analytics TLS handshake ERROR 簇 · marathon SSE 仍在 HY2 |
| **NOT** | Cursor 服务端 · max-steps-cap · R-41 close regression |
| **修复** | `transportMutationGateCore.ts` — deny protocol_upgrade when quarantine / hy2_parent_chain / stale_rids / cursor_conn / marathon_truth |
| **验证** | `transportMutationGateCore.test.ts` 12-state matrix + 14:50 replay · `marathonProtocolContractCore.test.ts` MTIC block case |
| **Ship** | upgrade:mac **1.30.0** · asar gate `TransportMutationGate` + `mtic_v2_transport_mutation_gate` · G9 soak |

### BUG-2026-08-04-001 · v1.28.7（生产）· RID 5f587792 / conn f1ee553d · HY2 stall + observation_fallback（同族第 10+ 次）

| 字段 | 内容 |
| --- | --- |
| **状态** | **definitive 定责** · R-40/R-40b **FIX CODE-DONE @1.28.9** · R-41/R-41b **FIX CODE-DONE @1.29.0** · **prod 1.28.7 零生效** |
| **A 时刻** | 2026-08-04 **10:04:00 CST**（UTC 02:04:00） |
| **RID** | `5f587792-788d-4188-a82c-913e1464a5f5`（generation UUID · stale_rid 追踪至 13:10 仍为僵尸条目） |
| **conn** | `f1ee553d-5cb7-4db4-80bc-84489bff9acb` · host **api2.cursor.sh** · leaf **JP-VPS-HY2** |
| **PRIMARY** | **L3** HY2 byte-freeze stall_ms=**208996**（upload/download 冻结 2458/4972） |
| **L7 aggravator** | Sparkle **1.28.7** `close_connection reason=frozen_surgical_prune close_target_source=observation_fallback` |
| **precursor** | 02:02:00 同 conn stall 88499ms → vitality_dial **无效**（字节不变）→ 121s 空窗无 escalation |
| **NOT** | max-steps-cap（rolling100 rate=1%）· Cursor 服务端随机 · VPS sing-box error（SSH @A±2min **0 ERROR** · 400 hy2 conn/min）· Sparkle TUN 加税（LatencyTruth delta=**−245ms** high=0） |
| **VPS @ A** | jp-vps sing-box active 5d+ · conntrack 678/1M · api2 curl 200/501ms @B |
| **jsonl 缺口** | `agent-transport-failures.jsonl` **无本 RID** — Sparkle close 抢先于 Cursor terminal 事件 |
| **单日复发** | 8/4 全天 **24+** 次同类 `observation_fallback close api2`（~每 5min） |
| **修复** | R-40 deny_unbound + persist birth + sidecar execute + R-40b auto TLS · **R-41 SEL + R-41b jsonl/gate CODE-DONE** |
| **证据** | `app-2026-8-4.log:10438,10467,10468` · Master SSOT §M.0.19–§M.0.20 · triage `~/Desktop/cursor-triage-5f587792-*` |
| **Ship** | ① upgrade:mac **1.29.0**（R-40+R-41 同包）② G9 soak strict |

**踩坑**：vitality_dial executed ≠ bytes 恢复 · marathonTruth 脱节走 generic close · sidecar 4h 阈值对 88s stall 无效 · 装 repo 不装 pkg = 零修复 · Dashboard RID 在 stale 列表 ≠ 新断连时刻。

**同族反复反思**：第 10+ 次 HY2 stall — 根因是 **binary vitality/close 无 escalation ladder** + **critical host close dead path 未删** + **无 G9 ship gate**。R-41 目标：最后一次。

### R-41 @1.29.0 · Stall Escalation Ladder · CODE-DONE

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.29.0** · **待 cursor_conn=0 upgrade:mac** |
| **核心** | `stallEscalationLadderCore.ts` — vitality 无效 → 60s emergency sidecar → 90s parent UDP refresh → **永不禁关 critical inner** |
| **plan 层** | `frozenSurgicalPruneCore` — critical host 永不返回 `close_frozen_connection` |
| **sidecar** | `hy2ParentSidecarCore` — `emergencyStallEscalation` 绕过 4h/marathon inactive |
| **recovery** | `mihomoQuicSilentStallRecovery` — vitality byte snapshot + SEL execute + close 双层 block |
| **验证** | `stallEscalationLadderCore.test.ts` f1ee553d replay · `frozenSurgicalPruneCore.test.ts` R-41 8 cases · **26/26 unit PASS** |
| **依赖** | R-40/R-40b 同包 @1.29.0 升级 |

### R-41b @1.29.0 · SEL jsonl + asar gate hardening · CODE-DONE

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.29.0** · **待 cursor_conn=0 upgrade:mac** |
| **jsonl** | `stallEscalationLadderJsonl.ts` — SEL 事件写入 `~/.sparkle/agent-transport-failures.jsonl`（含 stale RID 追踪） |
| **gate** | `upgradeSparkleAsarGateCore.ts` — 要求 `StallEscalationLadder` + `r41_critical_host_no_close` |
| **preflight** | `sparklePostUpgradePreflightCore.ts` — R-40/R-41 marker 联合校验 |
| **验证** | `stallEscalationLadderJsonl.test.ts` · `upgradeSparkleAsarGateCore.test.ts` · `sparklePostUpgradePreflightCore.test.ts` |

### R-40b @1.28.9 · v1.28.8→1.28.9 · 2026-08-04 8/4 recurrence path

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.28.9** · **待 cursor_conn=0 upgrade:mac** |
| **A 时刻** | 2026-08-04 **02:07 CST** · `gate_skipped_manual_selection` · **02:08** `marathon_started_on_suboptimal_leaf` |
| **PRIMARY** | conn=0 时 `shouldAutoUpgradeTls` 被 stale `marathonTruthActive` 阻断 → 断连后复入 HY2 |
| **修复** | ① `resolveShouldAutoUpgradeSuboptimalIdleTls` conn=0 SSOT ② 删 `promptColdStartProtocolUpgrade` dead code |
| **证据** | `app-2026-8-4.log:10545-10546` · `marathonProtocolContractCore.ts` R-40b |
| **验证** | `marathonProtocolContractCore.test.ts` R-40b 3 cases |

### R-40 @1.28.8 · v1.28.7→1.28.8 · 2026-08-04 observation_fallback api2 close

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.28.8** · **待 cursor_conn=0 upgrade:mac** |
| **A 时刻** | 2026-08-04 **10:04:00 CST** · conn `f1ee553d` · host **api2.cursor.sh** · leaf **JP-VPS-HY2** |
| **PRIMARY** | **L3** HY2 209s byte-freeze · **L7** `frozen_surgical_prune` + `observation_fallback` 关 api2 |
| **NOT** | max-steps-cap · VPS sing-box error · partition=0 |
| **修复** | ① `deny_unbound_critical_host` ② sidecar execute ③ persist `hy2ParentChainBirthMs` ④ conn=0 auto TLS ⑤ gate phase=execute |
| **证据** | `app-2026-8-4.log:10468` · RecoveryHonesty ineffective @10473 · Master SSOT §M.0.19 |
| **验证** | unit PASS · G9 soak `attempt_rate_pct≥90` 待跑 |
| **Ship** | 四绿：preflight · unit · upgrade:mac · G9 soak |

> **2026-08-02 最新**：**R-38 @1.28.7** carrier connection SSOT（9480ace0-class）· pkg freshness bump · 文档 @ 2026-08-02

### R-38 @1.28.7 · v1.28.6→1.28.7 · 9480ace0-class HY2 stall carrier bind

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.28.7** · pkg `dist/sparkle-macos-1.28.7-arm64.pkg` · **待 cursor_conn=0 安装** |
| **PRIMARY** | R-34 prune **错连短探针**未 close **dying SSE carrier** → `marathonCarrierConnectionBindCore` RID→connectionId |
| **证据** | `9480ace0` ledger server-eof×3 · `token_gap_rescue_ineffective probe_ok=true` · pkg 1.28.6 @8/1 **无 R-38** |
| **验证** | `marathonCarrierConnectionBindCore.test.ts` 13/13 · asar 含 `registry_carrier_bound` · preflight-1280 |

### BUG-2026-07-31-018 · v1.28.0（已装）· composer_ab194449_b866a8f9_server_eof_2231 (R-34 半闭环复发 · 同族第 9+ 次)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX CODE-DONE @1.28.2 R-35′** · 待 marathon 空窗 upgrade + G9 strict soak |
| **发生版本** | Sparkle **1.28.0**（~19:17 CST upgrade 完成 · Preflight1280 8/8 PASS · hasP28b=true）· Cursor **3.1.15** · leaf **JP-VPS-HY2** |
| **事故时间** | userMessage **20:33:57 CST**（Dashboard Included 行 **20:34** = 起点）· **A 断连 22:31:09 CST** · durationMs=**7031697**（≈117min）· 50.07M tok · $38.50 |
| **RID / composer** | `b866a8f9-75ad-49a4-8062-b6d9a59203d3` · `ab194449-a760-40d1-af95-1b166096ece1` · attempt=**0** |
| **PRIMARY 根因** | **L3** — Mac→JP-VPS-HY2 **HY2 马拉松 silent byte-freeze → HTTP SSE server-eof** · **25.5h 未轮换 parent chain**（`max_parent_chain_age_ms=92093505`）· split-brain（A 时刻 api2 pulse **315ms** 绿 · SSE dead） |
| **NOT** | max-steps-cap（`isMaxSteps=false`）· Cursor 服务端随机 · VPS sing-box crash（jp-vps @14:31 **408 行 0 ERROR**）· Guard execute（observe-only） |
| **R-34 为何仍失败（实锤）** | ① A-3min `MihomoQuicSilentStall` stall_ms=**46998**（47s）→ 仅 **vitality_dial**，未达 frozen_surgical_prune **120s** 阈值（`app-2026-7-31.log:33185-33187`）② 同马拉松 R-34 prune **有执行**（12:40–14:18 共 5 次）但 **未覆盖本 SSE carrier** ③ Plane E **18h parent rotation 半闭环** — chain 达 **25.5h** 仍无旁路热换（BUG-015 已知遗漏 #5） |
| **证据链** | `agent-transport-failures.jsonl:2805` · `validated-ledger-terminals.v1.jsonl` · incident bundle `~/Desktop/cursor-incident-b866a8f9-2026-07-31T1431/` · VPS SSH jp-vps sing-box @14:29–14:31 |
| **与 BUG-016/014 关系** | **同族第 9+ 次** split-brain/HY2 stall · BUG-016（13:40 @1.27.9 未装 R-34）· **本次 = R-34 装后首次 definitive 长跑复发** |
| **反复次数** | HY2/TUIC server-eof 同族 **第 9+ 次** · R-34 相关 **第 2 次**（BUG-016 预期 fix · **018 装后仍断**） |
| **遗漏（R-34 发版时已知未闭）** | ① parent_chain≥18h **mihomo 旁路 dial 未 upstream**（BUG-015 Plane B 半闭环）② prune 阈值 120s 对 **47s byte-freeze + 3min 后 SSE 死** 无效 ③ **零 G9 soak 通过** 即宣称 fix |
| **待修复（下一版）** | ~~parent 4h sidecar~~ · ~~SSE carrier 45s prune~~ · G9 40min soak：`attempt_rate_pct≥90` → **R-35 @1.28.1 CODE-DONE** |
| **踩坑** | Dashboard **20:34** 是计费起点非断连时刻 · 短探针全绿 **不能** 否定 L3 · vitality_dial **不能** 替代 close frozen conn · 装 1.28.0 ≠ 同族消失 |
| **验证方式** | G9 soak strict · `[MaxStepsRate] attempt_rate_pct≥90` · 零同窗 server-eof · parent_chain_age 日志 <4h during marathon |
| **会导致什么** | 117min 马拉松中途断 · willRetry=true 可能 ghost Included（拦截 OFF 时 Guard 已 notify） |

**结构反思（为何 R-34 装后仍复发）：**

| 机制 | 问题 |
| --- | --- |
| **Goodhart 漂移** | R-17–R-33 优化 rescue executed / vitality_dial 计数；真实目标 **SSE carrier 存活** 无直接 SLO |
| **半闭环发版** | Plane E 18h parent rotation 代码在、**mihomo 旁路 dial 未 upstream** → chain 25.5h 仍存活 |
| **阈值与载体错位** | frozen_surgical_prune 120s 全局门控 · 47s byte-freeze 只触发 vitality · ** dying carrier ≠ pruned carrier** |
| **验收真空** | 零 G9 soak 通过即 ship · rolling100 max-steps **0%** 未 blocking release |
| **向上失明** | split-brain（api2 绿 + SSE dead）被短探针 PASS 掩盖 · triage 依赖事后 bundle 非 inline 告警 |

**根治方向（非 Guard/拦截/failover）：** parent chain 4h 同节点热换 + marathon SSE carrier 45s prune + G9 soak strict gate。

### R-34e · token_gap_snapshot_retention @ 1.28.0（pre-ship）

| 字段 | 内容 |
| --- | --- |
| **问题** | `marathonTransportDialOrchestrator.ts:650-652` — `tokenGapSignal==null` 时 instant zero → 五门 AND 缺 stale proof → 仍只 vitality_dial |
| **修复** | `marathonTokenGapSnapshotRetentionCore.ts` — marathon active 时保留最近 180s stale proof |
| **验证** | `marathonTokenGapSnapshotRetentionCore.test.ts` 5/5 pass |
| **状态** | CODE-DONE · **shipped @1.28.0** upgrade ~19:17 CST 2026-07-31 |

### BUG-2026-07-31-017 · v1.28.0 · p28_maxsteps_slo_rolling100 (Phase 8)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ Sparkle `aaf8c9a` · **PENDING** `upgrade:mac`（2026-07-31 14:44 被 marathon guard 拦：cursor_conn=31） |
| **症状** | 无 SLO 量化 · 07-31 磁盘现算 rolling100 **rate_pct=0.0%**（8 turn / 0 max-steps / 3 early_disconnect 全 server-eof）· 无法验收「90% 到 max-steps」 |
| **根因** | 缺 turn 级终态统计 · `agent-transport-failures.jsonl` 漏 max-steps · 无发版门禁 |
| **修复** | `maxStepsRateObserverCore.ts` rolling100 主窗口 + 24h 辅指标 · `[MaxStepsRate]` @ hung_scan 5min · `~/.sparkle/max-steps-rate-snapshot.jsonl` · SSOT §M.0.13 Plane H |
| **版本** | Sparkle **1.28.0**（与 R-34 同包） |
| **遗漏（G8 DONE @1.28.0）** | G8a MaxStepsRate merge + G8b `validatedLedgerTerminalProjectionCore`→jsonl · 实机 143 terminals / 1 max-steps |
| **装包门禁** | `upgradeSparkleAsarGateCore` R-34+close · `preflight-sparkle-1280.sh` · `sparkle-mihomo-close-smoke.mts` |
| **90% 如何保证（诚实）** | R-34 打掉 L3 + G8 正确计量 + soak `rate_pct≥90` · 未 soak **不得声称达标** |
| **为何以前修复没 SLO** | R-17–R-33 优化 rescue **executed** 内部指标 · 无 rolling100 外部锚点 · 07-31 实锤 0% max-steps |
| **反复次数** | SLO 体系 **第 1 次**（此前零定量验收） |
| **踩坑** | 24h 窗口样本太少 → **rolling100** · jsonl-only 低估 max-steps → **G8 ledger SSOT 已接** |
| **用户动作** | marathon 结束 cursor_conn=0 → `pnpm run upgrade:mac` → grep `[MaxStepsRate]` |

### BUG-2026-07-31-016 · v1.27.9→**1.28.0** · composer_1c2e77de_server_eof_1340 (§M.0.12 子案)

| 字段 | 内容 |
| --- | --- |
| **状态** | **TRIAGE-DEFINITIVE** @ 2026-07-31 · **FIX IMPLEMENTED @1.28.0 R-34** · Sparkle **未装** |
| **症状** | userMessage `1c2e77de` @ **11:57:56** · resume `73e46389` ~91min · **13:40:04** `server-eof` durationMs=5468403 · 幽灵 resume `d2e6a330` @13:41 · Dashboard Included 浪费 |
| **关联** | BUG-014 同族（11:58 四路 batch）· 本条目为 **单路 definitive 时间链** |
| **PRIMARY 根因** | **L3** — token_gap max **485389ms** @13:35 · `TokenGapRescueIneffective` · `mihomoCloseConnection is not a function` · VpsL4 @13:40:26 **api2_ok** |
| **NOT** | max-steps-cap（全天零）· Cursor 随机 · patch-315 execute（零 `resume-chat-invoked`）· VPS 宕 |
| **IFM 补丁** | 全程 `phase=detect_only` · execute **未触发** |
| **Guard G6** | 2026-07-31 deploy observe-only · closure **15/15 PASS** · 待用户 **⌘Q** |
| **修复** | R-34 Plane C/D/E（见 BUG-015） |
| **反复次数** | HY2 stall 同族 **第 8+ 次**（延续 BUG-014） |
| **为何本次 triage 更准** | 单 rid 完整链：marathon-segments + app.log L2722 + transport-failures · 非 Dashboard 分钟级误读 |
| **用户动作** | ⌘Q 315 · marathon 结束后 upgrade Sparkle 1.28.0 |

| **向上失明** | 真实目标应是 **parent QUIC 链健康 + Connect SSE 存活**；机械执行短 api2 dial / 禁 marathon close，未复审目标 |

### §2026-07-31 R-34 vs R-17–R-33 — 以前为何没奏效 + 90% 如何保证

**以前修复清单（均已在生产跑过，07-31 仍断）：**

| 版本 | 改了什么 | 07-31 实锤为何无效 |
| --- | --- | --- |
| R-17~R-24 | partition latch / contention budget / deny pulse | 短探针绿、SSE 仍 dead；未碰 **马拉松 selective close** |
| R-33 @1.27.6 | stall≥45s vitality · stall≥120s close | 马拉松内 **`marathon_block_close_connection`**（`:13103`）· close 路径 **`mihomoCloseConnection is not a function`**（日志 16 次） |
| P28/P29 | partition/server-eof latch | solitary eof 不 arm · **不能复活** dead stream |
| Guard 315 execute bin 漂移 | 声明 observe-only 磁盘含 execute | 07-31 **未触发** execute，但污染排查可信度 |

**R-34 @1.28.0 打的是 A 时刻 proven 的三颗钉子（不是又一个 rescue 指标）：**

| Plane | 机制 | 外部锚点（验收必须看） |
| --- | --- | --- |
| C | `frozenSurgicalPrune` — **删** marathon 全禁 close，只摘 `stall≥阈值` 单 conn | prune 后 **同一 rid token 恢复** 或 gap↓≥50%/60s |
| C | static import 修 `mihomoCloseConnection` | 日志 **零** `is not a function` |
| D | `RecoveryHonesty` — rescue `executed` 须 token_gap↓≥50% | **零** `TokenGapRescueIneffective` 同窗恶化 |
| E | `transportLongevityTruth` 三龄 | parent_chain_age 超阈 **触发** rotation/prune，不靠短探针 |
| H | P28 rolling100 MaxStepsRate | `rate_pct≥90` 或 soak `early_disconnect=0` |

**90% 怎么「保证」——诚实表述（禁止过度承诺）：**

1. **不是写进代码的常量** — 是 **发版 SLO + soak 门禁**；未跑过 G9 soak **不得声称达标**。
2. **当前基线** — rolling100 **0%**（8 turn / 0 max-steps / 3 early_disconnect 全 server-eof）· 证明以前 **零定量验收**。
3. **通过条件（全部满足才 ship 1.28.0 生产结论）**：
   - 40min **4-way HY2 马拉松** soak：`early_disconnect=0`
   - `[TokenGapRescueIneffective]` **=0**（或 rescue 后 60s 内 gap↓≥50%）
   - `[MaxStepsRate] rolling100 rate_pct≥90` **或** 样本不足时至少 **连续 3 次 hung_scan rate≥90**
4. **若 soak 失败** — 按 triage 手册继续打 **同一 rid 链** 的新机制，**不**再叠「又一个 vitality dial」。
5. **与以前本质区别** — 以前优化 **内部 executed**；R-34 强制 **Connect token 恢复** 为唯一 success anchor。

**反复统计（HY2/TUIC split-brain 同族）：** 自 BUG-2026-07-20-001 起 **第 9+ 次** triage · R-17–R-33 **6 个版本** partial fix · R-34 @1.28.0 **装后仍断 1 次**（BUG-018）· **0 次** soak 门禁通过。

### §2026-07-31 R-34 pre-ship 深度审计（@1.28.0 CODE · dist 仍 1.27.9）

| # | 严重 | 风险 | 证据 | 触发条件 | 纠偏 | 回归验证 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **P0** | 未装包 = 零收益 | `/Applications/Sparkle.app` **1.27.9** · dist **1.27.9** · repo `buildStamp` **1.28.0** | 用户未空窗 upgrade | marathon 结束 **一次** `upgrade:mac` | `defaults read` → 1.28.0 |
| 2 | **P0** | close 路径仅 Core 单测 | `mihomoQuicSilentStallRecovery.ts:7` static import 修 · **无** asar/runtime 集成测 · 07-31 生产 16× `is not a function` | 首次马拉松 prune | 补 runtime close smoke（G10） | soak 零 close err |
| 3 | **P1** | 五门 AND 过严 → 仍只 vitality | `frozenSurgicalPruneCore.ts:64-65` 须 `tokenGap≥FORCE` **且** `staleRequestIdCount>0` · 07-31 `:13103` 有 gap 但 block 在 **旧** marathon_block | stall 大但 gap 未进 snapshot | 审计 snapshot 接线 · 放宽 gate 证据驱动 | soak：`close_frozen_connection` 出现且 gap↓ |
| 4 | **P1** | MaxStepsRate 漏计 max-steps | **G8 DONE** · ledger ingest + jsonl projection + MaxStepsRate merge | 已闭环 | Plane F validated-ledger | grep `validated-ledger-projection` in jsonl |
| 5 | **P1** | 18h parent 轮换半闭环 | BUG-015 Plane B · mihomo 层旁路 dial 待 upstream | parent_chain≥18h | hy2ParentRotation + 后续 upstream | longevity log 触发 rotation |
| 6 | **P2** | 测试非 90% line coverage | `test:node-quality` **460 pass / 4 fail**（bundle guard 预存）· R-34 Core **12/12 pass** · **零** soak/E2E | 发版 | G9 40min soak 门禁 | early_disconnect=0 + rate≥90 |
| 7 | **P2** | 误 close 活连接 | 五门：critical host + byte_frozen_proof 30s + global cooldown 60s | 极端 race | 已有 gate · RecoveryHonesty 60s | 无误杀 rid 证据 |

**三类结构性风险判定：**

| 类型 | 判定 | 证据 | 校准动作 |
| --- | --- | --- | --- |
| **测量衰减** | **命中（P28）** | jsonl 漏 max-steps → rate 低估 | **先** G8 ledger **后** 信 rate |
| **古德哈特** | **R-34 已纠** | `recoveryHonestyCore.ts:48-49` success=gap↓≥50%/60s | soak 看 `[RecoveryHonesty] outcome=success` |
| **向上失明** | **R-34 已纠** | `frozenSurgicalPruneCore` 目标=摘僵死 conn 非刷 executed | 外部锚点=Connect token + rolling100 |

**改完还会 bug 吗？诚实：**

| 问题 | 答案 |
| --- | --- |
| 同 bug（marathon_block + close 坏） | **装 1.28.0 后不应复现**（机制已删/修） |
| 同族（HY2 stall split-brain） | **已复发** — BUG-018 @1.28.0 22:31 · parent 25.5h + 47s stall 仅 vitality · 见 BUG-018 |
| 新 bug（prune 误伤） | **低概率**，有五门+cooldown · 需 RecoveryHonesty 监控 |
| **100% 永不断连** | **不可能**（物理网络 + Cursor max-steps） |
| **90% max-steps** | **可达** — 工程闭环：rate 可见 → 每个 early_disconnect triage → 修到达标 |

### §2026-07-31 遗漏补遗审计（第二轮 · 按用户铁律逐项）

| # | 先前遗漏/误判 | 真实证据 | 纠偏 |
| --- | --- | --- | --- |
| 1 | **TUN 延迟税** 未量化 | `[LatencyTruth]` @07-31：`mac_p50=301` `vps_p50=497` **`delta_ms=-194~−196`** `high=0` — **基线无 +200ms 税** | 监控 `delta_ms>+50` 告警；**勿与 pulse 尖峰混淆** |
| 2 | **pulse 争用尖峰** 未单列 | `:13115` `connect_path_delay_ms=**720**` · ledger @06:55 `pulse api2=**670**` · 基线 301ms | 07-31 断连窗 **争用恶化** 非静态 TUN 税 · R-24 deny 已部分抑制 · soak 验 pulse 频率 |
| 3 | **误杀健康连接** 路径未全扫 | `config.yaml`：**`cursorConnectionHygieneEnabled=false`** · **`autoCloseConnection=false`** · L1/L2 有 **marathon-disable** guard | **永久保持 hygiene OFF** · R-34 prune **五门 AND**（`:64-70` 须 byte_frozen+token_gap stale）· soak 验无误杀 rid |
| 4 | **close 路径全量** | 除 R-34：`cursorTransportHealth` L1/L2 · `cursorConnectionHygiene` — 赛中 guard/已关 | 不改节点 · 不 mass close 活连接 |
| 5 | **VPS 非节点因素** | parent_chain **≥18h**（`:12936` max_parent_chain_age_ms=149671005）· sing-box 马拉松 conn 堆积 · conntrack 历史低 | R-34 parent rotation · longevity truth · VPS sing-box 仅 **隧道刷新** 非切节点 |
| 6 | **MaxStepsRate 漏计** | G8 validated-ledger 未接 | 装 1.28.0 后 **优先 G8** 再信 rate |

**用户铁律对齐：**

| 铁律 | 现状 | 交付动作 |
| --- | --- | --- |
| 不杀健康连接 | hygiene OFF · prune 五门 | soak 证明只摘 byte-frozen |
| 最大化到 max-steps | rolling100=**0%** | P28 + G8 + 迭代 fix |
| ≥90% max-steps | 硬指标 | soak 门禁未过不交付 |
| 315 仅观测 | G6 PASS | ⌘Q 进内存 |
| 不切节点 | 全程 JP-VPS-HY2 | parent rotation=同 leaf 新隧道 |

### §踩坑经验 SSOT — 2026-07-31 四路 batch 沉淀（后续必读）

**定责**

1. Dashboard **分钟级时间戳 = 计费落账**，不是 userMessage 起点 · 定责必须 rid 级时间链（segments + jsonl + app.log A±60s）。
2. 多路同时 `server-eof` @ 同窗 → **L3 代理/VPS**，不是 Cursor 随机 · 全天零 `max-steps-cap` 则继续查 L3。
3. `VpsL4Probe api2_ok` + 短探针绿 **≠** Connect SSE 活 · split-brain 必须看 token_gap + stall_ms。

**修复反模式（R-17–R-33 六版教训）**

4. **禁止**用 rescue `executed` / vitality 294ms 绿作为 success — 外部锚点 = **Connect token 恢复** 或 **rolling100 max-steps**。
5. **禁止**马拉松全禁 close（`marathon_block_close_connection`）— 应 **五门 AND 只摘 byte-frozen 单 conn**。
6. **禁止** dynamic import close API 无 runtime 测 — 生产可 `mihomoCloseConnection is not a function`。
7. **禁止**无 soak 门禁发版 — `early_disconnect=0` 或 `rate_pct≥90` 才关单。
8. **禁止**把 Guard/拦截/Continue 当断连根因 — 315 须 observe-only · `verify-segment-handoff-closure.mjs` 每 deploy。

**运维铁律（500 Included）**

9. **hygiene OFF · autoCloseConnection false** 永久 — 误杀健康 SSE = 不可挽回次数浪费。
10. **不切节点 · 不 failover · 不减并行 · 不拆 userMessage**。
11. **LatencyTruth delta_ms>+50** 才认定 Sparkle 加税 · 600ms+ 尖峰先查 **pulse 争用** 非静态 TUN。
12. **装包一次** — marathon 中禁止 cold restart Sparkle · dist 版本须与 `buildStamp` 一致。

**文档/指标**

13. **先 G8 validated-ledger 再信 MaxStepsRate** — jsonl 漏 max-steps 会测量衰减。
14. `_ARCH.md` / `CURSOR-DISCONNECT-TRIAGE.md` 与代码同步 — 过时「conn≥12 禁止 close」「315 execute」会误导定责。
15. 每个 BUG 条目必含：**发生版本 · 修复版本 · 反复次数 · 遗漏 · 验证方式**。

**发版检查清单（复制用）**

```
□ upgrade:mac 后 defaults = buildStamp
□ grep 无 marathon_block_close_connection（新 stall 窗）
□ grep 无 mihomoCloseConnection is not a function（48h）
□ [MaxStepsRate] rolling100 可见
□ 315 closure verify 15/15 + ⌘Q 进内存
□ 40min 4-way soak：early_disconnect=0 或 rate≥90
□ 每个 early_disconnect 有 rid 级 triage 条目
```

### BUG-2026-07-31-015 · v1.28.0 · r34_transport_longevity_ssot (Phase 7)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-31 · **upgrade PENDING**（2026-07-31 14:44 marathon-core-restart-guard：cursor_conn=31 quiesce=1）· **dist 仍 1.27.9**（待空窗一次 build+install） |
| **事故时间** | 触发案 BUG-014 @ **2026-07-31 11:58–13:40 CST** · 运行版本 **1.27.9** |
| **修复版本** | **1.28.0**（`buildStamp.ts` · commit 待用户空窗 install） |
| **交付文件** | `frozenSurgicalPruneCore.ts` · `recoveryHonestyCore.ts` · `transportLongevityTruthCore.ts` · `hy2ParentRotationCore.ts` · `mihomoQuicSilentStallRecoveryCore.ts`（删 marathon_block）· `maxStepsRateObserverCore.ts` |
| **交付** | Plane A–E 见 §M.0.12 · 455/459 单测 pass |
| **已知半闭环（诚实）** | Plane B「赛中 healthy 流存在时的 18h 旁路新 dial」需 mihomo 层支持 · 当前仅 prune 后 UDP refresh |
| **补漏 @同版本** | token_gap snapshot 清零 · RecoveryHonesty 接 MTDO+hung_scan · P10b recent userMessage 段 block cold restart · natStale→prune snapshot · Hy2Vitality 三分龄日志 |
| **仍待 G6** | mihomo 层赛中 18h 旁路新 dial（需 upstream）· wallClockIso · asar close 集成测 |

### BUG-2026-07-31-014 · v1.27.9 · hy2_marathon_stall_r33_ineffective_4rid_1158 (split-brain 同族第 8+ 次)

| 字段 | 内容 |
| --- | --- |
| **状态** | **TRIAGE-DEFINITIVE** @ 2026-07-31 · **FIX IMPLEMENTED @1.28.0**（R-34） |
| **症状** | Dashboard **11:58** 四路 Included×1（composer `3dbdfb49`/`5b103c3f`/`ab194449`/`21419e13`）· userMessage **11:57:56–11:58:14** · **12:00–12:09** mass token_gap + resumeAction 风暴 · 烧 Included |
| **关联产品** | Sparkle **1.27.9**（11:52:54 升级 cold restart）· Cursor **3.1.15** · leaf **JP-VPS-HY2** · cursor_conn **31–39** |
| **PRIMARY 根因** | **L3** — Mac→JP-VPS-HY2 **21h 父链 QUIC silent stall**（`max_parent_chain_age_ms≈76.7M`）→ Connect token 断供 · **NOT** max-steps-cap · **NOT** VPS 宕（VpsL4 @11:58:58 api2_ms=478） |
| **R-33 为何无效（实锤）** | `app-2026-7-31.log:13101-13103` @ **11:59:28 CST**：`stall_ms=213944` → `[MihomoQuicStallRecovery] outcome=executed action=vitality_dial reason=**marathon_block_close_connection** connect_path_delay_ms=**294**` → 短探针绿但长流仍死 · `13117-13118` @ **12:00:02**：`token_gap_nudge outcome=executed_on_stale_rid` stale_rids=`10a5d11f,1c2e77de` · `network-stability-events.jsonl` @ **12:01:58**：`token_gap_rescue_ineffective` max_gap_ms=188586 |
| **R-33 生产缺陷（另案）** | @ **02:37:26** `MihomoQuicStallRecovery outcome=failed action=close_connection err=**TypeError: mihomoCloseConnection is not a function**` — 非马拉松 conn=28 时 close 路径 **运行时坏** · 仅 Core 单测、无 runtime/integration 测 |
| **11:52 重装** | **独立事件**（`generateProfile` @11:52:54 · core restart @11:52:59）· 比 userMessage 早 6min · **不是** Dashboard 11:58 同一秒 · 可能削弱隧道状态但断连证据对齐 **12:00–12:02** |
| **反复次数** | **split-brain/HY2 stall 同族第 8+ 次**（BUG-2026-07-20-001 起第 6 次 → TUIC 7+ → **本次 HY2 @1.27.9**） |
| **为何 R-17–33 仍复发** | ① 每层只修 **一个时间尺度**（观测/短探针/rescue 日志）② **马拉松禁 close**（`marathon_block_close_connection`）③ **vitality/rescue 不能复活 dead Connect SSE** ④ **parent chain ≥18h 无旁路轮换** ⑤ R-33 close 路径 asar dynamic import 坏 ⑥ 无 E2E soak 门禁 |
| **改完 R-33 还会 bug 吗** | **会** — 07-31 实锤 R-33 在马拉松内 **只能 vitality**，213s stall 未解 |
| **待编码（R-34 SSOT）** | Master **§M.0.12 Phase 7** · ① Longevity Truth 三龄 ② Parent Rotation 18h 旁路 ③ Frozen Surgical Prune（删 marathon_block）④ Recovery Honesty 3.0 ⑤ static import + soak |
| **结构性反思** | 见下方 **§2026-07-31 深度反思** |
| **用户动作** | 确认 R-34 方案后编码 · 装包前勿 cold restart 马拉松 active |

### §2026-07-31 深度反思 — 为何修了很多版仍复发？

| 问题 | 结论（证据） |
| --- | --- |
| **功能有 bug 吗？** | **有。** R-33 马拉松路径设计性无效（`mihomoQuicSilentStallRecoveryCore.ts:52-55` marathon_block_close）+ close 路径生产坏（app-log 02:37 `mihomoCloseConnection is not a function`） |
| **测试覆盖率 ≥90%？** | **否。** 无 `test:coverage` · `test:node-quality` **453 tests / 449 pass / 4 fail** · R-33 仅 5 条 Core 单测 · **零** runtime/asar/soak 测 |
| **以后还会这个 bug 吗？** | **会**，直到 parent chain 轮换 + 马拉松 selective close + import 修复 |
| **以后还会类似 bug 吗？** | **会**（QUIC split-brain 同族），除非闭环「长流真值」external anchor（Connect token 恢复），而非短 HTTP 探针 |
| **测量衰减** | `executed_on_stale_rid` / `MihomoQuicStallRecovery outcome=executed` 内部指标变好，**12:01:58 rescue_ineffective** 外部锚点仍 fail |
| **古德哈特** | R-33 优化「有 recovery 动作」指标，**真实目标**（Connect token 不断）未达成 — 11:59:28 vitality 294ms 绿 + 12:00 stale |
| **向上失明** | 真实目标应是 **parent QUIC 链健康 + Connect SSE 存活**；机械执行短 api2 dial / 禁 marathon close，未复审目标 |

### BUG-2026-07-31-013 · v1.27.8 · cursor_path_prefix_migration_wipe

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-31 |
| **症状** | 用户设置 `cursorProxyAppPathPrefixes: [/Applications/Cursor-3.1.15.app]` 后，Sparkle 重启/重装即被清成 `[]`，`generateProfile` 回退全量 `PROCESS-NAME,Cursor*` |
| **根因** | `migrateLegacyCursorDefaults` 误把 **唯一的** `Cursor-3.1.15.app` 前缀当作 legacy 硬编码迁移并清空 |
| **修复** | 删除该清空分支 · 提取 `appCursorDefaultsCore.ts` · 单测锁定「显式前缀必须保留」 |
| **回归** | `appCursorDefaultsCore.test.ts` · `cursorRuleInjection.test.ts` · `cursorPathPrefixProfileReloadCore.test.ts` |
| **用户动作** | `upgrade:mac` → 1.27.8；`config.yaml` 保持 `cursorProxyAppPathPrefixes: [/Applications/Cursor-3.1.15.app]` |

### BUG-2026-07-31-012 · v1.27.7 · cursor_path_scoped_dedicated_rules

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-31 |
| **症状** | `cursorProxyAppPathPrefixes` 设为非空后，`stripUnscopedCursorDedicatedRules` 未移除 legacy `PROCESS-NAME,Cursor*` → 多 Cursor 副本仍争用 `🎯 Cursor 专用` leaf |
| **修复** | `isUnscopedCursorDedicatedRuleParts` 同时剥离 `PROCESS-NAME` + naked DOMAIN 规则 · `patchAppConfig(cursorProxyAppPathPrefixes)` → `generateProfile` + `reloadMihomoConfigFromDisk` 即时生效 |
| **回归** | `cursorRuleInjection.test.ts` |
| **用户动作** | `config.yaml` 设 `cursorProxyAppPathPrefixes: [/Applications/Cursor-3.1.15.app]` · 1.27.7 后 UI/配置保存自动 reload · 当前已手动 patch + reload |

### BUG-2026-07-31-011 · v1.27.6 · mihomo_quic_stall_recovery (R-33)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-31 |
| **症状** | R-17 `[MihomoQuicSilentStall] observe_only=true` 仅观测 · 单 QUIC/TCP 流 45–210s 无字节 · 探针仍绿 · split-brain 可致 mass ping |
| **修复** | R-33：`stall≥45s` → HY2 vitality dial（`stallRecoveryBypass` 跳过 30min age gate）· `stall≥120s` → **单 connection close** + vitality · 日志 `[MihomoQuicStallRecovery]` |
| **边界** | 不切 leaf · 不 mass close · aggregate 仅 vitality |
| **回归** | `mihomoQuicSilentStallRecoveryCore.test.ts` · `hy2TunnelVitalityCore.test.ts` |
| **用户动作** | 任务结束后 `upgrade:mac` 重启 Sparkle（**现在勿重启**） |

> **2026-07-31 最新**：**BUG-2026-07-31-010** P21 bootstrap dial-timeout 45s SSOT · **1.27.5**

### BUG-2026-07-31-010 · v1.27.5 · marathon_dial_tolerance_bootstrap_ssot (P21)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-31 |
| **症状** | conn≥12 时 `memory_only_deferred target_timeout=45s data_plane_action=none` → mihomo 仍 5s dial-timeout → `connect_path_delay_ms=5000` 假失败 · Cursor 无效重试烧 Included |
| **根因** | P20b 禁赛中 provider reload（Zero-Disruption 证据：provider reload 可 RST 活跃流）· 但 45s 从未落地 |
| **修复** | P21：VPS leaf **bootstrap dial-timeout=45s** @ `extractProxies` · PostCoreBootstrap **idle-only** backfill + provider hot-update · 赛中仅 observability `ssot_active` |
| **回归** | `marathonDialToleranceCore.test.ts` |
| **用户动作** | `upgrade:mac` → 重启 Sparkle（conn=0 时 backfill）→ soak 验零 `memory_only_deferred` + 无 5000ms 尖峰 |

> **2026-07-30 最新**：**BUG-2026-07-30-009** R-32 operator manual HY2 switch · **BUG-2026-07-30-008** R-27 upgrade gate · **BUG-2026-07-30-007** `15e0c619` HY2

### BUG-2026-07-30-009 · v1.27.4 · operator_manual_protocol_switch (R-32)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-30 |
| **症状** | 操作者无法在 Sparkle UI 赛中手动切 JP-VPS-HY2；冷启动 gate 反复推回 TLS |
| **修复** | R-32：`source=manual` 豁免 R-30 赛中锁；手选 suboptimal leaf 跳过 cold-start gate |
| **仍保留** | auto/bootstrap 禁止回落 suboptimal；HY2↔TUIC↔Reality 横向仍 block |
| **关联文件** | `marathonProtocolContractCore.ts` · `marathonProtocolContract.ts` · `confirmCursorProxySwitch.ts` |

### BUG-2026-07-30-008 · upgrade_post_install_gate_since_line (R-27)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-30 |
| **症状** | `upgrade:mac` 安装成功但脚本 FAIL：`PostCoreBootstrap failed` — `tail -120` 扫到安装前旧失败行 |
| **修复** | PostCoreBootstrap / Api2ProbePlane 门控改用 `BUG014_GATE_SINCE_LINE` 偏移 + 单测 |
| **本地-only** | 见 BUGFIX §AI Agent「本地-only 升级口诀」 |

### BUG-2026-07-30-007 · v1.27.2 · hy2_mass_ping_split_brain_15e0c619 (Phase 6 R-30/31)

| 字段 | 内容 |
| --- | --- |
| **状态** | **TRIAGE-DEFINITIVE** @ 2026-07-30 · **R-31 + R-30 IMPLEMENTED** @ 1.27.3 · SSOT：`open-perplexity/temp-docs/repair/CURSOR_DISCONNECT_REPAIR_MASTER_SSOT.md` **§M.0.11** |
| **症状** | RID `15e0c619-3b0b-463f-acd3-b4857d122497` · `[unavailable] PING timed out` · attempt=6 重试耗尽 |
| **关联产品** | Sparkle **1.27.2** · Cursor **3.13.25** · active leaf **JP-VPS-HY2** · cursor_conn **17–21** · 马拉松 ~43min |
| **PRIMARY 根因** | **L3** — HY2 QUIC 长流 silent stall → **mass PING**（6 RID 同秒）· split-brain（api2 316ms 绿 + partition=1） |
| **证据（definitive）** | ① jsonl `proxyNode=JP-VPS-HY2` mass @ `1785412790*` ② Structured `19:59:53` PING timed out ③ app-log `PartitionMassPingSync affected_rid_count=6` ④ `connect_partition_nudge outcome=executed` 但 RID 仍死 ⑤ VPS sing-box @ A **零 inbound error** ⑥ `last_server_sent_heartbeat_ago_ms=30355` @ 19:31 第一波 |
| **NOT** | max-steps-cap · L4 VPS 宕 · L2 Sparkle mutation · Cursor 随机断流 · Sparkle TUN 加税（mac_p50≈316ms） |
| **为何 R-17–24 仍复发** | R-19 **observe_only** · operator 手选 HY2 马拉松 · R-18 未覆盖 mass_ping rescue 路径 |
| **修复方案** | **§M.0.11 Phase 6**：R-30 **Marathon Protocol Contract**（`marathonProtocolContractCore.ts` + mihomoChangeProxy gate + cold-start dialog @ 1.27.3）· R-31 **MassPingRescueIneffective**（同上） |
| **Operator** | 冷启动前 **JP-VPS-TLS**（非赛中切换） |
| **triage bundle** | `~/Desktop/cursor-triage-15e0c619-20260730T200505/` |

### BUG-2026-07-30-006 · v1.27.3 · marathon_quiesce_health_check_dynamic_import (R-24 G4 hotfix)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-30 — pkg **1.27.3** |
| **症状** | quiesce ON 时 `health_check_patch_failed err=TypeError: getAppConfig is not a function` |
| **根因** | Electron asar 下 `await import('../config')` 解构 `getAppConfig` 失败（同 R-25 类问题） |
| **修复** | `marathonQuiesce.ts` 静态 import `getAppConfig` from `../config/app` + import guard 单测 |

### BUG-2026-07-30-005 · v1.27.2 · generate_profile_wall_clock_guard (R-26)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-30 — pkg **1.27.2** |
| **症状** | mutex 首 call hang → 30min 全局阻塞 startCore；fail 后 runtime 仍空 |
| **修复** | 60s wall-clock timeout + last_step · fail→hydrate disk · install 60s mihomo 探测 |
| **证据** | app-log 09:29–09:59 vps 后无 log 直至杀进程 |

### BUG-2026-07-30-004 · v1.27.1 · post_install_generate_profile_ui_groups_orphan (R-25)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-30 — pkg **1.27.1** |
| **症状** | marathon force install 后 GUI **仅 GLOBAL** · `work/config.yaml` mtime 冻结 · app-log 反复 `[Provider]: vless_vision_mux_guard` 无 `[Factory]: generateProfile step=done` |
| **PRIMARY 根因** | ① `generateProfile()` 并发/卡死 → `runtimeConfig` 未写入 → `mihomoGroups()` 只匹配 GLOBAL ② install 脚本 kill service 后 GUI `startCore` 被 guard 阻断，core 孤儿 |
| **修复内容** | R-25 ① `generateProfile` 串行 mutex + 分步 elapsed_ms 日志 ② `mihomoGroups` disk fallback（`work/config.yaml` 22 groups）③ DHCP/DNS resolve 3s timeout ④ 待 install 后 core bootstrap |
| **证据** | app-log:13899-13912 Provider×N 无 Factory done · disk config groups=22 · mihomoApi.ts:206 runtime empty → UI GLOBAL-only |
| **验收** | 重启后 UI 显示 22 组 · app-log 出现 `generateProfile step=done groups=22` |

### BUG-2026-07-30-003 · v1.26.99 · marathon_contention_breach_closure_r24 (R-24)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-30 — pkg **1.26.99** · **30/30 R-24 相关单测 PASS** · **待 upgrade + TLS soak** |
| **症状** | R-23 上线后 cap 仍几乎永不 deny：07:06 TLS **26s/4 triple-pulse** · token_gap 每 15s hung_scan 触发 rescue bundle pulse |
| **PRIMARY 根因** | **R-23 设计漏洞**：routine `token_gap`/`connect_stream_gap`∈breachKinds → cap 永久 bypass；`pulse_contract_breach` 对 rescue bundle 也 bypass；independent pulse 成功不写 `lastMtdoDialAtMs` |
| **修复内容** | **R-24** ① `buildMarathonContentionBreachKinds` — 移除 routine token/connect_stream gap；`pulse_contract_breach` 仅 independent pulse ② rescue bundle 用独立 breach 集 ③ independent pulse 更新 lastMtdoDialAtMs ④ `frozen_quic_cursor` 接线 ⑤ quiesce ON/OFF 真调 `patchRuntimeProxyProviderHealthCheckEnable` + reload |
| **证据** | app-log:12521-12534 07:06:30-56 ×4 pulse/26s · orchestratorCore.ts:212 rescue 不 coalesce · marathonQuiesce.ts 原 data_plane_action=none |
| **验收** | 40min JP-VPS-TLS soak：`[MarathonContentionBudget] outcome=deny` · 无 26s/>1 pulse · connect_path ~290ms · server-eof rid=0 |
| **改完还会 bug 吗** | 07:06 类争用放大：**极低** · L7 max-steps / QUIC split-brain：**仍会**（非本 fix 范围） |

### BUG-2026-07-30-002 · v1.26.98 · marathon_probe_contention_amplifies_cursor_disconnect (R-23)

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIX IMPLEMENTED** @ 2026-07-30 — pkg **1.26.98** · **12/12 单测 PASS** · **待 upgrade + TLS soak** · SSOT：Master **§M.0.9** |
| **修复内容** | **R-23** `marathonContentionBudgetCore.ts` — green 基线 ≤1 triple-pulse/5min · breach bypass · rescue bundle 禁 redundant pulse · UI VPS leaf 读 LatencyTruth mac_p50 |
| **验收** | app-log `[MarathonContentionBudget] outcome=deny` 替代 26s/4 pulse · soak 40min server-eof=0 |
| **症状** | 用户：探针显示 **500+/超时** 时常与 Cursor **重连**同窗 · TLS/Reality UI 频繁 >500 · 「没法给 Cursor 用」 |
| **关联产品** | Sparkle **1.26.97** · dedicated **JP-VPS-TLS** @ 06:55 · cursor_conn **12–17** |
| **PRIMARY 根因** | **L3 路径争用 + Plane 2 探针 burst 放大** — Cursor SSE + Analytics 短连 + **connect_path_pulse 26s 内 ×4** 同抢 mihomo→TLS :18443 队列 · **非** TLS 栈故障 · **非**巧合 |
| **证据** | ① 07:04–05 connect_path **291ms** ×3 · LatencyTruth mac_p50=**292** delta=**−232ms** ② 07:06:10 FailureSync **先于** 07:06:30 pulse→**613ms** ③ 07:06:30–56 pulse **×4** ④ 07:08:55 pulse_contract_breach gap=120s ⑤ 07:17:41 **1014ms** ⑥ agent-transport-failures TLS **170** 条中 **168** 为 Analytics 幽灵（无 requestId）· 仅 **2** 条真 agent rid ⑦ 81afd4e9 **反证**：探针 262–423ms 绿 · SSE dead 3035000ms（split-brain） |
| **NOT** | VPS 机器慢 · Sparkle TUN 加税（delta 负）· Reality/TLS 协议栈坏 · 需 failover 换节点 |
| **修复方案** | **R-23 Contention Budget SSOT** — CB-1 green≤1 dial/5min · CB-2 breach-only full pulse · CB-3 marathon 停 VPS health-check · CB-4 UI=mac_p50 · CB-5 外部锚点 server-eof |
| **反复次数** | **探针争用同族第 5+ 次**（P12 budget · R-21 coalesce · 均未限 pulse burst） |
| **为何反复** | 观测平面与数据平面 **无 hard cap** · UI 读 health history 非 authoritative · 每版修观测 SSOT 但未闭合 **争用预算** |
| **改完还会 bug 吗** | L3 争用类 **极低** · L7 max-steps **仍会** · CB 过严致 split-brain 盲 **低**（S15 breach 兜底）— 见 Master §M.0.9.4 |
| **踩坑** | 探针红+重连同窗 **≠** 探针导致断连 · 常是 **同因** · 幽灵 tls-reset **不计次** 但造成「一直在重连」感知 |

### BUG-2026-07-30-001 · v1.26.97 · tuic_quic_silent_stall_split_brain_81afd4e9 (R-17–22)

| 字段 | 内容 |
| --- | --- |
| **状态** | **TRIAGE-DEFINITIVE** @ 2026-07-30 · **FIX IMPLEMENTED** @ 2026-07-30 — pkg **1.26.97** · **待 operator 重启 Sparkle + 赛前 TLS soak** · SSOT：`open-perplexity/temp-docs/repair/CURSOR_DISCONNECT_REPAIR_MASTER_SSOT.md` **§29.11** |
| **症状** | RID `81afd4e9-830e-48b7-9209-906eb350edec` · 用户可见 `WritableIterable is closed` · 马拉松 ~50–72min 后断 |
| **关联产品** | Sparkle **1.26.96** · Cursor **3.1.15** · active leaf **JP-VPS-TUIC** · cursor_conn **18–28** |
| **bug 存在版本** | Sparkle **≤1.26.96**（R-16 HY2-only stall · 无 TUIC byte-frozen 观测 · 无 rescue ineffective 诚实 metric） |
| **修复目标版本** | Sparkle **1.26.97**（R-17 QUIC stall SSOT · R-18 token_gap_rescue_ineffective · R-19 marathon preflight · R-20 connect_path_pulse ledger · R-21 observability coalesce · R-22 marathon data-plane guard） |
| **PRIMARY 根因** | **L3** — Mac→JP-VPS-TUIC QUIC 马拉松 Connect/SSE **长流 silent stall（split-brain）** → `server-eof` ×2 → attempt=4 `WritableIterable is closed` |
| **证据（definitive）** | ① jsonl 全链 `proxyNode=JP-VPS-TUIC` · `reasonSub=http-sse-server-eof` / `tls-reset` ② A2 106s 内 4 RID 同 TUIC server-eof ③ app-log `partition_stale=0` + api2 243–506ms 绿 + **`max_gap_ms=4867477`** + stale_rids 含 81afd4e9 ④ `token_gap_nudge outcome=executed_on_stale_rid` 同窗 max_gap 仍 ~81min ⑤ VPS @ 16:22 UTC sing-box **557 tuic conn/min · 0 tuic error** · VpsL4Probe api2_ms=538 · conntrack **433/1048576** · uptime **10d**（ssh jp-vps 2026-07-30 复核）⑥ renderer A1 `gapSinceActivityMs=634` · `streamPrimarySub=server-eof` · durationMs=3035000 ⑦ ledger @ A窗：Mac session_nudge p50=**293ms** vs VPS ssh_curl p50=**538ms** → **delta=−245ms**（Sparkle TUN **未**加税）⑧ A1 断连前 1s ledger `15:03:45` session_nudge **292ms 全绿** |
| **NOT** | max-steps-cap（81afd4e9 链无 maximum number of steps）· Cursor 服务端随机 · **VPS 机器/L4 宕机/节点慢** · sing-box tuic timeout 未配（udp_timeout=3600s 已配）· Sparkle L0 hung（hung=0）· Sparkle TUN 延迟加税（Mac 路径更快）· WritableIterable 为根因（是 terminal 非根因） |
| **VPS 定责澄清** | **VPS 机器质量：无问题**（api2 538ms 稳定 · sing-box 0 tuic error @A）· **VPS 上 TUIC QUIC 传输协议 + Mac mihomo 长流路径：有问题**（L3 split-brain）— 属手册「代理/VPS 问题」大类，**非**「VPS 烂了/慢了」 |
| **R-16 盲区** | `mihomoQuicSilentStallCore.ts` 仅 `/-HY2$/` · A 窗口 **0 行** `[MihomoQuicSilentStall] leaf=JP-VPS-TUIC` — **半实现 dead SSOT** |
| **反复次数** | **split-brain 同族第 7+ 次**（HY2/TUIC QUIC 长流 · 短探针绿 · 2026-07-18 Reality → 2026-07-25 P8 → 2026-07-29 R-16 HY2-only → **本次 TUIC**） |
| **为何反复** | ① stall 观测 HY2/TUIC SSOT 分裂 ② `executed_on_stale_rid` Goodhart ③ rescue 不能复活 dead SSE ④ operator 赛前仍可选 TUIC ⑤ `shouldUpgradeCursorDedicatedNode` 恒 false |
| **修复方案** | **Master §M.0.5 + §M.0.6 + §29.11** · R-17–22 · observe + R-22 禁 marathon provider update |
| **Operator 赛前** | 马拉松开始前 Cursor 专用 **JP-VPS-TLS :18443**（**TCP 长流**，同 VPS · 非 failover 换机器）— HY2/TUIC 均为 **QUIC/UDP 族**，不能当 TCP 替代 |
| **Included 幽灵计次** | 00:22 TUIC 集群断连 → 13:13–13:40 多条 Included（resumeAction ghost + ab194449 L7 max-steps @7505959ms）— **transport 根因浪费计次**，非独立新事故 |
| **先前修复是否有意义** | **有意义，未闭环**：P28 partition latch · P29 server-eof latch · R-16 HY2 stall 观测 · BUG-035 TLS leaf 恢复 · Reality :443 修复 — 均有效但 **R-16 仅 HY2**、operator 仍选 **TUIC**、rescue **不能复活 dead SSE** → 同族第 7+ 次复发。**不是白修**，是 **半闭环 + 协议选择错误** |
| **遗漏（待编码）** | ~~R-17/18/19 代码 · triage grep 更新 · pkg 1.26.97 soak~~ → **已编码** · 35 单测 pass · triage `frozen_quic_cursor` grep 已加 · **待重启 + 1 场 TLS 马拉松 soak 验收** |
| **踩坑（SSOT）** | ① TUIC/HY2 均为 **QUIC/UDP**，mihomo `[TCP]` 日志是 **内层** Cursor→api2，不是隧道协议 ② TUIC marathon = L3 split-brain 高风险类 ③ api2 绿 + max_gap>30min = 长流已死 ④ rescue executed ≠ 已修复 ⑤ **506ms 多为 api2geo 尖峰**，不是 TUN sustained 加税 ⑥ 马拉松应走 **JP-VPS-TLS（TCP）**，非 HY2/TUIC |
| **triage bundle** | `~/Desktop/cursor-triage-81afd4e9-20260730T131518/` · IncidentBundle `@16:22:34` |

### BUG-2026-07-29-035 · infra · jp_vps_tls_leaf_restore_ufw_18443

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** @ 2026-07-29 21:31 CST |
| **症状** | Sparkle override / provider 缺 **JP-VPS-TLS**；用户 Reality 665ms/超时，无法切回标准 TLS |
| **根因** | ① `sing-box-jp-tls-canary@18443` 在跑但 **UFW 未开 18443** → Mac 外网不可达 ② override / `sparkle-nodes.yaml` 未含 TLS leaf ③ 文档仍写「三节点」与 `vpsCanonicalNodes.ts` 四 leaf SSOT 不一致 |
| **修复** | ① `ufw allow 18443/tcp` ② override `proxies+` 追加 JP-VPS-TLS ③ `/root/sparkle-nodes.yaml` 同步 ④ hot-reload `678a1sub001-vps` provider |
| **验收** | 四 leaf alive=true；JP-VPS-TLS delay **325ms**（第 2 轮 healthcheck）；`:18443` TLSv1.3 握手 OK |
| **关联文件** | `VPS-INFRA.md` §JP-VPS-TLS · `VPS-CONNECT.md` · `vpsCanonicalNodes.ts` · `cursorDedicatedDefault.ts` |
| **Sparkle 责任** | 无代码 bug；文档与 override 模板需对齐四 leaf + `proxies+` |

### BUG-2026-07-29-034 · v1.26.96 · override_proxies_replace_wipes_commercial_provider

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED-USER-DATA** @ 2026-07-29 20:52 CST · Sparkle 代码未改（行为符合 `deepMerge` 设计） |
| **症状** | 订阅恢复后 Sparkle 代理页 **机场节点空白**；`profiles/678a1sub001-proxies.yaml` 为 `proxies: []`；仅 3 个 VPS 可见 |
| **关联产品** | Sparkle **1.26.96** · profile `678a1sub001` · override `c7sgvps01.yaml` |
| **bug 存在版本** | Sparkle **全版本**（`factory.ts` `overrideProfile` 对 yaml override 使用 `deepMerge(..., isOverride=true)`） |
| **修复时间** | **2026-07-29 20:52 CST**（用户数据）；**20:54** 重启后 provider 持久正确 |
| **根因** | override 使用 `proxies:`（3 个 VPS）→ `deepMerge` **整表替换**订阅 85 节点 → `setupProfileProviders` 写入 commercial provider 为空 → UI 空白。每次 `generateProfile()` / 订阅刷新 **复现** |
| **证据** | ① `678a1sub001-proxies.yaml` mtime 20:49:59 size=12 bytes ② `deepMerge` 数组默认 replace（`merge.ts:33-35`）③ 改 `proxies+:` 后 merge=88（85+3）④ 重启后 commercial=85 mihomo 加载正常 |
| **修复** | `~/Library/Application Support/sparkle/override/c7sgvps01.yaml`：`proxies:` → **`proxies+:`**（追加 VPS，不覆盖订阅） |
| **关联文件** | `src/main/core/factory.ts`（`overrideProfile`）· `src/main/utils/merge.ts` · `src/main/core/provider.ts`（`setupProfileProviders`） |
| **遗漏** | ① Sparkle 代码层未自动 warn/reject 覆盖型 override ② 未加单测「VPS override 不得清空 commercial」③ Gist 同步未开 — 再丢数据风险 |
| **反复次数** | **第 2 次**同类（2026-07-29 数据恢复写 override 时再次踩坑；7/18 前后 provider split 也可能触发类似空白） |
| **为何反复** | ① override 模板默认写 `proxies:` ② `proxies+` 语法无 UI 提示 ③ 症状像「订阅丢失」实为 merge 语义 |
| **踩坑（SSOT）** | **VPS override yaml 必须用 `proxies+:`**，禁止 bare `proxies:`；验证：`generateProfile` 后 commercial provider 行数 >0 |
| **导致** | 无（修复后 85+3 节点；马拉松 HY2 未断） |

### BUG-2026-07-29-033 · infra · jp_vps_nginx443_tls_terminator_breaks_reality

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED-VPS** @ 2026-07-29 21:17 CST · sing-box Reality 恢复监听 :443 |
| **症状** | Sparkle UI：**JP-VPS-Reality** `alive=false` / 超时；**JP-VPS-TUIC** 偶发 5001ms；**JP-VPS-HY2** 正常 ~300ms；用户误判「三节点全挂 / Sparkle 加税」 |
| **关联产品** | Sparkle **1.26.96** · JP-VPS `45.76.104.78` · override Reality 客户端配置未变 |
| **bug 引入时间** | **2026-07-18**（JP TLS 迁移：`nginx stream ssl` 占 :443 + `sing-box-jp-vless-backend` @ 18444） |
| **修复时间** | **2026-07-29 21:17 CST**（ssh jp-vps 恢复 `vless-reality-in` @ :443） |
| **根因** | 客户端：**VLESS+Reality**（SNI=www.cloudflare.com）→ VPS：**nginx Let's Encrypt 普通 TLS 终结** → 127.0.0.1:18444 **纯 VLESS 无 Reality** → `SSL alert bad certificate (42)` → backend **EOF** |
| **证据** | ① nginx `jp-vless-tls-error.log`：`bad certificate` SNI=www.cloudflare.com ② `jp-vless-backend.log`：`process connection → EOF` ③ 修复前 mihomo：Reality alive=false，HY2 alive=true ④ 修复后 Reality/TUIC/HY2 均 alive ~270–335ms ⑤ VPS `ss`：sing-box 监听 *:443 |
| **修复步骤** | ① 从 `config.json.bak.20260716` merge `vless-reality-in` → `/etc/sing-box/config.json` ② disable `nginx/stream-conf.d/jp-vless-tls.conf` ③ stop `sing-box-jp-vless-backend` ④ `systemctl restart sing-box` ⑤ **保留** `sing-box-jp-tls-canary@18443`（LE 证书监测，与 Reality 不冲突）|
| **关联文件** | VPS：`/etc/sing-box/config.json` · `/etc/nginx/stream-conf.d/jp-vless-tls.conf.disabled` · 文档：`VPS-INFRA.md`（新增禁止项） |
| **Sparkle 责任** | **无** — LatencyTruth `high=0`；542ms 为马拉松 session_nudge 瞬态，非 TUN 税 |
| **TUIC 5001ms** | **非独立 bug** — TUIC 8444 服务正常；api2 health-check 5s 上限 + 高负载时误报；Reality 修复后 TUIC ~295–670ms alive |
| **反复次数** | **第 1 次正式记录**（7/18 迁移后 Reality 隐性死亡 **≥11 天**；HY2 8443 未受影响故马拉松可跑） |
| **为何难发现** | ① 马拉松默认 **JP-VPS-HY2** ② Reality 死不影响 api2 ③ UI 超时像「节点挂」实为 **协议栈不匹配** |
| **踩坑（SSOT）** | **:443 必须 sing-box `vless-reality-in` 直连**；**禁止** nginx TLS 终结 + 后端纯 VLESS；改 443 前 `sing-box check` + Reality 探测 |
| **如何避免** | 部署 checklist：`ss -tlnp \| grep :443` 应为 **sing-box** 非 nginx；`ss -tlnp \| grep 18443` 应为 **sing-box**（TLS canary）；`ufw status \| grep 18443` 必须 ALLOW；`VpsL4Probe` + **四 leaf** mihomo health 同周期验收 |

### BUG-2026-07-29-032 · v1.26.95 · mihomo_quic_silent_stall_observer (R-16)

| 字段 | 内容 |
| --- | --- |
| **状态** | **EXEC-CODE-DONE** · **18/18 单测 PASS**（partition+vitality+R16）· **未重启 Sparkle** |
| **症状** | VPS sing-box @ A **0 error** 但 mass PING/server-eof — triage §60「QUIC 中途断连 mihomo **无日志**」 |
| **根因** | mihomo `/connections` WS 仅推 renderer · 无 HY2 byte-frozen stall 归因 |
| **修复** | `mihomoQuicSilentStallCore.ts` byte 不变≥45s + age≥90s + speed=0 → `[MihomoQuicSilentStall]` + `network-stability-events.jsonl kind=mihomo_quic_silent_stall` · aggregate @ conn≥80 frozen≥5 |
| **关联文件** | `mihomoQuicSilentStallCore.ts` · `mihomoQuicSilentStallObserver.ts` · `mihomoApi.ts` · `networkStabilityMonitor.ts` |
| **诚实边界** | **observe-only** · **不 recovery** · **不能阻止** partition · 5s scan 节流（非每 500ms） |

### BUG-2026-07-29-031 · v1.26.95 · http_sse_server_eof_partition_latch_reqId (P29)

| 字段 | 内容 |
| --- | --- |
| **状态** | **EXEC-CODE-DONE** · pkg **1.26.95** · **14/14 单测 PASS** · **未重启 Sparkle** |
| **症状** | parent `165cb7db` http-sse-server-eof @17:29:42 与 mass PING 同窗，但 latch 只登记 PING reqIds；余波 RID `67699e2d` 缺直接 eof 登记 |
| **根因** | `agentTransportFailureSync` 仅 `shouldArmPartitionLatchFromMassPingSync` → `collectConnectPingFailureRequestIds`；server-eof 行不参与 latch |
| **修复** | P29 同窗 mixed · **P29b** latch active 时迟到的 server-eof 合并 `[PartitionLateEofMerge]` |
| **关联文件** | `partitionLatchCore.ts` · `connectPartitionDetectCore.ts` · `agentTransportFailureSync.ts` · `marathonTransportDialOrchestrator.ts` |
| **诚实边界** |  solitary 单条 server-eof **不** arm latch（防 L7 误报）；**不能**复活已死 SSE stream |

### BUG-2026-07-29-030 · v1.26.95 · partition_latch_empty_stale_rids + pre_partition_vitality (P28)

| 字段 | 内容 |
| --- | --- |
| **状态** | **EXEC-CODE-DONE** · **待 pkg 1.26.95+** · git 未发版 · **13/13 单测 PASS** · **未重启 Sparkle**（operator 马拉松中） |
| **症状** | mass PING @ 17:29:11 后 rescue 日志 **29s** 才出现 victim RID `67699e2d`；`connect_partition_nudge` 早期 `stale_rids` 不含余波牺牲品；`PartitionMassPingSync` 无 reqId/cursor_conn |
| **关联产品** | Sparkle **1.26.94**（bug 存在）· stock **Cursor 3.13.25** · JP-VPS-HY2 · parent RID **67699e2d** |
| **bug 存在版本** | Sparkle ≤1.26.94（`resolvePartitionLatchCandidate` 返回空 `staleRequestIds`；blind_spot `armPartitionLatch(nowMs)` 无 RIDs；vitality 固定 30s @ ultra-conn） |
| **修复目标版本** | Sparkle **1.26.95** |
| **PRIMARY 关联** | **BUG-029** L3 mass PING partition — P28 **不阻止** partition，只修 **观测/归因/前兆频率** |
| **根因** | ① `partitionLatchCore.ts` latch armed 不持久化 ping failure reqIds ② `agentTransportFailureSync` 日志缺 cursor_conn/affected_rids ③ blind_spot 路径同漏 ④ ultra-conn+parent_chain≥12h 时 vitality 30s 间隔不足（**非 parent chain refresh**） |
| **修复 P28a** | `armPartitionLatch(nowMs, staleRequestIds)` · `collectConnectPingFailureRequestIds` · candidate 返回 ≤32 RIDs |
| **修复 P28b** | `marathonTransportDialOrchestrator.ts` blind_spot arm 带 mergedRows reqIds |
| **修复 P28c** | `hy2TunnelVitalityCore.ts` conn≥80 + chain≥12h → interval 30s→10s · log `mode=pre_partition` |
| **修复 P28d** | `formatPartitionMassPingSyncLogLine` · `partition_latch_age_ms` · stale_rids 展示 8 条 |
| **关联文件** | `partitionLatchCore.ts` · `agentTransportFailureSync.ts` · `hy2TunnelVitalityCore.ts` · `hy2TunnelVitality.ts` · `marathonTransportDialOrchestrator.ts` · `cursorHy2MarathonKeepaliveCore.ts` · `connectPartitionDetectCore.ts` |
| **回归** | `partitionLatchCore.test.ts` 7/7 · `hy2TunnelVitalityCore.test.ts` 4/4 · `hy2TunnelVitality.test.ts` 2/2 |
| **遗漏（诚实）** | ① P28c **不能**替代 `session_transport_nudge`（conn≥80 仍 defer，见 `CURSOR_HY2_NUDGE_DEFER_THRESHOLD`）② **不能**复活已死 Connect bidirectional stream ③ Mihomo QUIC silent stall **仍无 outbound log**（未来 R-16）④ stock Cursor **45GB vscdb** — **非 Sparkle 范围**，operator VACUUM |
| **反复次数** | partition latch 空 stale_rids：**第 3 次**定责（c8346504 @7/28 · 5d03320f 族 · 67699e2d @7/29）；每次 rescue 日志误导「已救」 |
| **为何反复修不好** | ① 修 rescue 执行未修 **latch 登记** ② 用 B 时刻 stale_rids 反推 A 时刻 ③ 把 P27 vitality 误当 mass PING 解药 ④ 未区分 **同秒 mass fail** vs **partition 余波 +54s** |
| **如何避免再翻车** | 装 1.26.95 → 验收 mass PING 后 **同一 sync 周期** `affected_rids=` 非空 → `partition_latch_age_ms` 有值 → 外部锚点：Included 消耗/turn 存活时长 |
| **踩坑** | ① **禁止**取消 session_nudge defer@80（dial storm，BUG-2026-07-22-001）② **禁止**用 vitality executed 率验收 mass PING（古德哈特 R-B）③ Continue 同 RID ≠ 新 userMessage |
| **用户动作** | marathon 结束 · `cursor_conn=0` → `upgrade:mac` 1.26.95+ · **并行** ⌘Q stock Cursor → VACUUM 45GB vscdb |

#### BUG-030 · 结构性风险审计（2026-07-29 · feedback#11）

| 风险 | 类型 | 证据 | 影响 | 纠偏 | 校准顺序 |
| --- | --- | --- | --- | --- | --- |
| vitality 3× dial | 测量衰减 | pre_partition 10s vs 30s | observability 预算争用 | rescue 永不 defer · budget 已有 | ① 装 1.26.95 ② 比 server-eof/partition 外部锚点 |
| latch reqId 满 | 边界 | cap 32 RIDs | ultra-conn>32 并行 victim 截断 | log `affected_rid_count` | 若截断频发 → 提 cap 或 spill file |
| clearPartitionLatch @ jsonl partition | 兼容性 | MTDO L356-357 | jsonl path 有 sampleRequestIds · latch 被清 — **OK** | 无 | — |
| 1.26.95 新 bug | 低 | 13/13 pass · 纯 additive | 极低语法/逻辑 | soak partition 窗 | marathon 后 upgrade |
| **同类还会来吗** | **会（L3 族）** | 117 conn + HY2 QUIC silent stall | mass PING / 余波 +54s | P28 降频+归因 · **不能 100% 杜绝** | VACUUM vscdb + P28 soak |

---

### BUG-2026-07-29-029 · v1.26.94 · mass_ping_partition_aftershock + vscdb_amplifier (F 案 67699e2d)

| 字段 | 内容 |
| --- | --- |
| **状态** | **INCIDENT-DOCUMENTED** · PRIMARY L3 definitive · AMPLIFIER 已识别 · **P28 + VACUUM 待 operator** |
| **症状** | 2026-07-29 **17:30:05 CST** · `RetriableError: [unavailable] PING timed out` · causeCode=**14** · RID `67699e2d-1e0c-4994-b992-5648a403dba1` |
| **关联产品** | stock **Cursor 3.13.25** window2 · Sparkle **1.26.94** · JP-VPS-HY2 · `state.vscdb` **45GB** |
| **A 时刻** | Structured Logs `:6654` · jsonl `:1343` · Sparkle `09:29:11–09:30:34Z` |
| **PRIMARY · L3** | **17:29:11** mass partition · `ping_rows=20` · `cursor_conn` 66→117 · split-brain（api2 280–292ms 绿 · Connect 死） |
| **NOT** | max-steps-cap · Cursor 随机关流 · VPS sing-box 崩溃（SSH @ A±2min **0 ERROR** · conntrack 614/1M） |
| **余波修正** | 67699e2d **不在** jsonl mass wave `:1321–1340`（同秒 20 路）· `:1343` **+54s** 终局 → **partition 余波牺牲品**，非同秒齐断 |
| **AMPLIFIER #1** | **45GB vscdb** · 16:25 同 RID `read EADDRNOTAVAIL` Structured `:2963` |
| **AMPLIFIER #2** | cursor_conn=117 · `CURSOR_HY2_NUDGE_DEFER_THRESHOLD=80` → session 保活 defer |
| **AMPLIFIER #3** | turn 自 15:49:48 · streamId `848c6ebe` · 长绑定 1h40m |
| **LatencyTruth** | mac_p50=**278** vps_p50=**539** delta=**−261** — **Sparkle 未加税**（500+ 仅 api2geo 或 ultra-conn 尖峰） |
| **P27 @ 案发现场** | `[Hy2TunnelVitality] outcome=executed` @ 09:29:12 — **在跑但不能阻止 mass PING**（§11.7 诚实边界） |
| **ghost Included** | turn 已跑 ~1h40m · 利用率良好 · **Continue 同 RID 不新开 userMessage** |
| **反复次数** | L3 mass PING code=14 族 **≥4 次/2 日**（c8346504 · 5d03320f · 15:49 wave · 17:29 wave） |
| **关联 SSOT** | open-perplexity `temp-docs/repair/CURSOR_DISCONNECT_REPAIR_MASTER_SSOT.md` **§10.5d** · `CURSOR-DISCONNECT-TRIAGE.md` |
| **修复路径** | ① operator VACUUM vscdb（P0 · 非 Sparkle）② Sparkle P28（BUG-030）③ 禁止 failover/减并行/L0 清连接 |

---

### BUG-2026-07-29-028 · v1.26.94 · marathon_install_p23_explicit_override

| 字段 | 内容 |
| --- | --- |
| **状态** | **EXEC-CODE-DONE** @ **1.26.94** · git `60e4a64` |
| **症状** | 马拉松中 `install-sparkle-local.sh` 被 P23 拒装（`cursor_conn>0`）；用户明确要求强制安装 |
| **关联产品** | Sparkle **1.26.93→1.26.94** · Cursor 马拉松 conn≈11–13 |
| **bug 存在版本** | Sparkle ≤1.26.93（P23 无显式 opt-in override；`SPARKLE_FORCE_INSTALL_DURING_MARATHON=1` 恒 fail） |
| **修复目标版本** | Sparkle **1.26.94**（脚本层，无 pkg 行为变） |
| **根因** | P23 hard gate 正确默认拒装；缺 operator 显式 override 通道 |
| **修复** | `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1` → skip conn/quiesce/snapshot gate · 日志 WARN |
| **副作用** | sparkle-service 重启 · `cursor_conn` 12→7（部分 Connect 流中断）— operator 已知代价 |
| **关联文件** | `scripts/lib/marathon-core-restart-guard.sh` |
| **用户动作** | 仅马拉松期确需时用：`SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 bash scripts/install-sparkle-local.sh` |
| **踩坑** | override ≠ 无代价；与铁律 #5 冲突时须 operator 明示；正常路径仍等 `cursor_conn=0` |

### BUG-2026-07-29-027 · v1.26.94 · nat_stale_suspect_observe + stale_rid_rescue_ssot (P27b + R-B)

| 字段 | 内容 |
| --- | --- |
| **状态** | **EXEC-CODE-DONE** @ **1.26.94** · SOAK-PENDING |
| **症状** | L3 split-brain：token_gap≥180s + api2 绿 + HTTP SSE `server-eof` · rescue 日志 `outcome=executed` 在 dead SSE 上误导 |
| **关联产品** | Sparkle **1.26.94** · JP-VPS-HY2 · Cursor-3.1.15 |
| **bug 存在版本** | Sparkle ≤1.26.93（P27b core-only 未 wired runtime；stale_rid SSOT 缺失） |
| **修复目标版本** | Sparkle **1.26.94** · git `125fbbd` |
| **修复 P27b** | `natStaleSuspectObserverCore.ts` · `natStaleSuspectObserver.ts` · hook `agentTransportFailureSync.ts` on server-eof → `[NatStaleSuspect]` + `network-stability-events.jsonl` kind `nat_stale_suspect`（**observe-only，无 recovery**） |
| **修复 R-B** | `cursorHy2MarathonKeepaliveCore.ts` `resolveRescueDialLogOutcome` — stale RID 不再误标 `executed` |
| **回归** | `natStaleSuspectObserverCore.test.ts` · `cursorHy2MarathonKeepaliveCore.test.ts` 15/15 |
| **用户动作** | `install-sparkle-local.sh` → app **1.26.94** · 验收 jsonl `nat_stale_suspect` |
| **踩坑** | P27b **不触发 dial**；仅 triage；L3 物理 EOF 仍可能发生 |

### BUG-2026-07-29-026 · v1.26.92 · marathon_pulse_registry_desync + hy2_sse_silent_eof (P24/P25/P27)

| 字段 | 内容 |
| --- | --- |
| **状态** | **P24/P25/P27 EXEC-CODE-DONE** · SOAK-PENDING · 当前安装 **1.26.94** |
| **症状** | Jul29 **10:35 双路** + **11:12–11:16 四段级联** · `streamPrimarySub=server-eof` · parent `445ba497` 单 userMessage 断 **4 次** · ghost resume ≥4 Included |
| **关联产品** | Sparkle **1.26.90** · Cursor-3.1.15 · JP-VPS-HY2 · sing-box **1.14.0-alpha.48** |
| **bug 存在版本** | Sparkle ≥1.26.77（P15 pulse gate 仅认 registry + 512KB tail 假阴性） |
| **修复目标版本** | **1.26.93**（P24+P25+P27） |
| **PRIMARY 根因** | **L3** — Mac→JP HY2 QUIC 马拉松 SSE **长流静默 server-eof**（split-brain：短 api2 287–321ms 绿 · VPS sing-box @ A **0 error** · SSH 11:12 复核） |
| **AMPLIFIER 根因** | P15 pulse gate 三重 false-negative → **10:35 34min** + **11:12 13.5min** pulse blackout（`app-2026-7-29.log` 末 pulse `03:00:51Z` → 下次 `03:14:20Z`） |
| **TERMINAL（非 PRIMARY）** | `1e5c49ca` @11:16:11 · `serverErrorRetries=3` · UI `Stream ended without turnEnded` — 级联终点 |
| **修复 P24** | `marathonSSETruthCore.ts` — parent-chain `httpStartMs` SSOT · pulse → `marathonTruthPulseDue` · segment cache |
| **修复 P25** | HTTP SSE jsonl · NWPathMonitor · incident_bundle 自动采集 |
| **修复 P27** | `hy2TunnelVitalityCore.ts` · `hy2TunnelVitality.ts` — 30s connect_path vitality · outbound HY2 udp-timeout/heartbeat-interval @ generate |
| **关联文件** | P24/P25 见 §11.4–11.5 · P27 见 roadmap §11.7 · R-14 |
| **反复出现次数** | 同类 L3 server-eof **≥5 次/日**（7/29 D+D′+E 四段）；P15 blackout **2 次 definitive**（34min + 13.5min） |
| **为何反复修不好** | ① 只修 VPS 入站未修 Mac 出站 ② pulse/rescue 误当「保活长流」③ registry 单源 gate 假阴性直到 BUG-026 |
| **如何避免再翻车** | 装 **1.26.93** → soak 双锚点（零 breach + server-eof 率降）→ 外部锚点：parent 链 server-eof / ghost Included |
| **踩坑** | ① nudge 绿 ≠ SSE 活 ② stale_rids rescue =  post-mortem ③ UI transport 错误 ≠ 新根因 ④ P26 已被 partition 窗占用 — 隧道活性叫 **P27** |

#### BUG-026 · P24/P25 代码审计（2026-07-29 · feedback#9）

| 审计项 | 结论 | 证据 |
| --- | --- | --- |
| **单测** | **52/52 pass**（含 runtime cache+tail 合并 · P27 executor） | marathon 栈全覆盖门控+executor |
| **覆盖率** | **~70%** P24/P25/P27 栈 | 90% 需 E2E soak，非单测可达 |
| **P24 可用性** | 门控逻辑正确；**不能治 L3** | `shouldRunIndependentConnectPathPulse` 仅认 `marathonTruthPulseDue`（`marathonTransportDialOrchestratorCore.ts:107`） |
| **性能风险** | 中 | `readMarathonSegmentCache` 每 cycle 全文件读（`marathonSegmentCache.ts:71-89`）；长跑 append-only jsonl 线性增长 |
| **测量衰减 R-A** | **命中** | pulse 绿 ≠ SSE 活（7/29 @ gapSinceActivityMs=7）；验收须 parent 链 server-eof 外部锚点 |
| **古德哈特 R-B** | **命中** | rescue `outcome=executed` 可在 stale_rids 上虚高；P27 须独立 `hy2_tunnel_vitality` SSOT |
| **向上失明 R-C** | **命中** | 1.26.92 仍无 Mac outbound QUIC 活性 → L3 必复发直至 P27 |
| **1.26.92 会引入新 bug 吗** | 低概率语法 bug；**中概率目标误判** | 更多 pulse dial → observability 预算争用；segment cache I/O；**不会**因 P24  alone 消除 server-eof |
| **同类 bug 还会来吗** | **会**（不同族） | L3 server-eof 直至 P27 · L7 ~90min gen-end（P22）· L2 mutation（§4 kernel 未完成）· ISP 硬断 |

> **2026-07-28 最新**：**BUG-2026-07-28-025** — 马拉松期 L0–L3 误杀健康连接 · **1.26.89**（R-07 zero-disruption）· **BUG-024** G22 rescue · **BUG-023** force install · **BUG-022** 见下

### BUG-2026-07-28-025 · v1.26.89 · marathon_transport_recovery_zero_disruption (R-07)

| 字段 | 内容 |
| --- | --- |
| **状态** | EXEC-CODE-DONE · SOAK-PENDING |
| **症状** | 马拉松 conn≥12 时 TransportHealth L0/L1 仍可能 close hung 连接；L2 flush 全 outbound；L3 restart core — 误杀活跃 SSE，浪费 500 配额 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≤1.26.87（L0/L1 仅部分 hard-disable；L2/L3 无 marathon guard） |
| **修复目标版本** | Sparkle **1.26.89** |
| **根因** | `executeTransportRecovery` 未与 `cursorConnectionHygieneCore.shouldSkipCursorConnectionHygieneClose` 对齐 |
| **修复** | L0–L3 @ conn≥12 或 quiesce active → log disabled + no-op · 与 Hygiene marathon_guard 同阈值 |
| **关联** | `cursorTransportHealth.ts` · `marathonQuiesce.ts` · Sparkle SSOT open-perplexity `temp-docs/repair/CURSOR_DISCONNECT_REPAIR_MASTER_SSOT.md` §14 R-07 |
| **回归** | `cursorTransportHealthCore.test.ts` agent-stability-first · `cursorConnectionHygieneCore.test.ts` marathon skip |
| **用户动作** | `upgrade:mac` @ cursor_conn=0 → app-log 马拉松窗口零 `L2 flushed all` / `L3 restarting` |
| **踩坑** | 低 conn 非马拉松窗口 L2/L3 仍保留（TUN 真丢灾难路径）；与铁律 #5「马拉松禁杀连接」不冲突 |

### BUG-2026-07-28-024 · v1.26.87 · marathon_force_install_hard_gate (P23)

| 字段 | 内容 |
| --- | --- |
| **状态** | EXEC-CODE-DONE · SOAK-PENDING |
| **症状** | Jul28 10:52 `force install` Sparkle 1.26.84 → `core_cold_restart` → mihomo/TUN reset → 马拉松断连（L2 自伤） |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≤1.26.86（upgrade 脚本可绕过 P10 marathon guard） |
| **修复目标版本** | Sparkle **1.26.87** |
| **根因** | `SPARKLE_FORCE_INSTALL_DURING_MARATHON=1` 未 hard-fail；pkg 安装未统一 PRE-gate |
| **修复** | `scripts/lib/marathon-core-restart-guard.sh` 默认拒绝 force install · audit 日志 · **显式 override**：`SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1`（operator opt-in，见 BUG-028） |
| **回归** | marathon-core-restart-guard 脚本 gate |
| **用户动作** | 禁止马拉松期 force install；任务结束后正常 `upgrade:mac` |

### BUG-2026-07-28-023 · v1.26.85 · rescue_skipped_weak_probe_amplifier (G22)

| 字段 | 内容 |
| --- | --- |
| **状态** | EXEC-CODE-DONE · SOAK-PENDING |
| **症状** | Jul28 15:41 c8346504 mass PING · app-log 07:40:28 `connect_partition outcome=skipped_weak_probe` @ conn=290 delay=0 → 43s 后 transport 分区 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≤1.26.84 |
| **修复目标版本** | Sparkle **1.26.85** |
| **根因** | `executeHy2SessionDialWithGuard` delay≤0 否决 **含 marathon_rescue** 的 dial |
| **修复** | G22 `forceOnWeakProbe:true` @ `marathonRescueDialExecutor.ts` · rescue 路径不受 weak delay veto |
| **遗漏** | **warmth** nudge（`marathonWarmthDialExecutor.ts`）delay=0 仍 skip — 非 L3 主因，已记入 SSOT |
| **回归** | `marathonRescueDialExecutor.test.ts` G22 @ conn=290+delay=0 |
| **用户动作** | `upgrade:mac` → partition 窗口验 `MarathonRescueDial outcome=executed` |

### BUG-2026-07-28-022 · v1.26.88 · l7_long_segment_silent_eof_handoff (P22a)

| 字段 | 内容 |
| --- | --- |
| **状态** | EXEC-CODE-DONE · SOAK-PENDING（execute：**patch-315 ssot-v2** @ Cursor-3.1.15 + c2-wb-025 @ Cursor-2） |
| **症状** | Jul28 14:47–14:50 c69260ad/cc6c19f8/11b777ba @ ~89–91min · Jul31 02:19/02:33 bffe9764/7375edad @ ~106/120min HY2 QUIC silent EOF → ghost resume 烧 Included |
| **关联产品** | Sparkle（detect + quic-stall-ssot.json）+ Guard patch-315（execute） |
| **bug 存在版本** | 无客户端段轮换 · observe-only ghost resume · patch-315 QUIC reader dead（row.stall_ms） |
| **修复目标版本** | Sparkle **1.27.5+**（P22b detect + ssot writer）· Guard **0.16.28+** patch-315 ssot-v2 |
| **修复** | Sparkle `quicStallSsot.ts` + `cursorSegmentHandoff*` @ hung_scan · WB patch-315 queue+resumeChat @ ~85min（QUIC stall → ~75min）· pendingTool deferred |
| **诚实边界** | 服务端 ~89min cap 无法 100% 消除；首跑须验 `[SegmentHandoff] outcome=executed phase=resume-chat-invoked` |
| **踩坑** | Sparkle detect 与 WB execute **双轨独立**；仅 deploy WB 后 execute 生效 · `submitChat` eager bind 避免 service 未捕获 |
| **SSOT** | Sparkle open-perplexity `temp-docs/repair/CURSOR_DISCONNECT_REPAIR_MASTER_SSOT.md` §11.2 · Guard312 `segmentHandoffCore.mjs` |

> **2026-07-28 最新**：**BUG-2026-07-28-021** — Cursor/logs `.DS_Store` ENOTDIR 致 MTDO/rescue/hung_scan 全灭 · **1.26.85**（P21）

### BUG-2026-07-28-021 · v1.26.85 · cursor_log_session_dir_filter (P21)

| 字段 | 内容 |
| --- | --- |
| **状态** | EXEC-CODE-DONE · SOAK-PENDING |
| **症状** | Jul28 08:02 起每 15s `[CursorTransportHealth]: hung scan failed: ENOTDIR …/Cursor/logs/.DS_Store` · `[MarathonTransportDial]: outcome=failed` · 零 `MarathonRescueDial outcome=executed` · P19 rescue 平面 100% 离线 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≥1.26.77（`listRendererLogFiles` 未过滤非目录项） |
| **修复目标版本** | Sparkle **1.26.85** |
| **根因** | `agentTransportFailureSync.ts` `listRendererLogFiles`/`listCursorStructuredLogFiles` 用 `existsSync` 过滤 session，`Cursor/logs/.DS_Store` 文件通过后被 `readdir` → ENOTDIR |
| **修复** | P21 `listCursorLogSessionDirs()` — `stat().isDirectory()` + 跳过 dotfile · 两 list 函数共用 |
| **回归** | `agentTransportFailureSync.test.ts` BUG-021 case |
| **用户动作** | 临时：`rm ~/Library/Application\ Support/Cursor/logs/.DS_Store` · 永久：`upgrade:mac` → soak 验零 ENOTDIR + `MarathonRescueDial outcome=executed` |

> **2026-07-28 最新**：**BUG-2026-07-28-020** — P20a LatencyTruth + P20b IDLE dial-tolerance + P20c triage 三门 · **1.26.84**（§29 闭合）

### BUG-2026-07-28-020 · v1.26.84 · p20_stability_closure (LatencyTruth + IDLE apply + triage gates)

| 字段 | 内容 |
| --- | --- |
| **状态** | EXEC-CODE-DONE · SOAK-PENDING |
| **症状** | conn 跨 12 时 dial-tolerance reload 可能在活跃 Marathon 流期间触发 · 300 vs 500 口径易误判 Sparkle 加税 · triage 缺 VPS/Latency 自动化门 |
| **关联产品** | Sparkle |
| **修复目标版本** | Sparkle **1.26.84** |
| **根因** | `marathonDialTolerance.ts` 仅 conn≥12 defer · exit reload 无 `hasActiveMarathonStream` gate · 无 `[LatencyTruth]` SSOT log |
| **修复** | P20a `latencyTruthGateCore.ts`+`latencyTruthGate.ts` @ VpsL4 300s · P20b `marathonDialToleranceIdleApplyCore.ts` stream/quiesce IDLE gate · P20c triage `VPS_CONTRACK_OK`/`VPS_HY2_UDP_TIMEOUT_OK`/`SPARKLE_LATENCY_TAX` |
| **回归** | `marathonDialToleranceIdleApplyCore.test.ts` · `latencyTruthGateCore.test.ts` |
| **用户动作** | `upgrade:mac` → soak 验 P19 executed + `[LatencyTruth] high=0` |

> **2026-07-28**：**BUG-2026-07-28-019** — MTDO rescue 执行自锁 + connect_partition 弱 bundle + 分区窗错位 · **1.26.83**（P19/P20 §29）

### BUG-2026-07-28-019 · v1.26.83 · mtdo_rescue_execution_plane (P19/P20 §29)

| 字段 | 内容 |
| --- | --- |
| **状态** | EXEC-CODE-DONE · SOAK-PENDING（§27.8 9/14 · 需 upgrade:mac + live executed 验） |
| **症状** | Jul27 22:31–0:58 mass PING @ conn≥20 · `connect_partition` 检出 · 100% `skipped_mtdo_in_flight` · 零 `outcome=executed` rescue · Marathon 断连浪费 500 次数 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≥1.26.75（BUG-019 guard 引入） |
| **修复目标版本** | Sparkle 1.26.83 |
| **根因** | **G10** `cursorHy2MarathonKeepalive.ts` mtdo re-entrancy guard · **G12** connect_partition→session_rescue_bundle 无三探针 pulse · **G11** 分区窗 8s&lt;scan 15s · **G16/G21** Marathon 期间零 recovery 平面 |
| **修复** | P19a `MarathonRescueDialExecutor`+`MarathonWarmthDialExecutor` · 删 mtdo guard · connect_partition/latency_delta→connect_rescue_bundle · G11 窗=15s@conn≥12 · `PartitionLatch` · G15 blind_spot candidate 检 · P20b dial-tolerance IDLE defer @conn≥12 |
| **回归** | `marathonTransportDialOrchestrator.integration.test.ts` G10/G12 · `connectPartitionDetectCore.test.ts` G11 · `partitionLatchCore.test.ts` · `partitionBlindSpotCore.test.ts` G15 |
| **用户动作** | `upgrade:mac` → soak @conn≥20 mass PING 后验 `[MarathonRescueDial] outcome=executed` · 无 `skipped_mtdo_in_flight` |

> **2026-07-27 最新**：**BUG-2026-07-27-018** — hot+jsonl 双计数 + jsonl homedir 固化 + blind_spot 缺失 · **1.26.78**（P18）

### BUG-2026-07-27-018 · v1.26.78 · transport_observability_hardening (P18)

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | P17 ship 后 audit 发现：sync→MTDO 同事件双计数 · CTHC/测试 homedir 模块加载固化 · mass PING 时 jsonl=0 无 blind_spot 告警 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≤1.26.77 |
| **修复目标版本** | Sparkle 1.26.78 |
| **根因** | `readConnectPartitionSignalAsync` 未 dedupe · `connectPartitionReader` jsonl 路径 module-load homedir · §25.3.4 观测项未 implement |
| **修复** | P18a `transportObservabilityMergeCore` · P18b `partitionBlindSpotCore` + MTDO 日志 · P18c Structured tail cache + roots 60s TTL · P18d triage v3.4 · RetriableError parser · homedir 动态化 |
| **回归** | `transportObservabilityMergeCore.test.ts` · `partitionBlindSpotCore.test.ts` · `connectPartitionReader.test.ts` · 520a4a94 replay pingFailureCount=2 |
| **用户动作** | `upgrade:mac` → soak @conn≥80 · mass PING 时验 `[CursorLogPlane]` + 可选 `[PartitionBlindSpot]` |

> **2026-07-27**：**BUG-2026-07-27-017** — Cursor 3.x Structured Logs 失明 · **1.26.77**（P17）

### BUG-2026-07-27-017 · v1.26.77 · cursor_log_plane_ssot + nal_transport_ingest (P17)

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | RID `520a4a94` @ conn≈436 · `[unavailable] PING timed out` · MTDO `skipped_coalesced` · 零 `connect_partition_rescue_nudge` · jsonl 无该 RID |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≤1.26.76 |
| **修复目标版本** | Sparkle 1.26.77 |
| **根因** | `agentTransportFailureSync` 仅扫 `Cursor-*-data`；Cursor 3.x 主日志在 `Cursor/logs` · NAL `Stream error reported…` JSON 无 parser · hung_scan 只读 jsonl tail |
| **修复** | P17a `discoverCursorLogRoots()` SSOT · P17b `parseCursorStructuredTransportLine`（含 originalRequestId）· P17c `readConnectPartitionSignalAsync` Structured hot tail |
| **反复次数** | 第 1 次闭合此 observability blind spot |
| **为何反复** | P16 假设 Diagnostic/renderer 已覆盖全部 PING 源；未读 Structured Logs |
| **踩坑** | Structured 行 `requestId`≠马拉松 `originalRequestId`；partition 必须用后者 |
| **回归** | `cursorLogDiscoveryCore.test.ts` · `agentTransportFailureSync.test.ts`（520a4a94 fixture）· `connectPartitionReader.test.ts` |
| **用户动作** | `upgrade:mac` → 续跑当前 RID / 新 marathon soak @conn≥200 |
| **代码位置** | `cursorLogDiscoveryCore.ts` · `cursorStructuredTransportIngestCore.ts` · `agentTransportFailureWriterCore.ts` · `connectPartitionReader.ts` |

> **2026-07-27**：**BUG-2026-07-27-016** — ultra-conn QUIC 饱和 Rescue 失明 + latencyDelta dead path · **1.26.76**（P16）

### BUG-2026-07-27-016 · v1.26.76 · connect_ping_storm + latency_delta_rescue (P16)

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | @816 conn Network Diagnostic 四路 FAIL（PING/Chat/Agent/Downloads）；Sparkle 仅 `session_transport_nudge_deferred` · 零 `connect_partition_rescue_nudge` |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle ≤1.26.75 |
| **修复目标版本** | Sparkle 1.26.76 |
| **根因** | Diagnostic PING 未写入 jsonl；`high_latency_warmth` @conn≥80 defer；`latencyDeltaGate` 只观测不 dial |
| **修复** | P16a Diagnostic/structured log ingest + synthetic partition @defer×2+VpsL4 ok + **conn≥200 分区窗 60s** + coalesce 虚拟 defer 计数；P16b `latency_delta_rescue`；P16c `UltraConnObservability` |
| **反复次数** | 第 1 次闭合此 failure mode |
| **为何反复** | P13 假设 jsonl 有 PING 行；Diagnostic 路径未收敛 |
| **踩坑** | conn>500 defer ≠ VPS 宕；看 `UltraConnObservability` + VpsL4Probe |
| **回归** | `connectPingStormCore.test.ts` · `marathonTransportDialOrchestratorCore.test.ts` · `agentTransportFailureSync.test.ts` |
| **用户动作** | `upgrade:mac` → soak 30min @conn≥80 · 手动 Diagnostic 一次 |
| **代码位置** | `connectPingStormCore.ts` · `marathonTransportDialOrchestrator.ts` · `agentTransportFailureSync.ts` |

> **2026-07-24 最新**：① **BUG-2026-07-24-015** — rescue bypass delay probe slot · **1.26.70** ② **BUG-2026-07-24-014** — quiesce bypass · **1.26.69** ③ **BUG-2026-07-24-013** — L2 fake-ip flush · **1.26.69**

每次修复用户可感知 bug 后 **必须追加一条**。架构见 open-perplexity **Master SSOT** · [`reports/cursor-marathon-playbook.md`](reports/cursor-marathon-playbook.md) · [`src/main/core/_ARCH.md`](src/main/core/_ARCH.md)；本文件只做 **修复台账**。


## 2026-09-16 · 自动选择 稳态化（国家节点 + 防抖 + 分钟级切换）

### 交付语义（当前代码 = 本文描述，无历史过程）
- **名单**：`sparkle-fast` provider，成员 = 国家/地区节点（国旗 emoji 或国家名命中，香港剔除）∧ 实测 ≤2000ms ∧ 最近探测可用，**整份名单按最佳已知延迟升序**（第一个 = 最低延迟）。
- **检测**：主进程每 5 分钟重写名单（`fastNodeProviderScheduler`，60s 内去重重复触发；失败快速重试）。
- **切换**：60s 级看门狗（`runAutoSelectWatchdogTick`）只盯当前选中节点——实测 >2000ms 或超时 → 立即切到名单内最低延迟节点；长流期间（marathon quiesce）"慢但活着"让路，"不可用"必切。
- **防抖**：本轮"没测到"= 无证据，既有成员按上次已知延迟保留（`sparkle-fast-state.json`）；实测超预算/超时才剔除。
- **可手动**：`自动选择` = select，手动选中只要 ≤2000ms 就不被看门狗打扰。

### 实测证据
- 名单：0 占位（流量重置/到期/推广）、0 香港；`sparkle-fast-state.json` 持久化各节点 lastDelayMs。
- 全量 707 项：701 pass / 6 fail（既有失败，与基线一致）· tsc 0（由 128 清零）· eslint 0。
- `proxy7890=200` 持续可用；看门狗/刷新均由主进程驱动（不依赖 GUI）。

### 遗留（非本轮范围，如实列出）
- 6 个既有测试失败在他人的未提交 WIP 文件中（agentTransportFailureSync / cursorLogDiscoveryCore / hy2×2 / proxy-delay-sample-age）。
- 物理层：本机电信国际出口劣化（软件不可修），劣化窗口内最优节点也可能慢。
- 包内含他人未提交 WIP 文件（版本可复现性风险）。


### 2026-09-16 下午 · byte-death 恢复阶梯去死锁 + 证据去幽灵化（事故 14:28-14:30）
- **死锁修复**（`hy2ParentByteDeathRecoveryCore.ts` / `ExecutorImpl.ts`）：UDP 父会话缺席且有冻结叶连接时，规划器产出 `close_leaf_connections`（reason=`byte_death_udp_absent_close_leaf_rebuild`），执行器关闭冻结叶连接逼 mihomo 重建 HY2 父会话——不再死等已被移除的整核冷重启（此前三方互等 ~4 分钟）。无目标时仍上交协调器叶轮换。事故实测：本次恢复正是"连接重建 + 看门狗切自动选择"生效。
- **证据去幽灵化**（`mihomoQuicSilentStallObserver.ts`）：`transport-longevity-truth.json` 的 `activeHy2Leaf` 每次写入都用实时连接链解析值（解析不到回退 `KR-VPS-HY2`），禁止沿用旧快照里已下线的叶名（事故中幽灵名 `JP-VPS-HY2` 污染了 Collective Death 报告的 leaf 字段）。
- 关联 fixture 同步新不变量：`eadc68de`（close-leaf rebuild）、C-8.13（core/executor 单测）；`0903` fixture（无 tracked 目标场景）语义不变。
- 8/26 fixture 场景 `plan=close_leaf_connections` 代替 `none`：副作用 = 关闭 ≤8 条冻结叶连接会触发 Cursor 自动重连（预期内，非破坏性）。


### 2026-09-16 晚 · `自动选择` 整体简化为 mihomo 原生 url-test（应用户"能简单一点吗"）
- **删除**：sparkle-fast provider 机制三模块（fastNodeProvider/Core/Scheduler，~700 行）+ 状态文件 + 60s 看门狗 + 去重锁/并发锁 + provider 注册 + 20 个自定义测试。净删后自动选择相关代码 = 一个配置组 + 一条国家白名单正则。
- **保留行为**（全部由 mihomo 原生承担）：5min 测速（interval 300）；当前节点测速失败立即落最低延迟；tolerance 2000 = 新节点快 2000ms 以上才切（"超预算才切"防抖）；国家白名单 filter（`regionPriority.buildAutoSelectCountryFilter`，香港不含任何关键词天然排除）；lazy 长流不打扰；url-test 支持手动固定。
- 无 provider 时回退：url-test over 地区组（原生最低延迟择优）。
- **验证**：装机后 `work/config.yaml` 组结构符合预期（url-test/filter/use 678a1sub001）、sparkle-fast 残留=0、google204=204、accounts=302；全量 705 项 = 699 pass / 6 fail（既有，零回归）；tsc 0 · eslint 0。


### 2026-09-16 晚 · 移除 Cursor 专用 failover 监视器（应用户"去掉 cursor 机制"）
- **删除** `proxyHealthMonitor.ts` 及全部接线：主进程 core-ready 启动/注册、3 个 IPC handler、渲染进程封装、数据面门禁条目。理由：🎯 Cursor 专用组成员含 `自动选择`（url-test 自愈），监视器的 5 分钟主动探测成为唯一活跃噪声源（槽位竞争误判、订阅刷新兜底等反复出 bug）。
- 现状：Cursor 组 = 手动 select（选 `自动选择` 即跟随原生自愈；选 VPS 叶则手动管理）；byte-death 阶梯保留为**事件驱动**的通道级兜底（仅在检测到真实冻结时介入）。
- 顺带清零渲染层 5 个既有类型错误（缺 import、通知 actionProps、delay purpose 联合对齐），web tsc = 0。


### 2026-09-16 晚 · 自动选择 = 地区优先级链（应用户"优先选择台湾日本韩国新加坡"）
- 结构：`自动选择` = 原生 fallback，成员顺序 = 台湾→日本→韩国→新加坡→美国→其他地区；前五为**手动 select 地区组**（用户规则：地区组永不自动切换，未做任何改动）；「Sparkle-其他地区」= 新增 url-test 兜底组（非优先国家自动最低延迟）。
- 语义：台湾可用就只用台湾；台湾当前节点探测失败 → 自动降级到日本 → 韩国 → 新加坡 → 美国 → 其他。探测目标 `gemini.google.com`（用户主用服务），interval 300 / timeout 5000 / lazy。
- 用户偏好顺序同步更新：`DEFAULT_REGION_PRIORITY` + 线上 `config.yaml proxySwitchPriority`。
- 装机验证：组结构/fallback 链/兜底组均符合预期；google204=204、gemini=200；tsc 双 0 · eslint 0 · 全量 704 项 = 697 pass / 6 fail（既有，零回归）。


### 2026-09-16 晚 · `自动选择` 终版结构（fallback + sparkle-fast 纯排序 provider）
- **根因认知（本次挂机的直接原因）**：mihomo 配置**解析期**不识别 provider 节点名——`proxies: [provider节点名]` 永远过不了 Profile Check（`自动选择: 'X' not found`）→ 内核拒绝启动 → 订阅更新也无法应用（死锁）。任何"按名字平铺 provider 节点"的方案在 mihomo 里都不成立。
- **终版结构**：
  - `自动选择` = 原生 fallback，`use: [sparkle-fast]`；组级检查 url=`gemini.google.com`、interval 300、timeout 5000、lazy。
  - `sparkle-fast` = Sparkle 托管的文件 provider：**每次 generateProfile 时按地区优先级重写**（台湾→日本→韩国→新加坡→美国→其他非优先国家，香港排除，去重保序）。纯排序，无测量/状态/看门狗。
  - fallback 原生语义：按顺序用第一个可用节点；当前节点探测失败自动降级；更高优先级恢复自动升回。
  - 地区组保持手动 select（用户规则），未做任何改动。
- 代码：`sparkleFastProviderCore.ts`（纯函数：常量 + orderProxiesByRegionPriority + buildSparkleFastProviderDocument）；文件写入由 `factory.ts generateProfile` 持有（fs/路径不进纯模块，避免 electron 依赖）。
- 验证：内核自检通过并启动（pid 16906）；`google204=204 (0.56s)`、`gemini=200`；tsc（node+web）双 0 · eslint 0 · 全量 704 项 = 697 pass / 6 fail（既有，零回归）。
- lazy 正名：`lazy=true` = 组空闲时跳过定时探测（省流量）；组在使用中时探测照常——与"长流打扰"无关（此前表述有误，已纠正）。


### 2026-09-17 · 修复"每日订阅更新被守卫永久推迟"
- **根因**：订阅更新本来就走**热刷新**路径（`setProfileStr` → `generateProfile` + provider 热刷新，无内核重启、不打断连接），但两层门禁沿用"冷重启"契约把热刷新一并拦住：① CLI 入口先用冷重启守卫整体拦截（cursor_conn>0 即 defer）；② 热刷新 defer 与冷重启共用同一决策（conn>0 即 defer）。用户全天开着 Cursor → defer 永不解除 → 每天 07:00 更新永远不落地。
- **修复**：① CLI（`profileUpdateDueCli.ts`）不再用冷重启守卫拦截 due 更新（热刷新连接安全，流保护在刷新路径自身的 defer 契约里）；② `shouldDeferProfileProviderReload` 改为仅在 quiesce 或 active marathon lifecycle 时 defer（`cursor_conn>0` 不再单独拦截——provider PUT 只影响新连接，不杀现有连接）。
- 门禁条目同步：`profile_update_due_hot_reload`（requiredPatterns=runDueProfileUpdates）。
- 语义基线：每天 07:00 订阅更新照常触发；Cursor 全天运行也会应用（热刷新不杀连接）；仅在有活跃 marathon 长流生命周期时让路。

## 记录模板（复制追加）

```markdown
### BUG-YYYY-MM-DD-NNN · vX.Y.Z · 模块名

| 字段 | 内容 |
| --- | --- |
| **状态** | OPEN / FIXED / PARTIAL |
| **症状** | 用户看到什么 / 什么操作失败 |
| **关联产品** | Sparkle / Cursor Usage Guard / Cursor IDE |
| **bug 存在版本** | Sparkle x.y.z（及关联扩展版本） |
| **修复目标版本** | Sparkle x.y.z+1 |
| **根因** | 证据（log / 代码路径 :行号） |
| **修复** | 文件 + 行为变化（一句话） |
| **反复次数** | 第 N 次发现 / 第 M 次修复尝试 |
| **为何反复** | 架构/监控盲区反思 |
| **踩坑** | 后续开发者必读教训 |
| **回归** | 单测 / 手动验证 |
| **用户动作** | 临时 workaround |
| **代码位置** | grep 锚点 |
```

---

## 2026-07-24

### BUG-2026-07-24-010 · v1.26.66 · KR-VPS 关服（源码 + SSH L4 探针）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | KR 自建 VPS（141.164.43.229）关服后 app.log 每 300s 出现 `kr-vps` SSH L4 探针超时；用户配置已删 KR-VPS 节点 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.65** |
| **修复目标版本** | Sparkle **1.26.66** |
| **根因** | `vpsL4ProbeCore.ts` `VPS_SSH_HOSTS` 硬编码 kr-vps/jp-vps；`vpsDirectBypass` 注入 kr-vps DIRECT 规则；canonical 节点含 KR-VPS |
| **修复** | 移除 kr-vps SSH 探针与 DIRECT 别名 · JP-only canonical/triangulation · 用户 profile 已清 KR-VPS |
| **反复次数** | 第 1 次 |
| **踩坑** | 用户数据与源码硬编码需同步清理；asar 热更不能替代正式装包 |
| **回归** | `vpsL4ProbeCore.test.ts` · `vpsDirectBypass.test.ts` · `vpsCanonicalNodes.test.ts` · `networkTriangulationDiagnosticCore.test.ts` |
| **用户动作** | 升级 **1.26.66** 并重启 Sparkle |
| **代码位置** | `vpsL4ProbeCore.ts` · `vpsDirectBypass.ts` · `vpsCanonicalNodes.ts` · `networkTriangulationDiagnosticCore.ts` |

### BUG-2026-07-24-011 · v1.26.67 · hung_scan appendAppLog ReferenceError（P13d connect_partition 失明）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | app.log **5021×** `hung scan failed: appendAppLog is not defined`；全仓 **零** `connect_partition_nudge`；PING cluster 存在但 rescue 永不落 log |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.66** |
| **修复目标版本** | Sparkle **1.26.67** |
| **根因** | `cursorHy2MarathonKeepalive.ts` 调用 `appendAppLog` 但未 import → hung_scan @15s 抛 ReferenceError → `runMarathonSessionWarmthIfDue` 中断 |
| **修复** | 补 `import { appendAppLog } from '../utils/log'` |
| **反复次数** | P13d soak 第 1 轮日志实锤 |
| **为何反复** | 单测 mock 未覆盖 executor 层 import 完整性 |
| **踩坑** | outcome 日志在 TransportHealth 层，executor 内 appendAppLog 缺 import 仍让 hung_scan 整体 fail |
| **回归** | 装包后 app.log 无 `hung scan failed: appendAppLog`；conn≥12 + PING cluster 应见 `connect_partition_nudge outcome=` |
| **用户动作** | 升级 ≥1.26.67 |
| **代码位置** | `cursorHy2MarathonKeepalive.ts:4` |

### BUG-2026-07-24-015 · v1.26.70 · marathon_rescue bypass mihomo delay probe slot

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED（待装包） |
| **症状** | ledger transport_pair P50=300ms 但 P90/outlier 5001–41919ms；Marathon conn 高时 rescue dial 排队等 2-slot |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.69** |
| **修复目标版本** | Sparkle **1.26.70** |
| **根因** | `mihomoProxyDelay` 一律 `withMihomoDelayProbeSlot`（max=2）；rescue 虽 bypass P12 budget + quiesce(014) 仍进 slot 队列 |
| **修复** | `shouldBypassMihomoDelayProbeSlot` → `purpose=marathon_rescue` 直调 `mihomoProxyDelayUnchecked` |
| **反复次数** | Latency Truth 误判链第 3 环（TUN 税 → 实探 probe 排队税） |
| **踩坑** | 5001ms=5s probe timeout 不是 HY2 RTT；badge 须 dual-track + outlier aware |
| **回归** | `mihomoProxyDelayCore.test.ts` |
| **用户动作** | 一次性升 **≥1.26.70**（含 014+013+015） |
| **代码位置** | `mihomoProxyDelayCore.ts` · `mihomoApi.ts` |

### BUG-2026-07-24-014 · v1.26.69 · rescue dial bypass quiesce healthcheck（BUG-012 补完）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED（待装包 log 验收） |
| **症状** | **1.26.68 已装**仍 **422×** `Resource not found` @ conn 14–15；与 `marathon_quiesce ON` + `provider health-check OFF` 同窗口（10:05–10:19） |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.68**（012 只 refresh provider，fallback 仍被 quiesce 掐 healthcheck） |
| **修复目标版本** | Sparkle **1.26.69** |
| **根因** | MTCP rescue bypass P12 budget，但 `mihomoProxyDelayFromProvider` 仍 `shouldAllowObservabilityDial('provider_healthcheck_api')=false` → delay=0 → rethrow Resource not found |
| **修复** | `MihomoDelayOptions.purpose='marathon_rescue'` · rescue keepalive/stream 传入 · bypass quiesce + `refreshProviderLeafBeforeDelay` 强制 healthcheck |
| **反复次数** | 012 标 FIXED 误判 1 次（未做装包后 log grep） |
| **为何反复** | 验收用「代码合入」代替「quiesce × dial fallback 交叉实测」 |
| **踩坑** | `token_gap_nudge outcome=failed err=Resource not found` 在 quiesce ON 时应先查 provider health-check OFF |
| **回归** | `mihomoProxyDelayCore.test.ts` · `upgrade-sparkle-local.sh` BUG-014 tail-120 grep 门禁 |
| **用户动作** | **一次性**升 **1.26.69** · 不应再见 failed Resource not found |
| **代码位置** | `mihomoProxyDelayCore.ts` · `mihomoApi.ts` · `cursorHy2MarathonKeepalive.ts` · `cursorConnectStreamKeepalive.ts` |

### BUG-2026-07-24-013 · v1.26.69 · TUN L2 store-fake-ip flush（Phase 4）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | TUN lost → L2 只清 outbound 连接，**不**清 `store-fake-ip` 映射；198.18 过期 fake-ip 加剧 TLS 挂死 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.68** |
| **修复目标版本** | Sparkle **1.26.69** |
| **根因** | `cursorTransportHealth.ts:366` `executeRecoveryL2` 仅 `mihomoCloseConnections()`；roadmap Phase 4 未落地 |
| **修复** | `mihomoFlushFakeIpCache()` → POST `/cache/fakeip/flush`；L2 清池后 flush + 失败可定责日志 |
| **反复次数** | 1（与 BUG-009–012 同批交付，**不再逐 bug 装包**） |
| **为何反复** | 此前每修一个 bug 就 `upgrade:mac` 一次，用户感知为「反复装」 |
| **踩坑** | fake-ip flush 须在 close connections **之后**；失败不阻断 L2 cooldown |
| **回归** | 手动：TUN lost → app.log 见 `L2 flushed fake-ip cache` |
| **用户动作** | 一次性升级 **≥1.26.69**（含 012 Resource not found + 011 hung_scan + Phase 4） |
| **代码位置** | `mihomoApi.ts` · `cursorTransportHealth.ts` |

### BUG-2026-07-24-012 · v1.26.68 · marathon rescue mihomo Resource not found（token_gap/connect_stream 空转）

| 字段 | 内容 |
| --- | --- |
| **状态** | **PARTIAL @1.26.68** → **FIXED @1.26.69**（见 BUG-2026-07-24-014 quiesce bypass） |
| **症状** | app.log **167×** `token_gap_nudge outcome=failed err={"message":"Resource not found"}` + `connect_stream_keepalive_failed` 同 err @conn 43–63；rescue dial 空转 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.67** |
| **修复目标版本** | Sparkle **1.26.68** |
| **根因** | `mihomoApi.ts:401` provider leaf 在 `/proxies` 有 stub 但 `/delay` 404 → 直接 rethrow；quiesce 停 healthcheck 后 leaf 未 re-register |
| **修复** | `mihomoProxyDelayCore.ts` + `mihomoProxyDelayViaProviderLeaf`：Resource not found → `mihomoUpdateProxyProviders` + retry delay（保留 custom url） |
| **反复次数** | P13d 监控 09:42–09:44 实锤 |
| **为何反复** | 旧 fallback 仅在 proxy 不在 `/proxies` 时触发，与 provider leaf 实际语义不符 |
| **踩坑** | mihomo axios reject plain `{message}` 非 Error；须显式识别 Resource not found |
| **回归** | `mihomoProxyDelayCore.test.ts` · 装包后 token_gap outcome=executed 或 skipped_*（非 failed Resource not found） |
| **用户动作** | 升级 ≥1.26.68 |
| **代码位置** | `mihomoProxyDelayCore.ts` · `mihomoApi.ts` |

### BUG-2026-07-24-009 · v1.26.66 · P13 Phase 2.1 region↔leaf 桥接 + 柱图 Mac SSOT

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | Phase 2 装包后 tooltip「VPS 本体 P50」对 JP-VPS-HY2 显示 `—`；leaf 节点 badge 消失（scoresByNode key=JP-VPS 与 proxy.name 不匹配）；非 quiesce 时柱图仍走 mihomo 非 transport_pair |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.65** |
| **修复目标版本** | Sparkle **1.26.66** |
| **根因** | `vpsL4Probe.ts:38` ledger node=region（JP-VPS）· UI 查 leaf（JP-VPS-HY2）无桥接；柱图优先 mihomo history |
| **修复** | `resolveVpsRegionFromLeafNode` + latency truth region 匹配 · `assignStabilityScoreTargets` fan-out · 柱图优先 ledger transport_pair · chip 标「Mac 路径」 |
| **反复次数** | Phase 2 审计第 2 轮 |
| **为何反复** | Phase 2 只做了 method/scope 过滤，未验证 node key 维度 |
| **踩坑** | VPS L4 天然 region 级 · Mac 探针 leaf 级 · 必须显式桥接 |
| **回归** | `vpsCanonicalNodes.test.ts` · `latencyTruthFromLedgerCore.test.ts` |
| **用户动作** | 升级 ≥1.26.66 |
| **代码位置** | `vpsCanonicalNodes.ts` · `commercialNodeBenchmark.ts` · `proxy-detail-tooltip.tsx` |

### BUG-2026-07-24-008 · v1.26.65 · P13 Phase 2 Latency Truth（badge gate + 双轨 tooltip）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | badge P50/slow500 可能混入 scope=vps 非 ssh_curl 样本；tooltip「24h api2 短探测」与 Mac 全路径柱图（含 session_nudge 尖峰）语义混淆，用户无法区分 VPS 本体 vs Mac→TUN→HY2 全路径 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.64** |
| **修复目标版本** | Sparkle **1.26.65** |
| **根因** | `buildRankingBundle` 未过滤 `method=ssh_curl`；柱图 ledger 回填含 `session_nudge`（Marathon 探针尖峰 §17.4）；无 vps/active 双轨 P50 SSOT |
| **修复** | `latencyTruthFromLedgerCore.ts` 双轨 P50 · badge 仅 `scope=vps ssh_curl` · 柱图仅 `transport_pair` · tooltip 双轨展示 + IPC `getLatencyTruthSummaryForNode` |
| **反复次数** | 第 1 次 |
| **为何反复** | — |
| **踩坑** | session_nudge 780ms 尖峰 ≠ VPS 劣化；badge 与 Mac 柱图必须分 scope/method |
| **回归** | `latencyTruthFromLedgerCore.test.ts` · `providerDelayHistoryFromLedgerCore.test.ts` |
| **用户动作** | 升级 ≥1.26.65 · tooltip 看「VPS 本体 P50」vs「Mac 全路径 P50」 |
| **代码位置** | `latencyTruthFromLedgerCore.ts` · `commercialNodeBenchmark.ts` · `proxy-detail-tooltip.tsx` |

### BUG-2026-07-25-019 · v1.26.75 · 删除 dead `cursorConnectStreamKeepalive.ts` · MTDO 唯一执行 SSOT

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | `runConnectStreamKeepaliveIfDue` 在 `src/` 零调用 · 与 MTDO 三探针重复 · dead feature path |
| **修复** | 删 `cursorConnectStreamKeepalive.ts` · HY2 nudge 改查 `isMarathonTransportDialInFlight()` · 保留 `cursorConnectStreamKeepaliveCore.ts` 纯函数 |
| **代码位置** | `marathonTransportDialOrchestrator.ts` · `cursorHy2MarathonKeepalive.ts` · `_ARCH.md` |

### BUG-2026-07-25-018 · v1.26.74 · P16-lite cycle connect_path pulse reuse + parallel probes

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | 同 MTDO cycle：独立 pulse（`ensureCycleConnectPathPulse`）+ `connect_rescue_bundle` 各调 `executeConnectPathPulse` → 6 HEAD |
| **修复** | `cycleConnectPathPulse` cycle-local SSOT · rescue bundle 复用 · 三探针 `Promise.all` · 删 dead plan `connect_path_pulse` |
| **代码位置** | `marathonTransportDialOrchestrator.ts` · `marathonTransportDialOrchestratorCore.ts` |

### BUG-2026-07-25-017 · v1.26.73 · P15 MTDO independent connect_path pulse + partition feed-forward（df1501ed audit）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | df1501ed audit：@ A 06:51:10 `token_gap_rescue_nudge` 已执行但 06:51:54 仍 silent EOF；1.26.72 MTDO `connectPathPartitionDetected` 硬编码 false · pulse 被 token_gap trigger 优先级饿死 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.72** |
| **修复目标版本** | Sparkle **1.26.73** |
| **根因** | connect_path pulse 与 rescue trigger 共用 hung_scan 单选槽 → 有 token_gap 时 60s 三探针不跑；`connect_path_partition` selection dead code |
| **修复** | **P15a** `shouldRunIndependentConnectPathPulse` @ 60s 独立于 trigger 选择 · **P15b** `lastConnectPathPartitionStale` 喂回 selection + inline partition rescue · pulse 不再参与 trigger priority |
| **反复次数** | df1501ed audit 闭环 |
| **为何反复** | pulse 与 rescue 共用 hung_scan 单选槽 |
| **踩坑** | HY2 nudge 保隧道不能复活已 silent EOF 的 Connect 流 — P15 价值在 **流死之前** 发现 split-brain |
| **回归** | `marathonTransportDialOrchestratorCore.test.ts` P15 cases |
| **用户动作** | 升级 **1.26.73** · marathon 见 `[MarathonTransportDial] marathon_connect_path_pulse outcome=executed` 每 ~60s |
| **代码位置** | `marathonTransportDialOrchestratorCore.ts` · `marathonTransportDialOrchestrator.ts` · `_ARCH.md` · `CURSOR-DISCONNECT-TRIAGE.md` |

### BUG-2026-07-25-016 · v1.26.71 · P14 Connect silent EOF split-brain（df1501ed 107min marathon）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | df1501ed @14:51:54：`generation-ended-without-turnEnded` · durationMs=6435381 · gapSinceActivityMs=7622 · HTTP api2 green · Connect stream silent EOF · `agent-transport-failures.jsonl` 缺 RID · token_gap rescue 未触发（gap<20s） |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.70** |
| **修复目标版本** | Sparkle **1.26.71** |
| **根因** | L3 HY2/QUIC Connect 长流 split-brain：HTTP 探针绿但 Connect gRPC 静默 EOF；`TRANSPORT_ERR_RE` 未匹配 IFM `generation-ended-without-turnEnded`；rescue 仅看 ≥20s token gap，7.6s sudden death 漏检；Connect keepalive 缺 agentn 路径探针 |
| **修复** | **P14a** `CONNECT_PATH_PROBE_TARGET` 三探针 + `transport_partition_stale_connect_path` · **P14b** `connect-silent-eof` 持久化（**仅 durationMs≥30min**）· **P14c** `silent_generation_end` rescue（duration≥30min + gap<30s）· **P14d** stale_rid 覆盖 txReqId+originalRequestId |
| **反复次数** | split-brain silent EOF 第 1 次完整闭环 |
| **为何反复** | — |
| **踩坑** | 15:32 `/jx` 报错是 dead stream 重试，非新断连；定责看 A=14:51 stream_terminated |
| **回归** | `agentTransportFailureWriterCore.test.ts` df1501ed · `cursorStreamTokenGapCore.test.ts` · `cursorConnectStreamKeepaliveCore.test.ts` · `cursorHy2MarathonKeepaliveCore.test.ts` |
| **用户动作** | 升级 **1.26.71** · marathon 断连后见 `silent_generation_end_nudge outcome=executed` 或 `connect_stream_keepalive ... connect_path_delay_ms=` |
| **代码位置** | `agentTransportFailureWriterCore.ts` · `cursorStreamTokenGapCore.ts` · `cursorStreamTokenGapReader.ts` · `cursorConnectStreamKeepaliveCore.ts` · `cursorConnectStreamKeepalive.ts` · `cursorHy2MarathonKeepaliveCore.ts` · `cursorTransportHealth.ts` · `_ARCH.md` |

### BUG-2026-07-24-007 · v1.26.64 · P14 token_gap/cold_resume nudge outcome SSOT（fcdf8644 triage 陷阱）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | fcdf8644：`token_gap_force_nudge` 无条件日志 → triage 误判 nudge 已执行；实际 `deferred_cursor_load` / in_flight / cooldown / weak 无 outcome |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.63** |
| **修复目标版本** | Sparkle **1.26.64** |
| **根因** | `cursorTransportHealth.ts` 在 `await runHy2...` 后无条件打 `token_gap_force_nudge`；`runHy2...` 返回 boolean 无 skip reason |
| **修复** | `MarathonSessionKeepaliveResult` + `formatMarathonRescueNudgeLogLine` → `token_gap_nudge outcome=executed\|skipped_* \|failed` 单行 SSOT；rescue defer 不再重复 `deferred_cursor_load` |
| **反复次数** | observability 陷阱第 2 次（006 踩坑仍不足） |
| **为何反复** | 检测日志（force_nudge）与执行日志（rescue_nudge/defer/failed）分离 |
| **踩坑** | triage 定责：`token_gap_nudge outcome=executed` 才表示 dial 成功；`skipped_*` / `failed` 均非成功 · 旧版 `token_gap_force_nudge` 已废弃 |
| **遗漏** | `formatUnknownErrorForLog` 仅 nudge/keepalive 两处；CTHC/hung_scan 等 ~18 处仍可能 `[object Object]`（BUG-003 partial） |
| **回归** | `cursorHy2MarathonKeepaliveCore.test.ts` formatMarathonRescueNudgeLogLine |
| **用户动作** | 升级 **1.26.64** · marathon 见 `token_gap_nudge outcome=executed` 而非旧 `token_gap_force_nudge` |
| **代码位置** | `cursorHy2MarathonKeepaliveCore.ts` · `cursorHy2MarathonKeepalive.ts` · `cursorTransportHealth.ts` · `_ARCH.md` · `CURSOR-DISCONNECT-TRIAGE.md` |

### BUG-2026-07-24-006 · v1.26.63 · P13 MTCP Marathon Transport Control Plane（connect_partition dead rescue path）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | connect_partition 检测触发 `force:true` nudge · conn≥80 仍 `session_transport_nudge_deferred_cursor_load trigger=force` · mass PING split-brain 救场到不了 · P8 @ conn≥80 仅 ≥20s gap 才 bypass（15–19s 窗口暴露） |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.59–1.26.62**（P10a 只修 token_gap/cold_resume · `force:true` 语义污染 · P12 dial budget 可 skip rescue dial） |
| **修复目标版本** | Sparkle **1.26.63** |
| **根因** | **架构债**：`tokenGapRescue = tokenGapForce && !force` → connect_partition 走 `force:true` **退出 rescue** · boolean 组合（force/tokenGapForce/highLatencyForce）无 SSOT · P8 defer 用 20s 阈值而非 15s keepalive 阈值 |
| **修复** | ① **MTCP** `MarathonWarmthTrigger` 枚举 + `shouldDeferMarathonWarmth`（Rescue 永不 defer · Warmth conn≥80 defer）② 删 force/tokenGapForce boolean API ③ `connect_partition_rescue_nudge` / `cold_resume_rescue_nudge` 日志 ④ Rescue dial **绕过** P12 observability budget ⑤ P8 `isConnectStreamRescueEligible` @15s gap ⑥ **1.26.64** connect_partition 接入 `formatMarathonRescueNudgeLogLine` outcome SSOT（P14 延伸） |
| **反复次数** | defer/rescue 分裂 **第 4 次**（BUG-2026-07-22-001 defer · 001 token_gap · 004 dial budget · 006 connect_partition） |
| **为何反复** | 每次只 patch 单 trigger · `force` 语义承载 connect_partition 与 periodic 两种含义 · P12 budget 未区分 rescue/warmth |
| **踩坑** | `token_gap_force_nudge` / connect_partition event **≠** nudge 已执行 · 须看下一行 defer/skip/budget · trigger=force 日志应消失改为 connect_partition |
| **遗漏** | Phase 2 Latency Truth badge→vps scope only · Phase 3 VPS runtime · Phase 4 fake-ip flush · Phase 5 NGHTTP2 · P9o soak |
| **回归** | `cursorHy2MarathonKeepaliveCore.test.ts` · `cursorConnectStreamKeepaliveCore.test.ts` MTCP cases |
| **用户动作** | `pnpm run upgrade:mac` → **1.26.63** · Marathon conn≥80 mass PING 窗口应见 `connect_partition_rescue_nudge` 且无 `deferred trigger=connect_partition` |
| **代码位置** | `cursorHy2MarathonKeepaliveCore.ts` · `cursorHy2MarathonKeepalive.ts` · `cursorTransportHealth.ts` · `cursorConnectStreamKeepaliveCore.ts` · `cursorConnectStreamKeepalive.ts` |

### BUG-2026-07-24-005 · v1.26.61 · P11b 显式测速仍无反应（follow-up）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | 1.26.60：tooltip api2 探针柱图有数据，但点击 VPS「测试」仍无 loading/结果；app.log 无新 `ManagedVpsDelayTest` 行 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.60** |
| **修复目标版本** | Sparkle **1.26.61** |
| **根因** | ① `explicitUserRequest` 在 probe congested 时仍进 120s defer ② UI 吞错 ③ Card/Button 事件冲突 ④ P11 首版未跳过 `waitForUiVpsDelaySlot` |
| **修复** | 显式测速跳过 defer 循环；入口/cooldown 日志；proxy-item stopPropagation + toast；标签「测速记录（api2 探针）」 |
| **反复次数** | P11 第 2 次（002→005） |
| **为何反复** | 002 只改 policy 未改 wait 循环与 UI 反馈 |
| **踩坑** | Marathon 升级需 `SPARKLE_FORCE_CORE_RESTART=1` |
| **回归** | `vpsDelayTestPolicyCore.test.ts` |
| **代码位置** | `managedVpsDelayTest.ts` · `proxy-item.tsx` · `proxy-detail-tooltip.tsx` |

### BUG-2026-07-24-004 · v1.26.62 · P12 Marathon 探针预算 SSOT

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | Marathon conn≥12 ledger/UI 偶发 500–5001ms；L4 ssh_curl 仍 ~540ms 绿；探针与 Connect 争 HY2 QUIC |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.53–1.26.61** |
| **修复目标版本** | Sparkle **1.26.62** |
| **根因** | JP-HY2 24h ledger p50=283ms 但 >500ms 占 5.2%；nudge/keepalive Promise.all×2 + transport_pair 无全局单槽 |
| **修复** | `marathonObservabilityDialBudget*` 单槽串行 + 优先级；nudge/keepalive busy skip + 串行 api2；接入 NSM/Hy2/P8/managedVps |
| **反复次数** | 1 |
| **踩坑** | 5001ms≠TUN 税，是探针 5s timeout/排队 |
| **回归** | `marathonObservabilityDialBudget*.test.ts` |
| **代码位置** | `marathonObservabilityDialBudget*.ts` · `networkStabilityMonitor.ts` · `cursorHy2MarathonKeepalive.ts` |

### BUG-2026-07-24-003 · v1.26.61 · nudge/keepalive err=[object Object] 定责盲区

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | fcdf8644 断连后 app-log `session_transport_nudge_failed` / `connect_stream_keepalive_failed` 仅 `err=[object Object]`，无法定责 mihomo 返回体 |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.60** |
| **修复目标版本** | Sparkle **1.26.61** |
| **根因** | `mihomoApi.ts:92` axios interceptor `reject(error.response.data)` 抛 plain object；catch 用 `String(error)` → `[object Object]` |
| **修复** | `formatUnknownErrorForLog`（Error + JSON.stringify plain object）→ `cursorHy2MarathonKeepalive.ts` · `cursorConnectStreamKeepalive.ts` |
| **反复次数** | 1 |
| **为何反复** | 仅 `instanceof Error` 分支，未覆盖 mihomo REST reject 形态 |
| **踩坑** | triage 看到 `token_gap_force_nudge` 后须读下一行 err 原文，不能 assume nudge 成功 |
| **回归** | `formatUnknownErrorForLog.test.ts` |
| **用户动作** | 升级 **1.26.61** · 断连后 app-log err 应见 JSON 如 `{"message":"timeout: ..."}` |
| **代码位置** | `formatUnknownErrorForLog.ts` · `cursorHy2MarathonKeepalive.ts` · `cursorConnectStreamKeepalive.ts` |

### BUG-2026-07-24-002 · v1.26.60 · P11 Marathon delay visibility（UI 暂无记录 + 手动测速无反应）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | Marathon 期间 tooltip 柱图「暂无记录」· 用户点击 VPS 手动测速无反馈（conn≥12 defer 最长 120s · P9 quiesce 停 health-check） |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.53–1.26.59**（P9 quiesce + conn≥12 defer 未区分用户显式请求） |
| **修复目标版本** | Sparkle **1.26.60** |
| **根因** | 柱图只读 mihomo provider memory history · quiesce @ conn≥12 不写 history · `managedVpsDelayTest` defer 静默至 120s · ledger 仍有 transport_pair/session_nudge 样本 |
| **修复** | ① `providerDelayHistoryFromLedgerCore` + IPC `getProviderDelayHistoryFromLedger` → tooltip ledger 回填 ② `explicitUserRequest` bypass conn defer（仍 respect probe congested · 15s cooldown · 串行）③ proxies 手动测速传 `explicitUserRequest:true` |
| **反复次数** | 1 |
| **为何反复** | P9n 只分离 nudge 柱图污染 · 未解决 quiesce 期间 history 空窗 |
| **踩坑** | ledger 回填含 session_nudge（有意）· mihomo history 仍剔除 nudge |
| **回归** | `providerDelayHistoryFromLedgerCore.test.ts` · `vpsDelayTestPolicyCore.test.ts` explicit bypass |
| **用户动作** | 升级 **1.26.60** · Marathon 中 hover tooltip 应见 ledger 柱图 · 点击测速应立即执行 |
| **代码位置** | `providerDelayHistoryFromLedgerCore.ts` · `managedVpsDelayTest.ts` · `proxy-detail-tooltip.tsx` |

### BUG-2026-07-24-001 · v1.26.59 · P10 token_gap Rescue Bypass defer（fcdf8644）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | Marathon conn=97 · token_gap max_gap=148s · `session_transport_nudge_deferred_cursor_load trigger=token_gap` → 10s 后批量 ECONNRESET · ≥5 Agent 同秒断连（RID fcdf8644 @ 2026-07-24 11:38:44 CST） |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **1.26.51–1.26.58**（BUG-2026-07-22-001 defer + BUG-2026-07-22-002 P8 未统一） |
| **修复目标版本** | Sparkle **1.26.59** |
| **根因** | `shouldDeferHy2MarathonSessionNudgeForCursorLoad` @ conn≥80 **无区分** periodic vs token_gap stale；P8 `shouldRunConnectStreamKeepalive` 同门槛直接 return false — conn=97 救场被 defer 挡死 |
| **修复** | `tokenGapRescue` bypass defer（nudge + P8）· `isTokenGapRescueEligible` · in-flight 互斥 · 成功日志 `token_gap_rescue_nudge` |
| **反复次数** | BUG-2026-07-22-002 遗漏项 #5 从未 ship；fcdf8644 为第 2 失败形态 |
| **为何反复** | defer 防 dial 风暴与 token_gap 救场未统一条件 bypass |
| **踩坑** | `token_gap_force_nudge` 日志出现 ≠ nudge 已执行；须看下一行是否 `deferred_cursor_load` |
| **回归** | `cursorHy2MarathonKeepaliveCore.test.ts` · `cursorConnectStreamKeepaliveCore.test.ts` 新增 case 全绿 |
| **用户动作** | `pnpm run upgrade:mac` → **1.26.59** · 30min Marathon soak（conn≥80 见 `token_gap_rescue_nudge` 且无批量 ECONNRESET） |
| **代码位置** | `cursorHy2MarathonKeepaliveCore.ts` · `cursorHy2MarathonKeepalive.ts` · `cursorConnectStreamKeepaliveCore.ts` · `cursorConnectStreamKeepalive.ts` |

---

## 2026-07-23

### BUG-2026-07-23-008 · v1.26.58 · MarathonCoreRestartGuard（install-sparkle 马拉松断连）

| 字段 | 内容 |
| --- | --- |
| **状态** | FIXED |
| **症状** | 马拉松并行 Agent 进行中 `upgrade-sparkle-local.sh` → `install-sparkle` Quit+stop service → `Mihomo shutting down` → Connect 长流 `read ECONNRESET` · Included 作废（例：6b3ce7c5 @ 17:15:17 · $9.77） |
| **关联产品** | Sparkle |
| **bug 存在版本** | Sparkle **≤1.26.57** |
| **修复目标版本** | Sparkle **1.26.58** |
| **根因** | P9 quiesce 仅 defer observability dial；**`install-sparkle-local.sh` OS 级 kill service 绕过 `restartCore` hot-reload**；`stopCore` 无 lifecycle reason 日志 |
| **修复** | `marathonCoreRestartGuardCore/Guard` block `stopCore`/`restartCore`；`~/.sparkle/marathon-core-restart-guard.json`；`scripts/lib/marathon-core-restart-guard.sh` PRE-gate install+upgrade；`[CoreLifecycle]` structured log |
| **反复次数** | 同日 8× `Mihomo shutting down`（core-2026-7-23.log） |
| **为何反复** | Agent 约束未禁止马拉松 install；shell 与 JS 双层缺口 |
| **踩坑** | `tls-reset` + `JP-VPS-HY2` 标签 ≠ VPS fault；17:15:12 provider reload 是 hot reload 非 second shutdown |
| **回归** | `marathonCoreRestartGuardCore.test.ts` 6/6 · `pnpm run test:node-quality` |
| **用户动作** | 马拉松中勿 install；紧急 override：`SPARKLE_FORCE_CORE_RESTART=1` |
| **代码位置** | `marathonCoreRestartGuard*.ts` · `manager.ts` · `scripts/lib/marathon-core-restart-guard.sh` · `install-sparkle-local.sh` · `upgrade-sparkle-local.sh` |

---

## 2026-07-18

### BUG-2026-07-18-005 · v1.26.46 · provider 写入路径二次 guard + 审计日志

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | provider 模式下 `199e64b94e8-vps-proxies.yaml` 重写后仍无 `smux: false`；Factory 审计日志不触发 |
| **修复** | `generateProxyProvider` 写入前二次 `applyVlessVisionMuxGuard`；`setupProfileProviders` 写 VPS 后 `[Provider]: vless_vision_mux_guard` 日志 |
| **回归** | test:node-quality |

### BUG-2026-07-18-004 · v1.26.45 · vision mux guard unconditional smux:false

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 1.26.44 guard 仅在 `smux===true` 时关闭；mihomo 对未显式配置的 vless 可能隐式 sing-mux → 长 marathon 仍 tls-reset/BAD_DECRYPT |
| **bug 存在版本** | Sparkle **1.26.44** |
| **修复目标版本** | Sparkle **1.26.45** |
| **根因** | guard 未对「无 smux 字段」的 vision 节点写入 `smux: false`，隐式 mux 仍可启用 |
| **修复** | `normalizeVlessVisionProxy` **无条件** `smux: false`；启动日志输出 guarded 节点名列表 |
| **回归** | `vlessVisionMuxGuardCore.test.ts` · test:node-quality **131/131** |
| **用户动作** | 安装 **1.26.45** pkg 并重启 Sparkle（触发 generateProfile） |
| **代码位置** | `vlessVisionMuxGuardCore.ts` · `factory.ts` |

### BUG-2026-07-18-003 · v1.26.44 · Reality vision+multiplex → post-turn TLS BAD_DECRYPT

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | RID `b6f815d1` 7min marathon turnEnded 后 Connect BAD_DECRYPT；KR sing-box @ A-69s mux EOF；短 probe 全绿 |
| **bug 存在版本** | Sparkle **≤1.26.43** |
| **修复目标版本** | Sparkle **1.26.44** |
| **根因** | sing-box [#1535](https://github.com/SagerNet/sing-box/issues/1535)：**xtls-rprx-vision 与 multiplex 不兼容**，内层 api2 TLS 解密失败；triage 仅 grep JP VPS 漏采 active KR |
| **修复** | `vlessVisionMuxGuardCore.ts` 生成 profile 时强制 vision 节点 strip multiplex + smux=false；triage 按 ledger/core @ A 解析 active VPS（KR/JP）grep sing-box；**triage SSH grep 引号 bug 修复**（base64 传 pattern + ±2min + log.1 轮转） |
| **回归** | `vlessVisionMuxGuardCore.test.ts` |
| **用户动作** | 安装 **1.26.44** pkg 并重启 core（触发 `generateProfile` 重写 provider）；**不杀连接、不切节点、不限制并行** |
| **代码位置** | `vlessVisionMuxGuardCore.ts` · `provider.ts` · `factory.ts` · `triage-cursor-disconnect.sh` |

### BUG-2026-07-18-002 · v1.26.43 · triage V5.4 空采 + HY2 Marathon 定责

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | triage 脚本 V5.4 恒空；RID `1a4bfbe0` HY2 Marathon 断连无法 definitive |
| **bug 存在版本** | Sparkle triage **≤1.26.42** |
| **修复目标版本** | Sparkle **1.26.43** |
| **根因** | `journalctl --since 5 min ago` 取采集时刻非 A 时刻；真实日志在 `/var/log/sing-box/sing-box.log` UTC 前缀 |
| **修复** | triage 按 `INCIDENT_UTC±1min` grep file log + V5.5 restart 窗口 |
| **回归** | 手动补采 + triage 脚本 · test:node-quality **126/126** |
| **用户动作** | 无锁定；KR-Reality 仅 bootstrap 默认，manual 切换才持久化 |
| **代码位置** | `triage-cursor-disconnect.sh` |

### BUG-2026-07-18-001 · v1.26.42 · Cursor 专用组手动切换被 bootstrap 覆盖

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 代理组页点选 Cursor 专用节点后，重启 Sparkle/core 又变回 KR-Reality；体感「无法切换」 |
| **bug 存在版本** | Sparkle **1.26.38–1.26.41** |
| **修复目标版本** | Sparkle **1.26.42** |
| **根因** | `shouldUpgradeCursorDedicatedNode` 强制 JP-Reality→KR-Reality；无 manual 选择持久化；bootstrap 覆盖用户确认后的节点 |
| **修复** | `cursorDedicatedSelectionCore.ts` 持久化 manual 选择；`mihomoChangeProxy(source:manual)` 写入；bootstrap 优先 restore manual；移除跨区 Reality 强制 upgrade |
| **回归** | `cursorDedicatedDefault.test.ts` · `cursorDedicatedSelectionCore.test.ts` · test:node-quality **126/126** |
| **用户动作** | 升级 1.26.42 后代理组页切换（仍有 ConfirmModal 确认） |
| **代码位置** | `cursorDedicatedDefault.ts` · `cursorDedicatedSelectionCore.ts` · `mihomoApi.ts` |

## 2026-07-17

### BUG-2026-07-17-006 · v1.26.38 · VPS 与商用混 provider 导致 76 节点 batch api2 测速尖峰

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 6 自建 VPS UI 测速频繁 >500ms / 尖峰 2000–4481ms；商用节点也被迫 api2 health-check |
| **关联产品** | Sparkle ≤1.26.37 |
| **根因** | `resolveProviderHealthCheckUrl` 见任意 VPS leaf 即整 provider 改 api2；76 leaf 每 300s 批量探测竞争 TUN |
| **修复** | `vpsProviderSplitCore` + `setupProfileProviders`：商用 `{profileId}`（generate_204）+ VPS `{profileId}-vps`（api2）；Cursor 专用组 `use: [profileId-vps]` |
| **回归** | `vpsProviderSplitCore.test.ts` · `providerVpsSplit.test.ts` · `customProxyGroups.test.ts` |
| **用户动作** | 安装 Sparkle **1.26.38** 并重启 core（自动重写 provider 文件） |

---

### BUG-2026-07-17-006 · v1.26.39 · Agent-stability-first（禁 L1 + Hygiene 保护 api2）

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 1.26.38 后 partition_stale 仍可能 L1 关 critical-host；Hygiene 可能清 api2 长 idle |
| **修复** | `marketplaceOk → none`（禁 L1 split-brain 杀流）；Hygiene 跳过 critical transport host；`cursorCriticalTransportCore.ts` 共享 SSOT |
| **防回归** | `agent-stability-first regression guard` 单测（healthy + partition_stale + hung → none） |
| **用户动作** | 安装 Sparkle **1.26.40+** pkg（含 1.26.39 Agent-stability-first + deep sign 启动修复） |

---

### BUG-2026-07-17-007 · v1.26.40 · 从 dist 直接启动 / pkg 未覆盖 → DYLD Team ID 崩溃

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | Sparkle **1.26.39** 启动即崩溃：`DYLD Library missing` · `@rpath/Electron Framework` · `different Team IDs` · dyld 尝试加载 `dist/mac-arm64/.../Electron Framework` |
| **关联产品** | Sparkle 本地 dev 构建 ≤1.26.39 |
| **根因** | ① **双击 `dist/mac-arm64/Sparkle.app` 直接运行**（非 `/Applications`）· ② electron-builder adhoc 分签名，主二进制与 Electron Framework **Team ID 不一致** · ③ `sudo installer` 未完整覆盖时 `/Applications` 仍为旧版（如 1.26.36）而用户从 dist 启动 |
| **修复** | `scripts/deepSignMac.cjs` + electron-builder 根级 `afterSign`：`codesign --deep --force --sign -` 整包重签后再打 pkg |
| **禁止** | ❌ `open dist/mac-arm64/Sparkle.app` 作为日常使用 · ❌ ditto/cp 覆盖（见 BUG-003）· ❌ 只更新 Info.plist 不替换 Framework · ❌ 复制到 `~/Applications/Sparkle.app`（与 `/Applications` 并存 → Dock 双图标） |
| **正确流程** | `bash scripts/install-sparkle-local.sh`（见 **「Sparkle 本地安装（标准 · 唯一路径）」**）· 或 pkg + `chown` + `codesign` |
| **dev 自测** | 1.26.40+ build 后 dist app 可短暂启动验证；**生产环境只用 `/Applications`** |
| **回归** | build log 出现 `replacing existing signature`；`open dist/.../Sparkle.app` 不 DYLD 崩溃 |
| **用户动作** | 安装 **1.26.40+** pkg，勿从 dist 启动 |

---

### BUG-2026-07-17-005 · v1.26.38 · CTHC L0 误杀 Agent SSE（1.26.36 回归）

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 今日 Included 计次暴增；单次请求 token 攒不到 20M；`L0 closed N hung` ×112 |
| **关联产品** | Sparkle 1.26.36 |
| **根因** | `decideRecoveryAction` 在 1.26.36 把 hung→L0 提到 healthy 之前；hung_scan 每 30s 杀 Agent 长连接 |
| **证据** | 07-16 app log L0=0 hung=19 action=none；07-17 L0=112/56 events；git a64e9fd diff |
| **修复** | 恢复 healthy 优先；**移除 L0 阶梯**（零 mihomo 吞吐 ≠ 可杀） |
| **回归** | `cursorTransportHealthCore.test.ts` |
| **用户动作** | 安装 Sparkle **1.26.38** pkg 并重启 core |

---

### BUG-2026-07-17-004 · v1.26.37 · vpsL4Probe fake-ip 假阴性

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | ledger `scope=vps` 周期性失败（`Connection closed by 198.18.x.x`），与 `scope=active` JP/KR 同时 OK 矛盾；定责误判 L4 |
| **关联产品** | Sparkle 1.26.36 |
| **根因** | `ssh kr-vps`/`jp-vps` 无 `HostName` 时经 TUN fake-ip 匹配「漏网之鱼」；`ensureVpsDirectBypass` 仅有 IP-CIDR 无 SSH 别名 DOMAIN DIRECT |
| **修复** | `vpsDirectBypass` 注入 `DOMAIN,kr-vps/jp-vps,DIRECT`；`vpsL4ProbeCore` 用 `ssh -G` + leaf 公网 IP 回退 + `ProxyCommand=none`；path 错误写 `authoritative=false` + `probe_attribution` |
| **回归** | `vpsL4ProbeCore.test.ts` · `vpsDirectBypass.test.ts` |
| **用户动作** | 安装 Sparkle **1.26.37** pkg 并重启 core |

---

### BUG-2026-07-17-002 · v1.26.36 · CTHC L0 误杀 Agent Connect 流

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | Agent 仅跑 ~1min 即 `WritableIterable is closed`；events `hung=7` + L0 杀连接；IFM 误标 marathon |
| **关联产品** | Sparkle 1.26.33 + Cursor Usage Guard |
| **根因** | `HUNG_CONNECTION_MIN_AGE_MS=60s` 过短；tool/thinking 间隙 Connect 流零 mihomo 吞吐仍存活；L0 无 newest 保护 |
| **修复** | hung 阈值 **60s→12min**；`selectHungCursorConnectionsToClose` 每 host **保留最新 6 条** 不 L0 杀（并行 Agent 保护） |
| **回归** | `cursorTransportHealthCore.test.ts`（newest 保护 + 12min 阈值） |
| **用户动作** | 安装 Sparkle **1.26.36** pkg 并重启 Sparkle core（**禁止 ditto/cp 覆盖**，见 BUG-2026-07-17-003） |

---

### BUG-2026-07-17-003 · v1.26.35 · ditto/cp 覆盖安装导致 DYLD 崩溃

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（流程文档化） |
| **症状** | Sparkle **1.26.35** 启动即崩溃：`DYLD Library missing` · Electron Framework **Team ID 与主二进制不一致**（`mapping process and mapped file have different Team IDs`） |
| **关联产品** | Sparkle 本地 dev 构建 → `/Applications/Sparkle.app` |
| **根因** | 用 **`ditto` / `cp -R`** 把 `dist/mac-arm64/Sparkle.app` **覆盖**到已安装的 `/Applications/Sparkle.app`，只替换了部分文件；旧版 **Electron Framework** 签名残留，与新 `Sparkle` 主二进制不匹配。**或**从 **`dist/mac-arm64` 直接 `open`**（≤1.26.39 adhoc 分签名，见 BUG-007） |
| **禁止** | ❌ `ditto dist/mac-arm64/Sparkle.app /Applications/Sparkle.app` · ❌ `cp -R` 覆盖 · ❌ 在旧 app 上「增量复制」 · ❌ **`open dist/mac-arm64/Sparkle.app` 日常使用**（必须 `installer` 到 `/Applications`） |
| **正确流程** | 见下方 **「Sparkle 本地 pkg 升级（标准）」** · build **≥1.26.40** 含 `afterSign` deep sign（BUG-007） |
| **验证** | ① `PlistBuddy … CFBundleShortVersionString` = 目标版本 ② `open -a Sparkle` 不崩溃 ③ app-log 出现 `mihomo API ready` ④ `ls /tmp/sparkle-mihomo-api.sock` |

#### Sparkle 本地安装（标准 · 唯一路径）

**Canonical 路径**：仅 `/Applications/Sparkle.app`。禁止与 `~/Applications/Sparkle.app` 并存（service/GUI 分裂 · Gatekeeper 混乱 · `spawn …/sparkle-service ENOENT`）。

**推荐（dev 构建 + 安装 · 一条命令）**：

```bash
cd /path/to/sparkle
pnpm run agent:upgrade:mac
# Agent SSOT：dist 就绪 → install only；否则 → upgrade-sparkle-local.sh
# 人工等价：pnpm run upgrade:mac
# 等价：bash scripts/upgrade-sparkle-local.sh
```

**仅安装已构建 dist（不重编）**：

```bash
bash scripts/install-sparkle-local.sh
```

**upgrade:mac 流程**：`electron-vite build` → **`rm -rf dist/mac-arm64`**（防 stale `Electron.app` 签名竞态，BUG-005）→ `electron-builder --mac dir`（`mac.identity: "-"` + `afterSign` deepSignMac · 失败自动 clean+重试 1 次）→ **`verify-sparkle-main-asar.mts`**（SSOT：`upgradeSparkleAsarGateCore.ts`）→ `install-sparkle-local.sh` → **Marathon 就绪门控**：mihomo socket + **`Api2ProbePlane ON`**（90s 内；macOS 26 GUI 路径下 app 有意跳过 observability stack，日志 `macOS 26 GUI — observability stack skipped` 同样算就绪）+ 禁止 `PostCoreBootstrap.*failed` → Finder 启动。macOS ≥ 26 且未设 `macos26ForceGui` 时改走 headless 分支（检查 `[MacOs26Headless]: bootstrap complete` + `:7890`）。构建后脚本会把 `HOME` 固定为登录用户真实主目录（`scripts/lib/login-home.sh`），Agent 沙箱里 `HOME` 被改写也不会读错日志目录（BUG-2026-10-09-002）。

**Marathon 就绪门控（SSOT · 零额外 userMessage）**：

| 层 | 检查 | 失败后果 |
| --- | --- | --- |
| Sparkle | `upgrade:mac` 后 `Api2ProbePlane ON` | CTHC/token_gap/connect_stream_keepalive **全盲** |
| Cursor EH | Reload Window（`files.watcherExclude` `.cursor`/`.git`） | FSEvents 风暴 → EH 冻结 → `WritableIterable is closed` |
| Guard 315 | deploy 后 **⌘Q**（非 Reload）→ renderer 有 `[ifm-event-v1]` | Billing 三列/RID ledger **盲**；intercept 开关内存未加载 |
| 续跑 | 同会话 `/jx` | 断 stream 不浪费新 userMessage |

**禁止**：

- ❌ 只跑 `electron-builder` 不先 `electron-vite build`（asar 缺新代码，见 BUG-004）
- ❌ `open -a` / 双击启动 adhoc 新 CDHash 包（`exit=1` 像闪退，见 BUG-004）
- ❌ install 后二次 `codesign`（CDHash 变 · Gatekeeper 批准作废，BUG-002）
- ❌ ditto/cp **覆盖**旧 `/Applications/Sparkle.app`（DYLD Team ID，BUG-003）
- ❌ `~/Applications/Sparkle.app` 与 `/Applications` 并存（split-brain，BUG-001）

脚本行为：quit GUI（graceful → `pkill -9`）→ 停 `sparkle-service` → **迁移/删除** `~/Applications/Sparkle.app` → `rm -rf` + `ditto` 到 `/Applications` → `xattr -cr` → **不重签** → Finder 启动 → 校验 GUI 运行。

**长期最稳**：Apple Developer ID + notarize（免 Gatekeeper · 可恢复「输密码 pkg 即用」）。

#### AI Agent 操作约束（防重复踩坑）

> 供 Cursor Agent / 自动化脚本读取；**Sparkle 问题只写 sparkle 仓 `BUGFIX_LOG.md`**，勿改 `tools/cursor-usage-watch/docs/BUGFIX_LOG_315.md`（Guard 3.1.15 补丁专账）。

| 必须 | 禁止 |
| --- | --- |
| **`pnpm run agent:upgrade:mac`** 或 **`bash scripts/agent-sparkle-upgrade.sh`**（Agent 唯一入口） | 裸跑 `pnpm build:mac` / 后台 build 后忘记 install |
| **DistFreshness gate**（`evaluate-sparkle-dist-freshness.mts` · `.sparkle-build-meta.json` git+tree 指纹）— 同 semver 源码变更禁止 install-only | 手动 `rm -rf dist` 绕过 agent 后仍用旧 asar；仅比 version 不比 commit |
| `pnpm run upgrade:mac` 或 `bash scripts/upgrade-sparkle-local.sh`（人工 full upgrade） | 只跑 `electron-builder` 不先 `electron-vite build`（stale asar） |
| **Stage-A**（vite 后 ~30s）：`pnpm run verify:bundle` 或自动 gate 扫 `out/main/*.js` | 只查 `out/main/index.js`（Vite code-split 后 R-34 可能在 chunk） |
| **Stage-B**（打包后）：同一 SSOT 扫 `app.asar` 全部 `out/main/*.js` | 打包 10min 后才发现 marker 缺失 |
| preflight / smoke 走 **path-based CLI**（不传 bundle 文本 argv） | inline `tsx -e` 塞 MB 级 bundle（ARG_MAX） |
| service 模式 close smoke 优先 `sparkle-service.sock` | 只测 `/tmp/sparkle-mihomo-api.sock`（僵尸 socket ECONNREFUSED） |
| 安装前 `rm -rf /Applications/Sparkle.app` 再 **整包 ditto** | ditto/cp **覆盖**旧 app（DYLD · BUG-003） |
| 启动：`install-sparkle-local.sh` 内 Finder POSIX open | 双击 / `open -a` 作为 adhoc 新包首选（Gatekeeper exit=1 像闪退） |
| 仅 `/Applications/Sparkle.app` 单路径 | `~/Applications/Sparkle.app` 并存（split-brain · BUG-001） |
| install 后 **不重签** | install/pkg 后二次 `codesign`（CDHash 变 · BUG-002） |
| 定责读 triage 证据包 + A 时刻三源 | 用 B 时刻探针否定 A 时刻断连 |
| **马拉松中禁止 `upgrade-sparkle-local.sh` / install**（conn≥12 或 quiesce ON 时脚本 FAIL） | 马拉松进行中 install Sparkle（会 kill mihomo → Connect ECONNRESET） |
| 紧急 override 仅 `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1` | 无 override 强杀 core |
| 启动升级前先 `pgrep -fl 'agent-sparkle-upgrade\|upgrade-sparkle-local\|electron-builder'` 确认**无**其他升级在跑（脚本暂无单实例锁，见 BUG-2026-10-08-001） | 并发起第二条升级 / 构建期间替换 `extra/` 内文件（会重写 `out/` 导致对方 `ENOENT`、互踩 `dist/mac-arm64`） |

**本地-only 升级口诀（无 Apple Developer · R-27）**：

1. **等 cursor_conn=0** 再跑（或明确接受 override 风险）
2. **只跑** `pnpm run upgrade:mac`（= vite build + **Stage-A/B bundle gate** + install + 门控）；升级前可单独 `pnpm run verify:bundle`
3. **新 CDHash 首次**：Finder → Control+点击 → 打开（仅一次；见 `~/.sparkle/last-sparkle-cdhash`）
4. **验 4 项**：版本 · `pgrep -x Sparkle` · `/tmp/sparkle-mihomo-api.sock` · app-log `generateProfile step=done groups=22`

**验证安装成功**：`defaults read … CFBundleShortVersionString` · `pgrep -x Sparkle` · `/tmp/sparkle-mihomo-api.sock` · app-log 含 `token_gap_nudge outcome=`（**≥1.26.64**）或 `token_gap_rescue_nudge`（成功 dial）。

**等价 pkg 流程**（无 dev 构建时）：

```bash
# 1. 构建（勿 SKIP_PREPARE，pkg 应 ~186MB+，见 BUG-2026-07-09-003）
#    ≥1.26.40：electron-builder afterSign 自动 deep adhoc 重签（BUG-007）
cd /path/to/sparkle
pnpm run build:mac
PKG="dist/sparkle-macos-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' dist/mac-arm64/Sparkle.app/Contents/Info.plist)-arm64.pkg"

# 2. 退出旧进程
osascript -e 'tell application "Sparkle" to quit' 2>/dev/null || true
pkill -f 'sparkle-service service run' 2>/dev/null || true
rm -rf ~/Applications/Sparkle.app 2>/dev/null || true

# 3. 整包替换（必须 rm 旧 app 再 installer，不可 ditto 覆盖）
sudo rm -rf /Applications/Sparkle.app
sudo installer -pkg "$PKG" -target /
sudo chown -R "$(whoami):staff" /Applications/Sparkle.app
xattr -cr /Applications/Sparkle.app
# 勿二次 codesign — 会改 CDHash、作废 Gatekeeper 批准（见 BUG-2026-07-21-002）

# 4. 验证并启动（install 脚本已自动 Finder 启动；pkg 手动时用下面两行）
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Sparkle.app/Contents/Info.plist
osascript -e 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"'
# 等 ~10s 后：tail ~/Library/Application\ Support/sparkle/logs/app-*.log | rg 'mihomo API ready'
```

无交互 sudo 时可用（会弹 macOS 授权框）：

```bash
osascript -e "do shell script \"pkill -9 -x Sparkle 2>/dev/null; pkill -9 -f 'sparkle-service service run' 2>/dev/null; rm -rf /Applications/Sparkle.app; installer -pkg '$PKG' -target /\" with administrator privileges"
```

**CTHC 逻辑变更**（如 1.26.34→1.26.35 hung keep 4）需 **Sparkle UI + sparkle-service 都重启** 后进内存；仅替换二进制不重启 service 仍跑旧逻辑。

---

### BUG-2026-07-17-001 · v1.26.33 · CTHC hung scan 不触发 L0

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | Marathon 46min + 2 路 Agent 断连；events 显示 `hung_connection_count` 12–17 但 `recovery_action=none`；短 probe 全绿 |
| **根因** | `cursorTransportHealthCore.ts` `decideRecoveryAction` 在 `attribution==='healthy'` 时直接 `return 'none'`，hung scan 固定 healthy + 假 probe，L0 分支永不可达 |
| **修复** | hung>0 且 L0 冷却就绪时优先返回 L0；`describeRecoveryBlockReason` 对 healthy+hung 报告 `L0_cooldown` |
| **回归** | `cursorTransportHealthCore.test.ts`（healthy+hung→L0） |
| **用户动作** | 重启 Sparkle core；**保持并行 Agent**（排查手册禁止建议减并行） |

---

## 2026-07-14

### BUG-2026-07-14-001 · v1.26.23 · VPS 稳定性 / provider leaf 测速误报

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.23**） |
| **症状** | ① UI 显示全部 VPS 节点「超时」② 默认回 `KR-VPS-TUIC`（UDP 最不稳）③ HY2/TUIC health 抖动时用户误以为 VPS 挂了并手动切走，掐断 marathon SSE |
| **根因** | ① provider leaf `/proxies/{name}/delay` 固定 404，fallback 读最后一条 health 历史，delay=0 即 UI 全红（Reality 实际可用）② `cursorDedicatedDefault.ts:8` 默认 `KR-VPS-TUIC` 与 2026-07-14 实测证据相反（TUIC auth timeout 17 次/12 天）③ provider health-check 用 `http://generate_204` 与 Cursor api2 流量不一致 |
| **修复** | ① 默认节点 → `JP-VPS-Reality`，TUIC/HY2 标 suboptimal ② VPS provider health-check → `https://api2.cursor.sh` ③ `mihomoProxyDelay` provider fallback 先 trigger healthcheck，取最近成功 delay（跳过尾部 delay=0） |
| **回归** | `cursorDedicatedDefault.test.ts` · `providerHealthCheck.test.ts` · `mihomoProviderDelay.test.ts` |
| **用户动作** | 升级 **1.26.23** 并 **重启 Sparkle 一次**（非 VPS）；专用组可固定 `JP-VPS-Reality` |

---

## 2026-07-09

### BUG-2026-07-09-001 · v1.26.15 · mihomo TUN 出站池僵死 + 自愈闭环缺陷

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.16** 已合入 CTHC） |
| **症状** | ① Cursor Network Diagnostic：`api2` 全系（SSL/API/Ping/Chat/Agent）约 **77s** 后统一 `ConnectError: [unavailable]`；`marketplace.cursorapi.com` / `prod.authentication.cursor.sh` 仍 **200**（364–837ms）。② Cursor Usage Guard（扩展 **0.13.388**）Dashboard 刷新报「**网络连接失败 (Network Error)**」。③ Agent `lastSseCase: heartbeat` + `[unavailable]`，Usage Guard patch-135 正确拦截 auto-retry。④ **退出并重启 Sparkle 后立刻恢复**；换代理节点无效。 |
| **关联产品** | Sparkle **1.26.15**（主因）· Usage Guard **0.13.388**（受害方）· Cursor **3.1.15** |
| **bug 存在版本** | Sparkle **≥1.26.x**；铁证采集于 **1.26.15** |
| **修复版本** | Sparkle **1.26.16** |
| **反复次数** | 第 1 次台账 · 第 1 次代码修复 |
| **修复** | 新增 **CTHC**（`cursorTransportHealthCore.ts` + `cursorTransportHealth.ts`）：L0 挂死连接 / L1 split-brain 清池 / L2 TUN 软清空 / L3 restartCore；删除缓存冒充健康；探针归因不计入节点评分 |
| **回归** | `cursorTransportHealthCore.test.ts` 7 场景全绿 · `cursorConnectionHygieneCore.test.ts` 6 场景全绿 |
| **用户动作** | 升级 Sparkle **1.26.16** 并重启应用；无需手动退出 Sparkle 作为常规 workaround |
| **提交** | —（待用户 commit） |

#### 根因链（第一性原理 · 每条有证据）

**结论：不是 VPS/商用节点质量问题，是 mihomo TUN 出站池僵死 + Sparkle 监控/清理/恢复三重失灵形成的死循环。**

```
① 触发：macOS 网络变动 → mihomo 报 TUN interface lost
   [日志] ~/Library/Application Support/sparkle/logs/core-2026-7-5.log
          "[TUN] default interface lost by monitor"
   [日志] app-2026-7-3.log:1413 "TUN interface lost — restarting mihomo core"
          app-2026-7-3.log:1422-1427 后续 3× "restart skipped (cooldown active)"

② 出站连接池污染：旧 socket 占住，新 api2 连接进入 TUN 后卡住
   [日志] core-2026-7-9.log:31974+ @ 10:41:01 CST
          路由正确 "🎯 Cursor 3.1.15 专用[KR-VPS-TUIC]"，与用户 02:41:39Z 诊断同时段
   [用户诊断] 02:41:39 → 02:42:56 全系 api2 [unavailable]（~77s）
              Marketplace 515ms OK → 不同域名/出站路径未污染

③ 连接清理清不动「挂死」连接
   [代码] cursorConnectionHygieneCore.ts:19
          CURSOR_CONN_IDLE_MIN_AGE_MS = 35 * 60_000  （35 分钟）
   [代码] cursorConnectionHygieneCore.ts:54-58
          isIdleCursorConnection：要求 age≥35min 且 upload/download speed=0
   [代码] cursorConnectionHygiene.ts:13-14
          HYGIENE_INTERVAL_MS=10min，HYGIENE_START_DELAY_MS=12min
   → 等待 api2 响应中的挂死连接（<77s）永远不会被清理
   [日志] app-2026-7-*.log 中零条 "CursorConnectionHygiene" → 僵死期未触发有效清理

④ 连接数≥20 时监控主动失明（关键闭环缺陷）
   [代码] cursorConnectionHygieneCore.ts:4
          CURSOR_CONN_PROBE_DEFER_THRESHOLD = 20
   [代码] networkStabilityMonitor.ts:478-483
          conn≥20 → 跳过真实 HEAD 探针，仅写 cached_defer 事件
   [代码] networkStabilityMonitor.ts:85
          RECENT_PROBE_MAX_AGE_MS = 90_000
   → 僵死期若 conn≥20，90s 内缓存 probe_ok 可冒充健康

⑤ TUN 恢复被误判跳过
   [代码] networkStabilityMonitor.ts:234-258
          TUN lost debounce 后 api2 短探针 OK → "skip restartCore"
   [代码] networkStabilityMonitor.ts:221-226, 614-619
          shouldDeferTunCoreRestart → shouldDeferCursorFailover（缓存 90s 内 OK 即 defer）
   [代码] networkStabilityMonitor.ts:31-32
          TUN_RESTART_COOLDOWN_MS = 10min → 连续 TUN lost 只 restart 一次

⑥ 用户只能手动退出 Sparkle（强制 restartCore）打破死循环
```

#### 次要加剧因素（非本次 77s 全系挂死主因）

| 因素 | 证据 | 影响 |
| --- | --- | --- |
| `PROCESS-NAME` 规则泄漏到商用 `节点选择` | [代码] cursorRuleInjection.ts:76-83, 150 · [日志] core-2026-7-9.log 统计：api2 ProcessName 泄漏 **10222** 次 / 专用 AND **13170** 次 | 部分连接绕开 VPS 专用组；**不是** 10:41 主因（同时段多为 KR-VPS-TUIC） |
| `store-fake-ip: true` | [配置] work/config.yaml:4147 · [代码] utils/template.ts:180 · fakeIpRoutingIntegrity.ts:4-11 | TUN 事件后 fake-ip 映射可能过期，加剧 TLS 挂死 |
| 短探针 timeout 15s | [代码] networkStabilityMonitor.ts:27 PROBE_TIMEOUT_MS=15000 | 探针看不到 77s 级挂死 |

#### Usage Guard 侧说明（受害，非根因）

| 项目 | 内容 |
| --- | --- |
| **调用接口** | `https://cursor.com/api/usage` · `/api/usage-summary` · `/api/dashboard/get-filtered-usage-events` |
| **错误文案** | `poller.ts:513-514` → `fetch failed` / `econnrefused` / `enotfound` 统一为「网络连接失败 (Network Error)」 |
| **与 Sparkle 关系** | 扩展进程 `Cursor Helper (Plugin)` 流量经 mihomo TUN；出站池僵死时 `cursor.com` fetch 同样超时 |

#### 修复方案（**1.26.16 已实装 · CTHC**）

**原则：打破死循环；`restartCore` 仅最后手段（会断进行中的 Agent SSE）。**

| 优先级 | 文件 | 实际改动 |
| --- | --- | --- |
| P0 | `cursorTransportHealthCore.ts` + `cursorTransportHealth.ts`（新） | **CTHC** 恢复阶梯 L0–L3：挂死连接关闭 → split-brain 清池 → TUN 软清空 → restartCore（10min cooldown） |
| P0 | `networkStabilityMonitor.ts` | api2+marketplace 双探针；conn≥20 强制真实探针；禁止缓存冒充健康；TUN lost 走 CTHC 阶梯 |
| P1 | `cursorRuleInjection.ts` | 3.1.15 专用模式 **删除** PROCESS-NAME→节点选择 fallback |
| P1 | `proxyHealthMonitor.ts` · `mihomoApi.ts` | failover defer 仅在 **live** 探针通过后生效 |
| P1 | `nodeProbeStats.ts` · `commercialNodeBenchmark.ts` | `probe_attribution`；`transport_partition_stale` **不计入** VPS 节点评分 |
| P2 | `scripts/prepare.ts` | `SKIP_PREPARE=1` 时若 `extra/sidecar/mihomo` 缺失则 **fail-fast**（防打包空内核） |
| — | `cursorProxyGroup.ts` | 删除未使用 `GENERAL_PROXY_GROUP_NAME`（修复 Rolldown panic） |

**1.26.16 未改 / 遗留：**

- `store-fake-ip` 仍为 `true`（P2 暂缓）
- 35min marathon idle 清理阈值 **不变**（与 CTHC **30s hung 扫描 + 12min 零吞吐判定** 并存；1.26.35+ L0 保留每 host 最新 4 条）
- **专用组 VPS UI 不可见** → 见 **BUG-2026-07-09-002**（1.26.17 修复）

#### 为何此前「翻来覆去修不好」（反思）

1. **症状像节点问题**：api2 超时 → 自然怀疑 VPS/商用节点；但日志证明路由正确时仍挂死。
2. **监控在僵死期失明**：conn≥20 defer + 90s 缓存 → 系统自认为健康，不触发恢复。
3. **清理门槛过高**：35min idle 阈值是为 marathon 保守设计，无法处理 **分钟级** 出站池污染。
4. **TUN restart 有 cooldown**：一次 restart 后 10min 内跳过后续 TUN lost（app-2026-7-3 铁证）。
5. **跨产品归因错误**：Usage Guard「网络连接失败」被当成扩展 bug，实际是 Sparkle TUN 僵死的外显。

#### 踩坑经验（后续开发者必读）

1. **「换节点」不能治 TUN 僵死** — 赛中/僵死期换 Selector 只会 RST 进行中的 SSE（见 playbook §核心原则）。退出 Sparkle = restartCore 才是用户验证过的 workaround。
2. **短探针 OK ≠ api2 可用** — HEAD 15s 超时内 OK，不代表 gRPC 双向流 / 77s 挂死不存在；不得用缓存 probe 阻止 TUN 恢复。
3. **conn≥20 defer 是双刃剑** — 为 marathon 减探针负载，但在僵死期造成监控失明；defer 必须带「强制真实探针」逃逸阀。
4. **区分域名** — `api2.cursor.sh` 僵死时 `marketplace.cursorapi.com` 仍可通；不要用后者 OK 推断前者 OK。
5. **日志判责顺序** — 先看 `core-*.log` 同时段路由规则 → 再看 `network-stability-events.jsonl` → 最后看 Usage Guard Output；避免在扩展侧打补丁。

#### 代码位置（grep 锚点）

| 模块 | 路径 | 关键符号 |
| --- | --- | --- |
| 探针 defer | `src/main/core/networkStabilityMonitor.ts:478-483` | `shouldDeferNetworkProbeForCursorLoad` |
| 探针缓存 | `src/main/core/networkStabilityMonitor.ts:85, 591-610` | `RECENT_PROBE_MAX_AGE_MS` · `getRecentHealthyCursorProbe` |
| TUN 恢复跳过 | `src/main/core/networkStabilityMonitor.ts:221-258` | `shouldDeferTunCoreRestart` · `confirmTunInterfaceLostAfterDebounce` |
| TUN cooldown | `src/main/core/networkStabilityMonitor.ts:31-32, 322-327` | `TUN_RESTART_COOLDOWN_MS` |
| 连接清理阈值 | `src/main/core/cursorConnectionHygieneCore.ts:4, 19` | `CURSOR_CONN_PROBE_DEFER_THRESHOLD` · `CURSOR_CONN_IDLE_MIN_AGE_MS` |
| 清理周期 | `src/main/core/cursorConnectionHygiene.ts:13-14` | `HYGIENE_INTERVAL_MS` · `HYGIENE_START_DELAY_MS` |
| 规则泄漏 | `src/main/core/cursorRuleInjection.ts:76-83, 150` | `injectCursorGeneralProxyFallbackRules` |
| 关闭连接 API | `src/main/core/mihomoApi.ts:120-146` | `mihomoCloseConnection` · `mihomoCloseConnections` |
| fake-ip | `src/main/core/fakeIpRoutingIntegrity.ts:4-11` | `TIER0_FAKE_IP_FILTER` |
| 架构索引 | `src/main/core/_ARCH.md` | `networkStabilityMonitor` · `cursorConnectionHygiene` |

#### 日志铁证索引

| 时间 | 文件 | 片段 |
| --- | --- | --- |
| 2026-07-03 | `~/Library/Application Support/sparkle/logs/app-2026-7-3.log:1413-1427` | TUN restart 1× + cooldown skip 3× |
| 2026-07-05 | `~/Library/Application Support/sparkle/logs/core-2026-7-5.log` | `[TUN] default interface lost by monitor` |
| 2026-07-09 10:41 CST | `core-2026-7-9.log:31974+` | 路由 KR-VPS-TUIC 正确，api2 仍挂 |
| 2026-07-09 10:41 UTC+8 | 用户 Cursor Network Diagnostic | api2 全系 77s unavailable；Marketplace OK |

---

### BUG-2026-07-09-002 · v1.26.15–1.26.16 · 专用组 6 个 VPS 节点 UI 不可见

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.17** 已构建安装） |
| **症状** | Sparkle「代理」页展开「🎯 Cursor 3.1.15 专用」时，用户 **只能看到 5 个 Sparkle-自动-*** 区域组，**看不到** KR/JP 共 **6 个自建 VPS** 节点。用户误以为节点丢失或被删除。 |
| **关联产品** | Sparkle **1.26.15–1.26.16** · Cursor **3.1.15** |
| **bug 存在版本** | Sparkle **≥1.26.x**（引入 `use+filter` provider 模式注入专用组后）；用户于 **1.26.16** 升级后反馈 |
| **修复版本** | Sparkle **1.26.17** |
| **反复次数** | 第 1 次用户报告 · 第 1 次代码修复 |
| **根因** | mihomo 在 `proxy-providers` + `use+filter` 模式下：6 个 VPS leaf 存在于 provider 与 `group.all`，但 **不注册进** `/proxies` 字典。Sparkle `mihomoGroups()` 仅用 `proxies.proxies[name]` 映射成员 → VPS 名解析为 `undefined` → UI `proxy &&` 过滤掉。 |
| **修复** | 新增 `mihomoGroupMembersCore.ts`：`buildProviderProxyLookup` + `resolveGroupMemberProxies`；`mihomoApi.ts:mihomoGroups()` 拉 `/providers/proxies` 补全缺失 leaf（含 delay/history/alive）。 |
| **回归** | `mihomoGroupMembersCore.test.ts` 2 场景全绿 |
| **用户动作** | 升级 **1.26.17** 并重启；展开专用组应见 **11 项**（5 区域自动 + 6 VPS）；推荐手动选 **KR-VPS-TUIC** |
| **提交** | —（待用户 commit） |

#### 根因证据（本机 2026-07-09 13:23 CST）

| 数据源 | 6 个 VPS | 命令/路径 |
| --- | --- | --- |
| provider `199e64b94e8` | ✅ 6/6，`alive: true` | `GET /providers/proxies/199e64b94e8` via `/tmp/sparkle-mihomo-api-noperm.sock` |
| 专用组 `group.all` | ✅ 11 项（5+6） | `GET /proxies/🎯 Cursor 3.1.15 专用` |
| `/proxies` 字典 | ❌ VPS **0 条**（仅 29 个组级条目） | `GET /proxies` |
| 节点定义文件 | ✅ 6/6 在 profile | `~/Library/Application Support/sparkle/profiles/199e64b94e8-proxies.yaml:2-62` |
| 运行时路由 | ✅ 仍走 VPS | `core-2026-7-9.log` 大量 `专用[KR-VPS-TUIC]` |

**关键代码路径：**

- [代码] `mihomoApi.ts:170`（修复前）`newGroup.all.map((name) => proxies.proxies[name])`
- [代码] `proxies.tsx:292` `group.all.filter((proxy) => proxy && ...)`
- [代码] `customProxyGroups.ts:225-234` 专用组 `use+filter: (?i)vps` 注入逻辑（**正确**，非根因）
- [配置] `work/config.yaml:49-59` 专用组 `use: [199e64b94e8]` + `filter: (?i)vps` + 5 个 Sparkle-自动前置

#### 与 BUG-2026-07-09-001 的区分（避免再误判）

| 维度 | TUN 僵死 (001) | VPS UI 不可见 (002) |
| --- | --- | --- |
| 用户感知 | api2 77s unavailable / Usage Guard 网络错误 | 专用组里「没有」6 个 VPS |
| 节点是否真的丢 | 否，路由仍走 KR-VPS-TUIC | 否，provider 与 group.all 均有 |
| 换 VPS 能否自愈 | 不能 | 不涉及（纯 UI 层） |
| 修复版本 | 1.26.16 CTHC | 1.26.17 provider 补全 |

#### 踩坑经验

1. **`use+filter` ≠ UI 自动可见** — mihomo 运行时能解析 provider leaf，但 `/proxies` 字典不一定包含 leaf；Sparkle UI 必须合并 `/providers/proxies`。
2. **「看不到节点」先查三层** — ① profile yaml ② provider API ③ `/proxies` 字典 vs `group.all`；不要先怀疑 VPS 宕机。
3. **专用组实际有 11 项** — 5 个 `Sparkle-自动-*` 是 `appendRegionalAutoGroupsToCursorDedicated` 有意前置的商用逃生（`defaultAutoSwitchProxy.ts:241-264`），不是替代 VPS。
4. **当前选中可能是商用** — 修复前 `now` 常为 `Sparkle-自动-新加坡`；节点可见后应切回 `KR-VPS-TUIC`（`cursorDedicatedDefault.ts:8`）。

#### 代码位置

| 模块 | 路径 |
| --- | --- |
| Provider 补全（新） | `src/main/core/mihomoGroupMembersCore.ts` |
| Groups 聚合 | `src/main/core/mihomoApi.ts` · `mihomoGroups` |
| UI 渲染 | `src/renderer/src/pages/proxies.tsx:285-310` |
| 专用组注入 | `src/main/core/customProxyGroups.ts:215-246` |
| 单测 | `src/main/core/mihomoGroupMembersCore.test.ts` |

---

### BUG-2026-07-09-003 · v1.26.16 构建 · 空 sidecar 导致安装后内核失败

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（流程加固 + 重装恢复） |
| **症状** | `SKIP_PREPARE=1 pnpm run build:mac` 产出 **~171MB** pkg（正常 **~186MB**）；安装后 Sparkle 重启报 **内核失败**，mihomo 未监听 `:7890`。 |
| **关联产品** | Sparkle **1.26.16** 本地构建 |
| **bug 存在版本** | 构建机 `extra/sidecar/` 为空时；**1.26.16** 首次错误打包 |
| **修复版本** | 同会话恢复：`prepare.ts` fail-fast + 重新下载 mihomo v1.19.28 + 重装完整 pkg |
| **反复次数** | 第 1 次踩坑 · 第 1 次流程修复 |
| **根因** | `SKIP_PREPARE=1` 跳过 sidecar 下载且 **未校验** 本地 `extra/sidecar/mihomo` 是否存在 → electron-builder 打出无内核 pkg。运行时期望路径：`Sparkle.app/Contents/Resources/sidecar/mihomo`（`dirs.ts:100-103`）。 |
| **修复** | `scripts/prepare.ts:16-25`：`SKIP_PREPARE=1` 时 sidecar 缺失 **exit 1**；完整 pkg 必须 **~186MB** 且含 41MB mihomo。 |
| **踩坑** | ① 不要用 pkg 体积显著偏小作静默信号 ② 安装后 `lsof -i :7890` 验证 ③ sidecar 可用 `gh` 镜像拉 mihomo release |
| **用户动作** | 重装含 sidecar 的完整 pkg；或手动 `osascript` 复制 mihomo 到 `Resources/sidecar/` |

---

## 版本索引

| Sparkle 版本 | 本文件条目 | 说明 |
| --- | --- | --- |
| **1.26.36** | BUG-2026-07-17-002 | CTHC L0 hung 12min + keep 6 + DedicatedDefault defer 不误导日志 |
| **1.26.35** | BUG-2026-07-17-003 | ditto 覆盖安装 DYLD 崩溃 + **pkg 升级标准流程** |
| **1.26.15** | BUG-2026-07-09-001 | 僵死 + 自愈闭环缺陷（存在） |
| **1.26.16** | BUG-2026-07-09-001 | CTHC 传输健康控制器 + 探针归因（**FIXED**） |
| **1.26.16** | BUG-2026-07-09-003 | 空 sidecar 打包导致内核失败（流程 **FIXED**） |
| **1.26.17** | BUG-2026-07-09-002 | 专用组 VPS UI 不可见（**FIXED**） |
| **1.26.18** | BUG-2026-07-09-004 | CTHC 可观测性增强（transport_recovery JSONL + block reason） |
| **1.26.19** | BUG-2026-07-09-002/004 | VPS 启动默认选择日志 + provider 测速 fallback |
| **1.26.20** | BUG-2026-07-09-006 | 启动链解耦：post-core 不阻塞 WS 流 |

### BUG-2026-07-09-006 · v1.26.19 · 启动链卡在 post-up 后 CTHC 未启动

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.20**） |
| **症状** | 重启后 `app-*.log` 仅 ~26 行停在 post-up，无 `network stability ... ON`；`~/.sparkle/network-stability-events.jsonl` 无 `transport_recovery`；CTHC 监控未运行 |
| **关联产品** | Sparkle **1.26.19** |
| **bug 存在版本** | Sparkle **≥1.26.16**（CTHC 已合入但启动链依赖 `startMihomoApiStreams` 完成） |
| **修复版本** | Sparkle **1.26.20** |
| **根因** | `waitForCoreReadyByHook` / log 路径 `await startMihomoApiStreams()` 阻塞 `completeCoreInitialization` → `startPromise` 永不 resolve → `index.ts` 中 `startNetworkStabilityMonitor` 45s grace 定时器从未调度 |
| **修复** | ① `manager.ts`：`startMihomoApiStreamsWithGrace`（10s race，失败继续）hook 路径 `void` 不阻塞 ② 新 `postCoreBootstrap.ts`：`runPostCoreBootstrap` 用 API ready 探针 + 8s core init race，解耦 WS 流 ③ `index.ts` 改调 `runPostCoreBootstrap` |
| **回归** | 重启后 `grep PostCoreBootstrap\|network stability app-*.log` 应有 ON 行 |
| **用户动作** | 升级 **1.26.20** 并重启 Sparkle |

---

### BUG-2026-07-09-005 · v1.26.17 · 启动未回 VPS + VPS 测速失败（同一 /proxies 遗漏）

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.19**） |
| **症状** | ① 重启后专用组停留 `Sparkle-自动-*` 商用，未自动回 `KR-VPS-TUIC` ② VPS 节点 UI 测速按钮可能失败 |
| **根因** | 同 BUG-002：`mihomoGroups()` 缺 VPS → `cursorDedicatedDefault.ts` `available.has(KR-VPS-TUIC)` 静默 false；`mihomoProxyDelay` 只调 `/proxies/{leaf}/delay` 对 provider leaf 404 |
| **修复版本** | **1.26.19**（叠加 1.26.17 UI + 1.26.18 日志） |
| **修复** | ① `cursorDedicatedDefault.ts` 安全取 `proxy?.name` + skip 日志 ② `mihomoApi.ts` delay 404 时 fallback `mihomoProxyDelayFromProvider`（provider healthcheck + history） |
| **踩坑** | 看到 `now=Sparkle-自动-新加坡` 不等于用户手动选择，可能是默认选择逻辑被静默 skip |

---

### BUG-2026-07-09-004 · v1.26.17 · CTHC 复现排查日志不足

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.18**） |
| **症状** | TUN 僵死复现时难以判断 CTHC 是否触发、卡在哪一级 cooldown、为何 `action=none` |
| **bug 存在版本** | Sparkle **1.26.16–1.26.17**（CTHC 已上线但仅 L0–L3 执行时写 app log，无结构化决策日志） |
| **修复版本** | Sparkle **1.26.18** |
| **修复** | ① `cursorTransportHealth.ts` 每次恢复决策写 `app-*.log` 一行摘要 + `~/.sparkle/network-stability-events.jsonl` 事件 `transport_recovery` / `transport_hung_scan` ② `describeRecoveryBlockReason` 解释 `L0_cooldown` 等阻塞原因 ③ `probe` 事件补 `recovery_action` + marketplace 字段 |
| **日志路径** | `~/Library/Application Support/sparkle/logs/app-*.log`（搜 `[CursorTransportHealth]:`）· `~/.sparkle/network-stability-events.jsonl`（`kind=transport_recovery`） |
| **踩坑** | 复现时同时打包 **core log + events jsonl + 发生时刻**；单看 Usage Guard 无法判 CTHC 是否漏触发 |

---

## 2026-07-20

### BUG-2026-07-20-001 · Connect split-brain P0–P3 · Sparkle main + Guard ext 0.15.75

| 字段 | 内容 |
| --- | --- |
| **状态** | **DEPLOYED**（2026-07-21 · Sparkle 1.26.48 · Guard 0.15.77） |
| **症状** | 探针全绿时 Connect mass PING timeout（RID 5d03320f 类）零恢复；`agent-transport-failures.jsonl` @ A 无行 |
| **bug 存在版本** | Sparkle **1.26.47** · Guard ext **≤0.15.74** |
| **修复目标版本** | Sparkle **1.26.48+** · Guard ext **0.15.75+** |
| **根因** | ① CTHC `resolveProbeAttribution` 仅探针失败才 stale ② keepalive 仅 api2 HTTP delay ③ MarathonDialTolerance 仅文档 ④ daily Cursor 无 transport jsonl |
| **修复** | P0 `agentTransportFailureSyncCore` · P1 `connectPartitionDetectCore`+reader（含 profiles glob）· P2 双探针 `session_transport_nudge` + partition 时 `ensureCursorMarathonKeepAlive` · P3 `marathonDialTolerance` 热更新 · hung_scan 用 recent probe 非假绿 · 5d03320f replay 单测 |
| **回归** | Guard `agentTransportFailureSyncCore.test` 10/10 · Sparkle connectPartition+reader+marathonDialTolerance+CTHC tests **22/22** |
| **用户动作** | Reload Guard ext · 安装 Sparkle 新 pkg · 并行 Agent 后查 app.log / jsonl |
| **代码位置** | `sparkle/src/main/core/connectPartition*` · `marathonDialTolerance*` · `cursorHy2MarathonKeepalive.ts` · `tools/cursor-usage-watch/src/agentTransportFailureSyncCore.ts` |

### BUG-2026-07-20-002 · v1.26.48 · HY2 marathon EOF（23bb8c85 + a9722f2）· VPS QUIC keepalive

| 字段 | 内容 |
| --- | --- |
| **状态** | **PARTIAL → FIXED @1.26.51**（VPS QUIC + 40s nudge + token_gap @1.26.50；**20s read ETIMEDOUT / api2direct 盲区**见 BUG-2026-07-22-002 P8） |
| **症状** | Marathon ~77–125min 后 Connect mid-stream EOF code 10；短 probe 全绿；案 B a9722f2 @18:23 僵尸无 agent-error |
| **bug 存在版本** | Sparkle **≤1.26.47** · VPS hy2-in 无 marathon 三层 · conntrack 运行时 30/120s |
| **修复目标版本** | Sparkle **1.26.48** · VPS `patch-hy2-in-quic-marathon.sh`（**1.13.14：`udp_timeout` only**；可选升级 **1.14.0-alpha.48** 三字段） |
| **根因** | Mac→JP-VPS-HY2 QUIC 长流 split-brain（partial）；VPS sing-box hy2-in 默认 QUIC idle 过短；内核 conntrack UDP 30s；Sparkle 仅短 HTTP nudge |
| **修复** | ① `cursorHy2MarathonKeepaliveCore.ts` 三字段 SSOT ② VPS 脚本：sysctl + 升级 + hy2-in ③ Guard patch-469–472 ④ triage REPORT（双案） |
| **NOT** | max-steps · VPS outage @A · 18:41 批量断 · Guard cursor-server 自动标签 |
| **回归** | `cursorHy2MarathonKeepaliveCore.test.ts` · connectPartition+CTHC **22/22** · VPS dry-run idempotent |
| **用户动作** | 已完成：Sparkle 1.26.48 · Guard deploy · VPS patch（conntrack=3600 · hy2-in `udp_timeout=3600s` @ sing-box 1.13.14） |
| **代码位置** | `cursorHy2MarathonKeepaliveCore.ts` · `scripts/vps-deploy/patch-hy2-in-quic-marathon.sh` · triage bundle `REPORT.md` |

---

## 2026-07-22

### BUG-2026-07-22-001 · v1.26.51 · HY2 marathon token_gap nudge 连接风暴（4950032b）· nudge defer @ cursor_conn≥80

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.51** 已部署 `/Applications` · `upgrade-sparkle-local.sh`） |
| **症状** | RID `4950032b-c843-4411-b6d3-3c3e78b6a65c` @ **2026-07-22 11:55:30 CST**：61min 马拉松 · `pendingTool=2` · `generation-ended-without-turnEnded` · cursor_conn **33→268** · `session_transport_nudge_failed` · renderer `ECONNRESET api2.cursor.sh` ×4 |
| **关联产品** | Sparkle **1.26.50**（断连时）· Cursor **3.1.15** · JP-VPS-HY2 |
| **bug 存在版本** | Sparkle **1.26.50**（token_gap nudge 无高 conn 保护） |
| **修复目标版本** | Sparkle **1.26.51** |
| **根因** | **L3 HY2 QUIC 长流静默 + nudge 叠加 dial 风暴（definitive）**：token_gap 已标 stale（max_gap 93s）但 `session_transport_nudge` 仍每 15s 开 **2× mihomoProxyDelay** 新 HY2 流；与 Cursor auth refresh TLS 风暴叠加 → conn 268 → QUIC 中途断 → ECONNRESET。**NOT** VPS 宕 · NOT L0 hung · NOT patch 破坏 retry |
| **修复** | `CURSOR_HY2_NUDGE_DEFER_THRESHOLD=80` · `shouldDeferHy2MarathonSessionNudgeForCursorLoad` · `session_transport_nudge_deferred_cursor_load` 日志 · conn≥80 时 **禁止** 新开 api2/api2geo dial，依赖 VPS keep_alive 30s |
| **NOT** | 切节点 · 杀健康 conn · 减并行 · 客户端限时 |
| **反复次数** | **同族 split-brain 第 6 次**（含 2026-07-21 d56b1442 33s EOF · 2026-07-22 0946940c 20s ETIMEDOUT）；**nudge defer 第 1 次实现** |
| **为何反复** | 1.26.50 token_gap @ 20s 用 **短 HTTP 探针救长流**，高 conn 时探针本身变成 **dial 风暴**；短探针全绿 ≠ marathon SSE 正常 |
| **踩坑** | ① conn 33→268 是 **新增 dial** 不是旧 conn 太多 — **禁止** 用 hygiene/prune 杀健康连接 ② `session_transport_nudge_failed` @ 高 conn = 风暴症状不是 VPS 宕 ③ 定责必须 ledger @ A + renderer ECONNRESET 时间线对齐 ④ P8 connect_stream_keepalive @ conn≥80 **尚未统一 defer**（见 BUG-2026-07-22-002 遗漏项） |
| **回归** | `cursorHy2MarathonKeepaliveCore.test.ts` defer 3/3 · test:node-quality **176/176** |
| **用户动作** | 已完成：`pnpm run upgrade:mac` → `/Applications` **1.26.51** 运行中 · app.log 搜 `session_transport_nudge_deferred_cursor_load` |
| **证据包** | `~/Desktop/cursor-triage-4950032b-20260722T133014/` · renderer @ 11:55:30 ECONNRESET |
| **代码位置** | `cursorHy2MarathonKeepaliveCore.ts` · `cursorHy2MarathonKeepalive.ts` |

### BUG-2026-07-22-002 · v1.26.51 · HY2 marathon read ETIMEDOUT（0946940c）· P8 Connect 长流保活 · tokenGapReader 损坏

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.51** 已部署 `/Applications` · **PARTIAL 待 soak 关门**） |
| **症状** | RID `0946940c-c7b1-4c69-85a9-0fba7f4e7ae2` @ **2026-07-22 11:40:25 CST**：84min 马拉松 · `cursor_conn=28–30` · 最后 `toolCallDelta` **11:40:06** → **~20s 静默** → `[unavailable] read ETIMEDOUT` · 14s 内第二 RID `c033803b` 同 JP-VPS-HY2 同错 · Guard intercept-on 断后 `will-retry` **BLOCK**（配额浪费，正交） |
| **关联产品** | Sparkle **1.26.50** @ `/Applications` · Cursor-2 **3.12.17** · JP-VPS-HY2 · Guard WB **1.0.9**（假阳性见 `BUGFIX_LOG_312` BUG-312-2026-07-22-003） |
| **bug 存在版本** | Sparkle **1.26.50**（token_gap nudge 仅 api2/api2geo 短探针 · **无 api2direct Connect 路径保活**）· `cursorStreamTokenGapReader.ts` **函数损坏缺 export**（token gap 信号可能失效） |
| **修复目标版本** | Sparkle **1.26.51** |
| **根因** | **L3 HY2 QUIC Marathon split-brain（definitive）**：ledger @ A+4s **291ms 全绿** · VPS sing-box @ A±2min **零 ERROR**（SSH 实查 hy2-in 3600s 三字段已部署）· 断前仍有 toolCallDelta → **NOT Cursor 服务端** · **NOT max-steps-cap**。机制：`session_transport_nudge` + `token_gap_force_nudge` 在 11:40:10~40 **已在打**，但仅 `mihomoProxyDelay(api2+api2geo)` **新开短 HTTP**，不保活 **api2direct.cursor.sh** 上 AgentService Run 长流 → socket read ETIMEDOUT @ ~20s（= `TOKEN_GAP_FORCE_MS` 窗口） |
| **修复** | ① **P8** `cursorConnectStreamKeepaliveCore.ts` / `cursorConnectStreamKeepalive.ts` — ≥15s meaningful SSE 静默 + conn≥12 → **api2direct + api2** 双探针 · 日志 `connect_stream_keepalive` · ≥12s 冷却 · **非破坏性** ② `readConnectStreamKeepaliveGapSignal` @ 15s 阈值（早于 20s ETIMEDOUT）③ **修复** `cursorStreamTokenGapReader.ts`（恢复 `readMarathonStreamTokenGapSignal` / cold-resume 收集）④ roadmap §14 SSOT |
| **1.26.50 已做但未够** | token_gap @ 20s ✅ · VPS/Mac QUIC 3600s ✅ · 40s session nudge ✅ — **不覆盖「探针全绿 + api2direct 长流 ~20s read timeout」** |
| **反复次数** | **同族 split-brain 第 5 次**（2026-07-18 Reality mux · 2026-07-20 partition · 2026-07-20 VPS QUIC · 2026-07-21 33s server_eof d56b1442 · **本次 20s read ETIMEDOUT**）；P8 **第 1 次实现** |
| **为何反复** | 每层修复只解决 **一个时间尺度 + 一个 host**：VPS 小时级 idle · 40s nudge 分钟级 · 20s token_gap 仍只探 **api2/api2geo**，未触 **Connect 实际 host api2direct**；短探针全绿 → 「网络正常」错觉 |
| **踩坑** | ① `HTTP api2 291ms 全绿 ≠ AgentService Run 长流正常` ② token_gap nudge **连续打仍 ETIMEDOUT** = 探针 **类型** 错，不是 **频率** 不够 ③ 定责必须 SSH VPS @ A + renderer 精确时间线（toolCallDelta→ETIMEDOUT 间隔）④ **勿** 用 GUI 批量 VPS delay 测速判活（见 BUG-2026-07-22-001）⑤ P8 与 BUG-001 defer（conn≥80）**尚未统一** — 极高 conn 时 P8 仍可能加探针，待 soak 后评估是否复用 defer |
| **遗漏 / 待验证** | ① P5 soak：并行 ≥30 conn · ≥60min · app.log `connect_stream_keepalive` ② P8 @ conn≥80 是否需 defer（4950032b 风暴族）③ Guard transport 断后 will-retry BLOCK → P7c 正交 |
| **回归** | `cursorConnectStreamKeepaliveCore.test.ts` 3/3 · test:node-quality **176/176** |
| **用户动作** | 已完成：`pnpm run upgrade:mac` → app.log 搜 `connect_stream_keepalive` · ⌘Q Cursor-2（Guard WB 1.0.9） |
| **证据包** | `~/Desktop/cursor-triage-0946940c-20260722T114605/` · `Cursor-2-data/.../renderer.log` @ 11:40:06 toolCallDelta · `app-2026-7-22.log` token_gap @ 03:40 |
| **代码位置** | `cursorConnectStreamKeepalive*.ts` · `cursorStreamTokenGapReader.ts` · `cursorTransportHealth.ts` · `temp-docs/repair/CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` §14 |

### BUG-2026-07-22-003 · v1.26.51→**1.26.52** · CTHC hung scan 崩溃 + mihomo history @ A 滚出（68a378b8 批次）

| 字段 | 内容 |
| --- | --- |
| **状态** | **PARTIAL FIXED**（① coreReadyTimestamp + bundler 链接 @ **1.26.52** ✅ — 见 **BUG-2026-07-23-004**；② history @ A 归档 @ **1.26.52** ✅；③ triage Step 3c 仍 OPEN） |
| **症状** | 2026-07-22 15:49–16:23 CST **5 次** `resumeAction HTTP` 幽灵 Included +1（目标 `68a378b8` @ 16:03:09）；Sparkle UI 测速记录有高延迟柱；CTHC 无法 hung_scan / token_gap nudge |
| **关联产品** | Sparkle **1.26.51**（运行中）· Cursor **3.1.15** · Guard patch **markers_missing** |
| **bug 存在版本** | Sparkle **≤1.26.51**（hung scan 运行时崩溃）；mihomo history ~10 条滚出导致 V5.6 @ 15:49–16:03 **不可回放** |
| **修复目标版本** | Sparkle **1.26.52** |
| **根因（Sparkle 侧）** | ① `06:02–08:32+` app.log 连续 `[CursorTransportHealth]: hung scan failed: getLastCoreReadyAtMs is not a function` → hung_scan / token_gap / MarathonKeepalive warmth **全盲** ② mihomo `199e64b94e8-vps` 每 leaf history ~10 条 · 15:49–16:03 @A 已从 UI last8 **滚出** · 定责只能交叉 ledger（405ms OK @ 08:03:19）③ `network-stability-events.jsonl` A 窗口 **0 行** vps_node_snapshots |
| **根因（本案 L1 · 非 Sparkle 单责）** | Cursor EH pid:32144 长期 unresponsive → resumeAction while SSE alive（见 roadmap SSOT）· **NOT** V5.2/V5.4 失败 @ A |
| **修复（计划）** | ① ✅ `coreReadyTimestamp.ts` 叶子模块 ② ✅ `mihomo_vps_history_snapshot` last8 @ hung_scan heartbeat（1.26.52）③ triage Step 3c ④ `@A` 仍 OPEN |
| **反复次数** | hung scan 类 **第 2 次**（同类 import/循环依赖）；history @ A 不可回放 **第 1 次**台账化 |
| **为何反复** | CTHC 与 manager 动态 import 无启动自检；history 仅 mihomo 内存滚动 · 无 A 时刻归档 |
| **踩坑** | ① UI 测速 765ms @ **16:23:50** 在 resume **后** 41s — 禁止当 A 时刻因果 ② 凌晨 707–947ms 柱可残留在 last8 — 须 filter `history[].time` @ A±5min ③ **禁止** 用 `vps_node_snapshots` 统计 delay 分布代替 UI history（手册 §6 节点对照） |
| **回归** | `networkStartupGraceCore.test.ts` +1（coreReadyTimestamp）· `cursorTransportHealthCore.test.ts` |
| **用户动作** | `pnpm run upgrade:mac` → app.log 应出现 `hung_scan_heartbeat` / `connect_stream_keepalive`，**不再**出现 `getLastCoreReadyAtMs is not a function` |
| **证据包** | `renderer.3.log:3856-3878` · `~/.sparkle/api2-probe-ledger.jsonl` @ 08:03 · mihomo socket `199e64b94e8-vps` history |
| **代码位置** | `coreReadyTimestamp.ts` · `mihomoApiSocketWatchdog.ts` · `cursorTransportHealth.ts:495-574` · `temp-docs/repair/CURSOR_RESUME_ACTION_EH_GHOST_BILLING_REPAIR_ROADMAP.md` |

### BUG-2026-07-23-004 · v1.26.52 · PostCoreBootstrap 失败 · `markCoreReadyAtMs is not defined` · CTHC 下午全盲

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.52** 已装 `/Applications` · CDHash `22c7ccfb59f92134bcf710075158377ead56432c` · 2026-07-23 14:46 CST） |
| **症状** | 2026-07-23 **10:15:14 CST** app.log：`[PostCoreBootstrap]: failed: markCoreReadyAtMs is not defined`；此后 **无** `token_gap_force_nudge` / `connect_stream_keepalive`；`network-stability-events.jsonl` 最后 `transport_hung_scan` **10:09:54**；12:47 / 13:45 L3 断连时 Mac **无 CTHC 证据** |
| **关联产品** | Sparkle **1.26.52**（`/Applications` 旧 asar 断裂包）· Cursor **3.1.15** · Guard **0.15.93** observe-only（独立：未 ⌘Q → Billing 三列 `—`） |
| **bug 存在版本** | Sparkle **1.26.52 首装 asar**（`manager.ts` 调用 `markCoreReadyAtMs()` 但 bundle 无导出；仅 `safeGetLastCoreReadyAtMs` 经 `networkStartupGraceCore` chunk 链接） |
| **修复目标版本** | Sparkle **1.26.52**（同 semver · 修复 build 产物，非 bump） |
| **根因** | ① `coreReadyTimestamp.ts` 拆出后 `manager.ts` 使用 **named import** → electron-vite/rolldown 产物 `out/main/index.js` **裸调用** `markCoreReadyAtMs()` **无定义**（asar 内仅 1 处引用、0 处 export）② `completeCoreInitialization` 抛 ReferenceError → `runPostCoreBootstrap` 的 `startCore()` race reject → PostCoreBootstrap catch ③ 与 **BUG-2026-07-22-003** 同类：**coreReadyTimestamp 与 manager 循环依赖治理后的 bundler 链接盲区** |
| **修复** | ① `manager.ts`：`import * as coreReadyTimestamp` + `coreReadyTimestamp.markCoreReadyAtMs()` → 产物 `require_networkStartupGraceCore.markCoreReadyAtMs()` ② asar 门禁 SSOT：`upgradeSparkleAsarGateCore.ts` + `verify-sparkle-main-asar.mts`（见 BUG-005） |
| **反复次数** | coreReadyTimestamp 链 **第 3 次**（① hung scan `getLastCoreReadyAtMs is not a function` ② 叶子模块 ③ 本次 PostCoreBootstrap） |
| **为何反复** | 源码 typecheck 通过但 **未在 asar 内 grep 导出**；PostCoreBootstrap 失败仅 1 行 app.log，Dashboard 无告警 |
| **踩坑** | ① stale dist → signing flake 见 **BUG-2026-07-23-005** ② install 后看 `Api2ProbePlane ON`，**禁止**只看 semver ③ 断连定责前 grep `PostCoreBootstrap.*failed` — 有则 Step 3a 全盲 |
| **回归** | `networkStartupGraceCore.test.ts` · `coreReadyTimestamp.bundle.test.ts` · `upgradeSparkleAsarGateCore.test.ts`（4/4）· `verify-sparkle-main-asar.mts` · app.log `Api2ProbePlane ON` 且无 `PostCoreBootstrap.*failed` |
| **用户动作** | `bash scripts/upgrade-sparkle-local.sh`（或 vite build + `install-sparkle-local.sh`）→ ⌘Q Sparkle → app.log 验收 |
| **证据包** | `app-2026-7-23.log` @ `2026-07-23T02:15:14.260Z` · 旧 asar：`markCoreReadyAtMs` count=1 无 export · 新 asar @ 14:46：`networkStartupGraceCore.markCoreReadyAtMs` · 装后 @ `06:40:08Z` `Api2ProbePlane ON` |
| **代码位置** | `manager.ts` · `coreReadyTimestamp.ts` · `scripts/upgrade-sparkle-local.sh` · `scripts/verify-sparkle-main-asar.mts` · `scripts/upgradeSparkleAsarGateCore.ts` · `postCoreBootstrap.ts` · `CURSOR-DISCONNECT-TRIAGE.md` Step 3a |

### BUG-2026-07-23-005 · v1.26.52 · `upgrade:mac` electron-builder signing flake · `Sparkle.app could not be found`

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.52** · `scripts/upgrade-sparkle-local.sh` + `electron-builder.yml`） |
| **症状** | `pnpm run upgrade:mac` @ 2026-07-23 **14:46 CST**：vite build 成功 → `@electron/osx-sign` 报错 `Application at path ".../dist/mac-arm64/Sparkle.app" could not be found`；`dist/mac-arm64/` 仅残留 **`Electron.app`**（无 `Sparkle.app`）→ install 未执行 |
| **关联产品** | Sparkle dev 本地升级 · electron-builder **26.8.2** · macOS arm64 |
| **bug 存在版本** | `upgrade-sparkle-local.sh` **未 clean dist** 且 asar 门禁误查 `coreReadyTimestamp.markCoreReadyAtMs`（Vite 压缩后为 `.markCoreReadyAtMs(`） |
| **修复目标版本** | Sparkle **1.26.52**（脚本 + yml，semver 不变） |
| **根因** | ① 前次 packaging/signing **中断** 或 **并发读写** → `dist/mac-arm64` 半成品（`Electron.app` 已写出、尚未 rename 为 `Sparkle.app`）② 下次 `electron-builder --mac dir` **增量**写入 → osx-sign 指向 `Sparkle.app` 时路径不存在 ③ asar 门禁字符串与 minified bundle 不一致 → **假失败**阻断 install |
| **修复** | ① **`rm -rf dist/mac-arm64`** 于每次 dir build 前 ② **`CSC_IDENTITY_AUTO_DISCOVERY=false`** + `electron-builder.yml` **`mac.identity: "-"`** ③ dir build **失败 → clean + 重试 1 次** ④ post-build **`codesign --verify --deep --strict`** ⑤ asar 门禁 SSOT：`upgradeSparkleAsarGateCore.ts` + `verify-sparkle-main-asar.mts`（拒绝 bare `markCoreReadyAtMs(`）⑥ PostCoreBootstrap 门控 90s / tail 500 |
| **反复次数** | 本地 upgrade signing **第 2 次**（① BUG-004 踩坑已记录 Electron.app 残留 ② 本次脚本化 fix） |
| **为何反复** | 文档只警告、脚本未 **强制 clean**；electron-builder 错误信息像「签名失败」实为 **stale dist 路径** |
| **踩坑** | ① 看到 `Sparkle.app could not be found` **先** `ls dist/mac-arm64` — 若仅 `Electron.app` = stale dist，非 codesign 身份问题 ② **`rm -rf dist/mac-arm64` 后单跑 dir** 可 100% 复现成功（2026-07-23 14:49 验证）③ install 验收仍看 **`Api2ProbePlane ON`**，不单看 build exit 0 |
| **回归** | 手动：`rm -rf dist/mac-arm64 && pnpm run upgrade:mac` 连续 2 次成功 · build log `replacing existing signature` · `upgradeSparkleAsarGateCore.test.ts` 4/4 |
| **用户动作** | `pnpm run upgrade:mac`（一条命令） |
| **代码位置** | `scripts/upgrade-sparkle-local.sh` · `scripts/verify-sparkle-main-asar.mts` · `scripts/upgradeSparkleAsarGateCore.ts` · `electron-builder.yml` · `scripts/deepSignMac.cjs` · BUGFIX「Sparkle 本地安装」 |

### BUG-2026-07-23-006 · v1.26.53 · P9 Marathon Quiesce · provider health-check + probe dial 风暴

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.53** 已装 `/Applications` · 2026-07-23 15:43 CST 现场验收） |
| **症状** | Marathon conn 12–157：6 VPS leaf 同秒 `delay=0` → UI 红字「超时」；`proxyHealthMonitor` 每 60s `mihomoProxyDelay`；P8 `MANDATORY_REAL_PROBE_MAX_AGE_MS=30s` + `burstProbeActive` 打穿 conn≥20 defer → Connect cancel / Included 浪费（12:02–12:50 批次 9 次） |
| **关联产品** | Sparkle **1.26.52**（bug 存在版本）· Cursor **3.1.15** · Guard **0.15.93** observe-only（Billing 三列 `—` 为独立线 BUG-183，需 ⌘Q Cursor） |
| **bug 存在版本** | Sparkle **≤1.26.52** |
| **修复目标版本** | Sparkle **1.26.53** |
| **根因** | 观测 dial（VPS/commercial provider auto health-check · `proxyHealthMonitor` · P8 mandatory 30s + burst · conn≥80 仍 `connect_stream_keepalive` 双 dial）与 Agent Connect 长流 **抢 JP-HY2 隧道**；`managedVpsDelayTest` defer **不覆盖** mihomo provider auto check |
| **修复** | ① `marathonQuiesceCore.ts` SSOT conn≥12/80 ② conn≥12：`health-check.enable=false` + `patchRuntimeProxyProviderHealthCheckEnable` + `PUT /configs?force=true` + 暂停 `proxyHealthMonitor` ③ conn≥80：`shouldDeferProbeForCursorLoadUnderMarathonQuiesce` 禁 mandatory/burst 穿透 + `shouldRunConnectStreamKeepalive` @80 false ④ UI 过滤 `delay=0` 柱 + **Marathon 静默** badge |
| **反复次数** | **同族 dial 风暴第 2 次根治尝试**（2026-07-22 defer@20 半修 · 2026-07-23 P9 全源 gate） |
| **为何反复** | 上轮只修 UI 手动测速 defer + conn≥20 probe defer，**未枚举** provider auto health-check / mandatory 30s 穿透 / P8 keepalive@80 |
| **踩坑** | ① `updateProvider()` 全量 reload 会抖 leaf — 用 runtime yaml patch + `reloadMihomoConfigFromDisk` ② `pnpm prepare` 网络失败时 upgrade 须 `SKIP_PREPARE=1`（sidecar/mihomo 已存在）③ 装 pkg 后须 **⌘Q Sparkle** 才加载新 asar — 否则 app.log 仍见旧 `connect_stream_keepalive` ④ Post-install 90s 门控在 grace 内可能报 FAIL，不等于 pkg 坏 |
| **回归** | `marathonQuiesceCore.test.ts` 11/11 · `proxy-delay-sample-age.test.ts` +1 · `cursorConnectStreamKeepaliveCore.test.ts` @80 defer · app.log 验收 |
| **用户动作** | `SKIP_PREPARE=1 bash scripts/upgrade-sparkle-local.sh` → ⌘Q Sparkle → conn≥12 验收 |
| **证据包** | app.log @ `2026-07-23T07:43:25Z` `marathon_quiesce ON cursor_conn=13` · `provider health-check OFF` · @ `07:56:14Z` conn=157 · **07:43 后零条** `connect_stream_keepalive` |
| **代码位置** | `marathonQuiesce*.ts` · `factory.patchRuntimeProxyProviderHealthCheckEnable` · `mihomoApi.reloadMihomoConfigFromDisk` · `networkStabilityMonitor.ts` · `proxyHealthMonitor.ts` · `cursorConnectStreamKeepaliveCore.ts` · `proxy-detail-tooltip.tsx` · `CURSOR-DISCONNECT-TRIAGE.md` |
| **遗漏** | P9g 30min soak 对照 Included 基线 **未跑** · Guard BUG-183 **正交未修** |

### BUG-2026-07-23-007 · v1.26.55 · P9 Phase 2 Dial Plane · in-flight health-check + hysteresis bypass

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.56** · proxyHealthMonitor hysteresis + P9n 柱图 · pkg 待 `upgrade:mac`） |
| **症状** | Phase 1（1.26.53）后 **15:56** 仍 6-leaf 同秒 `delay=0`；PostCoreBootstrap @conn=157 仍 warmup；Tray 尾部 delay=0 假红；HY2 tooltip 511ms 与 nudge 1:1 混读为 VPS 故障 |
| **关联产品** | Sparkle **1.26.53–1.26.54** · Cursor **3.1.15** · Guard **0.15.93** observe-only（Billing 三列 `—` = BUG-183，需 ⌘Q Cursor，与 Sparkle 正交） |
| **bug 存在版本** | Sparkle **≤1.26.54** |
| **修复目标版本** | Sparkle **1.26.56** |
| **根因** | ① mihomo **600s in-flight** health-check 不受 scheduled OFF 取消 ② cache miss 仍走 `mihomoProviderHealthcheckDeduped` `/healthcheck` API ③ probe_cycle defer 门槛 conn≥20 + mandatory 30s 穿透 ④ `shouldAllowObservabilityDial` 在 **exit hysteresis conn<12** 时误放行 observability dial ⑤ nudge RTT 写入 provider history 污染 UI |
| **修复** | **P9i** `shouldAllowObservabilityDial` SSOT（hysteresis 仍 block）· **P9j** `healthcheck_inflight_skipped` 审计 · **P9k** warmup defer · **P9l** Tray `pickLatestSuccessfulProviderDelay` · **P9m** marketplace skip · **P9n** `session_nudge` → ledger + **柱图剔除 nudge** · **P9r** block `/healthcheck` API @ quiesce · **P9s** probe_cycle defer · **1.26.56** proxyHealthMonitor quiesce 全暂停 |
| **反复次数** | dial 平面竞争 **第 3 次**（Phase 1 半修 → Phase 2 全源 gate → hysteresis bypass 补丁） |
| **为何反复** | Phase 1 只关 scheduled toggle；未枚举 in-flight timer · cache-miss API · mandatory 穿透 · hysteresis conn 门槛不一致 |
| **踩坑** | ① `delay=0` 与同批 TLS 689ms **可并存** — 拥塞非宕机 ② HY2 >500ms **常等于 nudge 成功探针** — 看中位数非尾部 ③ P9n **未** 剥离 provider history 柱图（ledger 分离已做，history 二期）④ **无 soak 数据前禁止宣称 >500ms 尖峰率下降** |
| **回归** | `marathonQuiesceCore.test.ts` **14/14** · `pnpm run upgrade:mac` asar gate |
| **用户动作** | `SKIP_PREPARE=1 bash scripts/upgrade-sparkle-local.sh` → ⌘Q Sparkle → 30min 并行 Agent soak（P9o） |
| **证据包** | `CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` §16.11 · app.log 15:56:46–50 TUIC batch · CTHC nudge 561/515/509 1:1 |
| **代码位置** | `marathonQuiesceCore.ts` · `mihomoApi.ts` · `networkStabilityMonitor.ts` · `postCoreBootstrap.ts` · `tray.ts` · `cursorHy2MarathonKeepalive.ts` · `api2ProbeLedgerRowCore.ts` |
| **遗漏** | P9o 30min soak **未跑** · P9i CI `grep mihomoProxyDelay` 门禁 **未加** · P9n provider history 分离 **部分** · Guard BUG-183 **未修** |

---

## 2026-07-21

### BUG-2026-07-21-003 · v1.26.50 · HY2 Marathon 33s token 静默 → server_eof（d56b1442）· token gap nudge

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.50** 已部署 `/Applications` · `upgrade-sparkle-local.sh`） |
| **症状** | RID `d56b1442-dd91-404e-90c7-6bb49aa57d49` @ **2026-07-21 18:54:20 CST**：3 Agent 并行 · JP-VPS-HY2 · Connect SSE **33s 无 token** → `server_eof` / `ConnectError code=10 aborted` → auto resume → Included×2 幽灵计次；UI 后续 resume 假卡死（stock 状态机 desync，非补丁） |
| **关联产品** | Sparkle **1.26.49**（运行中 pkg）· Cursor **3.1.15** 官方（补丁已删） |
| **bug 存在版本** | Sparkle **1.26.48–1.26.49**（含 P0–P3 + VPS QUIC 3600s + 40s nudge，**无 token gap**） |
| **修复目标版本** | Sparkle **1.26.50** |
| **根因** | **L3 HY2 QUIC Marathon split-brain（definitive）**：`gapSinceActivityMs=32796` · `terminalKind=server_eof` · ledger @ A **api2+api2geo 303ms 全绿** · VPS sing-box @ A±2min **error 段空** · 单 RID 断、其他 Agent 同秒仍收 token。P6 **40s** `session_transport_nudge` 周期 **盖不住 ~33s** 服务端 idle：`10:53:37 nudge` → `10:54:20 EOF` → `10:54:37 nudge`（晚 17s）。**NOT** max-steps · NOT Guard block · NOT patch · NOT L0 hung |
| **修复** | ① `cursorStreamTokenGapCore.ts` — 解析 renderer `[ifm-event-v1] stream_activity` / SSE audit（**忽略 heartbeat**）② `cursorStreamTokenGapReader.ts` — renderer tail ③ `cursorTransportHealth.ts` hung_scan：`gap≥20s` + conn≥12 → `tokenGapForce` nudge（15s cooldown）④ 常量 SSOT：`CURSOR_HY2_TOKEN_GAP_FORCE_MS=20000` |
| **1.26.48–49 已做但未够** | VPS hy2-in QUIC 3600s ✅ · MarathonDialTolerance dial 45s ✅ · partition detect ✅ · high_latency nudge (>600ms) ✅ — 均 **不覆盖「探针全绿 + 33s token 静默」** |
| **反复次数** | **同族 split-brain 第 4 次**（2026-07-18 Reality mux · 2026-07-20 P0–P3 partition · 2026-07-20 HY2 VPS QUIC · **本次 33s gap**）；**token gap 机制第 1 次实现** |
| **为何反复** | 每层修复只解决 split-brain **一个时间尺度**：VPS idle（小时级）· 40s nudge（分钟级）· 缺 **20–30s token 级** 自适应触发；短探针全绿造成「已修好」错觉 |
| **踩坑** | ① `HTTP api2 303ms 全绿 ≠ Connect 长流正常` ② 40s nudge **不是** 33s EOF 充分条件 ③ UI 批量测速 Marathon 下 defer → **误报超时**，非 VPS 宕 ④ 定责必须 A 时刻 ledger + VPS sing-box + renderer `gapSinceActivityMs`，禁止 B 时刻否定 A ⑤ 删除 IFM 补丁 **不消除** stock `ConnectError aborted` |
| **回归** | `cursorStreamTokenGapCore.test.ts` 4/4 · `cursorHy2MarathonKeepaliveCore.test.ts` token gap 3/3 · test:node-quality 含新文件 |
| **用户动作** | `pnpm run upgrade:mac`（或 `bash scripts/upgrade-sparkle-local.sh`）→ app.log 搜 `token_gap_nudge outcome=`（≥1.26.64） |
| **证据包** | `~/Desktop/cursor-triage-d56b1442-20260721T190949/` · `app-2026-7-21.log:885-891` · `renderer-A-full-disconnect.txt:42` |
| **代码位置** | `cursorStreamTokenGapCore.ts` · `cursorStreamTokenGapReader.ts` · `cursorTransportHealth.ts` · `cursorHy2MarathonKeepaliveCore.ts` · `cursorHy2MarathonKeepalive.ts` |

### BUG-2026-07-21-004 · v1.26.50 · 本地安装闪退 / stale asar / Gatekeeper 启动

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（`scripts/upgrade-sparkle-local.sh` · `install-sparkle-local.sh` Finder 启动） |
| **症状** | `install-sparkle-local.sh` 成功但 GUI **闪退/打不开**；`spctl: rejected`；直接运行 `Sparkle` **exit=1**；或安装后 asar **无新功能**（token_gap 字符串缺失） |
| **根因** | ① adhoc 新 CDHash → Gatekeeper rejected；`open -a` / 双击 **不弹批准** → 瞬间 exit（像闪退，非 DYLD）② 只跑 `electron-builder --mac dir` **未先** `electron-vite build` → dist asar 为旧构建 ③ 曾用手动 `codesign` + 损坏 backup → `sealed resource invalid` |
| **修复** | ① `upgrade-sparkle-local.sh`：vite → dir → asar 校验 → install ② `install-sparkle-local.sh`：Finder `open POSIX file` 启动；graceful quit 失败 → `pkill -9` ③ `pnpm run upgrade:mac` SSOT |
| **禁止** | ❌ 跳过 vite 直接 electron-builder · ❌ install 后二次 codesign · ❌ `open -a` 作为 adhoc 首选启动 |
| **正确流程** | `pnpm run upgrade:mac` |
| **长期** | Apple Developer ID + notarize |
| **代码位置** | `scripts/upgrade-sparkle-local.sh` · `scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装」 |

### BUG-2026-07-21-001 · v1.26.48 · 双份 Sparkle（/Applications + ~/Applications）· GUI/service 分裂

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（`scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装」SSOT） |
| **症状** | 设置页版本与 `defaults read` 不一致；删 `~/Applications` 副本后 GUI 无法启动；app.log `spawn …/Users/…/sparkle-service ENOENT` |
| **bug 存在版本** | 任意同时存在 **`/Applications/Sparkle.app`** 与 **`~/Applications/Sparkle.app`** 的安装方式 |
| **根因** | pkg/root 装系统目录 + dev 手动复制用户目录 → **service 绑 `/Applications`、GUI 从 `~/Applications` 启动**；Gatekeeper 对新 ditto 拒启（`spctl: rejected`）；root 所有 `/Applications` 无 sudo 无法 `chown`/codesign |
| **修复** | `install-sparkle-local.sh`：quit → 停 service → **删除/备份用户副本** → 仅 `ditto` 到 `/Applications` → `chown` + `xattr -cr` → **不重签**（见 BUG-002）→ 单路径启动校验 |
| **禁止** | ❌ 手动 `cp`/`ditto` 到 `~/Applications` · ❌ `open dist/mac-arm64/Sparkle.app` 日常用 · ❌ 只改 Info.plist |
| **正确流程** | `pnpm run upgrade:mac` |
| **踩坑** | 验证必须 **`pgrep -lf Sparkle.app/Contents/MacOS`** 与 **`sparkle-service`** 路径同属 `/Applications` |
| **代码位置** | `scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装（标准 · 唯一路径）」 |

---

### BUG-2026-07-21-002 · v1.26.48 · install 二次 codesign 作废 Gatekeeper 批准

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | `sudo install-sparkle-local.sh` 成功但 GUI **闪退/打不开**；`spctl: rejected`；直接运行 `Sparkle` **exit=1**；以前 `~/Applications` 旧副本可开、换 `/Applications` 新包后不行 |
| **bug 存在版本** | `install-sparkle-local.sh` 在 `ditto` 后 **`codesign --deep --sign -`**（与 pkg 流程末尾二次 sign 同理） |
| **根因** | `build:mac` 已由 `deepSignMac.cjs` deep sign；install **再次 adhoc 重签 → CDHash 变化** → macOS 视为全新未信任 app；同时删除已批准的 `~/Applications` GUI 副本 |
| **修复** | install 脚本：**仅 ditto + xattr -cr**，比对 CDHash；**Finder POSIX 启动**（BUG-004）；状态写入 `~/.sparkle/last-sparkle-cdhash` |
| **禁止** | ❌ install/pkg 后二次 `codesign`（除非 rebuild 失败验签）· ❌ 恢复 `~/Applications` 双路径 |
| **正确流程** | `pnpm run upgrade:mac`；Gatekeeper fallback：Finder Control+打开 **一次** |
| **长期** | Apple Developer ID + notarize 可彻底免 Gatekeeper；无账号时上述流程已是最稳 adhoc 方案 |
| **代码位置** | `scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装（标准 · 唯一路径）」 |
