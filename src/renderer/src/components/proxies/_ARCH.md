# src/renderer/src/components/proxies — 模块架构

代理页 UI：节点卡片、测速控件、悬停详情弹窗、代理页设置抽屉。

## AppConfig 开关

| 配置键 | 默认值 | 行为 |
|--------|--------|------|
| `showProxyDetailTooltip` | `true` | hover **600ms** → 详情弹窗（测速柱图等） |
| `showGroupSelectedProxy` | `false` | 代理组显示 `→ 当前子节点` |
| `rememberProxyGroupOpenState` | `false` | 记住代理组展开状态 |

配置 SSOT：`~/Library/Application Support/sparkle/config.yaml`（`src/main/utils/template.ts` 默认值）。修改磁盘上的 yaml 后须**完全退出并重启** Sparkle；UI 内 Switch 经 `patchAppConfig` 即时生效。

## 文件清单

| 文件 | 职责 |
|------|------|
| `proxy-item.tsx` | 节点卡片；测速按钮；条件绑定 hover/touch → 详情弹窗（agy/grok 组不绑定、分别改用 `agy-delay-control.tsx` / `grok-delay-control.tsx`）；对已锁定节点支持点击卡片/图钉一键解钉（Toggle Off）恢复自动优选 |
| `proxy-item.tsx` 延迟显示 | 经 `judgeProxyForUrl(proxy, probeUrl)` 判定：最新一次失败诚实显示「超时」，近期成功过在悬停与小标提供「N分前成功」客观溯源，绝不把旧延迟当成当前有效数值展示；`📧 邮件专用` 的 993/465 真实故障切换由主进程按需探测负责 |
| `probe-delay-control.tsx` | 应用层实测 Chip 的共同外壳：短文案 + 色调 + tooltip + 样本年龄；不参与口径换算 |
| `agy-delay-control.tsx` | `🎯 agy 专用` 组的延迟展示：只显示**真实 agy 结论**：可用显示秒级 + 距上次探测时间，失败显示「失败」+ 原因，锁区显示「锁区」，未探测显示「—」；该组组头显示「agy 实测」、隐藏 group 手动测速按钮、不渲染 mihomo 详情弹窗/柱图，避免用 gstatic 网络 RTT 冒充 agy 响应时间 |
| `grok-delay-control.tsx` | `grok 专用` 组的延迟展示：只显示**真实 grok.com HEAD 结论**：200 显示毫秒 + 样本年龄，403 显示「403」（Cloudflare 挑战），超时显示「超时」，未探测显示「—」；该组组头显示「grok 实测」、隐藏会误判 403 的 mihomo 手动测速、不渲染 mihomo 详情弹窗 |
| `probe-warmup-chip.tsx` | 页头「测速预热中」提示；状态来自 `@renderer/hooks/use-probe-warmup`，窗口内 `proxy-item.tsx` 对无可信样本的节点显示 loading 而非「测试」/「超时」 |
| `proxy-detail-tooltip.tsx` | Portal 浮层：展示完整节点名（不省略，支持自适应折行）、该组探测地址上的测速柱图、探测地址、其它探测地址上的表现（区分「只对该地址不通」与「整个节点不通」）与存活状态 |
| `proxy-setting-drawer.tsx` | 代理页设置抽屉（含上述 Switch） |

## 详情弹窗数据源

`proxy-detail-tooltip.tsx` 柱图取 `resolveProbeRecord(proxy, probeUrl).history` 的最近 8 条；样本年龄与过滤由 `@renderer/utils/proxy-delay-sample-age` 提供。

## agy / grok 组数据源

`🎯 agy 专用` / `grok 专用` 不走 mihomo 的延迟样本：`useAgyProbeSnapshot` / `useGrokProbeSnapshot` 每 30s 经 IPC 读取主进程内存快照（`sparkleAgyProbe.ts` 的 `agyProbeSnapshot`、`sparkleGrokProbe.ts` 的 `grokProbeSnapshot`），节点卡片显示真实请求的 `rttMs` 与「N分前」；grok 的失败样本同时保留 HTTP 状态与原因（403 挑战 / 超时）。无样本显示「未测」/「—」。两组都不显示 mihomo 测速柱图与手动测速按钮。

## gemini专用 组数据源

`gemini专用` **不做任何渲染层特判**，走通用 `fallback` 组渲染：节点延迟直接来自 mihomo provider 的 `https://www.gstatic.com/generate_204` 健康检查样本，与它实际的选路口径一致（成员资格由主进程 vXmutd 地区探测决定，界面只展示存活与延迟）。因此该组保留通用的测速柱图与手动测速按钮。

## 依赖

- `@renderer/utils/proxy-delay-sample-age` — 测速样本年龄、柱图过滤
- `@renderer/utils/agy-probe-display` — agy 实测毫秒 → 秒级文案 / 色调
- `@renderer/utils/grok-probe-display` — grok 实测毫秒 / 403 / 超时 → 文案与色调
- `@renderer/hooks/use-agy-probe-snapshot` — agy 快照轮询
- `@renderer/hooks/use-grok-probe-snapshot` — grok 快照轮询
- `@renderer/pages/proxies.tsx` — 列表容器，传入 `showProxyDetailTooltip` 等 props
