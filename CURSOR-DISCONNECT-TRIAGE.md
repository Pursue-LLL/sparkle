# Cursor 断连排查手册

当 Cursor Agent/Chat SSE 流中断时，按以下步骤逐层定位根因。

> **敏感信息**：VPS IP、SSH 端口、密钥等勿写入 git。Step 1 使用占位符；真实值见本地 [VPS-CONNECT.md](./VPS-CONNECT.md) 或私有运维文档。

---

## 核心原则（必读，避免误判）

### 用户目标（500 Included 套餐 — 排查与修复的北极星）

> **铁律**：一切以最不浪费 Included 次数为核心；单次 userMessage 物尽其用。

| 目标 | 含义 |
|------|------|
| **最省次数** | 每个 Included Request 物尽其用；拦截仅 ghost/自动计次；不误拦 Continue |
| **最持久** | 单次 userMessage 内 Marathon 尽量不断；**客户端不主动限时/断流**（可加长超时，禁止缩短） |
| **一次做最多事** | **保持并行 Agent**；禁止建议减并行、拆多轮 userMessage、新开会话、failover 换节点 |
| **真实定责** | IFM 标签不可盲信；以 ledger/events/agent-transport-failures @ A 时刻为准 |
| **Guard ON** | 拦 100% 会计次的 auto-retry；OFF 时只通知 ghost 不计次拦截 |

**500 套餐禁止项（修复 Sparkle/Guard 时不得违反）**

1. **禁止限并行** — 不得用「并发 dial 预算 / 限连接数」牺牲单次请求吞吐。
2. **禁止拆轮** — 不得建议拆成多轮 userMessage 或新开会话减步骤（直接浪费次数）。
3. **禁止 failover** — 不得建议切换节点「自愈」（换节点 = 断连 + 浪费）。
4. **禁止客户端主动限时** — 除非 Cursor 服务端断流；客户端应尽可能物尽其用（马拉松可 **加长** dial/connect timeout，不可缩短）。
5. **禁止误杀健康连接** — 不得清理/关闭仍在服务 Marathon SSE 的连接；api2geo 等 critical host 受 hygiene 保护。

**Sparkle 马拉松加固（≥1.26.45 方向；EOF 家族见 ≥1.26.48）**

| 机制 | 作用 |
|------|------|
| `MarathonDialTolerance` | Cursor 连接 ≥12 时 VPS Reality/HY2 leaf **dial timeout 5s→45s**（热更新 provider，不切节点、不关连接） |
| `transport_pair + api2geo` | ledger 同时探 `api2.cursor.sh` + `api2geo.cursor.sh`；api2 绿但 api2geo 红 → `transport_partition_stale`（**只观测，不 failover**） |
| `session_transport_nudge` | HY2 且 cursor_conn≥12 时每 **40s** api2+api2geo 短探针（**保活，非 failover**） |
| `token_gap_force_nudge` | hung_scan 读 renderer tail：任一 RID **≥20s** 无 meaningful token/tool SSE → 立即 session nudge（15s cooldown）；覆盖 ~33s server EOF 窗口（≥**1.26.50**） |
| `Connect partition` | mass PING/code-14 → 强制 nudge + marathon keepalive（**5d03320f 类**） |
| **VPS hy2-in QUIC** | conntrack 3600s + hy2-in **`udp_timeout: 3600s`**（sing-box **1.13.14+ 必做**）；`idle_timeout`/`keep_alive_period` 仅 **≥1.14**（`patch-hy2-in-quic-marathon.sh`）— **23bb8c85/a9722f2 EOF 类 L3 修复** |

修复 Sparkle/Guard 时以上目标优先于「看起来干净」的 transport 清理。

1. **除 `max-steps-cap` 等 Cursor 硬限外，Cursor 服务端不会无缘无故断开 SSE。** 报错几乎总有传输层原因。
2. **同一时刻多路 Agent 同时断连 → 几乎一定是代理 / VPS / QUIC 隧道问题**，不是「服务端随机关流」。
3. **HTTP api2 probe 全绿 ≠ Connect 长流正常。** 短探针 OK 时 gRPC 双向流仍可能已断（split-brain）；QUIC 中途断连 mihomo **无日志**。
4. **IFM 会把 `WritableIterable is closed` 标为 `marathon-stream-closed`（cursor-server）**，但 `agent-transport-failures.jsonl` 中同类错误常带 `proxyNode: *-HY2`——**标签不可盲信**（Guard patch-363/364 已修正弹窗 classify；仍交叉 ledger）。
5. **仅 `max-steps-cap` 可停止网络排查。** `marathon-stream-closed` 在 **<20min、多路并行、或 HY2/TUIC 节点** 时仍要继续 Step 3。
6. **Sparkle L0 @ 60s hung 会误杀 Agent tool 暂停中的 Connect 流**（v1.26.33）；**v1.26.34+** 改为 **12min** 阈值 + 每 host 保留最新 **6** 条（v1.26.36，并行 Agent 保护）。若 A 时刻 app-log 有 `L0 closed N hung` 且运行 <12min → 定责 **Sparkle L0 误杀/过度清理**，非 Cursor Marathon cap。
7. **`客户端 · resumeAction` / `resumeAction HTTP` 是断流后的恢复动作，不是根因。** 必须继续查 renderer `agent-error` + VPS @ A。
8. **非 `max-steps-cap` 断连，未完成 VPS @ A 证据矩阵（§V5）前，禁止输出 definitive 根因。**
9. **Sparkle 必须用 pkg 安装到 `/Applications`**（≥**1.26.44** 含 vision mux guard + triage V5.4 修复；≥**1.26.40** 含 Agent-stability-first + deep sign）。❌ 禁止 `ditto`/`cp -R` 覆盖 · ❌ 禁止从 `dist/mac-arm64/Sparkle.app` 日常使用 · 见 [BUGFIX_LOG BUG-003/007/2026-07-18-003](./BUGFIX_LOG.md)。

---

## 排查硬性要求（Anti-shallow — 每次必遵守）

**终极目的只有一个：找到【断连罪魁祸首】（哪一层、哪条链路、什么机制）。** 禁止浅尝辄止、禁止用 B 时刻数据否定 A 时刻、禁止把 Guard/拦截/Continue 建议当作根因结论。

### 必须做到的 5 条

1. **逐步执行 SOP §Step 0→8**，每一步输出固定三行：**步骤名 · 结论 · 证据**（文件路径 + 行/字段 + 原文片段）。
2. **A 时刻优先**：以 renderer `agent-error` 行时间戳为 A；所有 ledger/core/app 必须按 **A±60s** 过滤，禁止只读 `tail`。
3. **每步要么 PASS（排除）要么 FAIL（指向某层）**，不允许「可能 / 大概 / 应该」无证据结论。
4. **完成 §V5 矩阵或标注哪一格缺失**；缺 V5.4 时 confidence 最高 **partial**，不得写 definitive。
5. **最终必须单独输出【断连罪魁祸首】**（见 §6），并列出 **NOT**（已排除项 + 证据）。

### 禁止作为排查结论的内容

- Guard ON/OFF、是否拦截、如何 Continue — 这些与**根因定责无关**（除非 Guard 本身改写了 transport，需有 renderer 证据）。
- 「节点延迟高所以断连」— 必须对比 **A 时刻** 6 节点 history + 是否 split-brain。
- 「VPS 正常」— 仅 B 时刻 SSH/UI 测速 **不能** 否定 A 断连。
- 未跑 `triage-cursor-disconnect.sh` 就下结论。
- V5.4 文件 **0 行** 但未排查 UTC 对齐 / active 主机 / SSH 引号问题就标「sing-box 无 error」。

### 每一步输出格式（复制填空）

```markdown
### Step N — <名称>
- **结论**：<PASS 排除 X | FAIL 指向 Y | INCONCLUSIVE 缺 Z>
- **证据**：`<path>:<line或ts>` — `<原文关键字段>`
```

---

## SOP v2 — 逐步执行清单（主流程）

> 一键采集：`./scripts/triage-cursor-disconnect.sh <REQUEST_ID> ["YYYY-MM-DD HH:MM"]`
> 输出 `~/Desktop/cursor-triage-<RID>-<ts>/`（含 `REPORT.md` 骨架、`LOG-MATRIX-A.md`、`disconnect-facts.txt`）。
> **v3.2+** 自动：renderer 轮转扫描、A 时刻检测、ledger/core @ A、**V5.4 active VPS sing-box @ A±2min**（见下 §5.1）。
> **V5.2 @ A** 仍建议 SSH 手工对照（triage 采的是 **B 时刻** L4 快检 + ledger @ A 短探针）。

### §5.1 V5.4 sing-box @ A 采集（triage v3.2+ — 必读）

**目的：** 入站协议 error（HY2 EOF / Reality mux / TLS）是 L3 definitive 的关键一格；**禁止** V5.4 空采仍写 definitive。

| 项 | 规则 |
|----|------|
| **采哪台 VPS** | **active @ A**（ledger `node` 或 core `Cursor 专用[…]`），**禁止**硬编码只 grep JP |
| **时间窗口** | **A±2min**（UTC，与 `incident-utc-prefix.txt` 对齐） |
| **日志文件** | `/var/log/sing-box/sing-box.log` **+** `sing-box.log.1`（跨 midnight 轮转） |
| **bundle 输出** | `vps-active-ssh-host.txt` · `vps-active-singbox-A-window.log` · 同步复制 `vps-kr-*` 或 `vps-jp-*` |
| **验收** | 首行应为 **>0** 行数；`---mux-sample---` / `---errors---` 段非空或有明确「该窗口无 error」说明 |

**triage 实现要点（防回归）：**

- grep pattern 经 **base64** 传入远端 `bash -s`，**禁止**在 SSH 双引号内拼接含 `|` 的 ERE（远端 shell 会拆命令 → **wc -l 恒 0**，2026-07-18 已踩坑）。
- log 行格式：`+0000 YYYY-MM-DD HH:MM:SS`（UTC）；pattern 为 `^\+0000 <date> <HH:MM>:`。

**手工复现（active=kr-vps，A=11:37 UTC 示例）：**

```bash
ssh kr-vps "grep -E '^\\+0000 2026-07-18 11:3[567]:' /var/log/sing-box/sing-box.log \
  | grep -iE 'error|mux|tls|reality' | head -30"
```

**V5.4 空采时：**

| 现象 | 动作 |
|------|------|
| `0` 行 + SSH OK | 查 UTC 对齐、active 主机是否选错、是否只查了 `.log` 未查 `.log.1` |
| SSH 失败 | 标 V5.4 **缺失**，confidence ≤ partial |
| 有行但无 error | 记录行数 + reality/hy2 sample；仍可与 Mac BAD_DECRYPT 时间链交叉 |

### §0 输入清单（缺一则标 inconclusive）

| # | 必填 | 来源 |
|---|------|------|
| 0.1 | Request ID | IFM / Usage Watch |
| 0.2 | **A 时刻**（本地 + UTC） | renderer `agent-error` 行时间戳（优先于弹窗） |
| 0.3 | IFM 断连层级 | 弹窗 |
| 0.4 | 并行 Agent 数 | renderer `activeAgents=` |
| 0.5 | 已运行时长 | renderer `durationMs=` |
| 0.6 | Guard 生效态 | renderer `mode=` + `DECIDED_*` |

### §1 第一层分流

| IFM / Cursor 分类 | 动作 |
|-------------------|------|
| **`max-steps-cap`** | ✅ 唯一可 **停止** 网络/VPS 排查 |
| **`resumeAction` / 客户端 · resumeAction** | ⚠️ 恢复路径标签 → **继续 §2–§8** |
| **`marathon-stream-closed` / WritableIterable** | ⚠️ 常误标 → **继续 §2–§8** |
| **`BAD_DECRYPT` / connectCode=13 / tls-bad-decrypt** | ⚠️ 查 Reality + **V5.4 mux**（§Vision+Mux BAD_DECRYPT） |
| **`post-lifecycle-stall` 且无同期 agent-error** | ℹ️ 仅 watchdog 告警，**不是断流** |

### §2 Cursor 客户端（A 时刻，权威）

**路径：** `~/Library/Application Support/Cursor-*-data/logs/*/window*/renderer.log`

```bash
RID="<request-id>"
RENDERER_LOG="<最新 window*/renderer.log>"
rg "$RID" "$RENDERER_LOG" | rg "agent-error|disconnect|stream-transport|resumeAction|DECIDED_|j-decision|\\[ifm-patch-20 HTTP\\]"
```

**必提取字段 → `cursor_fault_class`：**

| 字段 | 定责用途 |
|------|----------|
| `errMsg` | mid-stream-eof / WritableIterable / ECONNRESET / **BAD_DECRYPT** … |
| `streamPrimarySub` | **tls-bad-decrypt** → Reality vision+mux 路径 |
| `lastSseCase` | heartbeat 静默断 vs turnEnded 正常结束 |
| `durationMs` | 排除/支持 Marathon |
| `activeAgents` | ≥2 → 倾向 L3 批量 |
| `willRetry` + `attempt` | ghost auto-retry |
| `mode` + `DECIDED_BLOCK/ALLOW` | Guard 拦/放 |
| `actionCase` | resumeAction vs userMessageAction |

### §3 Guard / 计次（A 时刻）

**路径：** `~/.cursor-500-guard/billing-guard-events.jsonl` + renderer Guard 行

| 观测 | 含义 |
|------|------|
| `post_lifecycle_stall` + 无 agent-error | 5min 无 turnEnded **告警**，流可能仍在跑 |
| `DECIDED_BLOCK` + attempt≥1 | ghost 已拦 → 用户 Continue（1 Included） |
| `DECIDED_ALLOW` + `stock-parity-off` | auto-retry **已放行**（可能偷计次） |
| `kind=agent_transport_failure` | 交叉 `proxyNode` / `reasonSub` |

### §4 Sparkle Mac 路径（A ±60s）

见下文 **Step 3 / 3b / 5** + **§遥测矩阵** Sparkle 行。

### §5 VPS @ A（非 max-steps **强制**）

> **禁止**仅用 B 时刻 SSH 否定 A 断连。  
> **禁止**仅用 ledger `scope=vps` 判定 L4：TUN fake-ip 常把 SSH 打到 `198.18.x.x` 导致 **假失败**（见 §遥测缺口 T-VPS-01）。

**V5 证据矩阵（必须填表才能 definitive）：**

| ID | 证据 | 命令 / 路径 | A 时刻失败含义 |
|----|------|-------------|----------------|
| V5.1 | sing-box 存活 | `systemctl is-active sing-box` | L4 进程挂 |
| V5.2 | VPS api2 curl | SSH（见 VPS-CONNECT.md） | L4 出口断 |
| V5.3 | VPS marketplace | SSH curl marketplace | partition 对照 |
| V5.4 | sing-box log @ A | triage `vps-active-singbox-A-window.log` 或 SSH grep A±2min（§5.1） | 入站 Reality/HY2/mux/TLS 异常 |
| V5.5 | sing-box restart | `journalctl -u sing-box --since A-10min` | 全协议瞬断 |
| V5.6 | 6 节点 history @ A | mihomo provider API `history[].time` | L3 协议 / KR-JP |
| V5.7 | active 协议 | ledger `probe_via` | HY2/TUIC 长流风险 |

**合成规则：**

1. V5.2 失败 @ A → **L4 definitive**（该 VPS）
2. V5.2 双 OK + V5.4 inbound error @ A → **L3 入站 definitive**
3. V5.2 双 OK + V5.5 restart @ A±2min → **VPS restart 批量断流 definitive**
4. V5.2 双 OK + V5.6 全绿 + mid-stream-eof + HY2/TUIC + activeAgents≥2 → **L3 QUIC 长流静默断 partial**
5. app-log L0 @ A → **Sparkle 自伤 definitive**
6. ledger vps 失败但 V5.2 手工 OK → **忽略 ledger vps 行**（fake-ip）
7. **V5.4 `mux connection closed` / Reality inbound error @ A−1~2min + Mac `turnEnded` 后 `BAD_DECRYPT`（connectCode=13, streamPrimarySub=tls-bad-decrypt）→ **L3 VLESS vision+client multiplex 不兼容 definitive**（见 §Vision+Mux BAD_DECRYPT）

### §6 输出模板（每次必填）

```markdown
Request: <RID>
A: <local> / <UTC>

## 逐步证据链（Step 0→8，每步 结论+证据）

### Step 0 — 输入清单
...

### Step 1 — 第一层分流
...

（Step 2–8 同上格式）

## 定责摘要

[Cursor] errMsg=… lastSse=… duration=… activeAgents=… fault_class=…
[Sparkle] L0/L1=… active=… probe_ok@A=… hung=…
[VPS @ A] V5.1=… V5.2-KR=… V5.2-JP=… V5.4=… V5.5=… V5.6=…

NOT: <已排除项，每条带证据>

## 【断连罪魁祸首】（必填，单独一段）

**层级**：L0 Sparkle | L1 split-brain | L2 mihomo/TUN | L3 QUIC/HY2/TUIC | L4 VPS sing-box | Cursor 硬限
**链路**：Mac → … → api2.cursor.sh
**机制**：<一句话，可复述给第三方>
**节点/协议**：<如 JP-VPS-HY2 / Hysteria2>
**CONFIDENCE**：definitive | partial | inconclusive
**缺失证据**（若 partial/inconclusive）：<如 V5.4 sing-box @ A>

PRODUCT FIX（若有，一条，与根因直接相关）: …
```

> **USER ACTION 不再写入根因报告正文**（与定责无关的操作建议移到产品/运维修复项）。

### §7 根因 → 动作（最佳单路径）

| 根因 | 用户 | 产品/运维 |
|------|------|-----------|
| max-steps-cap | 拆任务 / 新 userMessage | — |
| Sparkle L0 @ A | Continue 1 次 | 确认 Sparkle 1.26.36 + 重启 service |
| L4 @ A | Continue；等 VPS | 修 sing-box / 机房 |
| L3 restart @ A | Continue | 查 sing-box restart 根因 |
| L3 QUIC 长流 @ A | **Continue**（不换节点、不减并行） | 监控 HY2/TUIC；CTHC 12min+keep6 |
| L3 vision+mux BAD_DECRYPT @ A | **Continue** | Sparkle **≥1.26.44** mux guard；确认 `/Applications` 版本 |
| Guard OFF + auto-retry | 开 Guard ON | 查 gate165 同步 |
| post_lifecycle_stall 仅告警 | 忽略，继续等 | — |

---

## 遥测与看板矩阵（现有 · 缺口 · 补全）

| ID | 信号 | 路径 / 看板 | @ A | 能定责到 | 状态 | 缺口 / 补全 |
|----|------|-------------|-----|----------|------|-------------|
| T-C-01 | renderer agent-error | `Cursor-*-data/.../renderer.log` | ✅ | Cursor 断流类型、并行、Guard | **已有** | 无统一 RID 索引；用 triage 脚本 |
| T-C-02 | Guard billing 事件 | `~/.cursor-500-guard/billing-guard-events.jsonl` | ✅ | stall / block / allow | **已有** | Usage Watch 需绑 RID 展示 |
| T-C-03 | validated-ledger | `~/.cursor-500-guard/runtime-events/validated-ledger.v1.jsonl` | ✅ | SSE token/tool 活动 | **已有** | 无 UI 时间线 |
| T-C-04 | workbench gate165 live | `~/.cursor-500-guard/profiles/*/workbench-gate165-live.json` | B | Guard ON/OFF 生效 | **已有** | 与 extension mirror 不一致时需查 |
| T-S-01 | api2-probe-ledger | `~/.sparkle/api2-probe-ledger.jsonl` | ✅ | active 节点、短探针、partition | **已有** | ≠ 长流健康 |
| T-S-02 | network-stability-events | `~/.sparkle/network-stability-events.jsonl` | ✅ | hung 池、L0、vps_node_snapshots | **已有** | QUIC 中途断无 log |
| T-S-03 | app-log CTHC | `~/Library/.../sparkle/logs/app-*.log` | ✅ | L0/L1、hung scan | **已有** | — |
| T-S-04 | agent-transport-failures | `~/.sparkle/agent-transport-failures.jsonl` | △ | proxyNode、RST | **部分** | 常缺 proxyNode；HTTP resume 不一定写入 |
| T-S-05 | mihomo 6-node history | provider API / Sparkle UI | ✅ | L3 协议差异 | **已有** | 须按 A 过滤 history.time |
| T-S-06 | 三点定责 v2 | Sparkle 高级设置 UI | B | KR/JP/active 对照 | **已有** | 仅 B 瞬间 |
| T-VPS-01 | vpsL4Probe ledger | `scope=vps` + app-log `[VpsL4Probe]` | △ | L4 | **已修复 1.26.37** | `ProxyCommand=none` + DOMAIN DIRECT + leaf IP 回退；path 错误 `authoritative=false` |
| T-VPS-02 | sing-box log @ A | triage `vps-active-singbox-A-window.log` + VPS SSH | ✅ | 入站协议 error | **triage v3.2+** | active 主机解析；SSH grep 引号防回归 §5.1 |
| T-VPS-03 | sing-box restart @ A | VPS journalctl | ✅ | 批量断流 | **手工** | 同上 |
| T-VPS-04 | Connect 长流逐跳 | — | — | 单 hop | **缺失** | **inconclusive 承认**；无 magic probe |
| T-D-01 | 单页 incident 看板 | — | — | 全链路 | **缺失** | **Roadmap：Usage Watch「按 RID 定责页」** |
| T-D-02 | A 时刻 VPS 自动快照 | — | — | L4/L3 @ A | **缺失** | **Roadmap：Sparkle 在 agent-error 时触发 V5.2（绕过 TUN）** |

**补全优先级（推荐实施顺序）：**

1. **P0** — `scripts/triage-cursor-disconnect.sh`（Mac 侧一键包）✅ 本仓库
2. **P0** — 本手册 SOP v2 + V5 矩阵 ✅ 本文
3. **P1** — vpsL4Probe 走 `ssh -o ProxyCommand=none` / 直连 Host + DOMAIN DIRECT ✅ **1.26.37**
4. **P1** — agent-transport-failures 写入 `proxyNode` + `httpVer` + `actionCase`（Guard patch）
5. **P2** — Usage Watch Dashboard：**Request ID 定责页**（聚合 T-C-* + T-S-* + 填 V5 表）
6. **P2** — Sparkle：断连时 push `incident_bundle.json`（ledger 窗口 + events + active 节点）

---

## 时间对齐（最重要 — 避免 A/B 时刻混用）

### 两个时刻

| 符号 | 含义 | 示例 |
|------|------|------|
| **A** | 断连实际发生时刻 | IFM 弹窗时间 / Usage Watch 行时间 / 「已运行 N 分钟」反推 |
| **B** | 你粘贴错误、开始排查的时刻 | 通常比 A 晚数分钟 |

### 铁律

| 数据 | 必须看哪个时刻 | 原因 |
|------|----------------|------|
| ledger / events / app-log / core-log / agent-transport-failures | **A ±60s** | 断因证据 |
| mihomo UI 6 节点测速（provider history） | **A ±5min** 的 `history[].time` | 当前 UI 数字是 B 时刻，不能解释 A 断连 |
| VPS SSH curl / sing-box 存活 @ **A** | **A ±5min**（§V5 强制） | 非 max-steps 定责必备 |
| VPS SSH curl @ B only | B 时刻补查 | 仅证明「现在活着」，**不能**否定 A 断连 |

**禁止**：用 B 时刻 VPS curl 或 UI 测速 326ms，去否定 A 时刻的断连分析。

### 从 IFM 弹窗推算 A 时刻

```
A ≈ 粘贴时刻 − (弹窗显示「已运行 X 分钟」的误差)
```

粘贴时务必带上：**Request ID、断连层级、已运行时长、并行 Agent 数**；有精确时间戳更好。

### 日志文件与过滤命令

Sparkle 日志名：`app-2026-7-17.log`（月/日**无零填充**）。macOS 用 glob，勿用 GNU `date` 的 `%-m`。

```bash
APP_LOG=~/Library/Application\ Support/sparkle/logs/app-$(date +%Y)-*.log
CORE_LOG=~/Library/Application\ Support/sparkle/logs/core-$(date +%Y)-*.log

# 将 INCIDENT_UTC 换成 A 时刻 UTC，例如 2026-07-17T08:10
INCIDENT_UTC="2026-07-17T08:10"

# ledger：按 ts 过滤（A ±2min 窗口示例）
rg "\"ts\":\"2026-07-17T08:0[89]|\"ts\":\"2026-07-17T08:1[012]" \
  ~/.sparkle/api2-probe-ledger.jsonl

# events jsonl
rg "\"ts\":\"2026-07-17T08:0[89]|\"ts\":\"2026-07-17T08:1[012]" \
  ~/.sparkle/network-stability-events.jsonl

# mihomo 6 节点 A 时刻测速（history 带时间戳）
# 先确认 provider id（profile 名，常见 199e64b94e8）：
# curl -s --unix-socket "$SOCK" http://localhost/providers/proxies | python3 -c "import sys,json; print(list(json.load(sys.stdin).get('providers',{}).keys()))"
SOCK=/tmp/sparkle-mihomo-api.sock
PROVIDER_ID="199e64b94e8"  # 换成上一步输出的 id
curl -s --unix-socket "$SOCK" http://localhost/providers/proxies \
  | python3 -c "
import sys,json,os
target='2026-07-17T08:10'  # A 时刻 UTC 日期+小时+分
pid=os.environ.get('PROVIDER_ID','199e64b94e8')
d=json.load(sys.stdin)
for px in d.get('providers',{}).get(pid,{}).get('proxies',[]):
    h=[x for x in px.get('history',[]) if x.get('time','').startswith(target[:13])]
    if h: print(px['name'], h[-1])
"
```

CTHC 周期：**hung scan 30s**、**active probe 60s** → 窗口 **A ±60s** 足够。

**hung scan 要点：** hung 判定 = api2 等关键 host 连接 **存活 ≥12min 且上下行速率均为 0**。**v1.26.39+ Agent-stability-first**：CTHC **不 L0/L1 关 Agent SSE**（healthy 或 marketplace 探针 OK → 只观测）；Hygiene **不清理 critical transport host**。1.26.36 曾误将 hung→L0 置于 healthy 之前（BUG-005/006）。

---

## 6 节点 delay 数据源对照（必读，防口径错误）

用户 UI **「测速记录（mihomo）」** 是回答「6 节点 ms / 超时 / 是否 >500」时 **唯一** 与用户所见一致的数据源。代码：`proxy-detail-tooltip.tsx` → `proxy.history.slice(-8)`。

| 数据源 | 路径 / API | 与 UI 一致？ | 正确用途 | **禁止误用** |
|--------|-----------|-------------|----------|--------------|
| **UI 测速记录** | mihomo `/providers/proxies` → leaf `history[-8]` | ✅ **是** | 6 节点 delay 定责；与用户对话对齐 | — |
| **events `vps_node_snapshots`** | `network-stability-events.jsonl`（CTHC hung_scan 附带） | ❌ **否** | A 时刻定责**单点快照**（每 30s） | **禁止**统计「>500ms 占比」或复述用户测速记录 |
| **ledger `scope=active`** | `api2-probe-ledger.jsonl`（60s，当前 Cursor 选用节点） | ❌ 否 | split-brain / Guard / 长流探针 | 禁止代表 6 节点 health-check history |
| **ledger `scope=vps`** | SSH curl L4（300s，KR/JP 各 1 点） | ❌ 否 | L4 出口定责（2 台 VPS） | 与 UI 6 节点 ms 不可比 |

### 为何 `vps_node_snapshots` 会与 UI 对不上

- 代码 `canonicalVpsNodeSnapshotCore.ts`：每节点只取 **`pickLatestSuccessfulProviderDelay()`**（跳过尾部 `delay=0`），**不是** history 全量。
- 采样：hung_scan **30s** vs provider health-check **300s** → 快照常是「某一时刻最后一次成功值」，**不含** 931ms / 4481ms 等历史尖峰。
- mihomo 每 leaf 只保留约 **10 条** history；UI 展示 **last 8**；旧尖峰会滚出当前柱图。
- **反例（2026-07-17）**：用 `vps_node_snapshots` 统计 JP-HY2「24h >500ms = 0%」→ 与用户 UI（931、714、4481）矛盾 → **根因是数据源选错，不是节点真的 0% 超 500**。

### 正确读取 UI 测速记录（与用户对齐）

```bash
SOCK=/tmp/sparkle-mihomo-api.sock
PROVIDER_ID="199e64b94e8"   # 商用 provider id
VPS_PROVIDER_ID="${PROVIDER_ID}-vps"   # v1.26.38+：6 VPS 独立 provider
curl -s --unix-socket "$SOCK" http://localhost/providers/proxies \
  | python3 -c "
import sys,json,os
pid=os.environ.get('VPS_PROVIDER_ID') or (os.environ.get('PROVIDER_ID','199e64b94e8') + '-vps')
nodes=['JP-VPS-HY2','JP-VPS-Reality','JP-VPS-TUIC','KR-VPS-HY2','KR-VPS-Reality','KR-VPS-TUIC']
d=json.load(sys.stdin)
for px in d.get('providers',{}).get(pid,{}).get('proxies',[]):
    if px.get('name') not in nodes: continue
    hist=px.get('history',[])
    last8=[h.get('delay',0) for h in hist[-8:]]
    pos=[x for x in last8 if x>0]
    over=sum(1 for x in pos if x>500)
    print(px['name'], 'last8=', last8, f'>500={over}/{len(pos)}', 'alive=', px.get('alive'))
"
```

排查 **A 时刻** 6 节点：过滤 `history[].time` 落在 A±5min（见上文 §日志过滤 `target=` 示例），**不要**扫 `vps_node_snapshots` 做占比统计。

### 「>500ms」vs「超时」（三个不同概念）

| 用户看到 | mihomo `delay` | 含义 |
|----------|---------------|------|
| 数字 ms（如 714、2081） | >0 | health-check **成功**，偏慢或尖峰，节点仍 `alive` |
| 红字「超时」 | **0** | health-check **失败**（手动测速默认 timeout 5s；provider 失败亦记 0） |
| Sparkle badge / 评分 | — | `CURSOR_PROBE_SLOW_MS=500`（`nodeQualityScore.ts`），**评分门槛**，不是 mihomo 超时 |

**定责顺序：** 用户报「测速记录」→ 先 curl provider `{profileId}-vps` 的 `history[-8]` 对齐 UI → 再查 ledger @ A → `vps_node_snapshots` 仅作 A 时刻单点交叉，**不作** delay 分布统计。

**v1.26.38+ provider 拆分：** 6 VPS 在独立 provider `{profileId}-vps`（仅 6 leaf，api2 health-check）；商用节点留在 `{profileId}`（generate_204）。UI 测速 batch 从 76 节点降为 6，尖峰显著减少。

---

## Sparkle UI「测速 ms」是什么（6 节点数字）

代理列表里的 **326 / 439 / …（毫秒）** 表示：

> **从你 Mac 经 Sparkle TUN → 该 VPS 节点 → 访问 `https://api2.cursor.sh` 最近一次 provider health-check 的延迟。**

| 属性 | 值 |
|------|-----|
| 谁测 | mihomo provider health-check（`work/config.yaml`：`url: https://api2.cursor.sh`，`interval: 300`） |
| 测什么 | TCP+TLS 建连/首包（**不是** ping，**不是** VPS 内部延迟，**不是** Agent 响应时间） |
| 代码依据 | `providerHealthCheckCore.ts` — VPS health-check 目标与 Cursor 同平面 |

### 与 VPS SSH curl 的区别

| 测法 | 路径 | 含义 |
|------|------|------|
| VPS 上 `curl api2` | 仅 VPS→美国 | L4 出口；典型 ~500–620ms |
| **UI mihomo ms** | Mac→隧道→VPS→api2 | L2–L4 全路径；HY2/TUIC 典型 250–500ms；Reality 典型 600–900ms（见 §数据源对照） |

两者测量方式不同，**不能相减算「隧道开销」**。

### 读数参考

| ms | 含义 |
|----|------|
| <500 | HY2/TUIC 常见；Reality 偏乐观 |
| 500–1000 | **api2 目标下常见**（L4 基线已 ~500–620ms）；Reality 常态 |
| >1000 | 尖峰（批量 health-check 竞争、L1 抖动、KR-Reality 尖峰）；`delay>0` 仍可用，≠超时 |
| delay=0 | UI「超时」；与 >500ms **不同问题** |

---

## 三层定责（延迟变高 / 断连通用）

```
L1  公司网 → 美国          Mac 直连 api2（不经 VPS）~1s 基线
L2  Mac → Sparkle TUN      TUN / fake-ip / 路由
L3  Mac → VPS 隧道         Reality / HY2 / TUIC（UI 测速主要反映 L2+L3+L4 握手）
L4  VPS sing-box → api2    SSH curl api2 ~500–620ms
```

| 现象 | 定责 |
|------|------|
| VPS SSH curl OK，UI 仅 Reality 高 | **L3 Reality 隧道** |
| VPS SSH curl OK，HY2 正常 Reality 高 | **L3 协议层**，不是 sing-box 挂 |
| 6 节点同时 >1000ms | L1 公司网或 Cursor 全球（罕见） |
| VPS curl 失败 | **L4** sing-box / VPS 出口 |
| A 时刻 probe 全绿但断连 | **L3 QUIC 静默断流**（split-brain） |

---

## 6 节点测速：仅用于定责，不推荐换节点

6 节点 = **KR/JP 两台 VPS × Reality/HY2/TUIC 三种协议**。同一台 VPS 上 sing-box 正常时，Mac 侧延迟/稳定性仍可能因**协议不同**而不同——这是排查依据，不是日常选型指南。

**本手册不推荐具体节点。** 仅在定责需要区分「哪一层、哪条路径」时看 6 节点 A 时刻 history。

| A 时刻 6 节点 pattern | 定责 |
|------------------------|------|
| **6 个都高**（均 >500ms 或相对基线普涨） | L1 公司网或全局，不是单节点问题 |
| **仅 KR 三个高**，JP 正常 | KR VPS 线路 / Mac→KR 路径（L3/L4 KR） |
| **仅 JP 三个高**，KR 正常 | JP VPS 线路 / Mac→JP 路径 |
| **仅 Reality 高**（KR+JP），HY2/TUIC 正常 | **L3 Reality 协议隧道**（实测可差 2–3 倍） |
| **仅 HY2/TUIC 高**，Reality 正常 | **L3 UDP/QUIC 隧道** |
| **6 个都正常**（如 326–439ms）但 A 时刻断连 | 不是「节点延迟」问题 → QUIC 长流瞬断 / split-brain |
| VPS SSH curl 失败 | L4，与 6 节点 UI 无关 |

**实测证据（B 时刻复测，说明协议间确有差异，非推荐）：** 同一次 health-check 中 JP/KR Reality ~834–854ms，HY2 ~366–378ms；history 中 KR-Reality 曾尖峰 1452ms 而 HY2 同期 ~400ms。差异在 **L3 协议隧道**，不是 sing-box 进程挂掉。

若 VPS L4 正常且 6 节点 A 时刻均正常 → **继续查 split-brain / 并行 Agent / L0**，不要换节点。

---

## VPS 层（L4）排查 — 与 TUN / 6 节点 UI 无关

### 架构：L4 只有 2 个测量点，不是 6 个

```
Mac → [Reality|HY2|TUIC 入站] → sing-box → 同一 outbound → api2
              ↑ 6 节点差异（L3）           ↑ L4 curl 只测这里
```

6 节点在 **VPS 出口（L4）共用同一 sing-box outbound**。SSH 在 VPS 上 `curl api2` **无法区分** Reality/HY2/TUIC，只能区分 **KR vs JP** 两台机器。

**mihomo 为何能测出 6 个不同 ms？** 因为 health-check 在 **Mac 上**跑，对每个 leaf 节点单独发探测：选中 `KR-VPS-HY2` 就走 Mac→TUN→`141.164.43.229:8443` HY2 入站→sing-box→api2；选 `KR-VPS-Reality` 则走 `:443` Reality 入站。测的是 **不同入站协议 + Mac 到 VPS 的隧道**，不是 VPS 内部的 outbound curl。配置见 `override/c7sgvps01.yaml`（6 组 server/port/type）；代码见 `mihomoApi.ts` `/proxies/{name}/delay` + provider health-check。

| 数据源 | 测的是什么 | 节点数 |
|--------|------------|--------|
| **SSH curl api2**（本节） | VPS → api2 出口 | **2**（KR / JP） |
| mihomo UI 6 节点 ms | Mac → 入站协议 → VPS → api2 | 6 |
| `cursor-node-quality-report.md` | Mac 路径 probe（非 VPS SSH） | 6 |

Sparkle **`vpsL4Probe.ts`** 每 **300s** 经 `~/.ssh/config` 的 `kr-vps`/`jp-vps` 写入 ledger **`scope=vps`**（`method=ssh_curl`）。**前提**：本机可 `ssh kr-vps` / `ssh jp-vps`（见 [VPS-CONNECT.md](./VPS-CONNECT.md)）。

### 1c. L4 快检（B 时刻，两台都要测）

```bash
# KR-VPS
ssh -p <SSH_PORT> -i ~/.ssh/id_ed25519 root@<KR_VPS_IP> \
  "systemctl is-active sing-box && \
   curl -o /dev/null -s -w 'KR api2 %{time_total}s code=%{http_code}\n' \
   --connect-timeout 10 https://api2.cursor.sh && \
   curl -o /dev/null -s -w 'KR marketplace %{time_total}s code=%{http_code}\n' \
   --connect-timeout 10 https://marketplace.cursorapi.com"

# JP-VPS（同上，换 IP）
```

### L4 判定

| 结果 | 含义 |
|------|------|
| 两台均 `active` + api2 `200` + <3s | **L4 健康**；6 节点 L4 出口等价，断连原因不在 VPS 进程 |
| 仅 KR 失败/慢 | KR VPS 出口或 KR 机房线路（L4 KR） |
| 仅 JP 失败/慢 | JP VPS 出口或 JP 机房线路（L4 JP） |
| 两台均失败 | sing-box 全局 / VPS 上游 / Cursor 端点（罕见） |

**基线参考（2026-07-17 SSH 实测，需定期复测）：**

| VPS | api2 curl | marketplace |
|-----|-----------|-------------|
| KR | ~595–621ms | ~249ms |
| JP | ~499–547ms | ~197ms |

JP 比 KR 到 api2 快 ~80–100ms 是 **地理/路由差异**，与 Reality/HY2/TUIC 无关。

### 1d. 入站协议健康（L4 内唯一「6 协议」维度）

L4 curl 看不出协议差异；查 **sing-box 入站日志**（SSH）：

```bash
ssh -p <SSH_PORT> -i ~/.ssh/id_ed25519 root@<KR_VPS_IP> \
  "tail -500 /var/log/sing-box/sing-box.log \
   | grep -oE 'inbound/[a-z0-9_-]+' | sort | uniq -c; \
   tail -500 /var/log/sing-box/sing-box.log \
   | grep -iE 'error|warn|fail' | grep -v 'invalid connection' | tail -10; \
   journalctl -u sing-box --since '24 hours ago' --no-pager \
   | grep -ciE 'started|stopped'"
```

| log 关键词 | 含义 |
|------------|------|
| `inbound/vless` | Reality 入站流量 |
| `inbound/hysteria2` | HY2 入站 |
| `inbound/tuic` | TUIC 入站 |
| `authentication failed` / 大量 EOF | 入站协议问题或 sing-box 被 restart（见 [VPS-INFRA.md](./VPS-INFRA.md)） |
| **`mux connection closed`** / `read frame header: EOF` @ vless-reality-in | **vision + client multiplex 不兼容**（Mac 常表现为 turnEnded 后 BAD_DECRYPT） |
| **`REALITY: processed invalid connection`** | 扫描/误连，通常非 Agent 断连根因 |
| `journalctl` restart 次数突增 | 人为/异常 restart → 全协议断连 |

**规律：** sing-box 单进程 restart 会同时打断 Reality/HY2/TUIC 三路入站；HY2 单独 error 而 L4 curl 正常 → 入站 QUIC 层问题，不是 VPS 出口。**Reality mux EOF + Mac BAD_DECRYPT** → L3 client 出站 multiplex 问题，**修 Mac profile，不必改 VPS 入站**（sing-box #2415）。

---

## Vision+Mux BAD_DECRYPT（Reality 专用 — 2026-07-18 闭环）

**典型 RID 特征：** `lastSseCase=turnEnded` → 数秒内 `connectCode=13` · `OPENSSL_internal:BAD_DECRYPT` · `streamPrimarySub=tls-bad-decrypt` · active=**KR/JP-VPS-Reality**。

| 时刻 | 信号 | 证据路径 |
|------|------|----------|
| A−60~120s | KR/JP sing-box `mux connection closed: read frame header: EOF` | `vps-*-singbox-A-window.log` → `---mux-sample---` |
| A | Mac turnEnded 成功（SSE N 很大） | renderer `lastSseCase=turnEnded` |
| A+0~5s | Connect BAD_DECRYPT attempt=0 | renderer `agent-error` |
| A±1min | ledger 短探针仍 OK（split-brain） | `sparkle-A-window-api2-probe-ledger.jsonl` |

**根因机制：** sing-box [#1535](https://github.com/SagerNet/sing-box/issues/1535) — `xtls-rprx-vision` 与 multiplex/Mux.Cool **不兼容** → 长 marathon 后内层 TLS 解密失败。**客户端**必须 strip multiplex（[#2415](https://github.com/SagerNet/sing-box/issues/2415)：VPS 入站关 multiplex **无效**）。

**PRODUCT FIX：** Sparkle **≥1.26.44** `vlessVisionMuxGuardCore` — profile 生成时 vision 节点 strip `multiplex` + `smux: false`（见 [BUGFIX_LOG BUG-2026-07-18-003](./BUGFIX_LOG.md)）。

**定责注意：**

- **NOT** Cursor 服务端随机关流（turnEnded 已成功）
- **NOT** L4 VPS 宕机（V5.2 OK）
- **NOT** 单纯延迟高（V5.6 + ledger OK @ A）
- IFM `reasonSub=blob-not-found` 常为 **断后次生标签**，以 `streamPrimarySub=tls-bad-decrypt` + V5.4 mux 为准

### L4 与 Mac 路径报告的对照

`reports/cursor-node-quality-report.md` 排名靠后的 **JP-Reality / KR-Reality**（success 低、slow>500 高）反映的是 **Mac→协议→VPS 全路径**，在 L4 curl 正常时 **不能解读为 VPS 出口差**。

---

## Step 1：VPS 状态检查（可用 B 时刻补查）

> 详细 L4 命令与架构见上一节 **「VPS 层（L4）排查」**。本节为 Step 流程索引。

### 1a. 服务是否存活

```bash
ssh -p <SSH_PORT> -i ~/.ssh/id_ed25519 root@<JP_VPS_IP> \
  "systemctl is-active sing-box && uptime && tail -10 /var/log/sing-box/sing-box.log"

ssh -p <SSH_PORT> -i ~/.ssh/id_ed25519 root@<KR_VPS_IP> \
  "systemctl is-active sing-box && uptime && tail -10 /var/log/sing-box/sing-box.log"
```

### 1b. VPS 到 api2（L4 — KR 与 JP 都要测）

见 **1c. L4 快检**。`>3s` 或 `status≠200` → L4 有问题。`active + 200` **不能排除 L3 QUIC 瞬断** → 继续 Step 2。

---

## Step 2：读断连类型（IFM / Usage Watch）

**前置**：IFM billing-guard patch 或 Usage Watch Dashboard。

| 类型 | 操作 |
|------|------|
| **`max-steps-cap`** | ✅ 唯一可停止排查的服务端硬限 |
| **`客户端 · resumeAction` / resumeAction HTTP** | ⚠️ **恢复动作，非根因** → §2 renderer + **§V5 VPS @ A** |
| **`post-lifecycle-stall`**（仅 watchdog，无 agent-error） | ℹ️ 非断流；继续等 turnEnded |
| **`marathon-stream-closed`** / `WritableIterable is closed` | ⚠️ 常误标；<20min / 多路并行 / HY2·TUIC → **Step 3 + §V5** |
| **`mid-stream-eof`** / **`proxy-network`** / 其他 | → **Step 3 + §V5** |

```bash
# A 时刻 ±5min：查 agent-transport-failures 是否带 proxyNode
rg "WritableIterable|marathon-stream-closed" ~/.sparkle/agent-transport-failures.jsonl
# 按 Request ID 或 ts 过滤到 A 窗口
```

`proxyNode: *-HY2` → 传输层，非 Cursor 服务端硬限。

---

## Step 3：Sparkle app-log（A ±60s，查 L0 / L1）

```bash
rg "L0|L1|transport_partition_stale|\[CursorTransportHealth\]" "$APP_LOG"
# 人工或用 ts 过滤到 A 窗口
```

| 结果 | 含义 |
|------|------|
| `action=L0` / `L0 closed` 时间匹配 A | Sparkle 杀 hung 连接 |
| `L1` / `transport_partition_stale` 时间匹配 A | split-brain 清池 |
| 无 L0/L1，probe 全绿 | **QUIC 静默断流** → Step 4/5 |

---

## Step 3b：api2-probe-ledger（A ±60s）

```bash
# 勿只用 tail -30；必须按 A 时刻 ts 过滤（见上文 rg 示例）
```

| 字段 | 含义 |
|------|------|
| `probe_via` | `mihomo_node:KR-VPS-HY2` 等 |
| `probe_attribution` | `transport_partition_stale` = api2 败 + marketplace 成 |
| `ok` / `latency_ms` | 短探针（≠ 长流健康） |
| `recovery_action` | L0–L3 / none |

---

## Step 4：core-log（A ±60s）

```bash
rg "level=(warn|error)" "$CORE_LOG" | rg -v "staff.xdf.cn"
rg "api2\.cursor\.sh|api2direct" "$CORE_LOG"
```

无 error **仍不能排除 L3 QUIC 瞬断**。

---

## Step 5：jsonl 事件（A ±60s）

```bash
# 按 ts 过滤，勿 pipe 整文件给 json.tool
rg "\"ts\":\"<A时刻UTC前缀>" ~/.sparkle/network-stability-events.jsonl \
  | while read -r line; do echo "$line" | python3 -m json.tool; done
```

---

## 综合判定表

| A 时刻现象 | 结论 | 置信度 |
|------------|------|--------|
| **`max-steps-cap`** | Cursor 硬限，停止排查 | **definitive** |
| 多 Agent 同时断 | 代理/VPS/QUIC 批量故障 | **partial→definitive**（需排除 max-steps） |
| `marathon-stream-closed` + HY2 + 3 路并行 | 传输层（IFM 误标）；查 L3 QUIC + 降并行 | **partial**（需 ledger/agent-transport 佐证） |
| ledger `transport_partition_stale` @ A | split-brain（L2/L3 分区） | **definitive** @ A |
| L0/L1 @ A | Sparkle 恢复杀连接（后果，不一定是根因） | **definitive** @ A |
| probe 全绿 + 无 L0/L1 + HY2 @ A | **QUIC 静默断流**（L3） | **partial**（无法指到具体 hop） |
| VPS curl 失败 @ B | L4 问题 | **partial**（B≠A，需 ledger 交叉） |
| 6 节点 A 时刻全绿 + 三点定责全通 @ B | 路径瞬时健康，断连为 **历史瞬断** | **inconclusive** 根因 |

---

## mihomo / Sparkle 定责能力边界（必读）

**结论：没有任何单一信号能 100% 精准定位到「哪一跳」；只能给分层结论 + 置信度。**

mihomo provider health-check 与 UI ms 测的是 **Mac→TUN→某入站协议→VPS→api2 的短 HTTP 握手**，不是 Agent Connect/gRPC 长流，也 **不能** 单独拆开 L1/L2/L3/L4。

| 信号 | 能定责到 | 不能定责到 | 代码/配置依据 |
|------|----------|------------|---------------|
| **6 节点 UI ms / history** | L3 协议差异（Reality vs HY2）；KR vs JP 路径相对优劣 | L1 公司网；L4 sing-box 内部；QUIC 长流中途断 | `providerHealthCheckCore.ts`；`override/c7sgvps01.yaml` |
| **SSH curl api2（KR/JP）** | L4 VPS 出口；KR vs JP 地理差异 | 6 种入站协议；Mac→VPS 隧道 | 本节 L4 专章 |
| **三点定责（Reality only）** | 公司网→VPS；KR/JP 单路径劣化；split-brain 对照 | HY2/TUIC；VPS 进程内部；A 时刻历史 | `networkTriangulationDiagnosticCore.ts` |
| **api2-probe-ledger** | 当时 active 节点；`transport_partition_stale` | 长流是否仍存活 | `cursorTransportHealthCore.ts` |
| **CTHC L0 hung scan** | A 时刻 **零吞吐 hung 连接**；events 中 `hung_connection_count` | hung 的根因是哪一层 | `decideRecoveryAction`：hung>0 → L0（短 probe 仍 healthy 时也清理） |
| **agent-transport-failures** | 当时 `proxyNode`（若写入） | Cursor 服务端 vs 中间层谁先发 FIN | `~/.sparkle/agent-transport-failures.jsonl` |
| **IFM `marathon-stream-closed`** | 几乎 **不能** 单独定责 | — | patch-119 按 errMsg 分类，常误标 cursor-server |

### 置信度等级（与 Sparkle 三点定责对齐）

| 等级 | 含义 | 典型场景 |
|------|------|----------|
| **definitive** | 多信号一致，可行动 | `max-steps-cap`；ledger `transport_partition_stale` @ A；三点定责 KR 败 JP 成 |
| **partial** | 方向对，缺一跳证据 | probe 全绿 + HY2 + 多路并行断；6 节点 pattern 指向 L3 Reality |
| **inconclusive** | 证据不足或已恢复 | A 时刻无 ledger 行；B 时刻全绿无法反推 A；QUIC 瞬断无日志 |

### 组合定责流程（推荐顺序）

```
1. A 时刻对齐（IFM Request ID / 运行时长 / 并行数）
2. IFM 类型 → 仅 max-steps 可停；marathon 继续
3. agent-transport-failures @ A → proxyNode 是否 *-HY2/*-TUIC
4. ledger + events @ A ±60s → split-brain / recovery_action
5. app-log @ A ±60s → L0/L1 是否为后果
6. mihomo 6 节点 history @ A ±5min → L3 协议 / KR-JP pattern
7. （可选 B）Sparkle 高级设置 →「Cursor 网络三点定责」→ Reality 三点
8. （可选 B）VPS SSH L4 curl + sing-box log
9. （可选）Mac L1 直连（见下）→ 排除公司网
10. 输出：层级结论 + 置信度；QUIC 长流瞬断承认 inconclusive/partial
```

### Mac L1 直连（排除公司网 → 美国）

**不经 Sparkle TUN**，测 L1 基线（与 UI 6 节点 ms 不可直接对比）：

```bash
curl -o /dev/null -s -w 'L1 api2 %{time_total}s code=%{http_code}\n' \
  --connect-timeout 10 https://api2.cursor.sh
curl -o /dev/null -s -w 'L1 marketplace %{time_total}s code=%{http_code}\n' \
  --connect-timeout 10 https://marketplace.cursorapi.com
```

L1 失败而三点定责（经 TUN）成功 → L2 Sparkle/TUN 问题；L1 与经 VPS 路径均慢 → 公司网或全局。

### Sparkle「Cursor 网络定责探测」（v2：含 active 节点）

路径：**Sparkle 设置 → 高级 →「Cursor 网络定责探测」→ 运行定责探测**。

| 探测点 | 节点 | 目标 |
|--------|------|------|
| KR | `KR-VPS-Reality` | `https://api2.cursor.sh` |
| JP | `JP-VPS-Reality` | `https://api2.cursor.sh` |
| **active** | 当前 Cursor 专用组选中节点（如 `KR-VPS-HY2`） | `https://api2.cursor.sh` |
| 对照 | Reality 经 TUN | `https://marketplace.cursorapi.com` |

**定责增强：** Reality 三点全通但 **active FAIL** → `active_path_degraded`（L3 协议隧道，非「路径健康」误判）。

**限制：** 不含 VPS SSH（L4 见 ledger `scope=vps` @ A±5min）；测的是 **当前瞬间（B）**。

### IFM / Usage Watch 交叉验证

- `marathon-stream-closed` 文案默认写「Cursor 服务端关闭」——**与 agent-transport-failures 的 proxyNode 冲突时，以 proxyNode + ledger 为准**。
- Usage Watch Dashboard 可对 ghost/silent gap 做二次归因（v0.13.74+ 要求 SSE 静默足够久才报断连）；排查时对照 **Request ID** 与 A 时刻 ledger，避免把仍在输出的长任务误当断连。

### 信号 × 层级矩阵（快速查表）

|  | L1 公司网 | L2 TUN | L3 隧道协议 | L4 VPS 出口 | Cursor 服务端 |
|--|-----------|--------|-------------|-------------|---------------|
| L1 直连 curl 败 | ✅ | — | — | — | 可能 |
| 三点：mp 成、KR/JP 败 | ✅ | 可能 | 可能 | 否（大概率） | 否 |
| 6 节点仅 Reality 高 | 可能 | 可能 | ✅ | 否 | 否 |
| SSH curl 败 | — | — | — | ✅ | 否 |
| ledger partition_stale @ A | — | ✅ | ✅ | 可能 | 否 |
| max-steps-cap | — | — | — | — | ✅ |
| probe 全绿 + HY2 长流断 @ A | — | 可能 | ✅ QUIC | 否 | **否**（IFM 误标） |

---

## 日志源清单

| 层 | 路径 | 时刻要求 | 关键字 |
|----|------|----------|--------|
| IFM | IDE 弹窗 / Usage Watch | **A** | 断连层级、Request ID、并行数、时间戳 |
| app-log | `~/Library/.../sparkle/logs/app-*.log` | **A ±60s** | L0、L1、CTHC |
| core-log | `~/Library/.../sparkle/logs/core-*.log` | **A ±60s** | api2、warn/error |
| ledger | `~/.sparkle/api2-probe-ledger.jsonl` | **A ±60s** | probe_via、probe_attribution |
| events | `~/.sparkle/network-stability-events.jsonl` | **A ±60s** | transport_recovery、`vps_node_snapshots`（**单点快照，≠ UI 测速记录**） |
| ledger scope=vps | `~/.sparkle/api2-probe-ledger.jsonl` | **A ±5min** | `method=ssh_curl`、`probe_via=ssh:kr-vps` |
| agent RST | `~/.sparkle/agent-transport-failures.jsonl` | **A ±5min** | proxyNode、WritableIterable |
| **mihomo UI 测速记录** | `/providers/proxies` → leaf `history[-8]`（unix socket） | **A ±5min** | delay、time；**用户报 ms/超时必查此源** |
| VPS L4 | ledger `scope=vps`（自动 300s）或 SSH 手工补查 | **A±5min / B** | `method=ssh_curl`、http_code |
| VPS 入站 | SSH：`sing-box.log` inbound/error | **B 或 A 若保留 log** | inbound/vless、authentication failed |
| 定责探测 v2 | Sparkle 高级设置 / app-log `[Triangulation` | **B 瞬间** | layer、active、confidence |
| L1 直连 | Mac `curl api2`（不经 TUN） | **B** | time_total、http_code |

---

## 已知限制（含「无法 100% 精准」场景）

| 限制 | 原因 | 排查策略 |
|------|------|----------|
| **无法 100% 指到单一 hop** | 探针均为短 HTTP；长流无逐跳 trace | 输出 **层级 + 置信度**，不伪造精确根因 |
| QUIC 中途断连无日志 | mihomo 只记建连 | 标 **partial**：L3 QUIC + 降并行/换协议 |
| HTTP probe 全绿但长流断 | split-brain / QUIC 瞬断 | ledger @ A + 6 节点 pattern |
| IFM `marathon-stream-closed` 误标 | patch-119；**patch-362** 已修正 HY2/并行 | 仍交叉 agent-transport-failures |
| B 时刻 VPS/UI 正常不能否定 A 断连 | 瞬断可能已恢复 | 查 ledger **scope=vps @ A±5min** |
| 定责探测 Reality 对照 | active 节点单独探测 | events **`vps_node_snapshots` @ A**（单点，非 history 分布） |
| **用 snapshots 答 UI 测速** | 只采 latest-success 单点 / 30s 采样 | **必须** curl provider `history[-8]` 与用户 UI 对齐 |
| CTHC hung scan 无 probe 延迟 | hung 周期不关 probe | 勿误读 probe_latency_ms=0 |
| Cursor 服务端日志不可获取 | Cursor 不提供 | 仅 max-steps 可定 Cursor 服务端 |
| Sparkle &lt; 1.26.18 CTHC 难追溯 | 见 BUGFIX_LOG BUG-2026-07-09-004 | 升级后复现再查 |
| ledger 无 A 窗口行 | 未命中 60s probe 或旧版 | 靠 events + app-log + mihomo history |

### 案例：`910c65b2…`（46min Marathon，2 路并行，HY2）

| 证据 @ A | 读法 |
|----------|------|
| ledger 全程 `KR-VPS-HY2` healthy | split-brain |
| events：`hung_connection_count` **12–17** 持续 30min+ | Marathon Connect 零吞吐连接池污染 |
| 修复前 `recovery_action=none` | CTHC 曾误判 healthy 跳过 L0（已修） |
| **结论** | **L3 HY2 长流 + hung 池**；deploy patch-362 修正 IFM 标签 |

---

### 案例：`5f2ad1e4…`（marathon-stream-closed，11min，3 路并行）

| 证据 @ A | 读法 |
|----------|------|
| IFM 标 cursor-server | **不可信**（误标） |
| ledger：KR-VPS-HY2，`ok=true`，`recovery_action=none` | 短探针当时正常 |
| events：无 L0/L1 | Sparkle 未触发恢复 |
| 多 Agent 同时断 | **批量传输层** |
| **结论** | **partial→L3**：KR-VPS-HY2 QUIC 长流 + 并行压力；非 Cursor 服务端硬限 |
| **不能声称** | 「100% 是 VPS 第 N 跳」或「100% Cursor 关流」 |

### 案例：`810a64d5…`（resumeAction HTTP，mid-stream-eof，3 路并行，HY2）

| 证据 @ A（22:47:04 CST / 14:47:04 UTC） | 读法 |
|----------|------|
| IFM 层级 `客户端 · resumeAction` | **恢复路径**，非根因 |
| renderer `Stream ended without turnEnded` + `lastSseCase=heartbeat` | 长 HTTP/SSE 静默 EOF |
| `durationMs≈1041285`（~17min） | 非 1min L0 误杀场景 |
| `activeAgents=3` | 批量传输层模式 |
| 22:34 `post_lifecycle_stall` | **告警 only**，22:47 前流仍在输出 token/tool |
| app-log / ledger @ A | **无 L0/L1**；JP-VPS-HY2 probe ok |
| ledger `scope=vps` 失败 | **fake-ip 假阴性**（198.18.x.x）；不能定 L4 失败 |
| Guard `DECIDED_ALLOW` + intercept off | auto-retry 已放行；22:47:07 续跑成功 |
| **结论** | **partial：L3 JP-VPS-HY2 QUIC 长流静默断**；Sparkle/ max-steps 排除 |
| **缺口** | 未填 V5.2/V5.4 @ A → 不能 definitive 到 sing-box 入站 vs 纯 QUIC 瞬断 |
