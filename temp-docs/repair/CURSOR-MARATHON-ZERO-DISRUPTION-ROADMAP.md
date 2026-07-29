# Cursor Marathon 零中断修复 Roadmap

> **最后更新**：2026-07-29 · 合并 7/29 10:35–11:16 `445ba497` 四段 server-eof 链 + P24/P25/P27 · **Sparkle 仓 Marathon/L7/P21–P27 唯一 SSOT**（open-perplexity 仅薄索引）

## 1. 文档定位

本文是 Cursor 500 Included 套餐下 **Sparkle/mihomo 数据面零中断** 的唯一实施 SSOT。

北极星只有一个：单次 `userMessage` 物尽其用。修复不得限制并行，不得拆分消息或会话，不得 failover，不得设置客户端连接寿命，不得关闭、清理或重建任何健康连接。

本文只覆盖 Sparkle 边界：

1. 消除 Sparkle 运行期数据面 mutation 对 Cursor 健康长流的主动破坏。
2. 将所有 reload/restart/close/switch/update 的执行权收口到一个不可旁路的保护内核。

Cursor-2 幽灵计次的唯一实施 SSOT 是：

`/Users/yululiu/projects/AI/open-perplexity/temp-docs/repair/CURSOR2_INTERCEPT_RETRY_LEAK_REPAIR_ROADMAP.md`

本文只记录跨仓验收依赖，不重复 Guard 实现方案。

## 2. 事故定责

### 2.1 事故

- Parent Request ID：`d52a37e3-fcfc-4b11-93bd-3793f451c4db`
- 主要故障窗口：2026-07-26 00:23–00:40 CST
- 最终错误：`Connection failed repeatedly`
- 底层错误：`ConnectError: [canceled] http/2 stream closed with error code CANCEL (0x8)`
- Cursor 分类：`countAsServerError=false, countAsTransportError=true`
- Active path：Mac → Sparkle/mihomo → JP-VPS-HY2 → Cursor

### 2.2 罪魁祸首

**层级：L2，本机 Sparkle/mihomo 运行期数据面自伤。**

罪魁祸首不是单独某一个 `PUT /configs?force=true`，而是 **活跃 Cursor 流期间执行共享数据面 mutation** 这一整类机制：

1. `MarathonDialTolerance` 在连接数跨 12 时改写 provider YAML，再调用 provider reload。
2. `MarathonQuiesce` enter/exit 改写 `health-check.enable`，再强制 config reload。
3. `restartCore()` 被 guard 阻止时，反而以 provider hot reload 作为“替代恢复”。
4. delay/nudge 的 provider leaf 恢复会在探针失败时触发 provider update。

这些 mutation 发生在共享 mihomo 数据面上；它们不是“只影响未来拨号”的纯配置动作。00:39:45 的最强时序证据是：`MarathonDialTolerance` provider reload 完成日志在第一批 Cursor H2 CANCEL 前约 12ms，而 Quiesce health-check OFF 的完成日志在 CANCEL 后约 2ms。因此本案不能继续把 health-check reload 写成唯一直接触发点；**definitive 根因是运行期共享数据面 mutation，00:39:45 的直接触发者优先指向 provider reload。**

### 2.3 代码证据

- `src/main/core/marathonQuiesce.ts:45-58`
  - Quiesce enter/exit 均调用 `syncMarathonQuiesceProviderHealthCheck()`。
- `src/main/core/marathonQuiesceProviderSync.ts:29-35`
  - 修改 runtime provider health-check 后调用 `reloadMihomoConfigFromDisk()`。
- `src/main/core/mihomoApi.ts:135-142`
  - reload 实际执行 `PUT /configs?force=true`。
- `src/main/core/marathonDialTolerance.ts:21-55`
  - 每次 5s/45s 阈值切换都改写 provider 文件，并在第 50 行调用 `reloadMihomoProfileProviders()`。
- `src/main/core/provider.ts:142-149`
  - provider reload 最终调用 `mihomoUpdateProxyProviders()`。
- `src/main/core/mihomoApi.ts:232-235`
  - provider reload 实际执行 `PUT /providers/proxies/{name}`。
- `src/main/core/manager.ts:1064-1111`
  - 连接计数失败返回 0；活跃连接存在时用 provider hot reload 代替 hard restart。
- `src/main/core/mihomoApi.ts:315-389`
  - delay/nudge 的 provider leaf 恢复在失败时调用 provider update；`marathon_rescue` 还绕过 Quiesce。
- `src/main/core/cursorConnectionHygiene.ts:53-115`
  - 默认开启的定时器会按“年龄 + 零速率”自动关闭 Cursor 连接。
- `src/main/core/cursorTransportHealth.ts:323-423`
  - L0/L1/L2/L3 执行器可关闭单条、关键 host、全部连接或重启 core。

### 2.4 时间链证据

| Cursor 错误时间（CST） | Cursor 结果 | Sparkle 同期数据面动作 |
|---|---|---|
| 23:38:05 | attempt 3，H2 CANCEL | Quiesce ON → health-check OFF → reload |
| 00:23:15 | attempt 4，H2 CANCEL | Quiesce OFF → health-check ON → reload |
| 00:24:15 | attempt 5，H2 CANCEL | Quiesce ON → health-check OFF → reload |
| 00:25:30 | attempt 6，H2 CANCEL | Quiesce OFF → health-check ON → reload |
| 00:26:45 | attempt 7，H2 CANCEL | Quiesce ON → health-check OFF → reload |
| 00:28:15 | attempt 8，H2 CANCEL | Quiesce ON → health-check OFF → reload |
| 00:38:15 | attempt 9，多路 H2 CANCEL | Quiesce OFF → health-check ON → reload |
| 00:39:45.831 | provider reload 完成 | DialTolerance 5s→45s → provider reload |
| 00:39:45.843–.848 | attempt 10，多路 H2 CANCEL | 5 路在约 5ms 内 CANCEL；其中一条达到 transport retry 10 |
| 00:39:45.845 | Quiesce health-check OFF 完成 | 晚于首批 CANCEL，属于同一 mutation 风暴但不是该批首发触发 |
| 00:40:57 | 三路同步 transport error | Quiesce OFF → health-check ON → reload |

00:38:15 至少五路在 14ms 内同步取消；00:39:45 至少五路在 5ms 内同步取消；00:40:57 三路在 3ms 内同步失败。

现场文件：

- Sparkle：`~/Library/Application Support/sparkle/logs/app-2026-7-26.log:220-235`
- Cursor：`~/Library/Application Support/Cursor-2-data/logs/20260725T193519/window3/exthost/anysphere.cursor-always-local/Cursor Structured Logs.log:5128-5266`

### 2.5 排除项

- **不是 Cursor max-steps**：无 `maximum number of steps`，错误为 H2 CANCEL。
- **不是 Cursor 单路服务端随机关流**：多路毫秒级共振，且逐次紧贴本机 shared data-plane mutation。
- **不是断网**：A 前后 api2 短探针 243–357ms。
- **不是 JP VPS restart 或出口故障**：
  - A 附近 VPS L4：api2 200/492ms，marketplace 188ms。
  - A 窗口无 sing-box restart。
  - HY2 入站持续收到 Cursor 连接，无同期 error/EOF/timeout。
- **不是 VPS 资源耗尽**：
  - JP load 0.08，available memory 743MB，磁盘 41%。
  - conntrack 139/1,048,576。
  - qdisc dropped=0。
  - UDP conntrack、sing-box UDP/idle timeout 均为 3600s，keepalive 为 30s。

## 3. 不可违反的架构不变量

以下约束必须成为代码硬门和回归测试，不得仅写在注释或文档中：

1. 保护状态不是一个不可靠的数字，而是 `ACTIVE | DRAINING | UNKNOWN | IDLE_CONFIRMED`。
2. 只有 `IDLE_CONFIRMED` 可以签发一次性 data-plane mutation capability。
3. `ACTIVE`、`DRAINING`、`UNKNOWN` 时：
   - 禁止 mihomo config reload。
   - 禁止 provider reload。
   - 禁止 core restart。
   - 禁止切节点。
   - 禁止关闭或清理 Cursor critical host 的任何连接。
4. 任何连接盘点失败都必须进入 `UNKNOWN`；严禁 `.catch(() => 0)`。
5. 短暂出现 `connectionCount=0` 只能进入 `DRAINING`，不得在重连空窗执行积压 mutation。
6. Quiesce 只允许修改 Sparkle 进程内调度状态，不允许修改 runtime YAML 或触碰数据面。
7. 观测失败只允许记录，不允许触发恢复动作、reload、failover 或连接关闭。
8. 所有 mihomo mutation 必须由一个 facade 控制；禁止 raw mutator 被业务模块或 IPC 直接导入。

## 4. 最终架构

### 4.1 数据面：零触碰

Cursor 活跃期间，现有 TCP/H2/HY2/QUIC 连接视为不可变资源。任何配置、测速、升级、provider 更新都必须延后到 `cursorActiveConnections == 0`。

健康连接的判断不依赖短探针。短探针成功或失败都没有权限修改已有连接。

### 4.2 控制面：纯内存 Quiesce

保留 Quiesce 的目的，但改变实现：

- enter/exit 只更新内存 snapshot。
- 内存 snapshot 控制 Sparkle 自己的 scheduled health-check、warmup、marketplace、benchmark 与非必要 nudge。
- 删除运行时修改 `health-check.enable` 的路径。
- 删除 Quiesce enter/exit 对 `reloadMihomoConfigFromDisk()` 的调用。
- provider 的基础策略在初始配置生成时一次性确定，不在 Marathon 中动态变更。

### 4.3 统一 Data-Plane Mutation Kernel

采用纯函数内核 + I/O adapter + mutation facade：

输入：

- mutation kind：config patch/reload、provider/rule update、core stop/restart、connection close、fake-ip flush、node/mode switch。
- caller。
- reason。
- protection snapshot：连接 inventory、活跃 stream registry、数据源新鲜度。

输出：

- `EXECUTE | DEFER | REJECT`。
- 机器可读 `reasonCode`。
- 一次性 branded capability 或 coalesced pending intent。

默认规则：

- 只有 `IDLE_CONFIRMED`：允许签发 capability。
- 其余三态：自动动作 `DEFER`；显式会破坏健康流的 UI 动作 `REJECT` 并说明原因。
- pending intent 按资源键只保留最新意图；重新执行前必须再次取保护快照。
- 不提供普通 UI 绕过。

raw `PUT/PATCH/DELETE` 只能存在于 facade 内部。CI 静态门禁扫描 endpoint 与 raw mutator import，发现旁路直接失败。

### 4.4 观测拨号调度

Cursor 活跃时按优先级调度：

1. Cursor 生产长流：最高优先级，完全不触碰。
2. 只读现有连接状态：允许，无网络拨号。
3. 必要的独立短探针：仅在不会触碰数据面的实现下允许；失败只记录。
4. 商用 provider health-check、benchmark、warmup、marketplace：内存态 defer。

已观察到的 `session_transport_nudge_failed ... Resource not found` 必须消除：

- provider/leaf 不存在时不发起拨号。
- 记录 `outcome=skipped_provider_unavailable`。
- 不 provider update、不 retry、不 reload、不恢复。
- 修复后 nudge 必须证明不会重建 provider 或共享 transport。

### 4.5 必须删除或纯净拆分的旧链

| 旧链 | 裁决 | 理由 |
|---|---|---|
| `marathonQuiesceProviderSync.ts` | 删除 | Quiesce 必须是纯内存态 |
| `marathonDialTolerance.ts` runtime sync | 删除 | 将 45s 安全值前移到初始 provider 生成；禁止阈值热切 |
| `tryHotReloadProvidersInsteadOfHardRestart()` | 删除 | 被阻止的 restart 不能偷换成 provider reload |
| 自动 `CursorConnectionHygiene` timer/selector/setting | 删除 | 年龄 + 零速率不能证明 SSE 已死 |
| TransportHealth L0/L1 selector/executor | 删除 | 当前决策不可达，且具误杀关键流风险 |
| TransportHealth L2/L3 | 保留并接 kernel | 仅 `IDLE_CONFIRMED` 时有空闲恢复价值 |
| `cursorConnectionHygiene` 的只读 list/count | 移入 `cursorConnectionInventory` | 盘点与清理职责彻底分离 |
| rescue delay 的 provider refresh | 删除 | 观测拨号不得重建 provider |

### 4.6 跨仓 Guard 依赖

Sparkle 修复负责“尽量不制造断流”；Guard 修复负责“断流已发生时不让自动 HTTP 偷计次”。两者必须在同一事故 fixture 上联合验收，但实现与文档不得互相复制。Guard 的授权票、开关 ACK、部署 A/B 隔离见 Cursor-2 SSOT。

## 5. 实施顺序

### Phase 0 — 保护现场

- 读取所有待改文件最新内容。
- 审核当前 dirty worktree，确认不覆盖其他人的改动。
- 为本次修改建立精确文件清单。
- 禁止 reset、stash、checkout、revert。

### Phase 1 — 移除 Quiesce reload

- 从 `marathonQuiesce` transition 移除 provider health-check sync。
- 删除或降级 `marathonQuiesceProviderSync`，确保生产代码无调用。
- Quiesce enter/exit 日志明确写 `data_plane_action=none`。
- 保留内存态 defer 语义。

### Phase 2 — 建立统一 Data-Plane Mutation Kernel

- 实现保护状态纯函数、inventory adapter、pending intent coalescer 与 mutation facade。
- 接入所有 config/provider/rule/restart/stop/close/flush/switch 入口。
- 删除 raw mutator 的业务导出与 IPC 直通。
- 增加 CI 静态旁路扫描。

### Phase 3 — 清理主动观测竞争

- Marathon 中 defer 商用 provider scheduled health-check、benchmark、warmup、marketplace。
- 修复 Resource not found nudge。
- 确保所有 defer 都不通过 reload 实现。

### Phase 4 — 删除危险旧链

- 删除自动 Connection Hygiene。
- 删除 TransportHealth L0/L1。
- L2/L3、socket watchdog、TUN recovery 全部接入 `IDLE_CONFIRMED` capability。
- install/upgrade shell gate 改为任意 Cursor connection 或盘点未知即阻止；删除阈值 12 和未知放行。

### Phase 5 — 遥测补全

每个 incident bundle 必须包含：

- Quiesce transition 与 `data_plane_action`。
- 所有 reload/restart/close/switch 请求及 gate 决策。
- protection state、Cursor connection count、active stream count、snapshot age。
- mutation requested/begin/commit/defer/reject，包含 `mutationId`、caller、kind。
- retry HTTP count。
- VPS CPU、memory、conntrack delta。
- interface drop/requeue delta。
- sing-box restart、HY2/QUIC error。
- api2/api2geo/connect-path RTT。

VPS 指标必须记录 delta/速率，禁止用累计值直接定责。

### Phase 6 — 部署

- 完成静态检查、单测、集成测试与压力测试后才打包。
- 只使用项目规定的 pkg 安装流程。
- 安装前 gate 必须达到 `IDLE_CONFIRMED`；盘点失败不安装。
- 禁止通过 `cp -R`、`ditto` 或直接运行 dist app 覆盖生产。

## 6. 必须通过的测试

### 6.1 单元测试

1. Quiesce `11 → 12 → 11 → 12`：
   - transition 正确。
   - reload/provider reload/core restart/connection close 调用均为 0。
2. Mutation Kernel：
   - `ACTIVE/DRAINING/UNKNOWN` 时所有 mutation 均不得执行。
   - 只有 `IDLE_CONFIRMED` 签发 capability。
   - 短暂 `1→0→1` 时 pending mutation 执行次数为 0。
   - reasonCode、caller、reason 审计完整。
3. 旧链删除：
   - 自动 hygiene/L0/L1 production symbol 为 0。
   - `countCursorConnections` 失败结果为 `UNKNOWN`，不得为 0。
   - blocked restart 的 provider update 次数为 0。

### 6.2 集成测试

1. 建立至少 20 条长寿命 H2 流。
2. 连接数跨 12 阈值 100 次。
3. 运行 Quiesce、probe、warmup、benchmark 调度。
4. 验收：
   - H2 流断开数 0。
   - mihomo config reload 0。
   - provider reload 0。
   - core restart 0。
   - critical connection close 0。

### 6.3 跨仓计次测试

使用 Cursor-2 SSOT 的 one-shot UserActionTicket fixture 模拟 transport error：

- Guard ON：
  - retry planned 可观测。
  - 无用户票的任意 action/RID HTTP=0。
  - ghost Included=0。
- Guard OFF：
  - 不阻断。
  - retry HTTP 与通知一一对应。
  - billing audit 可按 originalRequestId 聚合。

### 6.4 性能测试

测试前后使用同一网络、同一目标、同一协议、同一采样周期：

- 长流吞吐与 token gap。
- p50/p95/p99 RTT。
- event-loop delay。
- CPU、内存。
- TUN/interface drop 与 requeue delta。

不得把 ping、VPS curl、Mac 隧道首包延迟混为同一指标。只有实测数据才能宣称性能提升。

## 7. 潜在风险与根治措施

| 风险 | 后果 | 根治措施 |
|---|---|---|
| 只删除 Quiesce reload，但其他模块仍 reload | 同类事故复发 | 所有破坏性入口统一接 Disruption Gate |
| provider 定时测速仍在 Marathon 中运行 | 与生产流争抢 event loop/带宽 | 内存调度层 defer，不改 YAML |
| gate 读取 stale connection count | 活跃流被误判为 0 | 四态保护状态；未知和 draining 都保护 |
| reload 队列在 Marathon 结束后集中执行 | 短时间 reload 风暴 | 合并为单个最新意图，执行前再次 gate |
| 观测本身制造网络压力 | 增加 RTT/token gap | 只读优先；拨号去重、合并、零重试 |
| 用累计 requeue 误判 bufferbloat | 错误修改 VPS qdisc | 先采集 delta、队列时延与丢包，再基准验证 |
| KR SSH 不可用导致证据缺口 | 事故后无法完成矩阵 | 带外 SSH 可用性监控与失败原因记录 |

## 8. 完成定义

只有同时满足以下条件才可关闭 Roadmap：

- Quiesce 阈值翻转不再触发任何数据面动作。
- 所有 mutation 入口受统一 kernel + capability 保护，CI 证明无旁路。
- `ACTIVE/DRAINING/UNKNOWN` 下 mutation commit 为 0。
- 自动 Hygiene、L0、L1、动态 DialTolerance、Quiesce provider sync 已从生产代码删除。
- 20+ 并行长流跨阈值压力测试零断流。
- Cursor-2 SSOT 的 Guard 联合矩阵通过。
- VPS 与 Sparkle incident bundle 能在 A 时刻完成证据矩阵。
- 无新增 lint error/warning。
- 安装包通过规定流程部署并完成生产态只读验收。

## 9. 明确不做

- 不减少并行 Agent。
- 不拆分 userMessage。
- 不建议新开会话。
- 不 failover 或切节点。
- 不设置客户端总时长或静默时长上限。
- 不关闭、清理或重建健康连接。
- 不以短探针失败为由触发恢复。
- 不在缺少同口径基准时修改 VPS 内核、qdisc 或协议参数。

---

## 10. 2026-07-28 事故定责补充（Request `c69260ad`）

本节合并自 triage SOP 完整执行结果（A=14:47:57 CST / 06:47:57 UTC），与 §2 的 d52a37e3 案 **并存、不覆盖**。

### 10.1 事故 B — 14:47 silent_generation_end（`c69260ad`）

| 项 | 值 |
|---|---|
| Parent RID | `c69260ad-6431-41b1-8c71-efdc3b81d5d8` |
| txReqId | `8520f8a9-ff73-4a17-9a19-b97e372f22b9` |
| composer | `e6829e24-0699-417d-b6f2-1b9d10c0f8f0` |
| segment | resumeAction **segment:14** · 13:18:36 → 14:47:57 · **durationMs=5361084（89.35min）** |
| 并行 | ≥4 agent；**仅本 composer 结束**，其余续流 |

**【断连罪魁祸首】PRIMARY L7**：Cursor 服务端在 **resumeAction 段**运行至 **~89–91min**（本日两样本）后发 `generation-ended` 关 SSE，不发 `turnEnded`。**机制**：长段 `silent_generation_end` + segment-age 与 `durationMs` 精确对齐；**非固定 5400s 已证伪**（历史 df1501ed 107min 同形态但 Sparkle 定责 L3 split-brain）。

**证据（definitive）**：

- `renderer.log:3774` `ComposerWakelockManager Released … reason="generation-ended"`
- `renderer.log:3778` `terminalKind=silent_generation_end` · `gapSinceActivityMs=3799` · `pendingTool=0`
- `renderer.2.log:5475` segment:14 `http_segment_started` @ 13:18:36 — 与 durationMs **精确对齐**
- **零** agent-error / ECONNRESET / max-steps-cap @ A±60s
- V5.4 jp-vps sing-box @ A±2min：**2526 行、0 error**
- `app-log:3387-3388` LatencyTruth mac_p50=271 vps_p50=521 delta=-250 — **网络健康**

**AMPLIFIER L2 — BUG-021**：`Cursor/logs/.DS_Store` 被 `listCursorLogSessionDirs` 误当 session → ENOTDIR → **MTDO / hung_scan / P14 / jsonl 写入全灭**（`app-log:3380-3393`）。

**NOT**：代理批量故障、VPS sing-box 故障、Sparkle core restart @ A、客户端主动超时、max-steps-cap。

### 10.1b 事故 B′ — 14:49 silent_generation_end（`cc6c19f8` · 同批次佐证）

| 项 | 值 |
|---|---|
| Parent RID | `cc6c19f8-f8ec-4030-95a2-094438b7956f` |
| txReqId | `85094a60-c26b-4225-a974-6ce9f26e0267` |
| composer | `23ef7055-b4de-4bc6-a8d7-8cde5be1e862` |
| segment | resumeAction **segment:12** · 13:18:14 → 14:49:27 · **durationMs=5473443（91.2min）** |
| A 时刻 | 14:49:27.632（比 c69260ad 晚 **90s**） |

**定责**：与 §10.1 **同机制 PRIMARY L7 长段 generation-ended** — 非代理批量断连。

**佐证**：

- `renderer.2.log:5421` segment:12 `http_segment_started` @ 13:18:14 — durationMs **精确对齐**
- `renderer.log:4166` 同 silent_generation_end 形态 · gapSinceActivityMs=1852
- jp-vps V5.4 @ 06:48–06:49 UTC：**2475 行、0 error**
- 段启动差 ~22s → 断连差 ~90s — **符合 per-segment 计时器，非同一时刻网络波动**

**AMPLIFIER**：同上 BUG-021 ENOTDIR @ 06:49（`app-log:3394-3398`）。

### 10.1c 事故 B″ — 14:49 silent_generation_end（`11b777ba` · Cursor-2 · 同批次第三路）

| 项 | 值 |
|---|---|
| Parent RID | `11b777ba-30cf-4f43-9d0a-ccb251c2a025` |
| composer | `88648e97-a6e7-48f0-b85b-4400140fcfbd` |
| App | **Cursor-2** · composer-2.5-fast |
| A 时刻 | **14:49:58 CST**（`06:49:58 UTC`） |
| segment | `rpc.run error=true` · **durationMs=5781613（96.36min）** |
| 段起点（反推） | **13:13:36 CST** — 与 Usage 表「7月28日 **13:13**」**精确对齐**（表内为段起点/计费锚点，**非**断连时刻） |

**定责**：与 §10.1/§10.1b **同机制 PRIMARY L7 长段 generation-ended** — 非代理批量断连。

**证据（definitive）**：

- `cursor.requestTraces.log:9674` `span_completed name="rpc.run" … error=true durationMs=5781613`
- `@ A±60s` Sparkle：`ENOTDIR .DS_Store` · hung_scan/MTDO 失败（BUG-021）— **无** mass transport / core restart
- **零** max-steps-cap · 非多路同秒 ECONNRESET @ A

**同 RID 更早一次断连（勿与本案 FINAL 混淆）**：

- `11:31:08` · `durationMs=2046999`（~34min，自 10:57 userMessage）· ConnectError `[aborted]` — 对齐 **§10.2 10:52 force install** 余波 · resume 后续跑至 14:49

**AMPLIFIER**：BUG-021 @ 06:49 · Guard `billing_guard_leak`（resumeAction 拦截泄漏，计次侧问题，**非**断连根因）

### 10.2 事故 A — 10:52 ECONNRESET（同会话 Earlier）

| 项 | 值 |
|---|---|
| 机制 | Sparkle **1.26.84 force install** → `core_cold_restart` → mihomo/TUN reset |
| 特征 | 多路并行 **同时** transport-error |
| 定责 | **PRIMARY L2** 数据面重启（≠ 14:47 案） |

**教训**：马拉松 active 时 `SPARKLE_FORCE_INSTALL_DURING_MARATHON=1` 必须 hard-block（接 §14 P23）。

### 10.3 多案关系（禁止混淆 · 2026-07-28 同日三族）

| | 10:52 A 案 | 14:47–14:50 B 案 | 15:41 C 案 | **7/29 10:35 D 案** |
|---|---|---|---|---|
| RID | （多路） | c69260ad / cc6c19f8 / 11b777ba | **c8346504 / 6c2791ff**（同簇） | **5f6f5e93 / 445ba497** |
| 层 | L2 Sparkle restart | **L7** 长段 generation-ended | **L3** mass PING timeout | **L3** HY2 SSE silent EOF |
| App | Cursor-2 | Cursor-3 + Cursor-2 | Cursor-3 | **Cursor-3.1.15** |
| 并行形态 | 多路同断 | 单路断、其余续流 | **多路同秒** PING code=14 | **双路 31ms 齐断** |
| 错误形态 | ECONNRESET / aborted | silent_generation_end · generation-ended | ConnectError `[unavailable] PING timed out` | **server-eof mid-tool** |
| 修复方向 | P10/P23 禁 force install | **P22 段轮换** + P21 | **§29 P19 rescue** · VPS QUIC（**非 P22**） | **P24 Pulse Contract + P25 观测** |
| 定责 SSOT | 本文 §10.2 | 本文 §10.1–§10.1c | **Split-Brain SSOT §29.10** | **本文 §10.5** |

**铁律**：B 案（L7）与 C 案（L3）与 D 案（L3 silent EOF）**禁止互用修复方案** — P22 不能治 PING timeout 或 40min server-eof；§29 rescue 不能阻止 L7 90min 关流；P22 不能治 D 案（未到 L7 cap）。

### 10.4 C 案交叉索引（15:41 mass PING 簇 · L3 · 正文在 Split-Brain）

| 项 | 值 |
|---|---|
| Parent RID（簇） | `c8346504-…` @15:41:11 · `6c2791ff-…` @15:41:22 |
| 定责 | **PRIMARY L3** — 同簇 · JP-VPS-HY2 Connect QUIC 传输分区 |
| triage bundle | `~/Desktop/cursor-triage-c8346504-20260728T160107/` · `~/Desktop/cursor-triage-6c2791ff-20260728T160748/` |

**完整证据链与修复归属** → open-perplexity `CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` **§29.10**（本文不重复）。

### 10.5 事故 D — 7/29 10:35 双路 Opus server-eof（`5f6f5e93` / `445ba497` · Cursor-3.1.15 · HY2）

| 项 | 值 |
|---|---|
| Parent RID | `5f6f5e93-8aeb-4023-b6c7-746050c822a6` · `445ba497-6c23-48e5-b47b-b88555993a4d` |
| App | **Cursor-3.1.15** · observe-only Guard · claude-4.6-opus-max |
| A 时刻 | **2026-07-29 10:35:10.780 CST**（`02:35:10 UTC`） |
| 并行 | 双 composer **31ms 内齐断** |
| segment | `phase1_stream` · `streamPrimarySub=server-eof` · `pendingTool=1` · `gapSinceActivityMs` 523/3723 |
| durationMs | 2381906 / 2273348（~40/38min，自 9:55/9:57 userMessage） |
| Active path | Mac → Sparkle/mihomo → **JP-VPS-HY2** → api2direct.cursor.sh |

**PRIMARY · L3**：HY2 QUIC 马拉松 SSE **长流静默断**（split-brain：短 api2 探针 302ms 全绿 · partition=0 · hung=0 · V5.4 sing-box @ A **0 error**）。

**AMPLIFIER · Sparkle P15（definitive）**：`marathon_connect_path_pulse` 在 **02:09:34 → 02:35:10 UTC 完全零执行**（~26min 观测失明）— 末次 pulse `app-2026-7-29.log:7498` · A 后下次 `7980` @ 02:43:22。断连前 rescue/三探针保活链未按设计每 60s 运行。

**ghost 计次（非断连根因）**：observe-only `willRetry=true` → resumeAction `436bb3ce` / `c3400bd9` 各烧 **1 Included**（`renderer.log:8492-8506`）。

**排除（@ A 证据）**：

- max-steps-cap · Sparkle L0 误杀 · connect_partition · VPS sing-box error/restart · 切 WiFi（VPS 源 IP `218.240.178.5:56103` 02:33–02:36 不变）
- **不是** periodic_session `skipped_coalesced` 直接导致（与 P15 **独立通道**；`marathonTransportDialOrchestratorCore.ts:97-111`）

**代码锚点（P15 为何失明 · 已定位 definitive · BUG-026）**：

三重 **false-negative** 叠加，导致 `marathonStreamActive=false` → pulse 不跑（`marathonTransportDialOrchestratorCore.ts:104-106`）：

| # | 缺陷 | 代码 | 7/29 实证 |
|---|---|---|---|
| 1 | **512KB tail 截断 age** | `marathonTransportDialReader.ts:16` `RENDERER_TAIL_BYTES=512_000` · registry `firstActivityMs` 仅来自 tail | renderer.1.log **5.2MB** · 512KB tail 首行 ≈ **11:01**（仅 ~6min 窗口）→ `streamAgeMs` **永远 < 30min** |
| 2 | **heartbeat 不计 activity** | `cursorStreamTokenGapCore.ts:162-163` 跳过 heartbeat | 长跑 tool 阶段仅 heartbeat → `lastGapMs` 可 **> 120s** |
| 3 | **120s activity gap 门** | `MTDO_ACTIVE_STREAM_MAX_GAP_MS=120_000` · `marathonStreamRegistryCore.ts:174-176` | tool 暂停 >2min 且无 openToolCalls 在 tail → active=false |

**辅证**：全程 `MarathonDialTolerance … active_stream=0`（`app-log:7487-8088`）与马拉松 40min 事实矛盾 → **不是 VPS 问题，是 Sparkle gate 算错**。

**02:07–02:09 pulse 簇**：当时 tokenDelta 密集 → `lastGapMs≤120s` 临时 true；进入 tool-heavy 阶段后三门齐关 → **26min pulse 空窗**。

**session_transport_nudge @40s 仍在跑**（`7862` api2=302ms）— 短 HTTP **不能**替代 SSE pulse/rescue；这是 split-brain 典型形态。

### 10.5b 事故 D′ — 7/29 10:50:52 单路 server-eof（c3400bd9 ghost resume 段）

| 项 | 值 |
|---|---|
| A 时刻 | **10:50:52.488** · `renderer.1.log:11251` |
| 断连 RID | **c3400bd9**（resumeAction segment:3 · parent 445ba497） |
| durationMs | **943564** (~15.7min，自 10:35:10 ghost resume) |
| 形态 | server-eof · gapSinceActivityMs=**25** · pendingTool=0 |
| 并行 | **仅 23ef7055 断**；e6829e24/436bb3ce **续流**（11255+）→ 排除 VPS 批量故障 |
| billing | **10:50 行 a30a7234** = 断后立即启动的 resume #2（非断连 A 本身） |

**定责**：与 §10.5 **同族 L3 + P15 放大**；单路断说明是 **per-SSE-connection** HY2 静默断，非全局代理宕机。

**累计 ghost Included（composer 23ef7055）**：10:35 c3400bd9 +1 · 10:50 a30a7234 +1（parent 445ba497 一条 userMessage 已烧 **3 次**）。

**与 B/C 案关系（§10.3 扩展）**：

| | B 案 L7 | C 案 L3 mass PING | **D 案 L3 silent EOF** |
|---|---|---|---|
| 时长 | ~89–96min | ~15min 簇 | **~38–40min** |
| 错误 | generation-ended | PING code=14 | **server-eof mid-tool** |
| 修复 | P22 段轮换 | §29 P19 rescue | **P24 Pulse Contract + P25 观测** |

**铁律**：D 案 **禁止** 用 P22（未到 L7 cap）或 failover；**禁止** 把 ghost Continue 当根因。

### 10.5c 事故 E — 7/29 11:12–11:16 `445ba497` 四段级联（Cursor-3.1.15 · 单 userMessage）

| # | A 时刻 | txReqId | attempt | streamPrimarySub | durationMs | 决策 |
|---|---|---|---|---|---|---|
| 1 | **10:35:10** | `445ba497` | 0 | **server-eof** | 2273348 (~38min) | RETRY · mid-tool |
| 2 | **10:50:52** | `c3400bd9` | 1 | **server-eof** | 943564 (~16min) | RETRY |
| 3 | **11:12:27** | `a30a7234` | 2 | **server-eof** | 1290581 (~21.5min) | RETRY · gapSinceActivityMs=**7** |
| 4 | **11:16:11** | `1e5c49ca` | 3 | **transport** | 208341 (~3.5min) | **THROW** · `serverErrorRetries=3` |

**UI 报错**（用户粘贴）= #4 · `originalRequestId=445ba497` · `Stream ended without turnEnded` — **级联终点，非新根因类型**。

**PRIMARY · L3（#1–#3）**：与 §10.5 **同族** HY2 QUIC 马拉松 SSE 静默 server-eof。JP-VPS sing-box @ 11:12:27 A±2min **0 error**（SSH 实测）。

**AMPLIFIER · P15（#3 窗口 definitive）**：pulse 末条 `03:00:51Z` → 下次 `03:14:20Z` = **~13.5min 零 pulse**；`a30a7234` 断于 blackout 内。断后 `token_gap_nudge outcome=executed` 但 `stale_rids=a30a7234` — **救不了已死 SSE**。

**并行佐证**：`e6829e24` / `26dbfb8f` @11:16:19 仍续流 → **非 Cursor 全站故障** · per-connection silent drop。

**ghost Included（composer 23ef7055 · parent 445ba497）**：10:35 c3400bd9 +1 · 10:50 a30a7234 +1 · 11:12 1e5c49ca 计次 — **一条 userMessage 已烧 ≥4 Included**。

**证据**：`Cursor-3.1.15-data/.../renderer.1.log:8488,11251` · `renderer.log:786,1565,1662` · `app-2026-7-29.log` pulse gap · `api2-probe-ledger.jsonl` @ 03:12:30 api2=321ms 绿。

**与 §10.5 关系**：D 案首次双路齐断 + 34min pulse blackout；E 案为 **同 parent 四段级联** + 13.5min pulse blackout — **同一 PRIMARY+AMPLIFIER，复发**。

---

## 11. 500 Included 终极加固（P21–P27 · 观测面 + 保活契约 + 隧道活性）

北极星不变：单次 userMessage 物尽其用。以下 **不拆消息、不减并行、不 failover、不设客户端总时长上限、不 kill 健康连接**。

### 11.1 P21 — BUG-021 日志目录过滤（**1.26.85 · 已编码待装**）

**问题**：`agentTransportFailureSync` 对 `Cursor/logs` 用 `existsSync` 过滤，`.DS_Store` 文件通过 → `readdir` ENOTDIR → **整条 MTDO/rescue/hung_scan/jsonl 链死亡**（维护成本真实、用户价值为零的 dead path 在运行）。

**方案**：

- `listCursorLogSessionDirs()`：`stat().isDirectory()` + 跳过 dotfile
- 启动时 **log-dir self-test**（写 `[LogDiscoveryHealth] outcome=ok|fail`）；fail 时 tray 告警，禁止 silent dead
- 单测覆盖 `.DS_Store` 陷阱

**用户收益**：P14 silent_generation_end rescue、P15 connect_path_pulse、P19 MTDO **重新生效**；断连后 Connect 预热恢复，减少续跑再断（不能阻止 L7 90min 关流本身）。

**验收**：app-log 零 ENOTDIR · 马拉松后见 `MarathonRescueDial outcome=executed` 或 `silent_generation_end_nudge outcome=executed`。

### 11.2 P22 — resumeAction 段主动轮换（**省 Continue 次数 · 对抗长段 silent EOF**）

**真实场景**：500 套餐单条 `/jx` 马拉松常超 89min；c69260ad/cc6c19f8 两案 `durationMs` 与段墙钟精确对齐（89.35min / 91.2min），服务端 `generation-ended` 后用户 **手动 Continue 烧 1 次 Included**（906c2bf1 @14:49:26）。P22 在 cap 前内部 handoff，避免 silent death → Continue。

**方案本质**：在服务端 cap **之前**（建议 **~85min / 5100000ms**），当 `pendingTool=0` 且 generation 活跃时，由 **IFM 观测层** 触发 Cursor **内部 resumeAction 段轮换**——与断连后自动 segment:20 **同机制、提前执行**。

**硬约束（对齐 §9）**：

- ❌ 不是 userMessage 拆分
- ❌ 不是客户端 idle/静默 timeout
- ❌ 不关闭、不清理任何现有连接
- ❌ 不 failover
- ✅ 同 composer、同 parent RID 语义续跑
- ✅ 仅在 `http_segment_started` + stream_activity 证明段仍健康时轮换

**完美原因**：

1. 唯一在 500 铁律内对抗 **已证实长段 silent EOF** 的手段（P14 只能事后 rescue，不能阻止）
2. 把「断连后被动 resume」变成「cap 前主动 handoff」，减少 silent EOF 窗口与 ghost billing
3. 与现有 `ifm-event-v1` segment 模型一致，无新 transport 层

**验收**：马拉松 >100min 无 `generation-ended-without-turnEnded` @ ~89min；见 `[SegmentHandoff] outcome=executed` @ ~85min；token 连续性可审计。

**实施分期（2026-07-28）**：

| Phase | 内容 | 状态 |
|-------|------|------|
| **P22a 检测** | Sparkle `cursorSegmentHandoffCore.ts` · hung_scan 日志 `[SegmentHandoff] outcome=due phase=detect_only` | ✅ **1.26.89 已编码** |
| **P22b 执行（Phase 1）** | Guard312 `c2-wb-025` · WB 队列 + `[SegmentHandoff] outcome=due phase=workbench-queue` | ✅ **WB 1.0.17 已编码** · 待 `deploy:dev` + ⌘Q Cursor-2 |
| **P22b 执行（Phase 2）** | `_ifmC2DrainSegmentHandoffQueue` → `resumeChat({isAutoResume:true})` + eager bind @ submitChat | ✅ **WB 1.0.17 已编码** · 待 deploy+⌘Q |

### 11.3 P23 — 马拉松期安装/升级 Hard Gate

- 复用 P10 `MarathonCoreRestartGuard` + upgrade 脚本 PRE-gate
- **`SPARKLE_FORCE_INSTALL_DURING_MARATHON` 默认拒绝**；override 须写 audit 且 tray 二次确认
- 防止 10:52 类 core_cold_restart 复发

### 11.4 P24 — MarathonSSETruth SSOT + Pulse Contract（**根治 P15 false-negative · 1.26.91+**）

**问题（BUG-026 · 代码级 definitive）**：P15 pulse 被 `hasActiveMarathonStream()` 三门 false-negative 锁死（§10.5 表）。维护成本真实、用户价值为零的 **dead feature path** — 必须 **接上或删**；方案选择 **接上并重构**。

#### 架构原则（无向后兼容 · 无技术债）

1. **段龄 SSOT = `http_segment_started.httpStartMs`**（已有 `cursorSegmentHandoffCore.parseHttpSegmentStartedLine`）— **免疫 512KB tail 截断**
2. **父马拉松 SSOT = `originalRequestId` 链** — userMessage + 全部 resumeAction 段共享同一 parent
3. **registry 降为辅助** — 仅提供 `openToolCalls` / `lastActivityMs`；**禁止** registry `firstActivityMs` 作 pulse gate
4. **Pulse Contract 硬不变量** — 违反即 bug + tray 告警

#### MarathonSSETruth 模块（新 · `marathonSSETruthCore.ts`）

| 输入 | 用途 |
|---|---|
| `http_segment_started` / `stream_terminated`（ifm-event-v1 tail + **append-only 本地 cache**） | 段龄 · 活跃段集合 |
| Guard `validated-ledger.v1.jsonl` tail | parent RID 马拉松事实 |
| registry（现有） | openToolCalls 辅助 |

**本地 cache（P24b）**：Sparkle 见 `http_segment_started` 即 append `~/.sparkle/marathon-segments.v1.jsonl` — renderer 轮转/5MB 日志不再抹掉段起点。

#### Pulse Contract

```
WHEN cursor_conn >= 12
 AND EXISTS open segment S WHERE (now - S.httpStartMs >= 30min
       OR parent-chain marathon age >= 30min)
THEN marathon_connect_path_pulse MUST fire within 60s
```

- **删除** pulse 对 `hasActiveMarathonStream(minStreamAgeMs=30min)` 的依赖
- **tool 暂停**：openToolCalls>0 或 parent-chain active → **仍算马拉松 active**（heartbeat 不再 gate pulse）
- 每次 tick：`pulse_skipped reason=<enum>` 或 `pulse_contract_breach gap_ms=…`
- enum：`no_open_segment` · `conn_below_threshold` · `coalesced` · `budget_exhausted` · `quiesce_defer`

#### 与 P22 关系

- P22 用同一 `http_segment_started` SSOT（已编码）— P24 **复用解析器**，不重复造轮
- P22 @85min 治 L7；P24 pulse 治 L3 split-brain — **正交、不冲突**

#### 验收

- 马拉松 tool-heavy 阶段 app-log **零** >60s pulse gap
- `active_stream=` 日志改为 `marathon_truth_active=1`（新字段，废弃误导性 active_stream）
- 7/29 复现场景单测：512KB tail + 仅 heartbeat + 40min 段 → pulse **仍 due**

### 11.5 P25 — Incident Observability Plane（**A 时刻 definitive · 1.26.91+**）

**问题（7/29 缺口）**：`agent-transport-failures.jsonl` **无** HTTP SSE server-eof 条目（P14b 仅 Connect）；billing-guard @ A 无 ghost 事件；V5.2 api2 @ A 时刻缺失；无 NWPathMonitor path_change 日志。

**架构 — 观测面补全（为定责服务，非拦截）**：

| 组件 | 行为 | 文件/锚点 |
|---|---|---|
| **P25a HTTP SSE transport failure** | renderer `agent-error` + `streamPrimarySub=server-eof` @ durationMs≥30min → append `agent-transport-failures.jsonl` | `agentTransportFailureSync.ts` |
| **P25b NWPathMonitor** | Mac 网络路径变化 → `network-stability-events.jsonl` `path_change` | 新增 `networkPathMonitorCore.ts` |
| **P25c incident_bundle @ agent-error** | 首条 `agent-error` 触发 triage 子集（V5.2 api2 + sing-box tail + pulse gap 统计）→ `~/Desktop/cursor-incident-<rid>-<ts>/` | `scripts/triage-cursor-disconnect.sh` hook |
| **P25d ghost billing 通知** | observe-only 见 `willRetry=true` → `billing-guard-events.jsonl` `ghost_resume_planned`（**通知**；拦截仍 Guard312 SSOT） | cross-ref open-perplexity Guard |

**诚实边界**：P25 **不能阻止** L3 silent EOF；目标是 **下次 A 时刻零证据缺口**，定责不再靠手工 grep。

### 11.7 P27 — Hy2TunnelVitality（Mac 出站 QUIC 隧道活性 · **L3 物理层 · 待编码**）

> **命名说明**：代码库已有 **P26 = connect partition 60s 马拉松窗**（`connectPartitionDetectCore.ts`）。本项为 **P27**，避免歧义。

**问题（7/29 E 案 definitive）**：VPS 入站 `udp_timeout=3600s` 已验（sing-box 1.14.0-alpha.48 · conntrack 3600）。P24 pulse + token_gap rescue 仅 dial **新短 HTTP 连接** — **不能维持已建立 SSE 所绑定的 Mac→VPS HY2 QUIC 五元组**。A 时刻 api2 287–321ms 全绿 + sing-box 0 error = **split-brain 典型**：短探针活 · 长流死。

**方案本质（无向后兼容 · 无 failover · 无 kill 健康连接）**：

1. **Mac mihomo HY2 outbound SSOT** — 初始 provider 生成时写入与 VPS 对称的 QUIC 字段（`udp_timeout` / `idle_timeout` / `keep_alive_period`），**禁止** Marathon 运行期 provider reload 改写（接 §4 kernel）。
2. **TunnelVitality 绑定** — 当 P24 `marathonTruthActive=1` 且 parent-chain age≥30min：每 **30s** 经 **同一 JP-VPS-HY2 leaf** 发 **轻量 UDP/QUIC 活性包**（复用现有 leaf dial 路径，**不新建 provider、不 failover、不关旧连接**）。
3. **活性 vs 探针分离** — `session_transport_nudge` / pulse 继续负责 **观测**；P27 负责 **维持 outbound QUIC 映射活性** — 日志字段 `hy2_tunnel_vitality outcome=` 独立 SSOT。
4. **ISP NAT 观测（P27b）** — `networkPathMonitor` 已有 path_change；追加 **UDP mapping age 推断**（token_gap>180s + api2 绿 + server-eof → 标 `nat_stale_suspect` 供 triage，**不触发 recovery**）。

**完美原因（真实用户场景）**：

- 500 套餐单条 `/jx` 常跑 40min+ 多 tool 并行；7/29 `445ba497` 在 **同一条 userMessage 内断 4 次** — P24  alone 无法阻止 in-flight SSE 死亡。
- VPS 侧已 3600s；缺口在 **Mac 出站 + 中间 NAT** — 不修则 P24 只能「更早发现 split-brain」，不能「不让长流死」。

**与 P24/P25 正交**：

| 层 | 组件 | 治什么 |
|---|---|---|
| 观测放大 | P24 Pulse Contract | pulse 不再 13–34min blackout |
| 定责 | P25 Incident Plane | A 时刻零缺口 |
| **物理** | **P27 TunnelVitality** | **维持 Mac→VPS QUIC 映射 · 减 silent server-eof** |

**验收**：

- 40min+ 马拉松 tool-heavy：`hy2_tunnel_vitality outcome=executed` 每 ~30s
- `server-eof` @ duration≥30min **率下降**（外部锚点：Usage ghost resume 次数 / parent 链 server-eof 计数）
- **零** 健康 SSE 连接 close · **零** provider reload · **零** failover

**诚实边界**：P27 **不能** 消除 Cursor L7 ~90min generation-ended（仍靠 P22）；**不能** 修复 mass PING partition（仍靠 §29 P19）。

### 11.6 与 Connect Split-Brain SSOT 关系

- P14/P15/P19 MTCP 细节见 open-perplexity `CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` §29
- **BUG-021 未修前 §29 十四门禁在 Mac 侧 observability 全灭** — P21 是 §29 生效前提

---

## 12. Latency Tax — Sparkle 不得拖慢 VPS 本体

### 12.1 指标 SSOT（已实现 · 需产品化）

| 轨道 | ledger scope | 含义 |
|---|---|---|
| **VPS 本体** | `scope=vps` · `method=ssh_curl` | jp-vps/kr-vps 直连公网 curl api2 |
| **Mac 全路径** | `scope=active` · `transport_pair` | Mac → TUN → mihomo → leaf → api2 |

**Delta 定义**：`macFullPathP50 - vpsBodyP50`（`latencyDeltaGateCore.ts` · 阈值 **150ms** · `MTDO_LATENCY_DELTA_THRESHOLD_MS`）。

**c69260ad @ A**：delta=**-250ms**（Mac 全路径 **快于** VPS 本体）— **Sparkle 未加税**，本案断连与 latency tax **无关**。

### 12.2 用户场景：VPS 300ms → Sparkle 后 500ms+

**绝不允许**。当 delta **持续 >150ms**（建议 10min 窗口、≥20 样本）：

1. Tray + 代理页 **双轨 P50 告警**（已有 IPC `getLatencyTruthSummaryForNode` 基础）
2. triage 自动标 `SPARKLE_LATENCY_TAX=1`
3. **只观测、不切节点**；定位 tax 来源：

| 来源 | 机制 | 修复方向 |
|---|---|---|
| 观测拨号与 SSE 争带宽/事件循环 | conn<12 时 probe 未 quiesce | 确保 P9 quiesce @ conn≥12；低 conn 亦 defer 非必要 dial |
| fake-ip  detour | 198.18 CIDR 陷阱 | `fakeIpRoutingIntegrity` 审计 |
| HY2 QUIC 用户态开销 | 长流 + 短探针同 leaf | P12 observability budget + rescue bypass 隔离 |
| DialTolerance 运行期 reload | provider mutation | §4 Zero-Disruption kernel **删除** runtime sync |
| mihomo delay 槽位 | max 2 slot 排队 | marathon_rescue bypass（已有）· UI 测速 defer |

### 12.3 VPS 本体质量因子（非 Sparkle、非 failover）

| 因子 | 影响 | 运维动作 |
|---|---|---|
| sing-box HY2 `udp_timeout` | QUIC 长流 EOF | 保持 **3600s**（`patch-hy2-in-quic-marathon.sh`） |
| conntrack 满 | 新流失败 | 监控 `nf_conntrack_count/max` · A 窗口 delta |
| qdisc dropped/requeue | bufferbloat | 采 **delta** 非累计；基准前后对比才改 qdisc |
| 入站 mux/TLS error | Connect 批量断 | V5.4 @ A 矩阵 |
| JP/KR 路径差异 | 单 region 劣化 | 三点定责（**不自动切换**） |

---

## 13. 非 Cursor 层网络稳定性 — 高价值项（禁止 failover）

按 **真实收益 / 缺点比** 排序；均已映射代码或 §4–§6 既有 Phase。

| 优先级 | 项 | 层 | 真实收益 |
|---|---|---|---|
| P0 | **P24 MarathonSSETruth + Pulse Contract** | Sparkle | 根治 P15 13–34min 失明 · split-brain 早检/rescue |
| P0 | **P27 Hy2TunnelVitality** | Sparkle + mihomo 初始配置 | **维持 Mac 出站 QUIC 映射** · 减 in-flight server-eof（7/29 E 案缺口） |
| P0 | **P21 发版 + log-dir self-test** | Sparkle | 复活整条 MTDO；否则 P14–P19 名存实亡 |
| P0 | **§4 Zero-Disruption Mutation Kernel 落地** | Sparkle | 消除 d52a37e3 / 10:52 类 L2 自伤（最大单项） |
| P0 | **P22 段轮换** | IFM+Sparkle | 少烧 Continue · 对抗长段 silent EOF |
| P1 | **P25 incident 观测面** | Sparkle + triage | A 时刻 HTTP SSE / path_change / ghost 零缺口 |
| P1 | **P23 马拉松升级 hard gate** | Sparkle scripts | 禁 force install |
| P1 | **Latency Tax 产品化告警** | Sparkle UI | 300→500 秒级可见、可 triage |
| P1 | ~~**P15 pulse 依赖 P21 验收**~~ → **P24 取代** | Sparkle | BUG-026：registry 单源 gate 已证伪 |
| P2 | **VPS conntrack/qdisc delta 采集** | Sparkle triage | A 时刻 definitive 补全 |
| P2 | **upgradeSparkleAsarGate 马拉松 PRE** | scripts | 防 asar 热替换断流 |

**明确不做（§9 延伸）**：减并行、拆 userMessage、新会话、切节点、客户端总时长、L0 清健康连接、短探针失败触发 recovery。

---

## 14. Dead Feature Path 清账

| 路径 | 状态 | 裁决 |
|---|---|---|
| MTDO/rescue @ BUG-021 | 全灭但未告警 | **P21 修复 + self-test** |
| `marathonQuiesceProviderSync` runtime reload | ~~§4 标删除~~ | **✅ 1.26.86 已删** · Quiesce 纯内存 |
| TransportHealth L0–L3 | §4 标删除 | **✅ L0–L3 marathon hard-disable** @1.26.89 · conn≥12/quiesce [`cursorTransportHealth.ts`] |
| P14 silent_generation_end @ 1.26.84 | 代码在 · 运行 dead | P21 后发 soak |
| P15 pulse @ registry-only gate | **BUG-026 已证伪** | **P24 取代** — MarathonSSETruth + Pulse Contract |
| P22 段轮换 | 不存在 | **新建**（§11.2） |
| Guard 拦截逻辑 | 在 open-perplexity SSOT | 本文仅列 cross-仓验收 |

---

## 15. 实施顺序（2026-07-29 起）

1. **立即**：P21 部署（rm `.DS_Store` + pkg **1.26.89**）— 用户确认后执行
2. **Soak 24h**：零 ENOTDIR · rescue executed · jsonl 写入恢复
3. **P24 编码 + 单测** — MarathonSSETruth + Pulse Contract（**优先于** P15 soak）
4. **P25 观测面** — HTTP SSE jsonl + NWPathMonitor + incident_bundle hook
5. **P22 设计与 IFM 补丁** — 段轮换 @ ~85min（L7 专用，不治 D 案）
6. **并行推进 §5 Phase 1–4** — Zero-Disruption kernel（长期最大收益）
7. **P23 + Latency Tax UI** — 升级 gate + 双轨告警
8. **Cross-仓**：Guard ghost 拦截与 P22 handoff 联合验收

**完成定义（增量）**：c69260ad 类长段 silent EOF 在 P22 后 **0 复现**；BUG-021 类 observability dead **0 复现**；BUG-026 类 pulse blackout **0 复现**（>60s gap=0）；latency tax 持续 >150ms 必告警且可 triage。

---

## 16. TODO 草案注册表（唯一清单 · 仅值得做项）

> **状态**：全部为 `草案` — 待三轮初审/复审/终审后逐项分析-实施-测试。**禁止**重复立项；与 §11–§14 一一对应，无歧义项。

| ID | 名称 | 状态 | 实际收益 | Sparkle 代码锚点 | 竞品/借鉴 | 原因 |
|---|---|---|---|---|---|---|
| **R-01** | P21 日志目录过滤 + LogDiscoveryHealth | 草案 | MTDO/P14/jsonl 从全灭恢复；A 时刻可定责 L3 vs L7 | `agentTransportFailureSync.ts` · `cursorLogDiscoveryCore.ts` | [opencodex 逆向](https://cephalochromoscope.net/9b48627c-29c6-4e4c-8c20-f550c2eb8176)：`turnEnded` 为权威结束信号，HTTP EOF 先于 turnEnded = 本案形态 | BUG-021 @ c69260ad：ENOTDIR 致观测面 silent dead |
| **R-02** | P22 resumeAction ~85min 段轮换 | **P22a 1.26.89 · P22b 1.0.17** | 省 Continue · 对抗 L7 silent EOF | Sparkle + guard-31210 `c2-wb-025` | flowctx segment handoff | 首跑 soak 验证 resume-chat-invoked |
| **R-03** | P23 马拉松期 upgrade/install hard gate | **已编码 1.26.87** | `SPARKLE_FORCE_INSTALL_DURING_MARATHON=1` → **hard FAIL** | `scripts/lib/marathon-core-restart-guard.sh` | Sparkle 自有 P10 | force install 绕过 guard @ c69260ad 10:52 案 |
| **R-04** | Zero-Disruption Mutation Kernel | **部分 1.26.87** | Quiesce/DialTolerance/manager hot-reload 已禁 | §4 列文件 | deer-flow StreamBridge | 最大 L2 自伤单项 |
| **R-05** | Latency Tax UI/Tray 双轨告警 | 草案 | 300→500ms 加税 **秒级可见**；只观测不切节点 | `latencyTruthFromLedgerCore.ts` · `latencyDeltaGateCore.ts` · `proxies.tsx` | [gbrain eval-gate](external_reference_project/mem/gbrain/src/core/bench/baseline-file.ts)：`(baseline+delta)/baseline` 延迟回归门禁 | 用户铁律：Sparkle 不得拖慢 VPS 本体 |
| **R-06** | 删 marathonQuiesceProviderSync runtime reload | **已编码 1.26.86** | Quiesce 纯内存 · 零数据面 mutation | ~~`marathonQuiesceProviderSync.ts`~~ 已删 · `marathonQuiesce.ts` | Cursor Enterprise [Network Docs](https://cursor.com/docs/enterprise/network-configuration)：长连接不应被 proxy reload 打断 | §4 Phase 1 · `data_plane_action=none` 日志 |
| **R-07** | 删/硬禁 TransportHealth L0–L3 @ marathon | **已编码 1.26.89** | L0–L3 在 conn≥12/quiesce 时 hard-disable | `cursorTransportHealth.ts` | Sparkle 自有 Agent-stability-first 文档 | 低 conn 非马拉松窗口 L2/L3 仍可用 |
| **R-08** | ~~P15 connect_path_pulse soak（post-P21）~~ → **P24 Pulse Contract** | **草案 · BUG-026** | registry 单源 gate 致 26min 失明 · L3 split-brain 无法早检 | `marathonTransportDialOrchestratorCore.ts` · `marathonSSETruthCore.ts`（新） | Sparkle BUG-026 Jul29 · df1501ed | P21 后 pulse 仍可能 dead — 7/29 已证伪 |
| **R-09** | triage VPS conntrack/qdisc delta 采集 | 草案 | V5.4 矩阵 definitive 补全 | `scripts/triage-cursor-vps-lib.sh` | Sparkle CURSOR-DISCONNECT-TRIAGE.md §5.1 | A 时刻 qdisc 累计值误判 bufferbloat |
| **R-10** | upgradeSparkleAsarGate 马拉松 PRE | 草案 | 防 asar 热替换断流 | `scripts/upgradeSparkleAsarGateCore.ts` | Sparkle 自有 ASAR gate | pkg 安装纪律延伸 |
| **R-11** | Cross-仓 Guard × P22 handoff 联合验收 | 草案 | Continue 计次与 ghost 拦截一致 | open-perplexity Guard SSOT | Sparkle 500 铁律 | 906c2bf1 Continue mode=allowed 实证 |
| **R-12** | P24 MarathonSSETruth + Pulse Contract | **已编码 1.26.91** | 根治 P15 26min blackout · 马拉松 >30min 强制 60s pulse | `marathonSSETruthCore.ts` · `marathonTransportDialOrchestratorCore.ts` | BUG-026 §10.5 | registry≠真实 SSE 时 rescue 链全盲 |
| **R-13** | P25 Incident Observability Plane | **已编码 1.26.92** | A 时刻 HTTP SSE jsonl + path_change + incident_bundle | `agentTransportFailureWriterCore.ts` · `networkPathMonitorCore.ts` · `incidentBundleCollectorCore.ts` | Jul29 证据缺口清单 | 定责不再靠手工 grep |
| **R-14** | P27 Hy2TunnelVitality（Mac outbound QUIC） | **草案** | 维持 SSE 绑定隧道 · 减 40min server-eof 复发 | 新 `hy2TunnelVitalityCore.ts` · `cursorHy2MarathonKeepaliveCore.ts` · 初始 provider 模板 | VPS `hy2InQuicMarathonFields` 已有 · Jul29 E 案 | pulse/rescue 不能复活已死 SSE |

### 不值得做（明确排除 · 禁止立项）

减并行 · 拆 userMessage · 新开会话 · failover/切节点 · 客户端总时长/idle timeout · L0 清健康连接 · 短探针失败触发 recovery · 固定 5400s 常量假设（未证实）

### 文档索引（repair/ 唯一 SSOT · 禁止重复文件 · 禁止冲突）

| 文档 | 职责 |
|---|---|
| **`CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md`** | **本文（Sparkle 仓）** — 500 马拉松零中断 + L7/L3 定责 + P21–P27 + P22 + Latency Tax + TODO R-01–R-14 |
| open-perplexity `CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md` | 薄索引 → 本文 · **禁止**复制全文 |
| open-perplexity `CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` §29 | **MTCP split-brain 实施/发版 SSOT**（P17–P20 · 十四门禁） |
| `CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md`（本仓） | 薄索引 → open-perplexity §29 |
| `CURSOR-DISCONNECT-TRIAGE.md`（仓根） | 排查 SOP |

**层级规则**：L3 mass transport / rescue 执行 → Split-Brain §29 · L7 silent EOF / 零 mutation / 段轮换 → 本文 §10–§11 · 两篇 **并行、互不覆盖**。

---

## 17. 万事俱备 · 等你重启清单（2026-07-29）

> **禁止**在 cursor_conn>0 时重启 Sparkle。你确认任务跑完后按此清单执行。

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | rm `Cursor/logs/.DS_Store` | ✅ 已完成 | MTDO 已恢复 · 07:22:58 rescue executed |
| 2 | BUG-021 代码（listCursorLogSessionDirs + LogDiscoveryHealth） | ✅ 已编码 | 待 pkg 生效 |
| 2b | **G22** rescue 禁止 skipped_weak_probe @ weak delay | ✅ 已编码 | c8346504 案 07:40:28 放大器 |
| 3 | BUG-021 + G22 + R-06 单测 | ✅ **PASS** | rescue G10+G22 · quiesce 无 reload · hygiene marathon_guard |
| 4 | `bun run upgrade:mac` → **1.26.89** | ⏸ **等你** | 含 P22a 检测 · P21+G22+G10+R-04~07 · **L0+L1 hard-disable** |
| 5 | Guard312 `deploy:dev` → **WB 1.0.17** | ⏸ **等你** | P22b eager bind @ submitChat · deferred retry if service late |
| 6 | **P24 编码** | ✅ **已编码 1.26.92** | BUG-026 · MarathonSSETruth + Pulse Contract |
| 6b | **P25 观测面** | ✅ **已编码 1.26.92** | HTTP SSE jsonl · path_change · incident_bundle |
| 7 | 重启后验收 | ⏸ **等你** | app-log 见 `[LogDiscoveryHealth] outcome=ok` · 零 ENOTDIR · rescue executed · **零 pulse_contract_breach** |

**P24+P25 已编码 1.26.92**。你确认 marathon 结束后：`bun run upgrade:mac`（cursor_conn=0）→ 验收 pulse + 零 breach + server-eof 写入 jsonl。

| 8 | **P27 Hy2TunnelVitality 编码** | ⏸ **待你批准** | Mac outbound QUIC 活性 · 减 in-flight server-eof |
| 9 | P27 soak @ 40min+ | ⏸ | `hy2_tunnel_vitality outcome=executed` · server-eof 率 vs 7/29 baseline |

**推荐执行序（一步到底 · 最少返工）**：① 装 **1.26.92** soak P24/P25 24h → ② 编码 **P27** → ③ 再 soak 40min+ 马拉松验证 server-eof 率下降。

---

## 18. 网络面稳定性深度评估（非 Cursor 层 · 禁止 failover）

> 目标：VPS 300ms 经 Sparkle 后 **不得** 稳定 >500ms（Latency Tax）；马拉松 SSE **尽量不断**。

### 18.1 先前结论遗漏修正（诚实协议）

| 遗漏 | 修正 |
|---|---|
| 「registry 与 SSE 脱节」过于模糊 | **definitive**：512KB tail + heartbeat 排除 + 120s gap 三门 false-negative（§10.5 表） |
| 未分析 10:50 第二起 | **D′ 案** §10.5b：单路断 · 同族 L3 · a30a7234 是 ghost resume 非 A 时刻 |
| 未解释 nudge 仍绿却断 | `session_transport_nudge` 是 **短 HTTP**，与 **长 SSE** 不同通道 — split-brain 预期行为 |
| VPS @ A 仅引用旧数据 | **已 SSH 复核** 10:35 + **11:12** A±2min：sing-box **0 error** · `udp_timeout=3600s` · conntrack udp=3600s |
| 「P24 够了」 | 7/29 E 案：pulse 恢复后 rescue 仍 **stale_rids** — **in-flight SSE 仍需 P27** |

### 18.2 代理/VPS 稳定性：值得做 vs 不值得做

| 项 | 层 | 真实收益 | 缺点/边界 | 裁决 |
|---|---|---|---|---|
| **P24 Pulse Contract** | Sparkle | 断前 rescue · 减 ghost Included | 不能消除 QUIC 物理层 silent drop | **P0 · 必做** |
| **P24b segment jsonl cache** | Sparkle | 免疫 renderer 5MB 轮转 | ~KB 级磁盘 | **P0 · 随 P24** |
| **P27 Hy2TunnelVitality** | Sparkle + mihomo | **维持 in-flight QUIC 隧道** | 不能治 L7 90min cap | **P0 · P24 后必做** |
| **P25 观测面** | Sparkle | 下次 A 零缺口 | 不治断连本身 | **P1 · 已编码** |
| **Latency Tax UI**（R-05） | Sparkle | 300→500 加税秒级可见 | 只观测 | **P1** · `latencyDeltaGateCore` 已有 150ms 阈值 |
| **§4 Zero-Disruption Kernel** | Sparkle | 禁 marathon reload 误杀 | 工程量大 | **P0 长期** |
| **marathonObservabilityDialBudget** | Sparkle | 高 conn 时减 probe 争带宽 | 已实现部分 | **维持** · rescue 永不 defer |
| **HY2 udp_timeout 3600s** | VPS | QUIC 长流 | 已部署 | **维持** · SSH 已验 |
| **qdisc/conntrack delta 采集**（R-09） | triage | A 时刻 definitive | 运维只读 | **P2** |
| 切节点 / failover | — | — | **违反铁律** | **禁止** |
| 减并行 / 拆 userMessage | — | — | **浪费 Included** | **禁止** |
| 客户端限时 / kill 健康连接 | — | — | **不可饶恕浪费** | **禁止** |

### 18.3 Latency Tax（Sparkle 不得拖慢 VPS 本体）

**机制已存在**：`latencyDeltaGateCore.ts` — `delta = macFullPathP50 - vpsBodyP50` · 阈值 **150ms**。

**7/29 @ A**：api2 nudge 302/426ms — **未观测到加税**（需 ledger 双轨 P50 持续窗口才 definitive）。

**产品化（R-05）**：Tray + 代理页双轨 P50 · triage 标 `SPARKLE_LATENCY_TAX=1` · **只告警不切节点**。

**加税来源排查序**：fake-ip detour → mihomo 排队 → 马拉松 probe 争 loop → DialTolerance reload（§4 删除）。

### 18.4 VPS 节点质量因子（同节点 · 非 failover）

| 因子 | 7/29 状态 | 影响 |
|---|---|---|
| sing-box HY2 keepalive 30s | ✅ 已配 | QUIC 中间盒保活 |
| conntrack | 717/1048576 ✅ | 无耗尽 |
| sing-box inbound error @ A | **0** | 非 VPS 应用层故障 |
| 运营商 QUIC/NAT 中间漂移 | **不可见于 sing-box** | L3 silent EOF **最可能物理层** |
| KR vs JP 路径 | 本案 JP-HY2 | 三点定责 · **不切换** |

**诚实边界**：ISP 侧 QUIC 会话漂移 **无法** 仅靠 VPS 入站配置 100% 消除。Sparkle 三层：**P24** 断前观测/rescue · **P27** Mac 出站隧道活性 · **P25** 定责 — 最大化单次 userMessage 存活。

### 18.5 Dead Feature Path 清账（本次新增）

| 路径 | 状态 | 裁决 |
|---|---|---|
| P15 pulse @ `hasActiveMarathonStream` | **BUG-026 false-negative** | **P24 替换 gate** · 不 soak |
| `active_stream=0` 日志 | 误导 | 改 `marathon_truth_active` |
| registry `firstActivityMs` 作 age SSOT | 512KB 下错误 | **废弃** · 改 httpStartMs |
| HTTP SSE server-eof jsonl | 未写入 @1.26.90 | **P25a 已编码 1.26.92** |
| Mac outbound HY2 活性 | **不存在** | **P27 新建**（§11.7 · R-14） |

---

## 19. 结构性风险与校准（P24/P27 · 必审）

### 19.1 风险 R-A — 测量衰减（Goodhart 前置）

| 字段 | 内容 |
|---|---|
| **风险类型** | 测量衰减 |
| **证据** | 7/29：`marathon_connect_path_pulse outcome=executed` + api2 绿，仍 server-eof @ gapSinceActivityMs=7 |
| **影响范围** | 若仅以 pulse 执行率验收，会误判「已修复」而 L3 仍断 |
| **纠偏动作** | 外部锚点 = **parent 链 server-eof 次数** + **ghost Included 率**；内部指标 pulse 仅作必要条件 |
| **校准顺序** | ① 装 1.26.92 验零 breach → ② 编码 P27 → ③ 40min+ soak 比 7/29 baseline |

### 19.2 风险 R-B — 古德哈特（冲指标）

| 字段 | 内容 |
|---|---|
| **风险类型** | 古德哈特 |
| **证据** | `token_gap_nudge outcome=executed` 在 stale_rids 上仍计「成功」 |
| **影响范围** | rescue 计数虚高 · 用户以为保活有效 |
| **纠偏动作** | 日志 SSOT：`outcome=executed_on_stale_rid` vs `executed_on_live_rid`；P27 独立 `hy2_tunnel_vitality` |
| **校准顺序** | P25 incident_bundle 含 stale_rid 标记 → P27 后对比 server-eof 率 |

### 19.3 风险 R-C — 向上失明（目标失真）

| 字段 | 内容 |
|---|---|
| **风险类型** | 向上失明 |
| **证据** | BUG-026 反复修 P15/registry 未修 Mac outbound；VPS 3600s 已配仍断 |
| **影响范围** | 继续在观测层叠补丁而不碰 in-flight 隧道 |
| **纠偏动作** | roadmap §11.7 P27 立项；§4 Zero-Disruption kernel 并行（L2 自伤） |
| **校准顺序** | P24 soak 24h → 若 server-eof 仍发 → **必须** P27，禁止再加 pulse 频率 |

### 19.4 风险 R-D — P27 活性包争带宽（剩余风险）

| 字段 | 内容 |
|---|---|
| **风险类型** | 性能 / 事件循环 |
| **证据** | `CURSOR_HY2_NUDGE_DEFER_THRESHOLD=80` 已存在 — 高 conn 时 dial 风暴曾放大 HY2 drop |
| **影响范围** | P27 30s 活性若走 api2 全量 dial，可能反向加 tax |
| **纠偏动作** | P27 仅 **QUIC keepalive 帧级** 或 mihomo 现有 leaf heartbeat API；与 pulse/rescue **预算隔离** |
| **触发条件** | cursor_conn>80 且 latency delta>150ms 持续 |
| **验证方式** | Latency Tax 双轨 P50 · 无 token_gap 恶化 |
| **剩余风险** | 极低频 ISP 硬断无法消除 — 靠 P22 @85min 减 L7 损失 |
