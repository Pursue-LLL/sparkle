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
| `proxy-item.tsx` | 节点卡片；测速按钮；条件绑定 hover/touch → 详情弹窗 |
| `probe-warmup-chip.tsx` | 页头「测速预热中」提示；状态来自 `@renderer/hooks/use-probe-warmup`，窗口内 `proxy-item.tsx` 对无可信样本的节点显示 loading 而非「测试」/「超时」 |
| `proxy-detail-tooltip.tsx` | Portal 浮层：mihomo `history` 测速柱图与样本年龄 |
| `proxy-setting-drawer.tsx` | 代理页设置抽屉（含上述 Switch） |

## 详情弹窗数据源

`proxy-detail-tooltip.tsx` 柱图取 mihomo `proxy.history[-8]`；样本年龄与过滤由 `@renderer/utils/proxy-delay-sample-age` 提供。

## 依赖

- `@renderer/utils/proxy-delay-sample-age` — 测速样本年龄、柱图过滤
- `@renderer/pages/proxies.tsx` — 列表容器，传入 `showProxyDetailTooltip` 等 props
