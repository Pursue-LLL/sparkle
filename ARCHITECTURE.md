# Sparkle — 系统架构

Electron 桌面代理 GUI，主进程驱动 mihomo 内核；`自动选择` 按地区优先级与延迟选节点（延迟快照仅在 provider 指纹一致且成功覆盖 ≥80% 时复用，否则启动补测）；`🎯 Cursor 专用` 与 Cursor 路由规则固定 Cursor 流量；`📧 邮件专用` 经 Sparkle 侧 993/465 真实探测筛节点（全量入库 + 当前节点按需复测）后承载 macOS Mail 等海外 IMAP/SMTP；`grok 专用` 以 mixed-port 真实 HEAD 请求（200 且无 Cloudflare challenge）筛选可用出口并每 60 秒复核；AI API 端点（`api.commandcode.ai` / `opencode.ai` / `open-design.ai`）在无人指定规则时**默认直连**。

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
                  └ postCoreBootstrap.ts — 运行时配置对齐与自动组固定释放 · 延迟序 · 自动选择粘性固定 · 故障转移 · 邮件端口探测（全量补测 + 当前节点按需复测） · 订阅更新 · Cursor 默认节点 · 地区组按需预热

mihomo (TUN) → 节点 leaf → 目标站点
```

## 架构约束

1. **Cursor 专用组仅手动选择** — `🎯 Cursor 专用` 只接受 `manual` / `bootstrap` 来源的切换，任何自动逻辑不得改写。
2. **`自动选择` 粘性固定与真实地区解锁** — 它是 `fallback` 组，按 `sparkle-fast` 的文件顺序选出首个存活节点后由 `autoSelectStickyPin` 固定（pin），固定前除检查 mihomo 存活外还经 `sparkleGeminiProbe` 流式校验 `gemini.google.com` 的 `vXmutd` 地区码（剔除返回 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或 `www.google.cn` 的“送中”节点），固定期间按 5 分钟节流复核、节点变化立即复核；只有当前节点真挂掉或被确认为地区受限时才换（丢固定时先做单点独立 Gemini 复测过滤并发体检偶发超时，10 分钟内再次丢固定则放行切换），高优先级节点恢复不回切；周期重排只改 provider 文件序，不解除固定，启动重排仅在原固定节点不在实测存活表内时解除；内核启动或整配置重载后先由 `autoSwitchPinRelease` 释放缓存恢复的固定，粘性固定只在验证通过后重新建立（见第 12 条）。
3. **安装 SSOT** — macOS 仅 `/Applications/Sparkle.app`（`pnpm run agent:upgrade:mac` / `upgrade:mac`）；禁止 ditto 覆盖、禁止 Agent 裸 `pnpm build:mac`。
4. **Ship 定义** — git HEAD = 已安装 semver，且装后 PostCoreBootstrap 日志出现 `mihomo API ready`。
5. **邮件端口与 mihomo 探测分离** — 海外邮件客户端域名走 `📧 邮件专用`；成员须通过 Sparkle 主进程 `imap.gmail.com:993` + `smtp.gmail.com:465` TLS 校验入库，**不得**用 mihomo 健康检查（`url-test` / `fallback`）直接探测 IMAPS URL（HTTP 客户端误判）或仅用 `mail.google.com:443` 代替（筛不掉封 993/465 的节点）。`📧 邮件专用` 为 `fallback`：按 provider 的地区优先级（台湾 → 日本 → 韩国 → 新加坡 → 美国 → 其余）取首个存活节点，与 `自动选择` 一致；当前节点只在邮件组最近被使用时复测 993/465，失败后 provider 成员集合变化时热重载并触发切换，完全未使用邮件时不做端口探测。
6. **浏览器 UDP 不得绕过代理出口** — `factory.ts` 在规则链最前端注入 `quicTrafficRuleInjection`：UDP 443 与 `stun.cloudflare.com` 一律 `REJECT`。节点缺 `udp: true` 时 mihomo 会把 UDP 回落 `DIRECT`，与 TCP 的代理出口形成双 IP 分裂，被 Cloudflare 判定异常；阻断后浏览器按 RFC 9114 回退 HTTP/2 over TCP，出口单一。
7. **内置规则只补缺省，覆写与订阅优先** — `aiApiDirectRules` 这类默认直连规则只在目标域名**没有任何规则命中**时前置（命中按 mihomo 语义判断 `DOMAIN` / `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD`）；覆写（全局/单订阅）在 `generateProfile` 首步生效，用户或订阅一旦对这些域名表过态，内置默认必须让路。`work/config.yaml` 是生成物，禁止手改。
8. **分组展示顺序固定** — `proxyGroupOrder` 在写盘前统一排序：`自动选择` → 四个专用组（`🎯 Cursor 专用` / `grok 专用` / `📧 邮件专用` / `🎯 agy 专用`，隐藏探测组 `__sparkle_mail_probe__` 紧随邮件组）→ `Sparkle-<地区>` → 其余；同档位保持订阅原顺序，代理页按该顺序渲染。
9. **延迟快照必须可验证** — `sparkle-fast-delays.json` 只保存带 `providerFingerprint` 的 v2 快照；加载时指纹必须匹配当前 provider 配置，且成功样本覆盖率必须 ≥80%。旧格式、配置变化、覆盖不足一律视为无快照并强制逐点补测，禁止用残缺/过期样本跳过探测。
10. **合并订阅不得丢失来源 DNS** — 来源订阅自带 `dns.proxy-server-nameserver`（如 YYSSR 的 carrier DoH）时，合并结果必须按来源节点 `server` 域名写入 `proxy-server-nameserver-policy`；只对来源自身域名生效，base 的 DNS 不得覆盖来源节点入口解析。
11. **agy 探测必须绑定出口** — `🎯 agy 专用` 的地域结论只能来自「真实 agy 请求 + 该请求确实从被测节点出去」：mihomo `select` 只影响新建连接，magpie 的 HTTP/2 长连接会复用旧出口，因此任何切组后必须 `mihomoCloseConnections('🎯 agy 专用')`，连接清不掉就记 `unknown` 不写缓存。巡检顺序固定为「pin 就地复测（5min，不切组，30s 超时）→ 400 同节点二次确认 / 超时连续两轮才做修复扫描（严格地区优先 台湾→日本→韩国→新加坡→美国→其余、15s 超时、12 个上限、5min 预算、第一个 200 立即停；15 分钟内试过的节点（含超时）降级到「已尝试」组，保证下一轮先试未试候选、防饿死）」，禁止再用定期全量切换把生产流量拖到候选节点上。代理页对 `🎯 agy 专用` 只展示真实 agy 结论：可用显示秒级 + 距上次探测时间，失败显示「失败」+ 原因，锁区显示「锁区」，未探测显示「—」；不展示 gstatic 网络延迟、不提供该组手动测速。
12. **自动切换由单一策略表声明，各机制互不重叠** — 「谁来切节点」只在 `autoSwitchPolicy` 声明一次：`自动选择`（粘性固定）、`Sparkle-<地区>`（url-test + 故障转移）、`🎯 Cursor 专用`（只手动）、邮件 / grok / agy 专用（各自探测）、订阅自带分组（内核原生 / 手动）。新增一类分组 = 补策略表一行，源码扫描测试会拦住漏填；不得新增轮询或跳过名单。
    - **运行时配置必须与磁盘一致**：`runtimeConfigSync` 在每次重新生成配置后，按 `rules` / `sub-rules` / `rule-providers` / `proxy-groups` / `proxy-providers` 的指纹对账，变化则整配置重载（`PUT /configs?force=true` 采用磁盘 `config.yaml`；失败只记日志，不重启内核）；内核就绪时再用 `GET /rules` 条数与磁盘对账（服务模式可能保留更早会话的旧内核）。仅热重载 provider 会让内核长期运行旧规则，这是「国内软件没走直连」的根因。
    - **固定释放按生命周期**：`store-selected: true` 下内核会把 `cache.db` 的历史选点读回为 `fixed`。`autoSwitchPinRelease` 在内核启动 / 整配置重载后释放全部自动组的固定（`all`），在订阅刷新后只释放节点已不在组内的孤儿固定（`orphans`）。节点失活本身由内核原生处理：URLTest 仅在固定节点存活时才遵循 `fixed`，Fallback 会清除失活的固定，无需看门狗。
    - **故障转移**：内核对一个组连续拨号失败时只打一条 warning 告警并复测一次，url-test 复测常常照旧通过，节点仍被选中而真实流量持续超时。`groupFailover*` 订阅独立于界面日志级别的告警流（`/logs?level=warning`），同一组窗口内两次计数告警（30 s 去重、180 s 窗口）即为 `Sparkle-<地区>` url-test 组改选最近一次探测成功、延迟最低的节点，失败节点隔离 10 分钟，保留期满把组交还内核；用户固定且内核正在遵循的节点不动；`自动选择` 与专用组不参与。内核的告警文案是它唯一的外部契约：升级或切换内核（含 alpha）后运行 `pnpm run verify:failover`（隔离实例，约 2 分钟）。
    - **国内直连基线**：订阅没有任何国内感知规则（`GEOSITE/GEOIP,CN` 或 `RULE-SET`）时，`cnDirectBaseline` 在最后一条 `MATCH` 前补 `GEOSITE,CN,DIRECT` 与 `GEOIP,CN,DIRECT`，避免国内流量全部走代理。
    - **交互可逆**：代理页 `ProxyItem` 对已处于锁定状态的卡片支持点击一键解钉（Toggle Off），杜绝误触后无法自愈。
13. **Grok 选路必须用真实请求口径** — `grok 专用` 为 `select`，成员来自 `sparkle-grok` provider；节点可用性只能由「通过 mixed-port 真实请求 `https://grok.com/` 得到 200 且无 `cf-mitigated: challenge`」判定（发现阶段同样逐个切换并真实请求验证）。稳态 60 秒只复核当前节点（网络超时重试一次），失败才按池内 RTT 顺序切换；池内全灭才扩到全量发现（3 个可用即停）。候选顺序非香港优先；provider 不做周期健康检查。

## 外部依赖

| 组件           | 用途                             |
| -------------- | -------------------------------- |
| Mihomo         | 代理内核、连接池、provider delay |
| sing-box @ VPS | 入站 Reality / HY2 / TUIC        |
