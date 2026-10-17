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
| `proxy-item.tsx` 延迟显示 | 经 `judgeProxyForUrl(proxy, probeUrl)` 判定，`probeUrl` 为该组实际探测地址（`自动选择`/地区组为 Gemini，香港为 grok，`📧 邮件专用` 为 `mail.google.com`）：最近一次失败但近期成功过判「不稳定」，显示上次成功的延迟 + 「N分前成功」，窗口内一次都没成功才显示「超时」 |
| `probe-warmup-chip.tsx` | 页头「测速预热中」提示；状态来自 `@renderer/hooks/use-probe-warmup`，窗口内 `proxy-item.tsx` 对无可信样本的节点显示 loading 而非「测试」/「超时」 |
| `proxy-detail-tooltip.tsx` | Portal 浮层：该组探测地址上的测速柱图、探测地址、其它探测地址上的表现（区分「只对该地址不通」与「整个节点不通」）与存活状态 |
| `proxy-setting-drawer.tsx` | 代理页设置抽屉（含上述 Switch） |

## 详情弹窗数据源

`proxy-detail-tooltip.tsx` 柱图取 `resolveProbeRecord(proxy, probeUrl).history` 的最近 8 条；样本年龄与过滤由 `@renderer/utils/proxy-delay-sample-age` 提供。

## 依赖

- `@renderer/utils/proxy-delay-sample-age` — 测速样本年龄、柱图过滤
- `@renderer/pages/proxies.tsx` — 列表容器，传入 `showProxyDetailTooltip` 等 props
