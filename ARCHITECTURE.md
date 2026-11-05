# Sparkle — 系统架构

Electron 桌面代理 GUI，主进程驱动 mihomo 内核；`自动选择` 按地区优先级与延迟选节点（延迟快照仅在 provider 指纹一致且成功覆盖 ≥80% 时复用，否则启动补测）；`🎯 Cursor 专用` 与 Cursor 路由规则固定 Cursor 流量；`📧 邮件专用` 经 Sparkle 侧 993/465 真实探测筛节点（全量入库 + 当前节点按需复测）后承载 macOS Mail 等海外 IMAP/SMTP；AI API 端点（`api.commandcode.ai` / `opencode.ai` / `open-design.ai`）在无人指定规则时**默认直连**。

## 模块导航

| 路径                                                                                          | 职责                                                                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [src/main/core/\_ARCH.md](src/main/core/_ARCH.md)                                             | 主进程核心：mihomo 控制、配置生成、自动选择延迟序、Cursor / 邮件专用组与规则 |
| [src/renderer/src/components/proxies/\_ARCH.md](src/renderer/src/components/proxies/_ARCH.md) | 代理页 UI、节点详情弹窗、build stamp                                         |
| [src/shared/\_ARCH.md](src/shared/_ARCH.md)                                                   | 跨进程类型与构建标识                                                         |
| [BUGFIX_LOG.md](BUGFIX_LOG.md)                                                                | 网络/安装缺陷台账与 ship 门禁记录                                            |
| [scripts/\_ARCH.md](scripts/_ARCH.md)                                                         | 构建/安装/验收脚本（含 Agent SSOT `agent-sparkle-upgrade.sh`）               |

## 进程与数据流

```
Renderer (React)
  ↔ preload ↔ Main (Electron)
                  ├ manager.ts — mihomo 生命周期
                  ├ factory.ts — runtime config 生成（provider / 分组 / 规则 / DNS）
                  └ postCoreBootstrap.ts — 自动组零死锁对齐与守护 · 延迟序 · 自动选择粘性固定 · 邮件端口探测（全量补测 + 当前节点按需复测） · 订阅更新 · Cursor 默认节点 · 地区组按需预热

mihomo (TUN) → 节点 leaf → 目标站点
```

## 架构约束

1. **Cursor 专用组仅手动选择** — `🎯 Cursor 专用` 只接受 `manual` / `bootstrap` 来源的切换，任何自动逻辑不得改写。
2. **`自动选择` 粘性固定与真实地区解锁** — 它是 `fallback` 组，按 `sparkle-fast` 的文件顺序选出首个存活节点后由 `autoSelectStickyPin` 固定（pin），固定前除检查 mihomo 存活外还经 `sparkleGeminiProbe` 流式校验 `gemini.google.com` 的 `vXmutd` 地区码（剔除返回 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或 `www.google.cn` 的“送中”节点），固定期间按 5 分钟节流复核、节点变化立即复核；只有当前节点真挂掉或被确认为地区受限时才换（丢固定时先做单点独立 Gemini 复测过滤并发体检偶发超时，10 分钟内再次丢固定则放行切换），高优先级节点恢复不回切；周期重排只改 provider 文件序，不解除固定，启动重排仅在原固定节点不在实测存活表内时解除；同时作为自动切换组纳入 `autoSwitchGroupIntegrity` 守护，节点失活时秒级熔断解钉。
3. **安装 SSOT** — macOS 仅 `/Applications/Sparkle.app`（`pnpm run agent:upgrade:mac` / `upgrade:mac`）；禁止 ditto 覆盖、禁止 Agent 裸 `pnpm build:mac`。
4. **Ship 定义** — git HEAD = 已安装 semver，且装后 PostCoreBootstrap 日志出现 `mihomo API ready`。
5. **邮件端口与 mihomo 探测分离** — 海外邮件客户端域名走 `📧 邮件专用`；成员须通过 Sparkle 主进程 `imap.gmail.com:993` + `smtp.gmail.com:465` TLS 校验入库，**不得**用 mihomo 健康检查（`url-test` / `fallback`）直接探测 IMAPS URL（HTTP 客户端误判）或仅用 `mail.google.com:443` 代替（筛不掉封 993/465 的节点）。`📧 邮件专用` 为 `fallback`：按 provider 的地区优先级（台湾 → 日本 → 韩国 → 新加坡 → 美国 → 其余）取首个存活节点，与 `自动选择` 一致；当前节点只在邮件组最近被使用时复测 993/465，失败后 provider 成员集合变化时热重载并触发切换，完全未使用邮件时不做端口探测。
6. **浏览器 UDP 不得绕过代理出口** — `factory.ts` 在规则链最前端注入 `quicTrafficRuleInjection`：UDP 443 与 `stun.cloudflare.com` 一律 `REJECT`。节点缺 `udp: true` 时 mihomo 会把 UDP 回落 `DIRECT`，与 TCP 的代理出口形成双 IP 分裂，被 Cloudflare 判定异常；阻断后浏览器按 RFC 9114 回退 HTTP/2 over TCP，出口单一。
7. **内置规则只补缺省，覆写与订阅优先** — `aiApiDirectRules` 这类默认直连规则只在目标域名**没有任何规则命中**时前置（命中按 mihomo 语义判断 `DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD`）；覆写（全局/单订阅）在 `generateProfile` 首步生效，用户或订阅一旦对这些域名表过态，内置默认必须让路。`work/config.yaml` 是生成物，禁止手改。
8. **分组展示顺序固定** — `proxyGroupOrder` 在写盘前统一排序：`自动选择` → 三个专用组（`🎯 Cursor 专用` / `📧 邮件专用` / `🎯 agy 专用`，隐藏探测组 `__sparkle_mail_probe__` 紧随邮件组）→ `Sparkle-<地区>` → 其余；同档位保持订阅原顺序，代理页按该顺序渲染。
9. **延迟快照必须可验证** — `sparkle-fast-delays.json` 只保存带 `providerFingerprint` 的 v2 快照；加载时指纹必须匹配当前 provider 配置，且成功样本覆盖率必须 ≥80%。旧格式、配置变化、覆盖不足一律视为无快照并强制逐点补测，禁止用残缺/过期样本跳过探测。
10. **合并订阅不得丢失来源 DNS** — 来源订阅自带 `dns.proxy-server-nameserver`（如 YYSSR 的 carrier DoH）时，合并结果必须按来源节点 `server` 域名写入 `proxy-server-nameserver-policy`；只对来源自身域名生效，base 的 DNS 不得覆盖来源节点入口解析。
11. **agy 探测必须绑定出口** — `🎯 agy 专用` 的地域结论只能来自「真实 agy 请求 + 该请求确实从被测节点出去」：mihomo `select` 只影响新建连接，magpie 的 HTTP/2 长连接会复用旧出口，因此任何切组后必须 `mihomoCloseConnections('🎯 agy 专用')`，连接清不掉就记 `unknown` 不写缓存。巡检顺序固定为「pin 就地复测（5min，不切组，30s 超时）→ 400 同节点二次确认 / 超时连续两轮才做修复扫描（严格地区优先 台湾→日本→韩国→新加坡→美国→其余、15s 超时、12 个上限、5min 预算、第一个 200 立即停；15 分钟内试过的节点（含超时）降级到「已尝试」组，保证下一轮先试未试候选、防饿死）」，禁止再用定期全量切换把生产流量拖到候选节点上。代理页对 `🎯 agy 专用` 只展示真实 agy 实测（rtt + 距上次实测时间），不展示 gstatic 网络延迟、不提供该组手动测速。
12. **自动切换组零死锁（零默认锁定 + 节点失活秒级自愈熔断）** — 覆盖「自动选择」与所有「Sparkle-<地区> / URLTest」自动选路组：
    - **启动与重载纯净对齐**：Mihomo 内核在 `store-selected: true` 下会把历史选点读回为 `fixed`（死锁）。系统在 `postCoreBootstrap` 启动就绪及订阅热重载（`reloadMihomoProfileProviders`）后自动执行 `reconcileAutoSwitchGroupsOnStartup`，强制清理来自 `cache.db` 的 `fixed` 锁定，确保自动组在冷启动与重载后**永远默认保持原生自动选路**。
    - **病态死锁自愈熔断看门狗**：`autoSwitchGroupIntegrity` 提供 10s 守护循环，一旦检测到任何自动切换组（含 `自动选择`）处于 `fixed` 锁定且当前固定节点失活（`delay === 0` 或 `alive: false`）或成为孤儿节点，看门狗立即执行 `mihomoUnfixedProxy` 熔断死锁、关断僵死连接并触发策略组健康测速切换，彻底封死“节点失效却死锁不换”的故障。
    - **交互可逆**：代理页 `ProxyItem` 对已处于锁定状态的卡片支持点击一键解钉（Toggle Off），杜绝误触后无法自愈。

## 外部依赖

| 组件           | 用途                             |
| -------------- | -------------------------------- |
| Mihomo         | 代理内核、连接池、provider delay |
| sing-box @ VPS | 入站 Reality / HY2 / TUIC        |
