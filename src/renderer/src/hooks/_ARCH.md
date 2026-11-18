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
| `use-dedicated-group-switches.ts` | 专用组开关：从应用配置解析四个开关，`setEnabled` 经 `patchAppConfig` 落盘并等主进程重载完成后刷新分组；切换期间该组标记为「进行中」（防重入、开关禁用）且展示值立即翻到目标值，结束后回到已保存的值，失败由 `patchAppConfig` 统一提示 |
| `use-proxy-group-state.ts` | 代理页分组的展开 / 搜索 / 测速中状态（与分组列表下标对齐，仅在分组数量变化时重对齐），含跨页缓存与展开记忆 |
| `use-proxy-group-delay-test.ts` | 代理页单节点 / 整组测速：按「测速地址范围」决定探针 URL，整组测速先展开该组、结束后刷新代理组；返回稳定的 `onProxyDelay` / `onGroupDelay` |
| `use-proxy-group-locate.ts` | 「定位当前节点」：目标组未展开时先展开，内容渲染完成后平滑滚动到该节点所在行 |
| `use-proxy-columns.ts` | 代理页节点网格列数：固定列数取配置值，`auto` 时按视口宽度断点计算并随窗口缩放更新 |
| `use-latest.ts` | 「最新值」ref，让回调保持稳定引用而不读到过期闭包 |
| `use-override-config.tsx` | 覆写配置 Provider/订阅 |
| `use-pending-action.ts` | 开关「进行中」状态：`run(target)` 执行异步动作期间 `pendingTarget` 为目标值（界面展示值先翻过去），ref 防重入，结束后（成败都）清空；虚拟网卡与系统代理开关用它，`use-dedicated-group-switches.ts` 有同类的自有实现 |
| `use-probe-warmup.ts` | 内核启动测速预热标志（IPC 事件 + 首拉） |
| `use-profile-config.tsx` | 订阅配置 Provider/订阅 |
| `use-rules.tsx` | 规则数据源：轮询 `mihomoRules`，暴露 `mutate` |

## 依赖

- `@renderer/utils/ipc` — 主进程能力桥
- `@sparkle-core/*` — 主进程共享的纯函数/类型
