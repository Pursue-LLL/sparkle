# Cursor 断连排查手册

当 Cursor Agent/Chat SSE 流中断时，按以下步骤逐层定位根因。

> **敏感信息**：VPS IP、SSH 端口、密钥等勿写入 git。Step 1 使用占位符；真实值见本地 [VPS-CONNECT.md](./VPS-CONNECT.md) 或私有运维文档。

---

## 核心原则（必读，避免误判）

### 用户目标（500 Included 套餐 — 排查与修复的北极星）

| 目标 | 含义 |
|------|------|
| **最省次数** | 每个 Included Request 物尽其用；拦截仅 ghost/自动计次；不误拦 Continue |
| **最持久** | 单次 userMessage 内 Marathon 尽量不断；客户端不主动限时/断流 |
| **一次做最多事** | 保持并行 Agent；禁止建议减并行、拆多轮、新开会话、failover 换节点 |
| **真实定责** | IFM 标签不可盲信；以 ledger/events/agent-transport-failures @ A 时刻为准 |
| **Guard ON** | 拦 100% 会计次的 auto-retry；OFF 时只通知 ghost 不计次拦截 |

修复 Sparkle/Guard 时以上目标优先于「看起来干净」的 transport 清理。

1. **除 `max-steps-cap` 等 Cursor 硬限外，Cursor 服务端不会无缘无故断开 SSE。** 报错几乎总有传输层原因。
2. **同一时刻多路 Agent 同时断连 → 几乎一定是代理 / VPS / QUIC 隧道问题**，不是「服务端随机关流」。
3. **HTTP api2 probe 全绿 ≠ Connect 长流正常。** 短探针 OK 时 gRPC 双向流仍可能已断（split-brain）；QUIC 中途断连 mihomo **无日志**。
4. **IFM 会把 `WritableIterable is closed` 标为 `marathon-stream-closed`（cursor-server）**，但 `agent-transport-failures.jsonl` 中同类错误常带 `proxyNode: *-HY2`——**标签不可盲信**（Guard patch-363/364 已修正弹窗 classify；仍交叉 ledger）。
5. **仅 `max-steps-cap` 可停止网络排查。** `marathon-stream-closed` 在 **<20min、多路并行、或 HY2/TUIC 节点** 时仍要继续 Step 3。
6. **Sparkle L0 @ 60s hung 会误杀 Agent tool 暂停中的 Connect 流**（v1.26.33）；**v1.26.34+** 改为 **12min** 阈值 + 每 host 保留最新 **6** 条（v1.26.36，并行 Agent 保护）。若 A 时刻 app-log 有 `L0 closed N hung` 且运行 <12min → 定责 **Sparkle L0 误杀/过度清理**，非 Cursor Marathon cap。

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
| VPS SSH curl / sing-box 存活 | **B 时刻可补查** | 仅证明「现在 VPS 活着」，不能反推 A 时刻状态 |

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

**hung scan 要点：** hung 判定 = api2 等关键 host 连接 **存活 ≥12min 且上下行速率均为 0**（v1.26.34+；旧版 60s 会误杀 tool/thinking 间隙 Connect 流）。hung scan 里 **`probe_latency_ms=0` 正常**（该周期不跑 HTTP probe）。L0 关闭列表会 **跳过每 (process, host) 最新 6 条** hung 连接（v1.26.36+）。**`hung_connection_count>0` 且 L0 冷却结束 → 应触发 `recovery_action=L0`**（仅清理更老的零吞吐连接）；若 hung 高但长期 `action=none`，查 app-log 是否 `L0_cooldown`。

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
| **UI mihomo ms** | Mac→隧道→VPS→api2 | L2–L4 全路径；典型 200–500ms（握手时间） |

两者测量方式不同，**不能相减算「隧道开销」**。

### 读数参考

| ms | 含义 |
|----|------|
| <500 | 正常 |
| 500–1000 | 偏慢 |
| >1000 | 异常尖峰（查 Reality 隧道或 KR 线路） |

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
| `journalctl` restart 次数突增 | 人为/异常 restart → 全协议断连 |

**规律：** sing-box 单进程 restart 会同时打断 Reality/HY2/TUIC 三路入站；HY2 单独 error 而 L4 curl 正常 → 入站 QUIC 层问题，不是 VPS 出口。

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
| **`marathon-stream-closed`** / `WritableIterable is closed` | ⚠️ 常误标；<20min / 多路并行 / HY2·TUIC → **Step 3** |
| **`mid-stream-eof`** / **`proxy-network`** / 其他 | → **Step 3** |

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
| events | `~/.sparkle/network-stability-events.jsonl` | **A ±60s** | transport_recovery、`vps_node_snapshots` |
| ledger scope=vps | `~/.sparkle/api2-probe-ledger.jsonl` | **A ±5min** | `method=ssh_curl`、`probe_via=ssh:kr-vps` |
| agent RST | `~/.sparkle/agent-transport-failures.jsonl` | **A ±5min** | proxyNode、WritableIterable |
| mihomo UI ms | provider `history[]` via API | **A ±5min** | delay、time |
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
| 定责探测 Reality 对照 | active 节点单独探测 | events **`vps_node_snapshots` @ A** |
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
