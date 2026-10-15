# Sparkle — 系统架构

Electron 桌面代理 GUI，主进程驱动 mihomo 内核；`自动选择` 按地区优先级与延迟选节点，`🎯 Cursor 专用` 组与 Cursor 路由规则把 Cursor 流量固定到手选节点。

## 模块导航

| 路径 | 职责 |
|------|------|
| [src/main/core/_ARCH.md](src/main/core/_ARCH.md) | 主进程核心：mihomo 控制、配置生成、自动选择延迟序、Cursor 专用组与规则 |
| [src/renderer/src/components/proxies/_ARCH.md](src/renderer/src/components/proxies/_ARCH.md) | 代理页 UI、节点详情弹窗、build stamp |
| [src/shared/_ARCH.md](src/shared/_ARCH.md) | 跨进程类型与构建标识 |
| [BUGFIX_LOG.md](BUGFIX_LOG.md) | 网络/安装缺陷台账与 ship 门禁记录 |
| [scripts/_ARCH.md](scripts/_ARCH.md) | 构建/安装/验收脚本（含 Agent SSOT `agent-sparkle-upgrade.sh`） |

## 进程与数据流

```
Renderer (React)
  ↔ preload ↔ Main (Electron)
                  ├ manager.ts — mihomo 生命周期
                  ├ factory.ts — runtime config 生成（provider / 分组 / 规则 / DNS）
                  └ postCoreBootstrap.ts — 延迟序 · 订阅更新 · Cursor 默认节点 · 地区组预热

mihomo (TUN) → 节点 leaf → 目标站点
```

## 架构约束

1. **Cursor 专用组仅手动选择** — `🎯 Cursor 专用` 只接受 `manual` / `bootstrap` 来源的切换，任何自动逻辑不得改写。
2. **`自动选择` 粘性固定** — 它是 `fallback` 组，按 `sparkle-fast` 的文件顺序选出首个存活节点后由 `autoSelectStickyPin` 固定（pin），只有该节点挂掉才换，高优先级节点恢复不回切；周期重排只改 provider 文件序，不解除固定，仅启动重排解除。
3. **安装 SSOT** — macOS 仅 `/Applications/Sparkle.app`（`pnpm run agent:upgrade:mac` / `upgrade:mac`）；禁止 ditto 覆盖、禁止 Agent 裸 `pnpm build:mac`。
4. **Ship 定义** — git HEAD = 已安装 semver，且装后 PostCoreBootstrap 日志出现 `mihomo API ready`。

## 外部依赖

| 组件 | 用途 |
|------|------|
| Mihomo | 代理内核、连接池、provider delay |
| sing-box @ VPS | 入站 Reality / HY2 / TUIC |
