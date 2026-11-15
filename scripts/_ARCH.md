# scripts — 运维与构建脚本

Shell/TS 脚本：本地升级与安装、安装前后门禁、post-upgrade 验收、内核契约校验、GUI 看门狗、构建与发布辅助、离线配置工具。

`*Core.ts` 是各脚本的纯判定层，与同名 `*.test.ts` 同目录，随 `pnpm run test:node-quality`（`src/**` 与 `scripts/**` 的全部 `*.test.ts`）一并执行。

## 升级与安装

| 文件 | 职责 |
| --- | --- |
| `agent-sparkle-upgrade.sh` | **Agent SSOT**：安装前先跑 `sparkle-pre-install-hygiene.mts` 与 `test-gui-watchdog-fuse.sh`；dist 与源码指纹一致则仅 install，否则 full upgrade；装后数据面就绪门禁 + profile due-check（后台 worker 由安装器预检阶段保证就位，这里不再安装）。入口持原子锁（`${TMPDIR}/sparkle-agent-upgrade-entry.lock`），已有升级在跑直接拒绝启动 |
| `upgrade-sparkle-local.sh` | 本地 dev 一条龙：**原子互斥锁**（`${TMPDIR}/sparkle-agent-upgrade.lock`，持有者 pid 已死或超时才接管，`INT/TERM` 释放后退出）→ 清理 `out/` → vite → Stage-A bundle 门禁 → electron-builder dir → Stage-B asar 门禁 → 写 dist build meta → install → 装后检查（进程在运行；close 烟测未就绪只告警）→ PostCoreBootstrap `mihomo API ready` 门控（macOS 26 且未设 `macos26ForceGui` 走 headless 分支，否则走 GUI 就绪门禁）；恢复轮次默认 **0**（`resolvePostInstallRecoveryRounds`），失败即停留现场，显式设 `SPARKLE_POST_INSTALL_RECOVERY_MAX_ROUNDS` 才放开（上限 3） |
| `install-sparkle-local.sh` | 仅安装 `dist/mac-arm64/Sparkle.app` → `/Applications`，**整个安装是一个可回滚的事务**（见下方「事务化安装」）：预检（拒绝并发、恢复上次被打断的事务、校验源包、基线探测、**幂等短路**、确认后台 worker 认静默标记且 launchd 调度的就是这份副本、空间与权限）→ 暂存（同目录拷贝并校验签名与 CDHash，再按需补 setuid）→ 静默（写标记、退出 GUI、让服务停掉托管内核）→ 换装（两次 rename，旧包留作备份；备份位被占用则在写阶段文件之前拒绝）→ 启动并过门禁 → 提交或回滚。提交之后的收尾（记 CDHash、把重复的 `~/Applications/Sparkle.app` 改名为 `.bak.<UTC 时间>` 留存、服务二进制变化提示）只是记账：失败只告警，不改变已成功的结果。退出码：0 成功 · 1 失败（系统未变或已恢复）· 3 新包被门禁拒绝并已回滚 · 4 自动回滚失败（需人工，现场保留）。每一步写入 `~/.sparkle/install-last.log`（上一轮为 `install-prev.log`）；`SPARKLE_FORCE_REINSTALL=1` 绕过短路 |
| `lib/login-home.sh` | `sparkle_pin_login_home`：把 `HOME` 固定为登录用户真实主目录（Agent 沙箱会改写 `HOME`，门禁/护栏需读真实日志与状态目录）；`upgrade-sparkle-local.sh` 构建后、安装与 worker 安装脚本开头调用 |
| `lib/sparkle-paths.sh` | 安装/升级脚本共用路径的单一来源（`SPARKLE_STATE_DIR` / `SPARKLE_APP_DATA_DIR` / `SPARKLE_LAUNCH_AGENTS_DIR` / `SPARKLE_INSTALL_DEST`）：默认值派生自已钉住的登录用户 `HOME`，每个都可由同名环境变量覆盖——沙箱测试靠它把整条流水线指向临时目录 |
| `lib/core-setuid.sh` | 内核权限判定的可 source 库（无副作用，只定义函数）：`enabled_core_name`（读 `config.yaml` 的 `core`）、`effective_core_permission_mode`（配置值 + macOS 26 缓解补丁：Darwin ≥ 25 且包内带 `sparkle-service` 时 elevated 视为 service）、`tun_enabled`、`core_setuid_required`（TUN 开启且有效模式不是 service）、`core_setuid_satisfied`、`is_setuid_mode`、`restore_core_setuid`（需要时一次提权补齐并断言，提权命令的 stderr 落日志；非交互模式拒绝弹框并给出可手工执行的命令）。**service 模式下内核是 root 服务的子进程，不看 setuid，安装不再要求它**；只有 TUN 开启且走 elevated 才补（`ditto` 会丢 setuid，实测 `-rwsr-xr-x` → `-rwxr-xr-x`）。判定刻意用纯 bash：权限位以 `-` 开头，传给 `tsx -e` 会被 node 当成选项而崩溃。与 App 的 `requiresCoreSetuid` 同口径，`src/main/core/coreSetuidScriptParity.test.ts` 逐格对齐 |
| `lib/install-log.sh` | 统一日志：每行带时间戳并同步写入 `~/.sparkle/install-last.log`；`run_captured` 把子命令（含特权命令）的 stdout+stderr 逐行记入日志——用户取消授权、被策略拒绝等原因只出现在那里 |
| `lib/install-app-control.sh` | GUI 与服务托管内核的启停：`app_quit_gui`（先 SIGTERM、超时才 SIGKILL。Electron 把 SIGTERM 当成 `app.quit()`，和 AppleEvent「quit」一样走 App 的 `before-quit`，平时它会弹出要人点的确认框；调用时静默标记已写入，认得标记的 App（`src/main/sys/upgradeQuiesce.ts`）跳过确认框、走正常退出清理，还没有这项逻辑的旧 App 会让确认框一直挂着、不理会 SIGTERM，只能等超时强杀）、`app_launch_and_settle`（先清掉上一个 GUI 留下的 `gui-graceful-quit.stamp`——留着会让看门狗把新进程的一次崩溃当成有意退出；再经 Finder POSIX open 启动）、`app_gui_expected_to_stay`（macOS 26 headless 下没有 GUI 进程是正常的）、`service_core_stop`（经签名 API 让 root 服务停掉托管内核，幂等） |
| `lib/install-gate.sh` | 装后门禁：代理端口监听；升级前数据面本来就通则必须经代理访问外网（升级前就不通是网络问题，不归咎新包）；service 模式下内核必须是升级后新拉起的（`ps etime` 对比升级基线）且 TUN 开启时新内核日志在快照之后出现监听行。按墙钟轮询（默认 90 秒），回滚验证用非严格模式（只看端口与数据面）。`install_short_circuit_reason` 是幂等短路判定 |
| `lib/install-transaction.sh` | 升级事务库：暂存 / 校验 / 换装 / 提交 / 回滚 / 中断恢复。阶段文件 `~/.sparkle/upgrade-state`（`phase`/`pid`/`ts`/`had_prev`，原子写）与静默标记 `upgrade-in-progress`（15 分钟 TTL，每个阶段与每次门禁轮询都会刷新；订阅调度、GUI 看门狗见到它就避让，App 的 `before-quit` 见到它就不弹退出确认框，文件名与 TTL 由 `src/main/sys/upgradeQuiesce.test.ts` 与本库对齐）；回滚与「上次被打断」的恢复走同一份决策表（`txn_plan_recovery`，与 `planInterruptedUpgradeRecovery` 逐格对齐）；`rm -rf` 只允许删暂存 / 备份 / 失败品三个事务私有目录；另一个安装在跑（pid 存活 + 是 bash + 阶段文件不足 1 小时）则拒绝开始，且赶在日志轮转之前 |
| `lib/launchd-agent.sh` | LaunchAgent 幂等安装：worker 内容、plist 内容、已加载 job 的来源路径（`launchctl print` 的 `path =`）三者都一致才跳过；只看「已加载」会被沙箱 shell 改写的 `HOME` 骗过（文件装到别处、真正生效的仍是旧副本）。两个 job 的 label 常量（`SPARKLE_PROFILE_SCHEDULER_LABEL` / `SPARKLE_GUI_WATCHDOG_LABEL`，后者与 `guiWatchdogCore.ts` 的常量由 `guiWatchdogCore.test.ts` 对齐）与 `launchd_agent_foreign_source`（该 label 若是从别的 plist 加载的，返回那份路径）也在这里，安装器预检据此拒绝「刷新之后 launchd 仍在调度一份不认静默标记的旧 job」的状态 |
| `lib/serviceSignedRequest.ts` / `lib/serviceCoreStop.ts` / `sparkle-service-core-stop.mts` | 经 unix socket 的 `SPARKLE-AUTH-V2` 签名请求：共享签名库（`measure-connections-payload.mts`、`sparkle-mihomo-close-smoke.mts`、`reload-mihomo-via-service.mts` 共用，与 App 侧签名由 `src/main/service/serviceScriptSigningParity.test.ts` 对齐）；`serviceCoreStop` 调 `POST /core/stop`（幂等）让服务停掉托管内核，**从不调用 `/service/restart`**（守护进程会在请求里重启自己）。密钥文件只读、不打印 |
| `coreSetuidLib.test.ts` | `lib/core-setuid.sh` 的功能测试：真实 `source` 后跑判定与失败路径（临时目录造伪 App），覆盖权限位识别、启用内核选择、有效权限模式、`ditto` 丢位后判缺失、非交互拒绝提权且不改权限位、sidecar 缺失报错 |
| `installPipeline.test.ts` / `installShortCircuit.test.ts` / `installFaultInjection.test.ts` / `installCrashRecovery.test.ts` / `installBackgroundWorkers.test.ts` | 在沙箱里**真实执行**安装流水线（系统自带 `/bin/bash` 3.2）：正常 / 首次安装 / headless / elevated / 短路族；9 种换装前失败、静默期失败、两次 rename 各自失败、5 种门禁拒绝、回滚失败（退出码 4）；每个步骤 `kill -9` 后重跑、回滚中途再被杀、SIGTERM / SIGINT / SIGHUP、并发拒绝与过期阶段文件；后台 worker 的静默标记行为与 LaunchAgent 安装器的幂等、加载路径、`HOME` 钉住 |
| `installGateChecks.test.ts` | 门禁与 App 控制库的单函数测试：用同名 shell 函数模拟进程表与内核日志，覆盖沙箱里难以稳定构造的分支（进程在两次查询之间消失、别的包路径下的内核不算新内核、内核日志被截断或换文件、macOS 26 前后 GUI 是否应当常驻） |
| `installLibContract.test.ts` | shell 库与 `sparkleInstallSafetyCore.ts` 逐格对齐：恢复决策表（6 阶段 × 16 种目录组合）、短路判定、setuid 位解析、启用内核名、`etime` 折算、`txn_remove_scratch` 拒绝清单、静默标记 TTL 与文件名三处一致 |
| `testing/` | 沙箱夹具（另有 `gitRepoFixture.ts`：构建标识测试共用的真实临时 git 仓库）：`installSandbox.ts` 把真实脚本复制进临时目录，PATH 只暴露白名单（真实 `mv` / `rm` / `ditto` / `find` 等文件系统命令 + 一个分发式命令桩 `sandbox-stub.sh`），没被桩住的特权命令表现为 `command not found`，不可能碰到真实系统；故障 / 崩溃 / 挂起由环境变量注入；沙箱里的 GUI 对 SIGTERM 的反应与真实 App 一致——只有静默标记在位才正常退出（并留下「正常退出」戳），否则像挂在确认框上一样不退，逼出 SIGKILL 兜底（`SIM_QUIT_REFUSES` 模拟还没有这项逻辑的旧 App，包行为 `unkillable=1` 模拟连 SIGKILL 都杀不掉）；`installWorld.ts` 是场景规格（新旧包、配置与网络状态、`serviceWorld`、包指纹）；`installAssertions.ts` 是公共不变量（事务关闭、旧包原样、从未删除在用的 App）；`libShell.ts` 是 source 事务库后只跑单个函数的最小外壳；`fakeSparkleService.ts` 是签名 API 的假服务 |
| `sparkleUpgradeScriptText.test.ts` | 升级链路结构护栏（行为由上面的沙箱测试证明，这里守「执行覆盖不到、一改就重新引入事故」的约束）：不得把 `-` 开头的值传给 `tsx -e`、全部脚本在 `/bin/bash -n` 下可解析且不含 bash 4+ 写法、source 库无顶层副作用、setuid 在暂存副本上补、特权命令不吞 stderr、永不调用 service 重启、阶段顺序（所有可能失败的步骤先于第一个不可逆动作）、静默期之前不退 App / 不停内核 / 不换装、四种退出路径都有清理、`rm -rf` 只在 `txn_remove_scratch`、短路早于暂存、两个入口持原子锁 |
| `sparkle-pre-install-hygiene.mts` / `sparklePreInstallHygieneCore.ts` | 装前卫生：lifecycle journal 超过 16 MiB 时只保留末尾 8 MiB；数据卷占用 ≥95% 阻断升级 |
| `sparkle-stale-mihomo-socket-hygiene.mts` / `sparkleStaleMihomoSocketHygieneCore.ts` | 探测失败时移除僵尸 `/tmp/sparkle-mihomo-api.sock`（它会阻止内核直连绑定） |
| `evaluate-sparkle-dist-freshness.mts` / `sparkleDistFreshnessCore.ts` / `write-sparkle-dist-build-meta.mts` | dist 新鲜度：build 时把 git commit 与工作区摘要写入 dist 的 `.sparkle-build-meta.json`，install-only 前比对当前源码；退出码 0 = 一致，1 = 过期（强制 full rebuild） |
| `upgrade-sparkle-post-install-recovery.mts` | 装后内核引导失败时的恢复：socket 卫生 + GUI 重启（**默认不自动调用**，仅在显式放开恢复轮次时使用） |
| `sparkleInstallSafetyCore.ts` | 升级安全的纯判定层（判定语义 SSOT 与文档）：`isCoreSetuidMode`、`resolveInstallShortCircuit`（五条同时成立才跳过安装）、`planInterruptedUpgradeRecovery`（被打断 / 回滚的事务如何收尾：阶段 × 四个目录是否存在 → 动作序列）、`UPGRADE_MARKER_TTL_MINUTES`、`resolvePostInstallRecoveryRounds`（默认 0）、`parseLockOwner`/`isLockOwnerActive`/`formatLockOwner`。shell 侧为不依赖 `tsx -e` 传参而用等价纯 bash，本模块保留语义定义与单测，`installLibContract.test.ts` 逐格对齐 |
| `install-sparkle-profile-scheduler.sh` | 幂等安装订阅定时检查 LaunchAgent（`StartInterval` 300s，worker `~/.sparkle/sparkle-profile-scheduler.sh`，`RunAtLoad`）：worker、plist、已加载 job 的来源路径都一致才跳过（`lib/launchd-agent.sh`）；由 `install-sparkle-local.sh` 预检阶段调用 |
| `open-sparkle-gui-macos26.sh` | macOS 26 SSOT：带 GUI 启动（`--sparkle-force-gui`） |
| `sparkle-profile-scheduler.sh` | LaunchAgent worker（远程订阅到期刷新）：见到新鲜的 `upgrade-in-progress` 标记就跳过本轮（升级期间 `/Applications/Sparkle.app` 正在被替换，此刻再拉起第二实例会和新包抢配置与内核）；标记超过 15 分钟视为安装进程已崩溃，照常运行 |

## 门禁与验收

| 文件 | 职责 |
| --- | --- |
| `verify-sparkle-bundle.mts` | `pnpm run verify:bundle`：Stage-A（out/main）bundle marker 门禁，`--with-asar` / `verify:bundle:full` 加 Stage-B（app.asar） |
| `verify-sparkle-main-bundle.mts` | `upgrade-sparkle-local.sh` 调用的 Stage-A 门禁，扫描 `out/main/*.js` |
| `verify-sparkle-main-asar.mts` | Stage-B：app.asar 内 main bundle marker 门禁 |
| `sparkleMainAsarSourceCore.ts` / `upgradeSparkleAsarGateCore.ts` | 两阶段共用：收集 main 进程源码文本（磁盘 `out/main/*.js` 或 asar）· `assertSparkleMainAsarBundle` 断言 bundle 含 `appendAppLog`、不含 PCRE 内联标志正则（如 `/(?i)/`，启动即 SyntaxError）、含 Core Readiness 门 |
| `upgradeSparklePostInstallGateCore.ts` | 装包后门禁纯函数：按安装行偏移计 PostCoreBootstrap 失败 / API 就绪 / headless 引导完成 |
| `sparkle-data-plane-readiness.mts` | 数据面就绪探针：经本机代理端口（默认 `127.0.0.1:7890`）重试探测，Agent 装后门禁的 SSOT |
| `measure-connections-payload.mts` | 只读性能测量：经 service socket（Auth V2 签名）拉取真实 `/core/controller/connections` 负载，量出连接数、字节数、`JSON.parse` 与结构化克隆序列化的中位数/P95，并按 500ms 间隔折算常驻 CPU 占比。用于判断「连接流常驻」是否值得按需启停——实测 103 条连接时为 0.04% 单核，故当前规模不优化 |
| `sparkle-mihomo-close-smoke.mts` | 关闭连接烟测：`DELETE /connections/{id}` 必须到达控制器（直连或 service 模式） |
| `check-build-drift.ts` / `sparkleBakedBuildStampCore.ts` | `pnpm run check:drift`：从 `/Applications` 里 `app.asar` 的主进程 bundle 按内容读出烧进去的 commit 与 dirty（不依赖打包器的 chunk 文件名，独立 chunk 与内联进 `index.js` 两种产物都能读），对比仓库 HEAD（commit 不同时再看构建提交之后是否只改了文档 / 测试 / buildStamp，是则不算漂移，判定在 `src/main/core/buildDriftPureCore.ts`），退出码 1 = 漂移 |
| `verify-group-failover.mts` | `pnpm run verify:failover [内核路径]`：故障转移引擎对真实 mihomo 内核的端到端校验（隔离实例，约 2 分钟）；升级或切换内核（含 alpha）后运行，内核告警文案或拨号失败语义变化时在第一步失败 |
| `mihomoIsolatedHarness.ts` | 隔离 mihomo 端到端校验的公共夹具：随机回环端口、模拟 HTTP 目标与 SOCKS5 节点、内核子进程与控制器客户端；只接触自己创建的进程、端口与目录 |
| `verify-antigravity-geo-routing.mts` | `pnpm run verify:agygeo`：agy / cloudcode-pa 流量必须落入 `🎯 agy 专用` |
| `verify-vps-provider-split.sh` | 装后校验 VPS provider 拆分（日本四个标准叶子），非零退出 = 失败 |
| `validate-dns-fix.sh` | DNS 修复验证清单：google 解析为 fake-ip、TUN 与 7890 代理访问 google / chatgpt、本机 sub2api 健康检查；汇总通过 / 失败数，有失败则退出 1 |

## GUI 看门狗

| 文件 | 职责 |
| --- | --- |
| `sparkle-gui-watchdog.sh` | 非预期退出后重启 `/Applications/Sparkle.app`；尊重 GUI 主动退出时写下的 `~/.sparkle/gui-graceful-quit.stamp`；macOS 26 不自动重启（service 保持代理）；崩溃台账熔断；见到新鲜的 `upgrade-in-progress` 标记就暂停（安装器有意停掉 App 不是崩溃：不写台账、不触发熔断或重启），标记超过 15 分钟视为安装进程已崩溃而恢复巡视。路径与判定常量在 `src/main/sys/guiWatchdogCore.ts`，由漂移测试对齐 |
| `install-sparkle-gui-watchdog.sh` | 幂等安装看门狗 LaunchAgent：worker、plist、已加载 job 的来源路径都一致时不做任何 `bootout/bootstrap/kickstart`（每次安装都重启看门狗会重置它的崩溃台账与退避状态）；由 `install-sparkle-local.sh` 预检阶段调用 |
| `test-gui-watchdog-fuse.sh` | 安装前门禁：崩溃循环熔断不依赖 node 也能统计台账行数 |
| `test-macos26-headless-smoke.sh` / `test-macos26-force-gui-soak.sh` | macOS 26 烟测：headless 启动应干净退出且代理在线；强制 GUI 在 `SOAK_SEC` 内不得 SIGTRAP |

## 构建与发布

| 文件 | 职责 |
| --- | --- |
| `write-build-stamp.ts` / `writeBuildStampCore.ts` | `pnpm run write-build-stamp`：写入 `src/shared/buildStamp.ts`（`YYYY.MMDD.HHMM` 格式 SSOT，含 semver、git commit 与 dirty）。dirty 不把上一次构建留下的 `buildStamp.ts` 改动算进去（源码仍能由该 commit 复现，与 `buildDriftPureCore` 把它判为「不影响二进制」同口径，路径由对齐测试锁住），其余未提交改动与未跟踪文件都算脏；非 git 仓库或 git 命令失败记 commit=unknown、dirty=true，漂移检测据此判定需重建。`writeBuildStampCore.test.ts` 与 `writeBuildStampCli.test.ts` 用真实临时 git 仓库覆盖（夹具 `testing/gitRepoFixture.ts`） |
| `prepare.ts` | `pnpm run prepare`：下载 sidecar 资源：mihomo（release / alpha）、geo 数据（mmdb / metadb / geosite / geoip / asn）、字体、sparkle-service、Sub-Store 及其前端，Windows 另含 loopback / runner / monitor / 7zip，每项重试 5 次；`SKIP_PREPARE=1` 要求 `extra/sidecar/mihomo` 已存在 |
| `install-electron.ts` | `pnpm run ensure:electron`：按平台下载并解压 Electron 二进制（macOS 用 `ditto`，校验 framework 符号链接） |
| `deepSignMac.cjs` | electron-builder 钩子：整包 ad-hoc 重签（主二进制与 Electron Framework 共用同一身份），清除扩展属性 |
| `updater.ts` / `checksum.ts` / `telegram.ts` | 发布流水线：生成 `latest.yml` 并在 changelog 追加下载链接 · 为 `dist/` 产物写 `.sha256` · 向 Telegram 频道推送发布公告 |

## 离线配置工具

| 文件 | 职责 |
| --- | --- |
| `regenerate-work-config.mjs` / `regenerate-work-config.ts` / `tsconfig.regen.json` / `electron-hook.mjs` / `electron-mock.mjs` / `electron-toolkit-mock.mjs` | 在 Electron 之外调用 `generateProfile()` 重写 `work/config.yaml`：加载钩子把 `electron` 与 `@electron-toolkit/utils` 换成桩 |
| `patch-work-config.cjs` / `patch-work-config.ts` | 不启动 App，对现有 `work/config.yaml` 就地补跑分组注入、规则目标修复、分组归一与自动选路组，输出 `PATCH_OK` |
| `reload-mihomo-via-service.mts` | 经 `/tmp/sparkle-service.sock` 的 `SPARKLE-AUTH-V2` 签名请求（共享签名库 `lib/serviceSignedRequest.ts`），对 service 模式内核执行 `PUT /configs?force=true`（整配置重载，输出 `reload_ok`） |
| `vps-deploy/` | VPS 侧 sing-box 部署与运维脚本（首尔 Cursor 节点 / 东京通用节点安装、迁移为纯 sing-box、审计日志、2 GB swap 与 OOM 防护），经 ssh 在 VPS 上执行，不被 App 构建链引用 |

## Agent 升级（唯一入口）

```bash
cd /path/to/sparkle
bash scripts/agent-sparkle-upgrade.sh
```

等价 `pnpm run agent:upgrade:mac`。禁止 Agent 裸跑 `pnpm build:mac` 或后台 build 后忘记 install。

**一次到位（铁律）**：改动先在源码层闭环（全量测试 + typecheck + lint 全绿、已提交）再触发升级；一次升级命令只跑一次、只对应一次 App 启停，禁止并发或重复触发；命令被中断后先用 `evaluate-sparkle-dist-freshness.mts`、`/Applications/Sparkle.app` 落盘时间与 App 日志核查已完成到哪一步，再决定续跑或收尾，禁止不查状态直接重跑；装后验收只用只读门禁（`mihomo API ready` 日志、`sparkle-data-plane-readiness.mts`），失败先离线定位根因，不拿反复重装试错（事故记录：`scripts_20261107_20261113_BUGFIX_LOG.md` BUG-2026-11-13-003）。

**重跑前必须确认没有构建进程**（BUG-2026-11-13-004 的唯一成因）：工具层报「命令中断」只表示调用方放弃等待，**构建进程可能仍在后台写 `dist/` 与 `out/`**。任何重跑前先执行 `ps aux | rg "electron-builder|agent-sparkle-upgrade|upgrade-sparkle-local"`，有残留必须先杀掉再重跑；两个构建并发写同一份 `dist` 会产出截断的 `app.asar`，表现为 App 启动零输出立即退出。App 装后打不开时的最短排查链：`node --check out/main/index.js` → 解析 asar header 长度 → 读包内 `package.json` 是否为合法 JSON → 检查 `SingletonLock` 是否指向已死 pid。

**为什么装完总要输密码（已修）**：`ditto` 不保留 root 属主与 setuid 位，所以每次安装都会把内核的 setuid 弄丢。内核拿到 TUN 权限有两条路：`elevated`（内核自带 setuid，GUI 以普通用户拉起它）与 `service`（内核是 root 服务的子进程，**不看 setuid**）。App 的 `tunStartupGuard` 过去不分模式一律要求 setuid，于是在 service 模式（macOS 26 默认）下也每次启动弹一次没有意义的密码框，叠加 `max_recovery_rounds=2` 的自动重启，一次升级可以变成 3 次启停、3 次密码框。修复后：App 守卫与安装脚本用同一口径（`requiresCoreSetuid`：TUN 开启且有效模式不是 service，口径由 `coreSetuidScriptParity.test.ts` 对齐）；需要时在**暂存副本**上给当前启用的内核补 setuid 并断言——它是整条流水线里唯一可能弹密码框、被取消的步骤，排在所有不可逆动作之前；service 模式不补、不弹；恢复轮次默认 0；服务托管的内核经签名 API（`POST /core/stop`）停掉，不再提权杀服务。

**幂等短路（避免无谓打断）**：`install-sparkle-local.sh` 在暂存与 quit 之前判定「CDHash 与已装版本一致 + App 在跑（或本就不该常驻）+ 数据面通 + 内核权限要求已满足」，全中直接 `exit 0`，不 quit、不暂存、不启动。实测依据：同一构建的 dist 与 `/Applications` CDHash 完全相同（`b42edc22…`），此前重复执行的安装全部是空操作，却每次都打断了用户。

**事务化安装（为什么「装到一半停住、旧 App 已删、代理全断」已根治）**：过去的安装把不可逆动作（退出 GUI、提权杀服务、`rm -rf` 旧包、`ditto` 新包）排在可能失败的特权步骤（补 setuid，硬失败）之前，一失败就停在半途；11-15 重装 `d4b25f7` 正是如此：失败原因被 `2>/dev/null` 吞掉、输出没有时间戳，代理中断约 5 分钟，setuid 是订阅调度拉起的无窗口 CLI 碰巧补上的。现在的顺序保证任何一步失败（含 Ctrl-C、`kill`、`kill -9` 之后重跑）系统最终只会停在「旧包原样可用」或「新包已验证」之一：**暂存并校验**（不碰现有安装）→ **静默**（标记让订阅调度与看门狗避让）→ **两次 rename 换装**（旧包留作备份，没有「先删旧包再慢慢拷」的窗口）→ **门禁**（代理端口 + 数据面；service 模式再要求新内核与 TUN 监听）→ 通过才**提交**（删备份），否则 rename 回滚并重新拉起旧包。回滚与中断恢复共用同一份决策表，沙箱测试对每个失败点与每个 `kill -9` 点逐一验证。**已知边界**：断电或 macOS 在两次 rename 之间崩溃（下次启动按决策表恢复）；macOS「App 管理」权限拦截对 `/Applications/Sparkle.app` 的改名（第一个 `mv` 失败，旧包原样，日志给出原因）；门禁只证明代理端口、数据面、新内核、TUN，不等于全部功能；root 服务二进制变化时服务进程仍是旧版本（重启它需要管理员授权，不在升级里强行弹框，日志 `NOTE` 如实告知）。

## 依赖

- `package.json` version = 目标 semver
- `BUGFIX_LOG.md` §「Sparkle 本地安装」· §「AI Agent 操作约束」
- 本目录按「模块 + 7 日」归档的缺陷日志 `scripts_<起>_<止>_BUGFIX_LOG.md`，最新一份 [scripts_20261107_20261113_BUGFIX_LOG.md](scripts_20261107_20261113_BUGFIX_LOG.md)（构建 chunk、测试门禁、Dock 残留注册、`check:drift` 误报）
