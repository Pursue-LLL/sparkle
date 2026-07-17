# src/main/core — 模块架构

Electron 主进程核心：mihomo 控制、Cursor 网络优化、节点探测与稳定性监控。

用户可感知网络僵死 / TUN 恢复缺陷台账：[BUGFIX_LOG.md](../../BUGFIX_LOG.md)（例：BUG-2026-07-09-001 mihomo 出站池僵死）。

## 文件清单

| 文件 | 职责 |
| --- | --- |
| `api2ProbePlane.ts` | 单一 bootstrap：active 60s + VPS L4 SSH 300s → api2-probe-ledger.jsonl |
| `vpsL4ProbeCore.ts` / `vpsL4Probe.ts` | VPS SSH curl（kr-vps/jp-vps）→ ledger scope=vps |
| `canonicalVpsNodeSnapshotCore.ts` | 从 provider history 采集 6 节点 snapshot（CTHC events） |
| `networkTriangulationDiagnosticCore.ts` | 定责探测：KR/JP Reality + active Cursor 节点 + marketplace |
| `api2ProbeLedgerCore.ts` | api2 探针统一 ledger 读写（scope=active/vps/marathon） |
| `nodeQualityScore.ts` | 纯函数：Probe/Session 分层评分、badge 门槛常量 |
| `nodeProbeStats.ts` | ledger vps 样本聚合 → DerivedStats |
| `commercialNodeBenchmark.ts` | 24h VPS 报告（ledger scope=vps SSH + active）、UI snapshot IPC |
| `networkStabilityMonitor.ts` | 当前节点 short probe、TUN 恢复（委托 CTHC）；非 probe 事件 jsonl |
| `cursorTransportHealthCore.ts` | 纯函数：挂死检测（**≥12min** 零吞吐）、split-brain 归因、恢复阶梯；L0 每 (process,host) **保留最新 6 条** hung 连接 |
| `cursorTransportHealth.ts` | CTHC 执行器：30s 挂死扫描、L0–L3 恢复动作 |
| `mihomoProbeCoordinator.ts` | 全局 mihomo delay 槽（max 2）与商业 batch 并发 cap |
| `cursorRuleInjection.ts` | 全量 Cursor PROCESS-NAME + DOMAIN → 🎯 Cursor 专用；可选 path-scoped AND 规则 |
| `cursorNetworkOptimize.ts` | Cursor DNS/TUN/keepalive 优化 |
| `fakeIpRoutingIntegrity.ts` | fake-ip 路由一致性：剥离 198.18 CIDR 陷阱、Tier0/Tier1 filter、sniffer 完整性 |
| `proxyHealthMonitor.ts` | SG/TW/JP failover（🎯 Cursor 专用，api2 测速） |
| `mihomoApi.ts` | mihomo REST 封装（delay 经 mihomoProbeCoordinator gate；provider leaf 走 healthcheck fallback） |
| `cursorDedicatedDefault.ts` | 启动回 VPS Reality 默认（JP 优先）；TUIC/HY2 标 suboptimal |
| `providerHealthCheckCore.ts` | VPS provider health-check URL → api2.cursor.sh |
| `mihomoProviderDelayCore.ts` | provider leaf delay 历史：取最近成功样本，跳过尾部 timeout |

## 节点质量数据流

```
api2ProbePlane (PostCoreBootstrap 单一入口)
  → networkStabilityMonitor (60s active transport_pair)
  → vpsL4Probe (300s SSH L4 curl → scope=vps)
  → ~/.sparkle/api2-probe-ledger.jsonl
      scope=active → Guard API探针列 / 代理裁决
      scope=vps    → SSH L4 KR/JP（method=ssh_curl）+ nodeProbeStats

cursorTransportHealth (hung_scan 30s / hung≥12min / keep-newest-6 / transport_recovery)
  → network-stability-events.jsonl + vps_node_snapshots（6 节点 provider history）
```

## Badge 规则

- VPS combined 第一 **且** 通过 gate：success≥95%、slow>500ms≤15%、jitter≤150ms
- 未通过 gate → 无 UI badge（`markersByNode` 为空），tooltip 仍可通过 `scoresByNode` 查看指标

## 测试

```bash
pnpm run test:node-quality
```
