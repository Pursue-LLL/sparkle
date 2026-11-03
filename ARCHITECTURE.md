# Sparkle — 系统架构

Electron 桌面代理 GUI，主进程驱动 mihomo 内核；`自动选择` 按地区优先级与延迟选节点；`🎯 Cursor 专用` 与 Cursor 路由规则固定 Cursor 流量；`📧 邮件专用` 经 Sparkle 侧 993/465 真实探测筛节点后承载 macOS Mail 等海外 IMAP/SMTP；AI API 端点（`api.commandcode.ai` / `opencode.ai`）在无人指定规则时**默认直连**。

## 模块导航

| 路径 | 职责 |
|------|------|
| [src/main/core/_ARCH.md](src/main/core/_ARCH.md) | 主进程核心：mihomo 控制、配置生成、自动选择延迟序、Cursor / 邮件专用组与规则 |
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
                  └ postCoreBootstrap.ts — 延迟序 · 自动选择粘性固定 · 邮件端口探测 · 订阅更新 · Cursor 默认节点 · 地区组预热

mihomo (TUN) → 节点 leaf → 目标站点
```

## 架构约束

1. **Cursor 专用组仅手动选择** — `🎯 Cursor 专用` 只接受 `manual` / `bootstrap` 来源的切换，任何自动逻辑不得改写。
2. **`自动选择` 粘性固定与真实地区解锁** — 它是 `fallback` 组，按 `sparkle-fast` 的文件顺序选出首个存活节点后由 `autoSelectStickyPin` 固定（pin），固定前除检查 mihomo 存活外还经 `sparkleGeminiProbe` 流式校验 `gemini.google.com` 的 `vXmutd` 地区码（剔除返回 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或 `www.google.cn` 的“送中”节点），只有当前节点真挂掉或被确认为地区受限时才换（丢固定时先做单点独立 Gemini 复测过滤并发体检偶发超时，10 分钟内再次丢固定则放行切换），高优先级节点恢复不回切；周期重排只改 provider 文件序，不解除固定，启动重排仅在原固定节点不在实测存活表内时解除。
3. **安装 SSOT** — macOS 仅 `/Applications/Sparkle.app`（`pnpm run agent:upgrade:mac` / `upgrade:mac`）；禁止 ditto 覆盖、禁止 Agent 裸 `pnpm build:mac`。
4. **Ship 定义** — git HEAD = 已安装 semver，且装后 PostCoreBootstrap 日志出现 `mihomo API ready`。
5. **邮件端口与 mihomo 探测分离** — 海外邮件客户端域名走 `📧 邮件专用`；成员须通过 Sparkle 主进程 `imap.gmail.com:993` + `smtp.gmail.com:465` TLS 校验入库，**不得**用 mihomo `url-test` 直接探测 IMAPS URL（HTTP 客户端误判）或仅用 `mail.google.com:443` 代替（筛不掉封 993/465 的节点）。
6. **浏览器 UDP 不得绕过代理出口** — `factory.ts` 在规则链最前端注入 `quicTrafficRuleInjection`：UDP 443 与 `stun.cloudflare.com` 一律 `REJECT`。节点缺 `udp: true` 时 mihomo 会把 UDP 回落 `DIRECT`，与 TCP 的代理出口形成双 IP 分裂，被 Cloudflare 判定异常；阻断后浏览器按 RFC 9114 回退 HTTP/2 over TCP，出口单一。
7. **内置规则只补缺省，覆写与订阅优先** — `aiApiDirectRules` 这类默认直连规则只在目标域名**没有任何规则命中**时前置（命中按 mihomo 语义判断 `DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD`）；覆写（全局/单订阅）在 `generateProfile` 首步生效，用户或订阅一旦对这些域名表过态，内置默认必须让路。`work/config.yaml` 是生成物，禁止手改。
8. **分组展示顺序固定** — `proxyGroupOrder` 在写盘前统一排序：`自动选择` → 三个专用组（`🎯 Cursor 专用` / `📧 邮件专用` / `🎯 agy 专用`，隐藏探测组 `__sparkle_mail_probe__` 紧随邮件组）→ `Sparkle-<地区>` → 其余；同档位保持订阅原顺序，代理页按该顺序渲染。

## 外部依赖

| 组件 | 用途 |
|------|------|
| Mihomo | 代理内核、连接池、provider delay |
| sing-box @ VPS | 入站 Reality / HY2 / TUIC |
