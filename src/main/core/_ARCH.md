# src/main/core — 模块架构

Electron 主进程核心：mihomo 控制、Cursor 网络优化、节点探测与稳定性监控。

用户可感知网络僵死 / TUN 恢复缺陷台账：[BUGFIX_LOG.md](../../BUGFIX_LOG.md)（例：BUG-2026-07-09-001 mihomo 出站池僵死）。

## 文件清单

| 文件 | 职责 |
| --- | --- |
| `api2ProbePlane.ts` | 单一 bootstrap：active 60s + VPS batch → api2-probe-ledger.jsonl |
| `api2ProbeLedgerCore.ts` | api2 探针统一 ledger 读写（scope=active/vps/marathon） |
| `nodeQualityScore.ts` | 纯函数：Probe/Session 分层评分、badge 门槛常量 |
| `nodeProbeStats.ts` | ledger vps 样本聚合 → DerivedStats |
| `commercialNodeBenchmark.ts` | VPS canonical 60s 探测、24h VPS 报告、UI snapshot IPC |
| `networkStabilityMonitor.ts` | 当前节点 short probe、TUN 恢复（委托 CTHC）；非 probe 事件 jsonl |
| `cursorTransportHealthCore.ts` | 纯函数：挂死检测、split-brain 归因、恢复阶梯决策 |
| `cursorTransportHealth.ts` | CTHC 执行器：30s 挂死扫描、L0–L3 恢复动作 |
| `mihomoProbeCoordinator.ts` | 全局 mihomo delay 槽（max 2）与商业 batch 并发 cap |
| `cursorRuleInjection.ts` | 3.1.15 路径 scoped 专用组；其他 Cursor 安装 PROCESS-NAME → 节点选择 |
| `cursorNetworkOptimize.ts` | Cursor DNS/TUN/keepalive 优化 |
| `fakeIpRoutingIntegrity.ts` | fake-ip 路由一致性：剥离 198.18 CIDR 陷阱、Tier0/Tier1 filter、sniffer 完整性 |
| `proxyHealthMonitor.ts` | SG/TW/JP failover（🎯 Cursor 3.1.15 专用，api2 测速） |
| `mihomoApi.ts` | mihomo REST 封装（delay 经 mihomoProbeCoordinator gate） |

## 节点质量数据流

```
api2ProbePlane (PostCoreBootstrap 单一入口)
  → networkStabilityMonitor (60s active transport_pair)
  → commercialNodeBenchmark (VPS canonical 60s mihomo_delay batch)
  → ~/.sparkle/api2-probe-ledger.jsonl
      scope=active → Guard API探针列 / 代理裁决
      scope=vps    → nodeProbeStats.buildStats + nodeQualityScore（不影响 active 节点评分）

networkStabilityMonitor (TUN/offline/recovery 等非 probe 事件)
  → ~/.sparkle/network-stability-events.jsonl
  → ~/.sparkle/agent-transport-failures.jsonl (agentRST)
  → nodeProbeStats.buildNodeTransportStats → session 层加减分（仅真实观测）
```

## Badge 规则

- VPS combined 第一 **且** 通过 gate：success≥95%、slow>500ms≤15%、jitter≤150ms
- 未通过 gate → 无 UI badge（`markersByNode` 为空），tooltip 仍可通过 `scoresByNode` 查看指标

## 测试

```bash
pnpm run test:node-quality
```
