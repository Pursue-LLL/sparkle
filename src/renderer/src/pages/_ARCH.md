# src/renderer/src/pages — 渲染进程页面

各功能页的容器组件：组合 `components/*` 与 `hooks/*`，通过 `@renderer/utils/ipc` 调用主进程能力。

## 文件清单

| 文件 | 职责 |
|------|------|
| `proxies.tsx` | 代理组页面：分组渲染、节点选择、手动测速、`🎯 agy 专用` / `grok 专用` 真实实测展示、设置抽屉 |
| `connections.tsx` | 连接列表、过滤、详情与关闭 |
| `rules.tsx` | 分流规则列表与启用开关 |
| `resources.tsx` | 外部资源（proxy provider / rule provider） |
| `profiles.tsx` | 订阅管理（导入、更新、切换、覆写入口） |
| `override.tsx` | 全局 / 单订阅覆写编辑 |
| `logs.tsx` | 实时日志（mihomo / 应用） |
| `mihomo.tsx` | 内核设置（模式、端口、日志级别等） |
| `settings.tsx` | 应用设置（外观、通用、Agent 等） |
| `syspeoxy.tsx` | 系统代理设置 |
| `tun.tsx` | 虚拟网卡（TUN）设置 |
| `dns.tsx` | DNS 设置 |
| `sniffer.tsx` | 域名嗅探设置 |
| `substore.tsx` | Sub-Store 管理页 |

## 依赖

- `@renderer/components/*` — 通用组件与业务卡片
- `@renderer/hooks/*` — 配置 / 代理组 / agy 快照等响应式数据
- `@renderer/utils/ipc` — 主进程能力桥
