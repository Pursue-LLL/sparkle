# src/renderer/src/utils — 渲染进程工具

渲染进程的纯函数、格式化与 IPC 封装；不持有 React 状态。

## 文件清单

| 文件 | 职责 |
|------|------|
| `advanced-filter.ts` | 高级过滤器表达式编译与匹配（日志/连接） |
| `agy-probe-display.ts` | agy 真实请求实测的格式口径：`rttMs` → 秒级文案 / 色调；无样本显示「未测」 |
| `calc.ts` | 流量/百分比格式化 |
| `connection-filter-autocomplete.ts` | 连接过滤输入框的补全建议 |
| `cursor-proxy-groups.ts` | Cursor / Sparkle 组名、各组的延迟探针地址与显示名解析 |
| `debounce.ts` | 防抖 |
| `delay-test.ts` | 代理页批量测速的并发控制 |
| `driver.ts` | driver.js 新手引导 |
| `env.d.ts` | 渲染进程环境类型 |
| `format-unknown-error.ts` | 未知错误 → 可展示文案 |
| `hash.ts` | MD5 字符串哈希（provider 缓存路径等） |
| `image.ts` | Canvas / 图片取色与 group icon 处理 |
| `includes.ts` | 忽略大小写的包含判断 |
| `init.ts` | 启动初始化：platform / version / buildStamp |
| `ipc.ts` | 渲染进程 IPC 唯一入口（mihomo、配置、agy 快照等） |
| `mihomo-log-store.ts` | 内核日志的内存存储与订阅 |
| `notification.ts` | 应用通知 / Toast |
| `proxy-delay-sample-age.ts` | 延迟样本年龄、tooltip 文案：当前失败如实写「最近一次测速失败」，历史成功值只作「N分前成功」溯源，不冒充当前延迟 |
| `routingIntegrity.ts` | 连接路由完整性不一致检测与提示 |
| `validate.ts` | IPv4 / IPv6 等输入校验 |
| `*.test.ts` | 对应纯函数的 `node:test` 单测（agy / cursor 组 / 延迟测试 / 错误格式化 / 延迟样本年龄） |

## 依赖

- `@renderer/utils/ipc` — 主进程能力桥（`ipc.ts` 自身）
- `@sparkle-core/*` — 主进程共享的纯函数/类型
- `@shared/buildStamp` — 构建标识（`init.ts`）
