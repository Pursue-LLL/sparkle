# Sparkle Bugfix Log

> **2026-07-30 最新**：**BUG-2026-07-30-002** — marathon probe contention · TLS 07:06 · **R-23 待授权** · **BUG-2026-07-30-001** R-17–22 @1.26.97

### BUG-2026-07-30-002 · v1.26.97 · marathon_probe_contention_amplifies_cursor_disconnect (R-23)

| 字段 | 内容 |
| --- | --- |
> **2026-07-30 最新**：**BUG-2026-07-30-002** — probe contention · **R-23 IMPLEMENTED @1.26.98** · **BUG-2026-07-30-001** R-17–22 @1.26.97

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
| **关联 SSOT** | `CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md` **§10.5d** · `CURSOR-DISCONNECT-TRIAGE.md` |
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
| **关联** | `cursorTransportHealth.ts` · `marathonQuiesce.ts` · Sparkle SSOT `CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md` §14 R-07 |
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
| **状态** | EXEC-CODE-DONE · SOAK-PENDING（execute 在 Guard312 WB **1.0.16**） |
| **症状** | Jul28 14:47–14:50 c69260ad/cc6c19f8/11b777ba @ ~89–91min · 服务端 generation-ended silent EOF → 用户手动 Continue 烧 Included |
| **关联产品** | Sparkle（检测）+ Guard312（execute） |
| **bug 存在版本** | 无客户端段轮换 · 被动等 silent EOF |
| **修复目标版本** | Sparkle **1.26.88–1.26.89**（P22a detect）· Guard312 **1.0.17**（P22b execute） |
| **修复** | Sparkle `cursorSegmentHandoffCore.ts` @ hung_scan `phase=detect_only` · WB `c2-wb-025` queue+resumeChat @ ~85min |
| **诚实边界** | 服务端 ~89min cap 无法 100% 消除；首跑须验 `[SegmentHandoff] outcome=executed phase=resume-chat-invoked` |
| **踩坑** | Sparkle detect 与 WB execute **双轨独立**；仅 deploy WB 后 execute 生效 · `submitChat` eager bind 避免 service 未捕获 |
| **SSOT** | Sparkle `CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md` §11.2 · Guard312 `segmentHandoffCore.mjs` |

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

每次修复用户可感知 bug 后 **必须追加一条**。架构教训与 Cursor 代理操作手册见 [reports/cursor-marathon-playbook.md](reports/cursor-marathon-playbook.md)、[src/main/core/_ARCH.md](src/main/core/_ARCH.md)；本文件只做 **修复台账**（症状 → 根因 → 计划/实际修复 → 版本 → 证据）。

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
pnpm run upgrade:mac
# 等价：bash scripts/upgrade-sparkle-local.sh
```

**仅安装已构建 dist（不重编）**：

```bash
bash scripts/install-sparkle-local.sh
```

**upgrade:mac 流程**：`electron-vite build` → **`rm -rf dist/mac-arm64`**（防 stale `Electron.app` 签名竞态，BUG-005）→ `electron-builder --mac dir`（`mac.identity: "-"` + `afterSign` deepSignMac · 失败自动 clean+重试 1 次）→ **`verify-sparkle-main-asar.mts`**（SSOT：`upgradeSparkleAsarGateCore.ts`）→ `install-sparkle-local.sh` → **Marathon 就绪门控**：mihomo socket + **`Api2ProbePlane ON`**（90s 内）+ 禁止 `PostCoreBootstrap.*failed` → Finder 启动。

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
| `pnpm run upgrade:mac` 或 `bash scripts/upgrade-sparkle-local.sh` | 只跑 `electron-builder` 不先 `electron-vite build`（stale asar） |
| 安装前 `rm -rf /Applications/Sparkle.app` 再 **整包 ditto** | ditto/cp **覆盖**旧 app（DYLD · BUG-003） |
| 启动：`install-sparkle-local.sh` 内 Finder POSIX open | 双击 / `open -a` 作为 adhoc 新包首选（Gatekeeper exit=1 像闪退） |
| 仅 `/Applications/Sparkle.app` 单路径 | `~/Applications/Sparkle.app` 并存（split-brain · BUG-001） |
| install 后 **不重签** | install/pkg 后二次 `codesign`（CDHash 变 · BUG-002） |
| 定责读 triage 证据包 + A 时刻三源 | 用 B 时刻探针否定 A 时刻断连 |
| **马拉松中禁止 `upgrade-sparkle-local.sh` / install**（conn≥12 或 quiesce ON 时脚本 FAIL） | 马拉松进行中 install Sparkle（会 kill mihomo → Connect ECONNRESET） |
| 紧急 override 仅 `SPARKLE_FORCE_CORE_RESTART=1` | 无 override 强杀 core |

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
