# scripts — 运维与构建脚本

Shell/TS 脚本：本地升级与安装、安装前后门禁、post-upgrade 验收、内核契约校验、GUI 看门狗、构建与发布辅助、离线配置工具。

`*Core.ts` 是各脚本的纯判定层，与同名 `*.test.ts` 同目录，随 `pnpm run test:node-quality`（`src/**` 与 `scripts/**` 的全部 `*.test.ts`）一并执行。

## 升级与安装

| 文件 | 职责 |
| --- | --- |
| `agent-sparkle-upgrade.sh` | **Agent SSOT**：持锁之后最先跑文档门禁 `docDrift/docDriftCli.mts`（文档与代码对不上就拒绝，此时没有任何清理、构建或安装发生），再由 `report_remote_sync` 只读地提示本地与远程有没有分叉（只警告，不拦截），再由 `report_ci_status` 提示远程分支的 CI 是红是绿（构建与安装开始之前唯一联网的一步，限时、只警告），再跑 `sparkle-pre-install-hygiene.mts` 与 `test-gui-watchdog-fuse.sh`；dist 与源码指纹一致则仅 install，否则 full upgrade；装后数据面就绪门禁 + profile due-check（后台 worker 由安装器预检阶段保证就位，这里不安装）。入口持原子锁（`${TMPDIR}/sparkle-agent-upgrade-entry.lock`），已有升级在跑直接拒绝启动 |
| `upgrade-sparkle-local.sh` | 本地 dev 一条龙：**原子互斥锁**（`${TMPDIR}/sparkle-agent-upgrade.lock`，持有者 pid 已死或超时才接管；退出时不论成功、失败还是 `INT/TERM`，都释放锁并删除自己建的 pnpm 垫片目录 `${TMPDIR}/sparkle-pnpm-shim.*`）→ 清理 `out/` → vite → Stage-A bundle 门禁 → electron-builder dir → Stage-B asar 门禁 → 写 dist build meta → install → 装后检查（进程在运行；close 烟测未就绪只告警）→ PostCoreBootstrap `mihomo API ready` 门控（macOS 26 且未设 `macos26ForceGui` 走 headless 分支，否则走 GUI 就绪门禁）；门控 90 秒内不就绪就 `fail`，**停留现场、不自动重启 App 重试**（重试要么被退出确认框拦住而无效，要么把「装一次」变成反复启停；由操作者读日志定位根因，`sparkleUpgradeScriptText.test.ts` 守住这一点） |
| `install-sparkle-local.sh` | 仅安装 `dist/mac-arm64/Sparkle.app` → `/Applications`，**整个安装是一个可回滚的事务**（见下方「事务化安装」）：预检（拒绝并发、恢复上次被打断的事务、校验源包、基线探测、**幂等短路**、确认后台 worker 认静默标记且 launchd 调度的就是这份副本、空间与权限）→ 暂存（同目录拷贝并校验签名与 CDHash，再按需补 setuid）→ 静默（写标记、退出 GUI、让服务停掉托管内核、清僵尸 mihomo socket）→ 换装（两次 rename，旧包留作备份；备份位被占用则在写阶段文件之前拒绝）→ 启动并过门禁 → 提交或回滚。提交之后的收尾（记 CDHash、把重复的 `~/Applications/Sparkle.app` 改名为 `.bak.<UTC 时间>` 留存并只留这一份、服务二进制变化提示、Gatekeeper 手动放行提示）只是记账：失败只告警，不改变已成功的结果。重复副本的备份只留最近一份：新备份落地后，本脚本更早留下的备份（`.bak.` 后面精确是 UTC 时间戳；符号链接与手工命名的不动）先向 LaunchServices 注销其中所有 `.app` 子包（Helper）的登记，再删除——只删不注销会留下指向不存在路径的登记，Dock 随后出现幽灵图标；`lsregister -u` 对本来没登记的路径返回 1 并报 `-10814`，按「本来就没登记」处理，其余错误则保留该备份、留给下次安装重试（工具路径可由 `SPARKLE_LSREGISTER` 覆盖，沙箱用桩替换）；改名失败时不删任何备份。Gatekeeper 提示依赖的 `spctl` 评估在真机上要几秒到二十秒（随系统负载而变），所以只在装进来的 CDHash 与之前不同（含首次安装）时才做，被拒绝才输出手动放行的办法；同一份字节重装不做。退出码：0 成功 · 1 失败（系统未变或已恢复）· 3 新包被门禁拒绝并已回滚 · 4 自动回滚失败（需人工，现场保留）。每一步写入 `~/.sparkle/install-last.log`（上一轮为 `install-prev.log`）；`SPARKLE_FORCE_REINSTALL=1` 绕过短路 |
| `.shellcheckrc`（仓库根） | shellcheck 配置：`external-sources=true` + `source-path=SCRIPTDIR`，让 shellcheck 沿 `source` 追到 `scripts/lib/*.sh`（库之间互相 source，路径相对当前脚本所在目录） |
| `lib/login-home.sh` | `sparkle_pin_login_home`：把 `HOME` 固定为登录用户真实主目录（Agent 沙箱会改写 `HOME`，门禁/护栏需读真实日志与状态目录）；`upgrade-sparkle-local.sh` 构建后、安装与 worker 安装脚本开头调用 |
| `lib/sparkle-paths.sh` | 安装/升级脚本共用路径的单一来源（`SPARKLE_STATE_DIR` / `SPARKLE_APP_DATA_DIR` / `SPARKLE_LAUNCH_AGENTS_DIR` / `SPARKLE_INSTALL_DEST`）：默认值派生自已钉住的登录用户 `HOME`，每个都可由同名环境变量覆盖——沙箱测试靠它把整条流水线指向临时目录 |
| `lib/core-setuid.sh` | 内核权限判定的可 source 库（无副作用，只定义函数）：`enabled_core_name`（读 `config.yaml` 的 `core`）、`effective_core_permission_mode`（配置值 + macOS 26 缓解补丁：Darwin ≥ 25 且包内带 `sparkle-service` 时 elevated 视为 service）、`tun_enabled`（读 `mihomo.yaml` 的 `tun.enable`）、`core_setuid_required`（TUN 开启且有效模式不是 service）、`core_setuid_satisfied`、`is_setuid_mode`、`restore_core_setuid`（需要时一次提权补齐并断言，提权命令的 stderr 落日志；非交互模式 `SPARKLE_NONINTERACTIVE=1` 拒绝弹框并给出可手工执行的命令）。**service 模式下内核是 root 服务的子进程，不看 setuid，安装不要求它**；只有 TUN 开启且走 elevated 才补（`ditto` 会丢 setuid：`-rwsr-xr-x` → `-rwxr-xr-x`）。判定刻意用纯 bash：权限位以 `-` 开头，传给 `tsx -e` 会被 node 当成选项而崩溃。与 App 的 `requiresCoreSetuid` 同口径，`src/main/core/coreSetuidScriptParity.test.ts` 逐格对齐 |
| `lib/install-log.sh` | 统一日志：每行带时间戳并同步写入 `~/.sparkle/install-last.log`；`run_captured` 把子命令（含特权命令）的 stdout+stderr 逐行记入日志——用户取消授权、被策略拒绝等原因只出现在那里 |
| `lib/install-app-control.sh` | GUI 与服务托管内核的启停：`app_quit_gui`（先 SIGTERM、超时才 SIGKILL。Electron 把 SIGTERM 当成 `app.quit()`，和 AppleEvent「quit」一样走 App 的 `before-quit`，平时它会弹出要人点的确认框；调用时静默标记已写入，认得标记的 App（`src/main/sys/upgradeQuiesce.ts`）跳过确认框、走正常退出清理；不认标记的 App（早于这项逻辑的构建）确认框会一直挂着、不理会 SIGTERM，只能等满 `SPARKLE_QUIT_TIMEOUT_SEC`（默认 10 秒）再强杀）、`app_launch_and_settle`（先清掉上一个 GUI 留下的 `gui-graceful-quit.stamp`——留着会让看门狗把新进程的一次崩溃当成有意退出；再经 Finder POSIX open 启动）、`app_gui_expected_to_stay`（macOS 26 headless 下没有 GUI 进程是正常的）、`service_core_stop`（经签名 API 让 root 服务停掉托管内核，幂等） |
| `lib/install-gate.sh` | 装后门禁：代理端口监听；升级前数据面本来就通则必须经代理访问外网（升级前就不通是网络问题，不归咎新包）；service 模式下内核必须是升级后新拉起的（`ps etime` 对比升级基线）且 TUN 开启时新内核日志在快照之后出现监听行。按墙钟轮询（默认 90 秒），回滚验证用非严格模式（只看端口与数据面）。`install_short_circuit_reason` 是幂等短路判定 |
| `lib/install-transaction.sh` | 升级事务库：暂存 / 校验 / 换装 / 提交 / 回滚 / 中断恢复。阶段文件 `~/.sparkle/upgrade-state`（`phase`/`pid`/`ts`/`had_prev`，原子写）与静默标记 `upgrade-in-progress`（15 分钟 TTL，每个阶段与每次门禁轮询都会刷新；订阅调度、GUI 看门狗见到它就避让，App 的 `before-quit` 见到它就不弹退出确认框，文件名与 TTL 由 `src/main/sys/upgradeQuiesce.test.ts` 与本库对齐）；回滚与「上次被打断」的恢复走同一份决策表（`txn_plan_recovery`，与 `planInterruptedUpgradeRecovery` 逐格对齐）；`rm -rf` 只允许删暂存 / 备份 / 失败品三个事务私有目录；另一个安装在跑（pid 存活 + 是 bash + 阶段文件不足 1 小时）则拒绝开始，且赶在日志轮转之前 |
| `lib/launchd-agent.sh` | LaunchAgent 幂等安装：worker 内容、plist 内容、已加载 job 的来源路径（`launchctl print` 的 `path =`）三者都一致才跳过；只看「已加载」会被沙箱 shell 改写的 `HOME` 骗过（文件装到别处、真正生效的仍是旧副本）。两个 job 的 label 常量（`SPARKLE_PROFILE_SCHEDULER_LABEL` / `SPARKLE_GUI_WATCHDOG_LABEL`，后者与 `guiWatchdogCore.ts` 的常量由 `guiWatchdogCore.test.ts` 对齐）与 `launchd_agent_foreign_source`（该 label 若是从别的 plist 加载的，返回那份路径）也在这里，安装器预检据此拒绝「刷新之后 launchd 仍在调度一份不认静默标记的旧 job」的状态 |
| `lib/serviceSignedRequest.ts` / `lib/serviceCoreStop.ts` / `sparkle-service-core-stop.mts` | 经 unix socket 的 `SPARKLE-AUTH-V2` 签名请求：共享签名库（`measure-connections-payload.mts`、`sparkle-mihomo-close-smoke.mts`、`reload-mihomo-via-service.mts` 共用，与 App 侧签名由 `src/main/service/serviceScriptSigningParity.test.ts` 对齐）；`serviceCoreStop` 调 `POST /core/stop`（幂等）让服务停掉托管内核，**从不调用 `/service/restart`**（守护进程会在请求里重启自己）。密钥文件只读、不打印 |
| `coreSetuidLib.test.ts` | `lib/core-setuid.sh` 的功能测试：真实 `source` 后跑判定与失败路径（临时目录造伪 App），覆盖权限位识别、启用内核选择、有效权限模式、`ditto` 丢位后判缺失、非交互拒绝提权且不改权限位、sidecar 缺失报错 |
| `installPipeline.test.ts` / `installShortCircuit.test.ts` / `installFaultInjection.test.ts` / `installCrashRecovery.test.ts` / `installBackgroundWorkers.test.ts` / `installParkedDuplicates.test.ts` | 在沙箱里**真实执行**安装流水线（系统自带 `/bin/bash` 3.2）：正常 / 首次安装 / headless / elevated / 短路族（含装后 Gatekeeper 提示只在 CDHash 变化时出现）；换装前的各类失败（暂存拷贝、签名或 CDHash 校验不过、源包缺失、空间不足、目录不可写、后台 worker 不认静默标记、launchd 仍调度别处的旧 job）、静默期里 GUI 不理会 SIGTERM（SIGKILL 兜底）或连 SIGKILL 都杀不掉（回滚）、两次 rename 各自失败与备份位被占用、门禁拒绝（代理不监听、数据面不通、TUN 不起、App 起不来、旧内核仍在）、回滚失败（退出码 4）；每个步骤 `kill -9` 后重跑、回滚中途再被杀、SIGTERM / SIGINT / SIGHUP、并发拒绝与过期阶段文件；后台 worker 的静默标记行为与 LaunchAgent 安装器的幂等、加载路径、`HOME` 钉住；重复的 `~/Applications/Sparkle.app` 改名留存且只留最近一份（先注销 LaunchServices 登记再删、本来没登记也照删、注销出错则保留、符号链接与手工命名的备份不动、改名失败时不删任何备份） |
| `installGateChecks.test.ts` | 门禁与 App 控制库的单函数测试：用同名 shell 函数模拟进程表与内核日志，覆盖沙箱里难以稳定构造的分支（进程在两次查询之间消失、别的包路径下的内核不算新内核、内核日志被截断或换文件、macOS 26 前后 GUI 是否应当常驻） |
| `installLibContract.test.ts` | shell 库与 `sparkleInstallSafetyCore.ts` 逐格对齐：恢复决策表（6 阶段 × 16 种目录组合）、短路判定、setuid 位解析、启用内核名、`etime` 折算、`txn_remove_scratch` 拒绝清单、每个恢复动作都有执行器；静默标记的 TTL 与文件名在事务库、订阅调度 worker、GUI 看门狗三处一致（App 侧由 `src/main/sys/upgradeQuiesce.test.ts` 对齐） |
| `testing/` | 沙箱夹具（另有 `gitRepoFixture.ts`：构建标识测试共用的真实临时 git 仓库；`tempDirs.ts`：脚本测试共用的临时目录，`makeTempDir` 建的目录在进程退出时自动删除，测试文件不用也不会忘记自己清理；`localServer.ts`：本机假 HTTP 服务，`withLocalServer` 在系统分配的空闲端口起服务，跑完回调后不管成败都关掉，包括还挂着的连接）：`installSandbox.ts` 把真实脚本复制进临时目录，PATH 只暴露白名单（真实 `mv` / `rm` / `ditto` / `find` 等文件系统命令 + 一个分发式命令桩 `sandbox-stub.sh`），没被桩住的特权命令表现为 `command not found`，不可能碰到真实系统；故障 / 崩溃 / 挂起由环境变量注入；沙箱里的 GUI 对 SIGTERM 的反应与真实 App 一致——只有静默标记在位才正常退出（并留下「正常退出」戳），否则像挂在确认框上一样不退，逼出 SIGKILL 兜底（`SIM_QUIT_REFUSES` 模拟还没有这项逻辑的旧 App，包行为 `unkillable=1` 模拟连 SIGKILL 都杀不掉）；`installWorld.ts` 是场景规格（新旧包、配置与网络状态、`serviceWorld`、包指纹）；`installAssertions.ts` 是公共不变量（事务关闭、旧包原样、从未删除在用的 App）；`libShell.ts` 是 source 事务库后只跑单个函数的最小外壳；`shellText.ts` 是按函数名从 shell 源码里切出一个函数的小工具（升级脚本的结构断言与 `report_remote_sync` 的函数级测试共用）；`fakeSparkleService.ts` 是签名 API 的假服务 |
| `sparkleUpgradeScriptText.test.ts` | 升级链路结构护栏（行为由上面的沙箱测试证明，这里守「执行覆盖不到、一改就会失效」的约束）：不得把 `-` 开头的值传给 `tsx -e`、全部脚本在 `/bin/bash -n` 下可解析且不含 bash 4+ 写法、source 库无顶层副作用、setuid 判定用纯 bash 并在暂存副本上补、只为启用的内核提权、特权命令不吞 stderr、装后引导失败默认不重启 App、永不调用 service 重启、阶段顺序（所有可能失败的步骤先于第一个不可逆动作）、静默期之前不退 App / 不停内核 / 不换装、短路早于暂存、四种退出路径都有清理、`rm -rf` 只在 `txn_remove_scratch` 与 `prune_older_parked_duplicates`（后者的候选只从 `${USER_COPY}.bak.*` 里遍历，够不着已装的 App）、后台 worker 由安装器负责（先刷新并拒绝陈旧副本）而入口脚本不重复安装、两个入口持原子锁、`upgrade-sparkle-local.sh` 在每条退出路径上删除自己建的 pnpm 垫片目录、入口脚本的远程同步提示与 CI 状态提示依次固定在文档门禁与装前清理之间；同步提示的函数体里没有 fetch / pull / push / ls-remote / remote / clone，也没有 `fail` / `exit`（只读不联网、只警告不拦截），CI 状态提示的函数体里没有 `fail` / `exit`，且探针的失败被吞掉、它的 stderr 不进日志（唯一联网的一步不能成为失败点） |
| `agentUpgradeRemoteSync.test.ts` | `agent-sparkle-upgrade.sh` 里 `report_remote_sync` 的行为测试：取出真实脚本里的这个函数，在临时的「裸远程 + 克隆」里造出同步、有未推送的提交、落后、分叉（落后 1、领先 2）、没有 upstream、游离 HEAD、不在 git 仓库、PATH 里没有 git，逐个断言提示文字，并断言每一种退出码都是 0（`set -euo pipefail` 下也不拦截装包）；PATH 最前面放一个记录子命令的 `git` 桩，断言函数只调用了 `rev-parse` 与 `rev-list`（远程地址指向不存在的路径照样给出结论，即没有联网） |
| `ciStatusCore.ts` | 远程分支 CI 状态提示的全部判断（git 与网络由调用方注入，本模块自己不碰进程、文件系统与网络）：`checkCiStatus` 从当前分支的 upstream 找到远程，`parseGithubSlug` 从各种写法的 GitHub 远程地址（scp 式、`https`、`ssh`、`git`，带凭据也行，主机名严格匹配，`..` 之类的名字拒绝）取出 `owner/repo`，向该仓库 `CI_WORKFLOW_FILE`（唯一在 push 到 master 时跑的 CI 工作流）的状态徽章发一次 GET。读徽章而不是 REST 接口，因为匿名 REST 每小时只有 60 次，额度用尽时直接 403（都是实测）；徽章不占这份配额（实测 REST 额度为 0 时它照常 200）。`parseBadgeState` 读徽章标题里的状态，翻译成**一行**日志：`passing`；`failing`（带 `WARN` 前缀与该分支运行列表的链接）；其他状态原样写出。没有 upstream、不是 GitHub 远程、取不到（HTTP 状态 / 网络错误 / 无应答）、响应读不懂、乃至注入的依赖抛异常，都只说「跳过」，**从不抛异常**。状态只收小写字母与空格：响应来自网络，进日志的字符必须可控；远程地址里的凭据不进日志也不进请求。`createFetchText` 给请求加一个同时覆盖连接、响应头与读完响应体的时限（`CI_STATUS_TIMEOUT_MS`，6 秒：实测一次徽章请求经代理 1–4 秒，留出余量，又不让离线或被黑洞的网络把装包路径拖太久） |
| `ciStatusCli.mts` | 命令行入口（`pnpm run check:ci`）：接上真实的 `git`（只读、限时的 `rev-parse` 与 `remote get-url`）与 `fetch`，在 stdout 打印一行结论，永远以 0 退出；`SPARKLE_CI_STATUS_BASE_URL` 换掉徽章所在的站点（测试指向本机的假服务，也可指向镜像）。`agent-sparkle-upgrade.sh` 的 `report_ci_status` 调用它 |
| `ciStatusCore.test.ts` | 远程地址写法（接受与拒绝两张表，含主机名伪装与 `..`）、徽章标题读法（含控制字符、换行、过长的恶意状态）、每一种「跳过」的原因、只读的 git 调用、凭据不进日志与请求、永远只有一行、依赖抛异常也不外泄；`createFetchText` 对本机假服务验证成功、HTTP 错误、连接被拒、不应答、响应体读到一半停住时的时限；并核对 `CI_WORKFLOW_FILE` 指向的工作流真实存在、在 push 到 master 时触发 |
| `agentUpgradeCiStatus.test.ts` | `agent-sparkle-upgrade.sh` 里 `report_ci_status` 的行为测试：先用桩替换探针（带进探针打印的那一行、按 `$ROOT` 定位探针脚本、失败 / 没输出 / tsx 不存在时说「跳过」、探针的 stderr 不进日志、`set -euo pipefail` 下退出码恒为 0）；再用真实的 tsx 与探针对本机的假徽章服务做端到端：通过、失败（带 `WARN`）、404、连接被拒、不在 git 仓库里（并断言没有发出请求） |
| `tempDirs.test.ts` | `testing/tempDirs.ts` 的行为测试：子进程里建带文件的目录后，正常结束与因未捕获异常崩溃两种结局，目录都被删掉 |
| `testTempDirCleanup.test.ts` | 临时目录结构护栏：`src/` 与 `scripts/` 下谁直接 `mkdtemp`，谁就必须在同一个文件里 `rm` / `rmSync`（共用的 `makeTempDir` 自己兜底，不受此限）；`scripts/` 下 shell 脚本里每个 `mktemp` 的结果必须赋给变量，并且同一文件里有 `rm` 删这个变量（别处的 `rm -rf` 不算数）；否则每跑一次测试或脚本就在系统临时目录里多留一份 |
| `sparkle-pre-install-hygiene.mts` / `sparklePreInstallHygieneCore.ts` | 装前卫生：lifecycle journal 超过 16 MiB 时只保留末尾 8 MiB；数据卷占用 ≥95% 阻断升级 |
| `sparkle-stale-mihomo-socket-hygiene.mts` / `sparkleStaleMihomoSocketHygieneCore.ts` | 探测失败时移除僵尸 `/tmp/sparkle-mihomo-api.sock`（它会阻止内核直连绑定） |
| `evaluate-sparkle-dist-freshness.mts` / `sparkleDistFreshnessCore.ts` / `write-sparkle-dist-build-meta.mts` | dist 新鲜度：build 时把 git commit 与工作区摘要写入 dist 的 `.sparkle-build-meta.json`，install-only 前比对当前源码；退出码 0 = 一致，1 = 过期（强制 full rebuild） |
| `sparkleInstallSafetyCore.ts` | 升级安全的纯判定层（判定语义 SSOT 与文档）：`isCoreSetuidMode`、`resolveInstallShortCircuit`（五条同时成立才跳过安装）、`planInterruptedUpgradeRecovery`（被打断 / 回滚的事务如何收尾：阶段 × 四个目录是否存在 → 动作序列）、`UPGRADE_MARKER_TTL_MINUTES`、`parseLockOwner`/`isLockOwnerActive`/`formatLockOwner`。shell 侧为不依赖 `tsx -e` 传参而用等价纯 bash，本模块保留语义定义与单测，`installLibContract.test.ts` 逐格对齐 |
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
| `measure-connections-payload.mts` | 只读性能测量：经 service socket（Auth V2 签名）拉取真实 `/core/controller/connections` 负载，量出连接数、字节数、每条连接的平均字节、`JSON.parse` 的中位数/P95（200 次采样），并按 500ms 间隔折算常驻 CPU 占比。用于判断「连接流常驻」的开销是否值得按需启停；脚本只做 GET，不改任何配置或连接 |
| `sparkle-mihomo-close-smoke.mts` | 关闭连接烟测：`DELETE /connections/{id}` 必须到达控制器（直连或 service 模式） |
| `check-build-drift.ts` / `sparkleBakedBuildStampCore.ts` | `pnpm run check:drift`：从 `/Applications` 里 `app.asar` 的主进程 bundle 按内容读出烧进去的 commit 与 dirty（不依赖打包器的 chunk 文件名，独立 chunk 与内联进 `index.js` 两种产物都能读），对比仓库 HEAD（commit 不同时再看构建提交之后是否只改了文档 / 测试 / buildStamp，是则不算漂移，判定在 `src/main/core/buildDriftPureCore.ts`），退出码 1 = 漂移 |
| `verify-group-failover.mts` | `pnpm run verify:failover [内核路径]`：故障转移引擎与 agy 被动触发对真实 mihomo 内核的端到端校验（隔离实例，约 2 分钟）；升级或切换内核（含 alpha）后运行，内核告警文案（含逐连接 `[TCP] dial` 行）或拨号失败语义变化时在第一步失败 |
| `mihomoIsolatedHarness.ts` | 隔离 mihomo 端到端校验的公共夹具：随机回环端口、模拟 HTTP 目标与 SOCKS5 节点、内核子进程与控制器客户端；只接触自己创建的进程、端口与目录 |
| `verify-anytls-reuse-option.mts` | `pnpm run verify:anytls-reuse [内核路径]`：AnyTLS 会话复用防护对真实 mihomo 内核的契约校验（`mihomo -t`，约 1 秒，不启动内核）；防护写出的节点必须被接受，同一个键给非 bool 值必须被拒绝（内核对未知键静默忽略，只测前者证明不了选项被识别）；升级或切换内核（含 alpha）后运行，选项改名或被忽略时失败 |
| `verify-antigravity-geo-routing.mts` | `pnpm run verify:agygeo`：agy / cloudcode-pa 流量必须落入 `🎯 agy 专用` |
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
| `prepare.ts` | `pnpm run prepare`：下载 sidecar 资源：mihomo（release / alpha）、geo 数据（mmdb / metadb / geosite / geoip / asn）、字体、sparkle-service、Sub-Store 及其前端，Windows 另含 loopback / runner / monitor / 7zip，每项重试 5 次。`SKIP_PREPARE=1` 时只打印一行提示就以 0 退出，不读也不写任何文件：CI 先 `SKIP_PREPARE=1 pnpm install`（装完依赖后 pnpm 会自动再跑一次根 `prepare`），之后才单独 `pnpm prepare` 下载内核，装依赖时内核本来就还不存在，所以内核是否到位不在这里校验，而由打包边界的 `beforePack.ts` 把关；`prepareSkip.test.ts` 在空目录里真实执行这条分支，要求 0 退出、目录仍为空 |
| `beforePack.ts` | electron-builder 的 `beforePack` 钩子（`electron-builder.yml` 的 `beforePack` 接线）：打包前确认 `extra/sidecar/` 下有目标平台的 mihomo 内核（`win32` 为 `mihomo.exe`，其余为 `mihomo`，必须是非空的普通文件），缺了就抛错并写明补救办法（`node scripts/prepare.ts`，不带 `SKIP_PREPARE`）。`extraResources` 把 `extra/` 原样拷进安装包，缺了内核就会打出一启动就没有内核的包；校验放在打包边界，所以 CI、`pnpm build:*`、`upgrade-sparkle-local.sh` 不论从哪条路进入打包，都由同一处把关。`beforePack.test.ts` 覆盖各平台文件名、空文件、同名目录、缺 `extra/`、钩子只认上下文里的 `projectDir` 与 `electronPlatformName`，并断言 `electron-builder.yml` 里的路径解析到的模块默认导出就是这个钩子、`prepare.ts` 写出内核的文件名与这里一致（一边改名另一边没改，测试变红） |
| `ciWorkflow.test.ts` | 守护 `.github/workflows/build.yml` 的失败自述。Actions 日志要登录才读得到，公开页面上只有「某一步失败」，所以「Install Dependencies and Prepare」与「Build」两步的第一条命令把自己的输出同时落盘（`$RUNNER_TEMP` 下的 `ci-install.log` / `ci-build.log`），失败时最后一步 `Report Failure`（`if: failure()`）把失败那一步日志的最后 120 行（去掉颜色码）写进 job summary，并给报错行打错误注解（最多 10 条，`%` 已转义）；`fail-fast` 关闭，一次运行就能看到各平台各自的结果。测试取出工作流里的 shell 脚本，按 runner 的调用方式（`bash -eo pipefail <脚本文件>`）真实执行：步骤体成功与失败都只跑一遍、失败的退出码与输出带得出来、注解点名失败的步骤、两步都没失败时（失败发生在别处）不把已成功步骤的日志当作原因而保持沉默、没有日志时说明情况而不让 Report 自己失败；并核对两个步骤的 `id` 与 Report 读取的结果环境变量一一对应 |
| `install-electron.ts` | `pnpm run ensure:electron`：按平台下载并解压 Electron 二进制（macOS 用 `ditto`，校验 framework 符号链接） |
| `deepSignMac.cjs` | electron-builder 的 `afterSign` 钩子：整包 ad-hoc 重签（主二进制与 Electron Framework 共用同一身份），清除扩展属性。只对 macOS 目标执行：electron-builder 的 Windows 打包器处理完 exe 就报告已签名，所以 `afterSign` 在 Windows 目标上同样会触发，而 `codesign` 只存在于 macOS，其余平台直接返回。`deepSignMac.test.ts` 按 `electron-builder.yml` 的 `afterSign` 路径加载钩子，在 `PATH` 里放假的 `codesign` / `xattr` 真实执行：macOS 目标按预期参数调用，win32 / linux 目标一次都不调用 |
| `updater.ts` / `checksum.ts` / `telegram.ts` | 发布流水线：生成 `latest.yml` 并在 changelog 追加下载链接 · 为 `dist/` 产物写 `.sha256` · 向 Telegram 频道推送发布公告 |

## 离线配置工具

| 文件 | 职责 |
| --- | --- |
| `regenerate-work-config.mjs` / `regenerate-work-config.ts` / `tsconfig.regen.json` / `electron-hook.mjs` / `electron-mock.mjs` / `electron-toolkit-mock.mjs` | 在 Electron 之外调用 `generateProfile()` 重写 `work/config.yaml`：加载钩子把 `electron` 与 `@electron-toolkit/utils` 换成桩 |
| `patch-work-config.cjs` / `patch-work-config.ts` | 不启动 App，对现有 `work/config.yaml` 就地补跑分组注入（专用分组按应用配置里的开关注入，与 App 同口径）、规则目标修复、分组归一与自动选路组，输出 `PATCH_OK` |
| `reload-mihomo-via-service.mts` | 经 `/tmp/sparkle-service.sock` 的 `SPARKLE-AUTH-V2` 签名请求（共享签名库 `lib/serviceSignedRequest.ts`），对 service 模式内核执行 `PUT /configs?force=true`（整配置重载，输出 `reload_ok`） |

## 文档守护

`docDrift/` 把「文档与代码是否一致」做成可执行的检查：文件头（L4 的 `[INPUT]` / `[OUTPUT]` / `[POS]`）、各目录 `_ARCH.md`（L3）、根 `ARCHITECTURE.md`（L1）里点了名的东西，必须真实存在于代码里。**两个强制点**：漂移会让 `pnpm run test:node-quality` 变红；也会让 `pnpm run check:docs`（命令行入口 `docDriftCli.mts`，只对真实仓库对账一次，装载失败同样非零）以 1 退出，而 `agent-sparkle-upgrade.sh` 持锁之后最先跑它，装包前就被拦下。报错都带文件、规则名与（定位得到时的）行号。只判定「写了就必须是真的」：没有任何标签的文件（shell 脚本里 `#` 写法的文件头也读不到）、自由写法的 INPUT（没有 `模块::符号` 或没有 POS）、OUTPUT 没列全某个导出、散文里没挂常量名的数字都不判定，这些靠人审，守护不猜。守护只做正则级解析（不引入 TypeScript 编译器），对账一次很轻，所以能随每次测试、每次装包运行；规则层只读内存快照、不碰磁盘，每条规则的正反例都是几行字符串。

| 文件 | 职责 |
| --- | --- |
| `docDrift/docDriftCore.ts` | 入口 `checkDocDrift`：对一份仓库快照跑全部规则，返回按文件、行号、规则排序的漂移列表；`formatFinding` / `formatFindings` 出逐条报错文本，`formatDriftReport` 出整份报告（条数、怎么改、逐条明细；过与拦由调用方按漂移列表是否为空判定，不依赖报告文字）。守护自己的测试与夹具里全是编造的示例名字，不计入「代码事实」（算进去会让文档里同名的过期标识符也查得到），守护的生产代码照常计入 |
| `docDrift/docDriftParse.ts` | 文本解析层：文件头三段（行注释与块注释两种写法，同一标签以第一次出现为准，只扫开头 60 行）、INPUT 的规范写法 `模块::符号 (POS: …)`、OUTPUT 点名的导出（`a/b` 并列、`名字: 说明`、`*` 通配；整条含说明文字的当散文跳过）、文件的真实导出（含 `export *` 转发、`export default` 表达式里的名字、`.d.ts` 的全局声明）、代码里出现过的标识符 |
| `docDrift/docDriftIndex.ts` | 数据模型（`RepoSnapshot`、`DriftFinding`、`DriftRule`）、路径分类与源码索引：INPUT 里的模块写法按路径后缀解析成源码文件，同名多个时取离引用方最近的，仍分不出才算歧义（跳过，不猜）；以仓库路径或相对路径写的按整条路径精确匹配；导出集合追进 `export *`，转发环有保护 |
| `docDrift/docDriftHeaderRules.ts` | 文件头规则：三段齐全（`header-incomplete`）、OUTPUT 点名的导出真实存在（`output-not-exported`）、INPUT 点名的模块与符号真实存在（`input-module-missing` / `input-not-exported`；npm 依赖与 Node 内置模块不算缺失） |
| `docDrift/docDriftDocRules.ts` | 文档规则：反引号里的源码文件名与 UPPER_SNAKE / 驼峰标识符仍在（`doc-file-missing` / `doc-identifier-missing`，存在与否按「代码里是否出现过这个词」判，注释里的词也算；文档里合法出现、但不在本仓库代码里的外部名字登记在 `EXTERNAL_NAMES`）、相对链接可达（`doc-link-broken`）、根 `ARCHITECTURE.md` 的模块导航链到每份 `_ARCH.md`（`arch-not-linked`）、`_ARCH.md` 登记了本目录的每个源码文件（`arch-file-unlisted`；测试、`.d.ts`、`*Rig` / `*Harness` / `*World` 夹具与子目录除外）；围栏代码块里的内容不读 |
| `docDrift/docDriftNumberRules.ts` | 数值规则：文档写成「`常量名`（数值）」或「`常量名` = 数值」时与代码常量比对（`doc-number-mismatch`）；时间常量按名字后缀折算到毫秒（`30 分钟` = 1,800,000），其余按个数；常量值只认数字、已知常量与四则、括号；同名常量在不同文件里值不同视为歧义，不判定 |
| `docDrift/docDriftRepo.ts` | 磁盘装载层，守护里唯一碰文件系统的一环：遍历仓库（跳过 `node_modules`、`.git` 与 `SKIPPED_ROOT_DIRS` 里 `.gitignore` 已忽略的产物、下载资源与草稿目录），收录全部文件路径、源码与脚本文本、根 `ARCHITECTURE.md` 与各 `_ARCH.md`、`package.json` 依赖与 Node 内置模块名。遍历磁盘而不是读 git 索引，刚新建、还没 `git add` 的文件也在范围内；目录里没有根 `ARCHITECTURE.md` 就抛错（规则层没有它会放过模块导航检查，不能让「什么都没查」表现成通过） |
| `docDrift/docDriftCli.mts` | 命令行入口（`pnpm run check:docs`）：对脚本所在的这份工作树对账一次，一致就打印一行结论、退出 0，有漂移把报告打到 stderr、退出 1；装载失败抛错，同样非零。`agent-sparkle-upgrade.sh` 的装包前门禁直接调用它，不跑守护自己的测试，输出里只有漂移本身 |
| `docDrift/docDriftRig.ts` | 各测试共用的夹具：几行字符串拼出内存快照与文件头 |
| `docDrift/docDriftParse.test.ts` / `docDriftHeaderRules.test.ts` / `docDriftDocRules.test.ts` / `docDriftNumberRules.test.ts` | 解析文法与每条规则的正反例（内存快照）：哪些写法算「点名」要核对、哪些是说明文字不核对，歧义、外部模块、通配、转发环、围栏代码块、单位换算等边界 |
| `docDrift/docDriftRepo.test.ts` | 守护的出口：**真实仓库此刻必须零漂移**，有漂移就红；并要求扫到足够多的 `_ARCH.md`、源码与带文件头的文件（装载层坏了不会因为「什么都没扫到」而通过）；装载范围用临时目录里的迷你仓库验证，`SKIPPED_ROOT_DIRS` 的每一项都必须在 `.gitignore` 里，没有根 `ARCHITECTURE.md` 的目录拒绝装载 |
| `docDrift/docDriftGate.test.ts` | 装包前门禁的出口测试：在迷你仓库（复制守护的生产代码与 `scripts/package.json`，后者把 `scripts/` 声明成 ESM）里真实运行命令行入口——一致时退出 0 并打印结论、有漂移在 stderr 列明并退出 1、缺根文档时失败；再把真实的 `agent-sparkle-upgrade.sh` 复制进去，`tsx` 换成桩（只放行文档门禁，其余步骤只记录调用并失败；HOME、TMPDIR 与入口锁都指向临时目录，沙箱里没有安装脚本），验证漂移时在任何其他步骤之前拒绝升级、一致时放行到下一步（迷你仓库不是 git 仓库，远程同步提示在这里只是跳过、不拦截；CI 状态提示的探针被桩弄失败，日志说「跳过」，升级照样先后调用探针与装前清理） |
| `docDrift/docDriftMutation.test.ts` | 灵敏度验证：在真实仓库快照的内存副本上注入漂移（改名被 INPUT 引用的导出、OUTPUT 多写不存在的名字、缺 `[POS]`、删掉文档点名的文件、抹掉 `_ARCH.md` 对某文件的登记、模块导航少链一份、文档写不存在的标识符与链接、文档给常量写的数值与代码对不上），每一种都必须被抓出来；不碰磁盘 |

改代码后守护报错时：改名 / 删除导出 → 同步该文件的 `[OUTPUT]` 与引用方的 `[INPUT]`；新增 / 删除源码文件 → 同步所在目录的 `_ARCH.md`；新增 `_ARCH.md` → 在根 `ARCHITECTURE.md` 的模块导航加一行；改常量值 → 改文档里写过的数值；文档里出现外部名字 → 登记 `EXTERNAL_NAMES`，不要为过测试改文档措辞。`pnpm run check:docs` 随时可以单独跑，改完文档当场验证，不必等整套测试。

## Agent 升级（唯一入口）

```bash
cd /path/to/sparkle
bash scripts/agent-sparkle-upgrade.sh
```

等价 `pnpm run agent:upgrade:mac`。禁止 Agent 裸跑 `pnpm build:mac` 或后台 build 后忘记 install。

**文档门禁（持锁后的第一步）**：`docDrift/docDriftCli.mts` 对脚本所在的工作树做文档与代码的一致性对账，有漂移就 `fail` 退出。此时还没有装前清理（会截断日志）、构建与安装，所以被拒绝等于什么都没动；报错逐条列出「文件:行 [规则名] 说明」，照「文档守护」一节末段的对照改文档，再重跑。门禁没有绕过开关（环境变量或参数）。它判的是整个工作树，共享工作区里别的会话写到一半的文件会让它变红，此时从干净的 `git worktree` 升级；单独运行 `upgrade-sparkle-local.sh`（`pnpm run upgrade:mac`）不经过它。`docDrift/docDriftGate.test.ts` 用桩替换其余步骤，验证漂移时在任何其他步骤之前拒绝、一致时放行。

**远程同步提示（门禁之后、装前清理之前）**：`report_remote_sync` 读当前分支已有的 upstream 引用，与 `HEAD` 比较领先、落后的提交数，打一行 `Remote sync:` 日志——同步；有未推送的提交；落后（给出 `git merge --ff-only` 的快进做法）；分叉（说明先合并、不改写历史、不强制推送）；没有 upstream、游离 HEAD、不在 git 仓库、PATH 里没有 git 时只说跳过。**只警告，永远不影响退出码**（拦截会让紧急装包被一件与构建无关的事卡住）；**只读、不联网**（联网会让装包路径多一个会被代理抖动打断的失败点），所以只反映最近一次 `fetch` / `push` 之后的状态，看不到远端刚发生的新提交；本地领先是工作中的常态，所以这是提醒而不是门禁。它存在的原因是分叉每个工作段都在悄悄加重、此前没有任何步骤会提醒。`agentUpgradeRemoteSync.test.ts` 验证每种状态的文字与退出码，`sparkleUpgradeScriptText.test.ts` 守住位置与「不联网、不拦截」；单独运行的 `upgrade-sparkle-local.sh` 不经过它。

**CI 状态提示（远程同步提示之后、装前清理之前）**：`report_ci_status` 调用 `ciStatusCli.mts`，打且只打一行 `CI status:` 日志——远程分支的工作流是 `passing`；`failing`（`WARN` 前缀，附该分支运行列表的链接）；其他状态原样写出；取不到、读不懂、没有 upstream、探针没跑起来都说「跳过」。它存在的原因是红灯没人看见就会一直红下去：工作流的失败自述解决「看得懂原因」，这一步解决「看得见红灯」。**只警告，永远不影响退出码**：函数里没有 `fail` / `exit`，探针的失败被吞掉，它的 stderr（Node 的弃用警告之类）不进日志。**这是构建与安装开始之前唯一联网的一步**（文档门禁、同步提示、装前清理、看门狗熔断、dist 新鲜度判定都不联网），所以它被约束成不可能成为失败点：只对状态徽章发一次 GET，限时 `CI_STATUS_TIMEOUT_MS`（6 秒），最坏情况是多等一个时限；不走 REST 接口，不占匿名额度。它反映的是远程分支的状态，不含本地还没推送的提交，也可能滞后几分钟（徽章响应带 300 秒的缓存头）。Node 的 `fetch` 默认不读 HTTPS_PROXY 之类的环境变量（实测），所以探针只走直连或透明代理（TUN）；必须靠环境变量代理才能上 GitHub 的机器上，它会一直说「取不到」，这是已知边界。`ciStatusCore.test.ts` 与 `agentUpgradeCiStatus.test.ts` 验证各种状态与退出码，`sparkleUpgradeScriptText.test.ts` 守住位置与「不拦截」；`pnpm run check:ci` 可随时单独跑；单独运行的 `upgrade-sparkle-local.sh` 不经过它。

**一次到位（铁律）**：改动先在源码层闭环（全量测试 + typecheck + lint 全绿、已提交）再触发升级；一次升级命令只跑一次、只对应一次 App 启停，禁止并发或重复触发；命令被中断后先用 `evaluate-sparkle-dist-freshness.mts`、`/Applications/Sparkle.app` 落盘时间与 App 日志核查已完成到哪一步，再决定续跑或收尾，禁止不查状态直接重跑；装后验收只用只读门禁（`mihomo API ready` 日志、`sparkle-data-plane-readiness.mts`），失败先离线定位根因，不拿反复重装试错。

**重跑前必须确认没有构建进程**（这是 `app.asar` 损坏的唯一成因）：工具层报「命令中断」只表示调用方放弃等待，**构建进程可能仍在后台写 `dist/` 与 `out/`**。任何重跑前先执行 `ps aux | rg "electron-builder|agent-sparkle-upgrade|upgrade-sparkle-local"`，有残留必须先杀掉再重跑；两个构建并发写同一份 `dist` 会产出截断的 `app.asar`，表现为 App 启动零输出立即退出。App 装后打不开时的最短排查链：`node --check out/main/index.js` → 解析 asar header 长度 → 读包内 `package.json` 是否为合法 JSON → 检查 `SingletonLock` 是否指向已死 pid。

**内核权限（setuid）的口径**：`ditto` 不保留 root 属主与 setuid 位，每次安装都会丢掉内核的 setuid。内核拿到 TUN 权限有两条路：`elevated`（内核自带 setuid，GUI 以普通用户拉起它）与 `service`（内核是 root 服务的子进程，**不看 setuid**）。App 的 `tunStartupGuard` 与安装脚本用同一口径（`requiresCoreSetuid`：TUN 开启且有效模式不是 service，口径由 `coreSetuidScriptParity.test.ts` 对齐），只在需要时才要求 setuid：需要时在**暂存副本**上给当前启用的内核补 setuid 并断言——它是整条流水线里唯一可能弹密码框、被取消的步骤，排在所有不可逆动作之前；service 模式既不补也不弹；装后不自动重启重试（自动重试只会把「装一次」变成反复启停；门控不就绪就停在现场）；服务托管的内核经签名 API（`POST /core/stop`）停掉，不提权杀服务。

**幂等短路（避免无谓打断）**：`install-sparkle-local.sh` 在暂存与 quit 之前判定「CDHash 与已装版本一致 + App 在跑（或本就不该常驻）+ 数据面通 + 内核权限要求已满足」，全中直接 `exit 0`，不 quit、不暂存、不启动，并在 `SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER` 指向的文件里留下标记，让 `agent-sparkle-upgrade.sh` 跳过装后门禁；任何一条不满足都走真实安装（内核权限要求不满足是必须修的缺陷，不能被「看起来已装好」掩盖）。同一份源码的构建产物在 `dist` 与 `/Applications` 里 CDHash 相同，所以重复触发的升级是空操作，不会打断用户。

**事务化安装的保证**：不可逆动作（退出 GUI、停内核、换装）都排在所有可能失败的步骤（校验、补 setuid、空间与权限）之后；任何一步失败（含 Ctrl-C、`kill`、`kill -9` 之后重跑）系统最终只会停在「旧包原样可用」或「新包已验证」之一：**暂存并校验**（不碰现有安装）→ **静默**（标记让订阅调度与看门狗避让，也让 App 跳过退出确认框）→ **两次 rename 换装**（旧包留作备份，没有「先删旧包再慢慢拷」的窗口）→ **门禁**（代理端口 + 数据面；service 模式再要求新内核与 TUN 监听）→ 通过才**提交**（删备份），否则 rename 回滚并重新拉起旧包。回滚与中断恢复共用同一份决策表，沙箱测试对每个失败点与每个 `kill -9` 点逐一验证；每一步（含被捕获的特权命令输出）写入带时间戳的 `~/.sparkle/install-last.log`。**已知边界**：断电或 macOS 在两次 rename 之间崩溃（下次启动按决策表恢复）；macOS「App 管理」权限拦截对 `/Applications/Sparkle.app` 的改名（第一个 `mv` 失败，旧包原样，日志给出原因）；门禁只证明代理端口、数据面、新内核、TUN，不等于全部功能；root 服务二进制变化时服务进程仍是旧版本（重启它需要管理员授权，不在升级里强行弹框，日志 `NOTE` 如实告知）；不认静默标记的旧 App 会让退出确认框一直挂着，安装器等满 `SPARKLE_QUIT_TIMEOUT_SEC`（默认 10 秒）后强杀。

## 依赖

- `package.json` version = 目标 semver
