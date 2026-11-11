# src/renderer/src/hooks — 渲染进程 hooks

React 状态订阅 hooks：把主进程配置 / 代理组 / 探测状态桥接为组件可用的响应式数据。

## 文件清单

| 文件 | 职责 |
|------|------|
| `use-agy-probe-snapshot.ts` | 30s 轮询主进程 `getSparkleAgyProbeSnapshot`，供代理页 `🎯 agy 专用` 展示真实 agy 请求实测；只读快照，不触发任何探测 |
| `use-grok-probe-snapshot.ts` | 30s 轮询主进程 `getSparkleGrokProbeSnapshot`，供代理页 `grok 专用` 展示真实 grok.com 请求实测；只读快照，不触发任何探测 |
| `use-app-config.tsx` | 应用配置 Provider/订阅（`getAppConfig` · `patchAppConfig`） |
| `use-card-dnd-sensors.ts` | 卡片拖拽的 dnd-kit sensors |
| `use-controled-mihomo-config.tsx` | mihomo 受控配置 Provider/订阅（模式/端口等） |
| `use-groups.tsx` | 代理组数据源：轮询 `mihomoGroups`，暴露 `mutate` |
| `use-override-config.tsx` | 覆写配置 Provider/订阅 |
| `use-probe-warmup.ts` | 内核启动测速预热标志（IPC 事件 + 首拉） |
| `use-profile-config.tsx` | 订阅配置 Provider/订阅 |
| `use-rules.tsx` | 规则数据源：轮询 `mihomoRules`，暴露 `mutate` |

## 依赖

- `@renderer/utils/ipc` — 主进程能力桥
- `@sparkle-core/*` — 主进程共享的纯函数/类型
