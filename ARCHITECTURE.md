# Sparkle — 系统架构

Electron 桌面代理 GUI，主进程驱动 mihomo 内核；`自动选择` 按地区优先级与延迟选节点（延迟快照仅在 provider 指纹一致且成功覆盖 ≥80% 时复用，否则启动补测）；`🎯 Cursor 专用` 与 Cursor 路由规则固定 Cursor 流量；`📧 邮件专用` 经 Sparkle 侧 993/465 真实探测筛节点（全量入库 + 当前节点按需复测）后承载 macOS Mail 等海外 IMAP/SMTP；`grok 专用` 以 mixed-port 真实 HEAD 请求（200 且无 Cloudflare challenge）筛选可用出口并每 60 秒复核；`gemini专用` 只收录经 vXmutd 地区探测确认解锁的节点（fallback + 地区合格 provider，与 `自动选择` 共用同一份地区审计）；`🎯 agy 专用` 只收录通过官方 agy CLI 真实请求的节点；运行时配置与内核对账重载，`Sparkle-<地区>` 组由故障转移引擎兜底；AI API 端点不内置直连预设，是否直连只由用户的全局覆写决定。

## 模块导航

| 路径                                                                                          | 职责                                                                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [src/main/core/\_ARCH.md](src/main/core/_ARCH.md)                                             | 主进程核心：mihomo 控制、配置生成与对账、自动选路与故障转移、Cursor / 邮件 / grok / agy / gemini 专用组与规则 |
| [src/renderer/src/components/proxies/\_ARCH.md](src/renderer/src/components/proxies/_ARCH.md) | 代理页 UI、节点详情弹窗、build stamp                                         |
| [src/shared/\_ARCH.md](src/shared/_ARCH.md)                                                   | 跨进程类型与构建标识                                                         |
| [BUGFIX_LOG.md](BUGFIX_LOG.md)                                                                | 网络/安装缺陷台账与 ship 门禁记录                                            |
| [scripts/\_ARCH.md](scripts/_ARCH.md)                                                         | 构建/安装/验收脚本、GUI 看门狗（含 Agent SSOT `agent-sparkle-upgrade.sh`）   |

## 进程与数据流

```
Renderer (React)
  ↔ preload ↔ Main (Electron)
                  ├ manager.ts — mihomo 生命周期
                  ├ factory.ts — runtime config 生成（provider / 分组 / 规则 / DNS）
                  └ postCoreBootstrap.ts — 内核就绪后的启动编排：运行时配置对齐与自动组固定释放 · 延迟序 · Gemini 地区审计 / 邮件 / grok / agy 探测（后台并行） · 自动选择粘性固定 · 故障转移 · 订阅更新 · Cursor 默认节点 · 地区组按需预热

mihomo (TUN) → 节点 leaf → 目标站点
```

## 架构约束

1. **Cursor 专用组仅手动选择** — `🎯 Cursor 专用` 只接受 `manual` / `bootstrap` 来源的切换，任何自动逻辑不得改写。
2. **`自动选择` 粘性固定与真实地区解锁** — 它是 `fallback` 组，按 `sparkle-fast` 的文件顺序选出首个存活节点后由 `autoSelectStickyPin` 固定（pin），组测速统一用轻量 `https://www.gstatic.com/generate_204` 只量存活与延迟（不以 Gemini 首页重量污染排序），固定前除检查 mihomo 存活外还经 `sparkleGeminiProbe` 流式校验 `gemini.google.com` 的 `vXmutd` 地区码（剔除返回 `ZZ`/`CN`/`HK`/`MO`/`RU`/`BY`/`KP`/`IR`/`SY`/`CU` 或 `www.google.cn` 的“送中”节点），固定期间按 5 分钟节流复核、节点变化立即复核；只有当前节点真挂掉或被确认为地区受限时才换（丢固定时先做单点独立存活复测过滤并发体检偶发超时，10 分钟内再次丢固定则放行切换），高优先级节点恢复不回切；周期重排只改 provider 文件序，不解除固定，启动重排仅在原固定节点不在实测存活表内时解除；内核启动或整配置重载后先由 `autoSwitchPinRelease` 释放缓存恢复的固定，粘性固定只在验证通过后重新建立（见第 12 条）；钉住前还要过节点质量准入、钉住后每 2 小时原位复查（见第 20 条）。
3. **安装 SSOT** — macOS 仅 `/Applications/Sparkle.app`（`pnpm run agent:upgrade:mac` / `upgrade:mac`）；禁止 ditto 覆盖、禁止 Agent 裸 `pnpm build:mac`。
4. **Ship 定义** — git HEAD = 已安装 semver，且装后 PostCoreBootstrap 日志出现 `mihomo API ready`。
5. **邮件端口与 mihomo 探测分离** — 海外邮件客户端域名走 `📧 邮件专用`；成员须通过 Sparkle 主进程 `imap.gmail.com:993` + `smtp.gmail.com:465` TLS 校验入库，**不得**用 mihomo 健康检查（`url-test` / `fallback`）直接探测 IMAPS URL（HTTP 客户端误判）或仅用 `mail.google.com:443` 代替（筛不掉封 993/465 的节点）。`📧 邮件专用` 为 `fallback`：按 provider 的地区优先级（台湾 → 日本 → 韩国 → 新加坡 → 美国 → 其余）取首个存活节点，与 `自动选择` 一致；当前节点只在邮件组最近被使用时复测 993/465，失败后 provider 成员集合变化时热重载并触发切换，完全未使用邮件时不做端口探测。
6. **浏览器 UDP 不得绕过代理出口** — `factory.ts` 在规则链最前端注入 `quicTrafficRuleInjection`：UDP 443 与 `stun.cloudflare.com` 一律 `REJECT`，这两条规则在最终规则链里恰好各一条且排在最前——链中任何位置的同文副本（用户覆写或订阅带来的）都并入最前的这一条，因为埋在专用组 / 直连规则之后的副本拦不住先被前面规则命中的 UDP 443（事故记录：`src/main/core/core_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-17-003）。节点缺 `udp: true` 时 mihomo 会把 UDP 回落 `DIRECT`，与 TCP 的代理出口形成双 IP 分裂，被 Cloudflare 判定异常；阻断后浏览器按 RFC 9114 回退 HTTP/2 over TCP，出口单一。
7. **内置规则只补缺省，覆写与订阅优先；AI API 直连不内置** — 内置规则只在缺失时补（`cnDirectBaseline` 在订阅无国内感知规则时才补、`ensureMatchFallbackRule` 在无 `MATCH` 时才补）；覆写（全局/单订阅）在 `generateProfile` 首步生效，用户或订阅一旦表过态，内置默认必须让路。唯一的例外是第 6 条的 QUIC / STUN 防护：它是约束而不是默认值，覆写或订阅里的同文规则不会让它让路，而是被并入最前的一条。AI API 端点（`api.commandcode.ai` / `opencode.ai` / `open-design.ai`）不预设直连：是否直连只由用户的全局覆写 `sparkle-ai-direct` 决定，关闭覆写即回到订阅规则，没有第二个来源把直连补回（事故记录：`src/main/core/core_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-16-003）。`work/config.yaml` 是生成物，禁止手改。
8. **分组展示顺序固定** — `proxyGroupOrder` 在写盘前统一排序：`自动选择` → 五个专用组（`🎯 Cursor 专用` / `grok 专用` / `gemini专用` / `📧 邮件专用` / `🎯 agy 专用`，隐藏探测组 `__sparkle_mail_probe__` 紧随邮件组）→ `Sparkle-<地区>` → 其余；同档位保持订阅原顺序，代理页按该顺序渲染。
9. **延迟快照必须可验证** — `sparkle-fast-delays.json` 只保存带 `providerFingerprint` 的 v2 快照；加载时指纹必须匹配当前 provider 配置，且成功样本覆盖率必须 ≥80%。旧格式、配置变化、覆盖不足一律视为无快照并强制逐点补测，禁止用残缺/过期样本跳过探测。
10. **合并订阅不得丢失来源 DNS** — 来源订阅自带 `dns.proxy-server-nameserver`（如 YYSSR 的 carrier DoH）时，合并结果必须按来源节点 `server` 域名写入 `proxy-server-nameserver-policy`；只对来源自身域名生效，base 的 DNS 不得覆盖来源节点入口解析。
11. **agy 探测必须绑定出口** — `🎯 agy 专用` 的地域结论只能来自「真实 agy 请求 + 该请求确实从被测节点出去」：mihomo `select` 只影响新建连接，magpie 的 HTTP/2 长连接会复用旧出口，因此任何切组后必须 `mihomoCloseConnections('🎯 agy 专用')`，连接清不掉就记 `unknown` 不写缓存。巡检顺序固定为「pin 就地复测（30 分钟一轮，不切组，90s 超时）→ 400 同节点二次确认 / 超时连续两轮才做修复扫描（严格地区优先 台湾→日本→韩国→新加坡→美国→其余、60s 超时、6 个上限、5min 预算、第一个 200 立即停；15 分钟内试过的节点（含超时）降级到「已尝试」组，保证下一轮先试未试候选、防饿死）；全灭后按 1×/2×/3× 退避」，不用定期全量切换，避免把生产流量拖到候选节点上。定时复测按固定间隔采样，会漏掉时好时坏的节点，所以修复扫描另有一个被动入口：订阅内核 warning 告警流，`🎯 agy 专用` 的 `[TCP] dial` 拨号失败在 120 s 内累计 ≥30 条、且其它组同窗口的失败 <15 条（排除整网故障）时，跳过 pin 复测直接进入修复扫描（10 分钟冷却；与定时轮互斥，仍受全灭退避约束；触发只读取内核已打出的告警，不新增常规探测，进入扫描后与定时入口走同一条修复路径）。代理页对 `🎯 agy 专用` 只展示真实 agy 结论：可用显示秒级 + 距上次探测时间，失败显示「失败」+ 原因，锁区显示「锁区」，未探测显示「—」；不展示 gstatic 网络延迟、不提供该组手动测速（事故记录：`src/main/core/core_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-17-001）。约束：
    - **发现延迟随间隔与阈值联动**：无响应类故障的最坏发现延迟 = `PIN_CHECK_INTERVAL_MS` × `AGY_PIN_UNKNOWN_STREAK_LIMIT`（现为 30 分钟 × 2 = 60 分钟），被动入口只覆盖内核逐连接告警能看到的故障；改任何一个数值（含被动入口的 30 条 / 120 s / 15 条 / 10 分钟）都要在周缺陷日志写明新的最坏发现延迟，并用核心日志回放校准。
    - **不新增常规探测**：新的检测入口只读内核已打出的告警，不得为缩短发现延迟再加轮询（官方账号额度是成本，见 `sparkleAgyProbe.ts` 的间隔注释）。
    - **内核契约要验**：被动入口依赖内核 `[TCP] dial <组> (match …)` 告警文案；升级或切换内核（含 alpha）后运行 `pnpm run verify:failover`，文案变了只会无声退回「仅定时复测」。
12. **自动切换由单一策略表声明，各机制互不重叠** — 「谁来切节点」只在 `autoSwitchPolicy` 声明一次：`自动选择`（粘性固定）、`Sparkle-<地区>`（url-test + 故障转移）、`🎯 Cursor 专用`（只手动）、邮件 / grok / agy 专用与 `gemini专用`（各自探测；agy 另按拨号失败告警提前触发，见第 11 条）、订阅自带分组（内核原生 / 手动）。新增一类分组 = 补策略表一行，源码扫描测试会拦住漏填；不得新增轮询或跳过名单。
    - **运行时配置必须与磁盘一致**：`runtimeConfigSync` 在每次重新生成配置后，按 `rules` / `sub-rules` / `rule-providers` / `proxy-groups` / `proxy-providers` 的指纹对账，变化则整配置重载（`PUT /configs?force=true` 采用磁盘 `config.yaml`；失败只记日志，不重启内核）；内核就绪时再用 `GET /rules` 条数与磁盘对账（服务模式可能保留更早会话的旧内核）。仅热重载 provider 会让内核长期运行旧规则，这是「国内软件没走直连」的根因。
    - **固定释放按生命周期**：`store-selected: true` 下内核会把 `cache.db` 的历史选点读回为 `fixed`。`autoSwitchPinRelease` 在内核启动 / 整配置重载后释放全部自动组的固定（`all`），在订阅刷新后只释放节点已不在组内的孤儿固定（`orphans`）。节点失活本身由内核原生处理：URLTest 仅在固定节点存活时才遵循 `fixed`，Fallback 会清除失活的固定，Sparkle 不另设看门狗。
    - **故障转移**：内核对一个组连续拨号失败时只打一条 warning 告警并复测一次，url-test 复测常常照旧通过，节点仍被选中而真实流量持续超时。`groupFailover*` 订阅独立于界面日志级别的告警流（`/logs?level=warning`），同一组窗口内两次计数告警（30 s 去重、180 s 窗口）即为 `Sparkle-<地区>` url-test 组改选最近一次探测成功、延迟最低的节点，失败节点隔离 10 分钟，保留期满把组交还内核；用户固定且内核正在遵循的节点不动；`自动选择` 与专用组不参与。内核的告警文案是外部契约（故障转移读「连续拨号失败」告警；agy 被动触发读逐连接的 `[TCP] dial <组> (match …) … error:` 告警）：升级或切换内核（含 alpha）后运行 `pnpm run verify:failover`（隔离实例，约 2 分钟，两处文案一并校验）。
    - **国内直连基线**：订阅没有任何国内感知规则（`GEOSITE/GEOIP,CN` 或 `RULE-SET`）时，`cnDirectBaseline` 在最后一条 `MATCH` 前补 `GEOSITE,CN,DIRECT` 与 `GEOIP,CN,DIRECT`，避免国内流量全部走代理。
    - **交互可逆**：代理页 `ProxyItem` 对已处于锁定状态的卡片支持点击一键解钉（Toggle Off），杜绝误触后无法自愈。
13. **Grok 选路必须用真实请求口径**（**当前已禁用**：`cursorProxyGroup::GROK_GROUP_ENABLED = false`，不注入组与 `grok.com` 规则、不注册 / 不写 `sparkle-grok` provider、不启动探针，代码保留，改为 `true` 即整体恢复。） — `grok 专用` 为 `select`，成员来自 `sparkle-grok` provider；节点可用性只能由「通过 mixed-port 真实请求 `https://grok.com/` 得到 200 且无 `cf-mitigated: challenge`」判定（发现阶段同样逐个切换并真实请求验证）。稳态 60 秒只复核当前节点（网络超时重试一次），失败才按池内 RTT 顺序切换；池内全灭才扩到全量发现（3 个可用即停）。候选顺序非香港优先；provider 不做周期健康检查。

14. **旁路不得改变主流程** — 日志只用于诊断：`appendAppLog` 落盘失败只丢这一段、永不 reject，编排层经 `bestEffortLog` 包装注入的日志函数；`postCoreBootstrap` 的每个服务经 `guarded` 隔离，任一服务失败只记日志，不影响其余（尤其故障转移）。
15. **规则策略只经 `ruleSyntax` 读写** — 规则的字段布局、策略读取与改写在 `ruleSyntax` 一处定义（改写只换策略字段，`no-resolve`、`src` 等参数原样保留）；`antigravityRuleInjection` / `profileGroupNormalize` / `fakeIpRoutingIntegrity` / `cursorRuleInjection` / `cursorDedicatedRuleRewrite` / `customProxyGroups` 读写策略目标一律经它，不各自 `split(',')`。`vpsDirectBypass` 只按「类型 + 载荷」两个前导字段判断是否已有规则，不读不改策略。兜底 `MATCH` 的目标只能是内置出口、订阅组或顶层内联节点。
16. **YAML 读写保 Reality `short-id` 原文** — 纯数字写法（`01234567`、`1e5`）经 `parseYaml` 仍是原字符串，不丢前导零、不变成 Infinity；服务端要求逐字相同。
17. **测试门禁收集全部测试** — `pnpm run test:node-quality` 以 glob 收集 `src/**` 与 `scripts/**` 的全部 `*.test.ts`，新增测试文件无需登记；随机化不变量测试用固定 seed，失败可原样重放。
18. **升级一次到位，禁止反复重启试错** — 任何改动先在源码层闭环（全量测试 + typecheck + lint 全绿、已提交），再只执行一次 `pnpm run agent:upgrade:mac` 完成构建/安装/重启，一次命令对应一次启停；升级被中断后先查 dist 新鲜度、`/Applications` 落盘与 App 日志再决定续跑，验收失败先离线分析根因，不得以重复安装代替排查（事故记录：`scripts/scripts_20261107_20261113_BUGFIX_LOG.md` BUG-2026-11-13-003）。
    - **安装必须是可回滚的事务，且幂等、不重复要密码**：`install-sparkle-local.sh` 先在同目录暂存并校验新包（不碰现有安装），再静默（标记让订阅调度与 GUI 看门狗避让，也让 App 的 `before-quit` 跳过退出确认框——否则安装器发出的 SIGTERM 会被确认框拦住，只能等超时强杀）、用两次 rename 换装（旧包留作备份）、过门禁（代理端口 + 数据面；service 模式再要求新内核与 TUN 监听）才提交；任何一步失败（含 Ctrl-C、`kill -9` 后重跑）都 rename 回滚并重新拉起旧包，退出码 3 = 被门禁拒绝已回滚、4 = 回滚失败需人工，每一步写入 `~/.sparkle/install-last.log`。`ditto` 不保留 root 属主与 setuid 位，但只有 TUN 开启且内核走 `elevated` 才需要 setuid——`service` 模式的内核是 root 服务的子进程，不看 setuid；需要时在暂存副本上给**当前启用的内核**（`config.yaml` 的 `core`）补 `chown root:admin` + `chmod +sx` 并断言，判定口径与 App 的 `requiresCoreSetuid` 一致（契约测试对齐），否则 App 每次启动都会经 `permission.ts` 弹系统密码框。CDHash 与已装版本一致、App 在跑、数据面通、权限要求已满足时直接短路退出（`SPARKLE_FORCE_REINSTALL=1` 可强制重装）；装后内核引导不就绪就停在现场、不自动重启重试（由操作者读日志定位根因）；入口与内部各持一个原子 `mkdir` 锁、安装事务再按阶段文件里存活的 pid 拒绝并发安装，禁止并发升级（并发写 `dist`/`/Applications` 是 BUG-2026-11-13-004 asar 损坏的成因）。事务化与 `service` 模式免 setuid 的事故记录：`scripts/scripts_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-15-001（旧脚本先破坏后补权限，补 setuid 一步失败时系统停在半途）。
19. **Gemini 专用组的成员资格只认地区探测** — `gemini专用` 为 `fallback`，成员来自 `gemini专用` provider：稳态只收 vXmutd 明确判定地区解锁的节点（按地区优先级分段、段内延迟升序、最多 12 个），与 `自动选择` 共用 `sparkleGeminiProbe` 的同一份地区缓存与 30 分钟审计（同轮结论同时维护两个 provider，成员集合变化才热重载）；冷启动无合格样本时排除已确认锁区节点兜底、禁止空 provider；健康检查只用轻量 204 量存活。流量边界：`gemini.google.com` / `aistudio.google.com` 走本组，`generativelanguage.googleapis.com`（Gemini API）保留给经真实 Google AI 请求验证的 `🎯 agy 专用`，同一域名不得两处抢占留下被遮蔽的死规则。
20. **`自动选择` 的节点质量闸门：存活不等于可用，失败开放** — mihomo 的存活判定只看握手 / 204 延迟，看不到「能连通但下载只有几十 KB/s」的节点，粘性固定又会在节点「存活」时一直不放手。`autoSelectQualityGuard` 在粘性固定前对候选实测 128 KiB 下载吞吐（主目标 Google + 对照目标，经 `localProbeChannel` 串行），读数明显偏低的节点不钉，顺 fallback 序换下一个达标的存活节点；钉住后每 2 小时（放行路径上未验证就钉住的节点 10 分钟）只复测主目标，两次读数（间隔 ≥45 秒）确认劣化才原位替换，并关掉被放弃节点上经过 `自动选择` 的旧连接（其他组显式选了同一节点的连接不动；切换只影响新连接）（事故记录：`src/main/core/core_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-14-001）。约束：
    - **只让结果变好**：任何探测 / 控制器异常、没有达标替代、前几个候选都读不到数据，一律放行，行为与没有这道闸时一致；闸门不排名，只拦「极慢」。
    - **沉底不拉黑**：判劣节点记入 `sparkle-node-quality.json`（12 小时失效）并排到 `sparkle-fast` 文件最末，仍留在池内；且只在本轮找到达标节点时才沉底（比较证据，没有替代时沉底只会让池子更差）。
    - **只管自己钉的**：复查状态就是「这个固定是闸门钉的」标记，用户手动固定的节点永远不会被复查或替换；主动解除固定（`notifyAutoSelectUnfixed`）会作废进行中的遍历并清空复查状态。
    - **三处读同一份依据**：写 `sparkle-fast` 文件的配置生成、Gemini 审计重建、延迟重排都经 `loadFastProviderExclusions` 取剔除 / 沉底集合，漏读一处沉底节点就会在下一次重写时排回最前。
    - **探测通道只此一条**：邮件端口、Gemini 地区、吞吐三类探测共用本地隐藏监听器，必须经 `localProbeChannel` 串行化。
21. **AnyTLS 节点不复用会话，防护只接在 `extractProxies`** — mihomo 的 AnyTLS（协议 v2）客户端在会话上开第 2 条及以后的流时起 3 秒看门狗，3 秒内没收到服务端的 SYNACK 就关闭整个会话；服务端不回 SYNACK 时，复用会话上存活超过 3 秒的流（Cursor Agent 的长连接首当其冲）在第 3 秒被切断，而新会话的第 1 条流不起看门狗。`applyAnytlsReuseGuard` 给没有显式设置 `disable-reuse` 的 AnyTLS 节点写 `disable-reuse: true`（显式写过的值，含 `false`，一律尊重），让每条流独占一个新会话；代价是每条连接多一次 TLS 握手，A/B 实测中位多约 0.3 秒（事故记录：`src/main/core/core_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-17-002）。约束：
    - **防护只在节点入口**：五个派生 provider（fast / mail / agy / grok / gemini）的节点都取自 `extractProxies`，防护接在它与 `generateProxyProvider`（写盘）上；新增任何写节点的路径必须取节点自 `extractProxies` 或读回已写好的 provider 文件，不得直接用订阅原始节点。
    - **内核契约要验**：内核对未知键静默忽略，选项改名后防护会无声失效；升级或切换内核（含 alpha）后运行 `pnpm run verify:anytls-reuse`。
22. **订阅内容先验证、后落盘，坏内容按订阅退避重试** — 远程订阅（含 sub-store）下载到的内容必须先过 `profileContentCore.assertValidProfileContent`（非空、是 YAML 映射、`proxies` / `proxy-providers` / `proxy-groups` / `rules` / `rule-providers` 至少一段非空）才能写进 `profiles/<id>.yaml`；通不过就抛 `InvalidProfileContentError`，旧文件原样保留、`updated` 不推进、不触发合并订阅重建与内核热重载。写盘前不校验的后果：错误页、空响应、限流 JSON 会替换掉好订阅，它若正是当前订阅就被重载成没有订阅节点的配置，依赖它的合并订阅因来源无效重建失败而停在旧节点上（线上观察到的是后者），且这次「更新成功」让该订阅直到下一个计划时刻都不再重试（事故记录：`src/main/core/core_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-14-002）。约束：
    - **校验不可关**：订阅条目没有「验证订阅格式」开关（旧的 `verify` 字段默认关闭、等于每条订阅都没有防护，已连同界面开关删除）；新增任何订阅下载路径都必须经同一个 `assertValidProfileContent`，写盘在校验之后。
    - **无效内容按订阅退避**：同一订阅连续返回无效内容时，`createDueProfileUpdateRunner` 按 5 / 15 / 30 / 60 分钟（之后保持 60 分钟）延后重试，成功一次即清零；网络 / HTTP 错误不受此限，仍每次心跳重试。退避由 `InvalidProfileContentError` 触发，目前只有远程订阅的下载路径抛它：合并订阅因来源文件无效而重建失败时抛的是普通 `Error`（`mergeProfileCore.ts:229-231`），仍每次心跳重试——重建只读本地文件、不请求服务端，经下载进入的来源已被校验，其余来源是用户自己写入的（手改、导入本地文件）。退避只存在内存里，重启后从第 1 次重新计。
    - **只拦明显不是配置的内容**：判定是「含配置段的映射」，不检查节点字段、也不强求有节点（只带分组与规则、节点由覆写补的模板同样是合法订阅），避免把服务商的非常规写法误拒而让订阅再也更新不了；错误信息带上内容开头 80 字（凭证值脱敏）用来事后辨认服务端返回了什么，日志里只有这一份证据。
    - **错误信息不带订阅地址**：订阅与覆写的下载失败统一经 `downloadErrorCore.toDownloadError`，消息里的地址只留协议、主机与端口（`redactUrl`）——令牌可能在查询串、路径片段或 `用户:密码@` 里，错误信息会写进 App 日志（落盘），也经 IPC 回到界面；新增下载路径同样经它，不要把 `item.url` 拼进错误文本，并像 `downloadErrorCore.test.ts` 那样用「路径与查询里放假令牌」断言信息里一个都没有。
    - **订阅持续失败要让用户看到**：同一订阅从第一次失败起持续 ≥ `FAILURE_NOTICE_AFTER_MS`（5 分钟）仍在失败时，`createDueProfileUpdateRunner` 经注入的 `notify` 弹一次系统通知（`profileUpdater.ts` 接 `showNotification`，通知 id `profile-update-failed:<订阅 id>`），每个失败序列一次、成功清零、退避等待中的跳过不算失败。判定用时间而不是次数：GUI 心跳与 LaunchAgent 是相位不同的两个触发源，相邻两次尝试可以只隔几秒（11-14 那次 541 次失败里 24% 不到 60 秒），按次数会在睡眠唤醒后网络未恢复的瞬间误报。序列只存内存：GUI 没运行时 LaunchAgent 起的是一次性进程，一个进程里撑不到 5 分钟，所以不会每 5 分钟弹一次，代价是 GUI 没运行时不提醒。通知会停留在锁屏与通知中心，内容无效时固定写「服务端返回的内容不是有效的配置」、不转述服务端返回的文字，细节只在日志里。新增后台任务的失败出口也要想清楚「持续出错时用户怎么知道」（`profileUpdaterFailureNotice.test.ts`；事故记录：`core_20261114_20261120_BUGFIX_LOG.md` BUG-2026-11-14-002「后续」）。
24. **切换类操作先反馈、后等待，内核重启一律经闸门** — 开关与切换点击后界面必须立即翻到目标值，不等主进程：`ControledMihomoConfigProvider.patchControledMihomoConfig` 先把 `previewConfigPatch` 算出的预览写进 SWR 缓存，主进程处理完后重新读取真实配置，失败回滚并提示，并返回「是否已生效」（失败时调用方不得接着重启内核）；虚拟网卡与系统代理开关由 `usePendingAction` 管「进行中」（展示值翻到目标值、执行期间禁用、重复点击忽略）。渲染进程的内核重启只能走 `utils/ipc.ts` 的 `restartCore()`：`coreRestartGate` 保证同一时刻只有一次重启在跑，运行中到达的请求合并成唯一一次随后重启（所以重启必须保持「无参数、只读磁盘上的配置」才能合并），执行超过 120 秒视为卡死、放开闸门并报错（不取消主进程那次重启）；页头显示「内核重启中…」，虚拟网卡开关在重启期间禁用；`restartGateWiring.test.ts` 拦住绕过入口的写法。主进程 `patchControledMihomoConfig`、`restartCore`、`triggerSysProxy` 各记一行 `[SwitchTiming]`（耗时、`os.loadavg()` 的 1 分钟负载、空闲内存；旁路，遵守第 14 条）。
    - **边界**：预览只近似主进程的合并规则（`nameserver-policy` / `proxy-server-nameserver-policy` / `hosts` 的整体替换、`controlDns` / `controlSniff` 关闭时的删除不在预览里，以随后的重新读取为准）；多个补丁重叠时，较早失败的补丁要等最后结束的那个才被纠正（SWR 只让最后结束的变更重新读取）；闸门只管渲染进程的入口，托盘、快捷键与主进程自己发起的重启不经过它，主进程 `restartCore` 本身没有互斥；`use-dedicated-group-switches.ts` 有一份同类的「进行中」实现，没有并入 `usePendingAction`。
    - **事故记录**：BUG-2026-11-18-005（`src/main/core/core_20261114_20261120_BUGFIX_LOG.md`）。

## 外部依赖

| 组件           | 用途                             |
| -------------- | -------------------------------- |
| Mihomo         | 代理内核、连接池、provider delay |
| sing-box @ VPS | 入站 Reality / HY2 / TUIC        |
