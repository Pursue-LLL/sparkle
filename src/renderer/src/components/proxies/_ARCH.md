# src/renderer/src/components/proxies — 模块架构

代理页 UI：节点卡片、测速控件、悬停详情弹窗、代理页设置抽屉。

## AppConfig 开关

| 配置键 | 默认值 | 行为 |
|--------|--------|------|
| `showProxyDetailTooltip` | `true` | hover **600ms** → 详情弹窗（测速柱图等） |
| `showGroupSelectedProxy` | `false` | 代理组显示 `→ 当前子节点` |
| `commercialNodeBenchmarkEnabled` | `false` | 24h benchmark / Agent badge（**只读 ledger，不发探测**） |
| `rememberProxyGroupOpenState` | `false` | 记住代理组展开状态 |

配置 SSOT：`~/Library/Application Support/sparkle/config.yaml`（`src/main/utils/template.ts` 默认值）。修改磁盘上的 yaml 后须**完全退出并重启** Sparkle；UI 内 Switch 经 `patchAppConfig` 即时生效。

## 文件清单

| 文件 | 职责 |
|------|------|
| `proxy-item.tsx` | 节点卡片；测速按钮；条件绑定 hover/touch → 详情弹窗 |
| `proxy-detail-tooltip.tsx` | Portal 浮层：mihomo history / ledger 柱图、latency truth 双轨、benchmark 区块 |
| `proxy-setting-drawer.tsx` | 代理页设置抽屉（含上述 Switch） |

## 详情弹窗数据源

`proxy-detail-tooltip.tsx` 柱图优先级：

1. `getProviderDelayHistoryFromLedger`（`transport_pair` · Mac 全路径）
2. 否则 mihomo `proxy.history[-8]`，经 marathon 过滤并剔除 session_nudge 锚点
3. Marathon quiesce 时显示 **Marathon 静默** badge；柱图空时可读 ledger 回填

IPC：`getRecentSessionNudgeAnchorsForNode` · `getProviderDelayHistoryFromLedger` · `getLatencyTruthSummaryForNode`（主进程 `api2ProbeLedgerCore.ts` · `latencyTruthFromLedgerCore.ts`）。

## 依赖

- `@renderer/hooks/use-commercial-node-stability` — badge / tooltip 稳定性文案
- `@renderer/utils/proxy-delay-sample-age` — 测速样本年龄、柱图过滤
- `@renderer/pages/proxies.tsx` — 列表容器，传入 `showProxyDetailTooltip` 等 props
