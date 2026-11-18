# src/renderer/src/hooks — 渲染进程 hooks

React 状态订阅 hooks：把主进程配置 / 代理组 / 探测状态桥接为组件可用的响应式数据。

## 文件清单

| 文件 | 职责 |
|------|------|
| `use-agy-probe-snapshot.ts` | 30s 轮询主进程 `getSparkleAgyProbeSnapshot`，供代理页 `🎯 agy 专用` 展示真实 agy 请求实测；只读快照，不触发任何探测 |
| `use-grok-probe-snapshot.ts` | 30s 轮询主进程 `getSparkleGrokProbeSnapshot`，供代理页 `grok 专用` 展示真实 grok.com 请求实测；只读快照，不触发任何探测 |
| `use-app-config.tsx` | 应用配置 Provider/订阅（`getAppConfig` · `patchAppConfig`） |
| `use-card-dnd-sensors.ts` | 卡片拖拽的 dnd-kit sensors |
| `use-controled-mihomo-config.tsx` | mihomo 受控配置 Provider/订阅（模式/端口等）；`patchControledMihomoConfig` 先把 `previewConfigPatch` 的预览写进 SWR 缓存（开关立即翻转），主进程处理完后重新读取真实配置，失败回滚并提示，返回「是否已生效」（失败时调用方不得接着重启内核） |
| `use-core-restarting.ts` | 订阅 `coreRestartGate` 的忙闲状态（`useSyncExternalStore`），供页头「内核重启中…」与虚拟网卡开关禁用 |
| `use-groups.tsx` | 代理组数据源：轮询 `mihomoGroups`，暴露 `mutate` |
| `use-override-config.tsx` | 覆写配置 Provider/订阅 |
| `use-pending-action.ts` | 开关「进行中」状态：`run(target)` 执行异步动作期间 `pendingTarget` 为目标值（界面展示值先翻过去），ref 防重入，结束后（成败都）清空；虚拟网卡与系统代理开关用它，`use-dedicated-group-switches.ts` 有同类的自有实现 |
| `use-probe-warmup.ts` | 内核启动测速预热标志（IPC 事件 + 首拉） |
| `use-profile-config.tsx` | 订阅配置 Provider/订阅 |
| `use-rules.tsx` | 规则数据源：轮询 `mihomoRules`，暴露 `mutate` |

## 依赖

- `@renderer/utils/ipc` — 主进程能力桥
- `@sparkle-core/*` — 主进程共享的纯函数/类型
