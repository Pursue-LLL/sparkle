# src/main/core — 模块架构

Electron 主进程核心：mihomo 控制、Cursor 网络优化、节点探测与稳定性监控。

用户可感知网络僵死 / TUN 恢复缺陷台账：[BUGFIX_LOG.md](../../BUGFIX_LOG.md)（例：BUG-2026-07-09-001 mihomo 出站池僵死）。

## 文件清单

| 文件                                                                    | 职责                                                                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api2ProbePlane.ts`                                                     | 单一 bootstrap：active 60s + VPS L4 SSH 300s → api2-probe-ledger.jsonl                                                                                                |
| `vpsL4ProbeCore.ts` / `vpsL4Probe.ts`                                   | VPS SSH curl（**jp-vps**，`ProxyCommand=none` + 公网 HostName 回退）→ ledger scope=vps                                                                             |
| `canonicalVpsNodeSnapshotCore.ts`                                       | 从 provider history 采集 **JP 四 leaf** snapshot（CTHC events）                                                                                                       |
| `networkTriangulationDiagnosticCore.ts`                                 | 定责探测：KR/JP Reality（KR 可选）+ active Cursor 节点 + marketplace                                                                                                  |
| `api2ProbeLedgerCore.ts`                                                | api2 探针统一 ledger 读写（scope=active/vps/marathon）；**readRecentSessionNudgeAnchorsForNode**（P9n）；**readLatencyTruthSummaryForNode**（P13 Phase 2） |
| `latencyTruthFromLedgerCore.ts`                                         | **P13 Phase 2** VPS 本体 vs Mac 全路径 P50 SSOT（scope=vps ssh_curl vs scope=active transport_pair） |
| `vpsCanonicalNodes.ts`                                                  | **SSOT** JP-VPS 四 leaf：Reality / TLS / HY2 / TUIC · KR 已退役（2026-07-24） |
| `nodeQualityScore.ts`                                                   | 纯函数：Probe/Session 分层评分、badge 门槛常量                                                                                                                        |
| `nodeProbeStats.ts`                                                     | ledger vps 样本聚合 → DerivedStats                                                                                                                                    |
| `commercialNodeBenchmark.ts`                                            | 24h VPS 报告（ledger scope=vps SSH + active）、UI snapshot IPC                                                                                                        |
| `networkStabilityMonitor.ts`                                            | 当前节点 short probe、TUN 恢复（委托 CTHC）；**P9 `shouldDeferProbeForCursorLoadUnderMarathonQuiesce` + `syncMarathonQuiesceIfNeeded`**；非 probe 事件 jsonl         |
| `cursorTransportHealthCore.ts`                                          | 纯函数：挂死检测、Agent-stability-first 恢复决策、**R-07 `decideTransportRecoveryExecution`**（L0–L3 marathon guard） |
| `connectPartitionDetectCore.ts` / `connectPartitionReader.ts`           | Connect mass-PING · **G11/P19** `resolveConnectPartitionWindowMs`（conn≥12 → **15s** · conn≥200 → **60s** · 低 conn 8s）· `[ConnectPartitionWindow]` 日志 · **P18** dedupe · `partitionBlindSpotCore` · `partitionLatchCore` |
| `connectPingStormCore.ts`                                               | **P16** ultra-conn：Diagnostic ingest 合成 · synthetic partition · latency_delta rescue streak · ultra_conn 观测                                                      |
| `cursorLogDiscoveryCore.ts` / `cursorStructuredTransportIngestCore.ts` / `cursorStructuredTailCacheCore.ts` | **P17/P18** log roots SSOT · Structured tail 热读 + mtime/size cache · merge 输入 |
| `transportObservabilityMergeCore.ts` / `partitionBlindSpotCore.ts`     | **P18** hot+jsonl dedupe · jsonl=0∧structured≥2 blind_spot 告警 |
| `agentTransportFailureWriterCore.ts` / `agentTransportFailureSync.ts`   | Sparkle 写 `~/.sparkle/agent-transport-failures.jsonl`（Cursor renderer/exthost/**Structured NAL** 同步 + proxyNode 回填）；**P27b** server-eof → `natStaleSuspectObserver` |
| `natStaleSuspectObserverCore.ts` / `natStaleSuspectObserver.ts`         | **P27b** token_gap≥180s + api2 绿 + server-eof → `[NatStaleSuspect]` + jsonl `nat_stale_suspect`（observe-only，无 recovery） |
| `hy2TunnelVitalityCore.ts` / `hy2TunnelVitality.ts`                       | **P27** Mac outbound HY2 隧道活性：marathonTruthActive + parent age≥30min → 每 30s connect_path dial（purpose=`hy2_tunnel_vitality`）；日志 `[Hy2TunnelVitality] outcome=` SSOT |
| `hysteria2QuicStability.ts`                                               | 出站 HY2 `udp-timeout=3600s` · `heartbeat-interval=30s`（与 VPS sing-box 对称） |
| `marathonDialToleranceCore.ts` / `marathonDialTolerance.ts` / `marathonDialToleranceIdleApplyCore.ts` | 高并行时 VPS leaf dial-timeout 5s→45s · **P20b IDLE apply**（active stream/quiesce 期间 defer reload） |
| `latencyTruthGateCore.ts` / `latencyTruthGate.ts` | **P20a** `[LatencyTruth]` dual-track log · triage `SPARKLE_LATENCY_TAX` |
| `marathonQuiesceCore.ts` / `marathonQuiesce.ts` | P9 Marathon 静默：conn≥12 暂停 proxyHealthMonitor + observability dial；**R-24** quiesce ON/OFF 热 patch `health-check.enable` + mihomo reload |
| `marathonCoreRestartGuardCore.ts` / `marathonCoreRestartGuard.ts` | **P10** 马拉松 core cold restart guard：quiesce active 或 conn≥12 时 block `stopCore`/`restartCore`；写 `~/.sparkle/marathon-core-restart-guard.json`；install/upgrade PRE-gate |
| `cursorHy2MarathonKeepaliveCore.ts` / `cursorHy2MarathonKeepalive.ts`   | **MTCP/P13/P19** Rescue vs Warmth facade · delegates to `marathonRescueDialExecutor` / `marathonWarmthDialExecutor` · **无 mtdo re-entrancy guard** |
| `marathonSessionDialExecutorCore.ts` / `marathonRescueDialExecutor.ts` / `marathonWarmthDialExecutor.ts` | **P19** shared HY2 session dial + in-flight guard · rescue bypass P12 budget · warmth uses P12 budget |
| `cursorDedicatedNodeResolver.ts`                                        | Active Cursor dedicated leaf resolver (breaks executor↔keepalive circular import) |
| `cursorStreamTokenGapCore.ts` / `cursorStreamTokenGapReader.ts`        | Marathon token 静默检测（≥20s 无 meaningful SSE → hung_scan 触发 token_gap rescue）；**P14c** `generation-ended-without-turnEnded` sudden-death rescue（gap<30s · duration≥30min）；**P14d** txReqId+originalRequestId alias；**冷 resume 32s 零首 token** |
| `cursorConnectStreamKeepaliveCore.ts` | **P8+P14a** Connect-path 三探针纯函数 SSOT · partition 检测 · 15s gap 阈值；**执行统一由 MTDO** `marathonTransportDialOrchestrator.ts` |
| `coreReadyTimestamp.ts`                                                 | 叶子模块：`markCoreReadyAtMs` / `safeGetLastCoreReadyAtMs`（CTHC startup grace）；`manager.ts` 须 **namespace import** |
| `mihomoApiSocketWatchdog.ts`                                            | mihomo-api.sock ECONNREFUSED 时自动 `restartCore`（60s cooldown，startup grace 内跳过） |
| `cursorCriticalTransportCore.ts`                                        | critical Cursor transport host SSOT（CTHC + Hygiene 共享）                                                                                                            |
| `cursorTransportHealth.ts`                                              | CTHC 执行器：30s 挂死扫描；**L0–L3 marathon hard-disable**（conn≥12/quiesce）；**§22 MTDO** `runMarathonTransportDialCycle` @ hung_scan |
| `cursorSegmentHandoffCore.ts` / `cursorSegmentHandoff.ts`                 | **P22a** ~85min 段轮换检测 @ hung_scan · `[SegmentHandoff] outcome=due phase=detect_only`（execute 在 Guard312 WB） |
| `marathonStreamRegistryCore.ts` / `marathonTransportDialReader.ts`       | §22 active RID registry · pendingTool 门控 |
| `marathonTransportDialOrchestratorCore.ts` / `marathonTransportDialOrchestrator.ts` | §22 MTDO · **P15/P16/R-24**：独立 60s pulse · rescue bundle 分流 breach · `MarathonContentionBudget` deny |
| `marathonContentionBudgetCore.ts` | **R-23/R-24** green 基线 observability cap · `buildMarathonContentionBreachKinds` definitive breach SSOT |
| `tokenGapRescueIneffectiveCore.ts` | **R-18** token_gap rescue executed but max_gap persists + short path green → `[TokenGapRescueIneffective]` |
| `connectPartitionRescueIneffectiveCore.ts` | **R-31** connect_partition rescue executed but mass PING persists + short path green → `[ConnectPartitionRescueIneffective]` |
| `marathonProtocolContractCore.ts` / `marathonProtocolContract.ts` | **R-30** cold-start TLS gate · mid-marathon leaf switch block · `protocol_contract` one-click upgrade |
| `latencyDeltaGateCore.ts`                                               | §22 Mac 全路径 vs VPS 本体 P50 delta 告警（defer warmth only） |
| `mihomoProbeCoordinator.ts`                                             | 全局 mihomo delay 槽（max 2）与商业 batch 并发 cap                                                                                                                    |
| `marathonObservabilityDialBudgetCore.ts` / `marathonObservabilityDialBudgetQueueCore.ts` / `marathonObservabilityDialBudget.ts` | **P12** conn≥12/quiesce observability dial 单槽串行（QueueCore 无 Electron 依赖） |
| `providerDelayHistoryFromLedgerCore.ts`                                 | **P11** mihomo history 空时从 api2-probe-ledger 回填 tooltip 柱图（transport_pair/session_nudge）                                                                  |
| `managedVpsDelayTest.ts` / `vpsDelayTestPolicyCore.ts`                    | VPS UI 测速 defer 策略；**P11** `explicitUserRequest` bypass conn defer + 15s cooldown                                                                              |
| `cursorRuleInjection.ts`                                                | 全量 Cursor PROCESS-NAME + DOMAIN → 🎯 Cursor 专用；可选 path-scoped AND 规则                                                                                         |
| `cursorNetworkOptimize.ts`                                              | Cursor DNS/TUN/keepalive 优化                                                                                                                                         |
| `fakeIpRoutingIntegrity.ts`                                             | fake-ip 路由一致性：剥离 198.18 CIDR 陷阱、Tier0/Tier1 filter、sniffer 完整性                                                                                         |
| `proxyHealthMonitor.ts`                                                 | SG/TW/JP failover（🎯 Cursor 专用，api2 测速）；**Marathon quiesce active 全暂停**（含 exit hysteresis 60s）                                                         |
| `mihomoApi.ts`                                                          | mihomo REST 封装（delay 经 mihomoProbeCoordinator gate **除 marathon_rescue** BUG-015；Resource not found → provider leaf BUG-012/014；L2 fake-ip flush BUG-013） |
| `mihomoProxyDelayCore.ts`                                               | **BUG-012/014/015** isMihomoApiResourceNotFoundError · resolveProviderNameForLeaf · isMarathonRescueDelayPurpose · shouldBypassMihomoDelayProbeSlot |
| `cursorDedicatedDefault.ts`                                             | 启动恢复手选；无手选时默认 **`JP-VPS-TLS`**（trusted standard TLS）；Reality/HY2/TUIC 标 suboptimal，禁止自动回落 |
| `providerHealthCheckCore.ts`                                            | 商用 provider health-check URL（generate_204）                                                                                                                        |
| `vpsProviderSplitCore.ts`                                               | VPS/commercial partition；`{profileId}-vps` provider；api2 health-check                                                                                               |
| `mihomoProviderDelayCore.ts` / `providerDelayHistoryDisplayCore.ts`            | provider leaf delay 历史：取最近成功样本；**P9n** 柱图剔除 session_nudge（ledger SSOT）                                                                               |
| `factory.ts`                                                            | runtime config 生成；**`patchRuntimeProxyProviderHealthCheckEnable`**（P9 health-check 热 patch）                                                                       |
| `../utils/formatUnknownErrorForLog.ts`                                  | mihomo catch 值 JSON 序列化（nudge/keepalive failed 路径；**≥1.26.61**）                                                                                              |

## 节点质量数据流

```
api2ProbePlane (PostCoreBootstrap 单一入口)
  → networkStabilityMonitor (60s active transport_pair)
  → vpsL4Probe (300s SSH L4 curl → scope=vps)
  → ~/.sparkle/api2-probe-ledger.jsonl
      scope=active → Guard API探针列 / 代理裁决
      scope=vps    → SSH L4 **JP**（method=ssh_curl）+ nodeProbeStats

cursorTransportHealth (hung_scan 30s / hung≥12min / keep-newest-6 / transport_recovery)
  → network-stability-events.jsonl + vps_node_snapshots（CTHC 单点：latest-success delay，≠ UI 测速记录 history[-8]）
```

## Transport 观测数据流（P16–P18）

```
agentTransportFailureSync → ~/.sparkle/agent-transport-failures.jsonl
  ↑ connectPingStormCore（Diagnostic defer×2 + VpsL4 ok → synthetic partition）
cursorStructuredTransportIngestCore ← Cursor/logs Structured tail（P17）
  → transportObservabilityMergeCore（P18 dedupe）
  → connectPartitionReader.readConnectPartitionSignalAsync
  → marathonTransportDialOrchestrator
       ├ connect_partition / latency_delta_rescue（P16b · delta≥15s + 短 HTTP 绿）
       └ UltraConnObservability @ conn>500（P16c 节流日志）
```

## Badge 规则

- VPS combined 第一 **且** 通过 gate：success≥95%、slow>500ms≤15%、jitter≤150ms
- 未通过 gate → 无 UI badge（`markersByNode` 为空）；需 `commercialNodeBenchmarkEnabled=true`（默认 true）
- 节点 hover 详情弹窗由 `showProxyDetailTooltip` 控制（默认 true）；见 [proxies/_ARCH.md](../../renderer/src/components/proxies/_ARCH.md)

## App 配置路径

| 路径 | 内容 |
|------|------|
| `~/Library/Application Support/sparkle/config.yaml` | UI 与行为开关（含上述 opt-in） |
| `~/.sparkle/api2-probe-ledger.jsonl` | 探针 ledger（与 app 配置目录分离） |

修改 `config.yaml` 后须完全退出并重启 Sparkle 方生效（主进程内存缓存）。

## 测试

```bash
pnpm run test:node-quality   # 含 marathonQuiesceCore.test.ts 14/14 · marathonCoreRestartGuardCore.test.ts · coreReadyTimestamp.bundle.test.ts · upgradeSparkleAsarGateCore.test.ts
pnpm run upgrade:mac         # 本地装 /Applications + PostCoreBootstrap 门控（网络失败：SKIP_PREPARE=1）
```

## 构建标识（UI）

| 路径 | 职责 |
|------|------|
| `scripts/writeBuildStampCore.ts` | `YYYY.MMDD.HHMM` 格式 SSOT |
| `scripts/write-build-stamp.ts` | 写入 `src/shared/buildStamp.ts`（`dev` / `build:*` / upgrade 前） |
| `src/shared/buildStamp.ts` | 生成物：`SPARKLE_BUILD_STAMP` + `SPARKLE_SEMVER` |
| `src/main/utils/ipc.ts` | `getBuildStamp` IPC |
| `src/renderer/src/pages/proxies.tsx` | 代理组标题旁 Chip 展示 build stamp |

详见 [src/shared/_ARCH.md](../shared/_ARCH.md)。
