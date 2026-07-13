# Sparkle Bugfix Log

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
- 35min marathon idle 清理阈值 **不变**（与 CTHC 60s 挂死扫描并存）
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
