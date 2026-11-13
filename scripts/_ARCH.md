# scripts — 运维与构建脚本

Shell/TS 脚本：本地升级与安装、安装前后门禁、post-upgrade 验收、内核契约校验、GUI 看门狗、构建与发布辅助、离线配置工具。

`*Core.ts` 是各脚本的纯判定层，与同名 `*.test.ts` 同目录，随 `pnpm run test:node-quality`（`src/**` 与 `scripts/**` 的全部 `*.test.ts`）一并执行。

## 升级与安装

| 文件 | 职责 |
| --- | --- |
| `agent-sparkle-upgrade.sh` | **Agent SSOT**：安装前先跑 `sparkle-pre-install-hygiene.mts` 与 `test-gui-watchdog-fuse.sh`；dist 与源码指纹一致则仅 install，否则 full upgrade；装后数据面就绪门禁 + profile scheduler 安装 + profile due-check |
| `upgrade-sparkle-local.sh` | 本地 dev 一条龙：清理 `out/` → vite → Stage-A bundle 门禁 → electron-builder dir → Stage-B asar 门禁 → 写 dist build meta → install → 装后检查（进程在运行；close 烟测未就绪只告警）→ PostCoreBootstrap `mihomo API ready` 门控（macOS 26 且未设 `macos26ForceGui` 走 headless 分支，否则走 GUI 就绪门禁）；门控失败时按轮次调用 post-install recovery |
| `install-sparkle-local.sh` | 仅安装 `dist/mac-arm64/Sparkle.app` → `/Applications`；装前清僵尸 mihomo socket（失败不阻断），装后安装 GUI 看门狗（失败只告警）并启动 App |
| `lib/login-home.sh` | `sparkle_pin_login_home`：把 `HOME` 固定为登录用户真实主目录（Agent 沙箱会改写 `HOME`，门禁/护栏需读真实日志与状态目录）；`upgrade-sparkle-local.sh` 构建后、`install-sparkle-local.sh` 开头调用 |
| `sparkle-pre-install-hygiene.mts` / `sparklePreInstallHygieneCore.ts` | 装前卫生：lifecycle journal 超过 16 MiB 时只保留末尾 8 MiB；数据卷占用 ≥95% 阻断升级 |
| `sparkle-stale-mihomo-socket-hygiene.mts` / `sparkleStaleMihomoSocketHygieneCore.ts` | 探测失败时移除僵尸 `/tmp/sparkle-mihomo-api.sock`（它会阻止内核直连绑定） |
| `evaluate-sparkle-dist-freshness.mts` / `sparkleDistFreshnessCore.ts` / `write-sparkle-dist-build-meta.mts` | dist 新鲜度：build 时把 git commit 与工作区摘要写入 dist 的 `.sparkle-build-meta.json`，install-only 前比对当前源码；退出码 0 = 一致，1 = 过期（强制 full rebuild） |
| `upgrade-sparkle-post-install-recovery.mts` | 装后内核引导失败时的恢复：socket 卫生 + GUI 重启 |
| `open-sparkle-gui-macos26.sh` | macOS 26 SSOT：带 GUI 启动（`--sparkle-force-gui`） |
| `sparkle-profile-scheduler.sh` / `install-sparkle-profile-scheduler.sh` | LaunchAgent worker（远程订阅到期刷新）与其安装脚本 |

## 门禁与验收

| 文件 | 职责 |
| --- | --- |
| `verify-sparkle-bundle.mts` | `pnpm run verify:bundle`：Stage-A（out/main）bundle marker 门禁，`--with-asar` / `verify:bundle:full` 加 Stage-B（app.asar） |
| `verify-sparkle-main-bundle.mts` | `upgrade-sparkle-local.sh` 调用的 Stage-A 门禁，扫描 `out/main/*.js` |
| `verify-sparkle-main-asar.mts` | Stage-B：app.asar 内 main bundle marker 门禁 |
| `sparkleMainAsarSourceCore.ts` / `upgradeSparkleAsarGateCore.ts` | 两阶段共用：收集 main 进程源码文本（磁盘 `out/main/*.js` 或 asar）· `assertSparkleMainAsarBundle` 断言 bundle 含 `appendAppLog`、不含 PCRE 内联标志正则（如 `/(?i)/`，启动即 SyntaxError）、含 Core Readiness 门 |
| `upgradeSparklePostInstallGateCore.ts` | 装包后门禁纯函数：按安装行偏移计 PostCoreBootstrap 失败 / API 就绪 / headless 引导完成 |
| `sparkle-data-plane-readiness.mts` | 数据面就绪探针：经本机代理端口（默认 `127.0.0.1:7890`）重试探测，Agent 装后门禁的 SSOT |
| `sparkle-mihomo-close-smoke.mts` | 关闭连接烟测：`DELETE /connections/{id}` 必须到达控制器（直连或 service 模式） |
| `check-build-drift.ts` | `pnpm run check:drift`：对比 `/Applications` 运行的 app 与仓库 HEAD，退出码 1 = 漂移 |
| `verify-group-failover.mts` | `pnpm run verify:failover [内核路径]`：故障转移引擎对真实 mihomo 内核的端到端校验（隔离实例，约 2 分钟）；升级或切换内核（含 alpha）后运行，内核告警文案或拨号失败语义变化时在第一步失败 |
| `mihomoIsolatedHarness.ts` | 隔离 mihomo 端到端校验的公共夹具：随机回环端口、模拟 HTTP 目标与 SOCKS5 节点、内核子进程与控制器客户端；只接触自己创建的进程、端口与目录 |
| `verify-antigravity-geo-routing.mts` | `pnpm run verify:agygeo`：agy / cloudcode-pa 流量必须落入 `🎯 agy 专用` |
| `verify-vps-provider-split.sh` | 装后校验 VPS provider 拆分（日本四个标准叶子），非零退出 = 失败 |
| `validate-dns-fix.sh` | DNS 修复验证清单：google 解析为 fake-ip、TUN 与 7890 代理访问 google / chatgpt、本机 sub2api 健康检查；汇总通过 / 失败数，有失败则退出 1 |

## GUI 看门狗

| 文件 | 职责 |
| --- | --- |
| `sparkle-gui-watchdog.sh` | 非预期退出后重启 `/Applications/Sparkle.app`；尊重 GUI 主动退出时写下的 `~/.sparkle/gui-graceful-quit.stamp`；macOS 26 不自动重启（service 保持代理）；崩溃台账熔断。路径与判定常量在 `src/main/sys/guiWatchdogCore.ts`，由漂移测试对齐 |
| `install-sparkle-gui-watchdog.sh` | 安装看门狗 LaunchAgent（先 `bootout` 再 `bootstrap`） |
| `test-gui-watchdog-fuse.sh` | 安装前门禁：崩溃循环熔断不依赖 node 也能统计台账行数 |
| `test-macos26-headless-smoke.sh` / `test-macos26-force-gui-soak.sh` | macOS 26 烟测：headless 启动应干净退出且代理在线；强制 GUI 在 `SOAK_SEC` 内不得 SIGTRAP |

## 构建与发布

| 文件 | 职责 |
| --- | --- |
| `write-build-stamp.ts` / `writeBuildStampCore.ts` | `pnpm run write-build-stamp`：写入 `src/shared/buildStamp.ts`（`YYYY.MMDD.HHMM` 格式 SSOT，含 semver、git commit 与 dirty；非 git 仓库或命令失败记 unknown，漂移检测据此判定需重建） |
| `prepare.ts` | `pnpm run prepare`：下载 sidecar 资源：mihomo（release / alpha）、geo 数据（mmdb / metadb / geosite / geoip / asn）、字体、sparkle-service、Sub-Store 及其前端，Windows 另含 loopback / runner / monitor / 7zip，每项重试 5 次；`SKIP_PREPARE=1` 要求 `extra/sidecar/mihomo` 已存在 |
| `install-electron.ts` | `pnpm run ensure:electron`：按平台下载并解压 Electron 二进制（macOS 用 `ditto`，校验 framework 符号链接） |
| `deepSignMac.cjs` | electron-builder 钩子：整包 ad-hoc 重签（主二进制与 Electron Framework 共用同一身份），清除扩展属性 |
| `updater.ts` / `checksum.ts` / `telegram.ts` | 发布流水线：生成 `latest.yml` 并在 changelog 追加下载链接 · 为 `dist/` 产物写 `.sha256` · 向 Telegram 频道推送发布公告 |

## 离线配置工具

| 文件 | 职责 |
| --- | --- |
| `regenerate-work-config.mjs` / `regenerate-work-config.ts` / `tsconfig.regen.json` / `electron-hook.mjs` / `electron-mock.mjs` / `electron-toolkit-mock.mjs` | 在 Electron 之外调用 `generateProfile()` 重写 `work/config.yaml`：加载钩子把 `electron` 与 `@electron-toolkit/utils` 换成桩 |
| `patch-work-config.cjs` / `patch-work-config.ts` | 不启动 App，对现有 `work/config.yaml` 就地补跑分组注入、规则目标修复、分组归一与自动选路组，输出 `PATCH_OK` |
| `reload-mihomo-via-service.mjs` | 经 `/tmp/sparkle-service.sock` 的 `SPARKLE-AUTH-V2` 签名请求，对 service 模式内核执行 `PUT /configs?force=true`（整配置重载，输出 `reload_ok`） |
| `vps-deploy/` | VPS 侧 sing-box 部署与运维脚本（首尔 Cursor 节点 / 东京通用节点安装、迁移为纯 sing-box、审计日志、2 GB swap 与 OOM 防护），经 ssh 在 VPS 上执行，不被 App 构建链引用 |

## Agent 升级（唯一入口）

```bash
cd /path/to/sparkle
bash scripts/agent-sparkle-upgrade.sh
```

等价 `pnpm run agent:upgrade:mac`。禁止 Agent 裸跑 `pnpm build:mac` 或后台 build 后忘记 install。

## 依赖

- `package.json` version = 目标 semver
- `BUGFIX_LOG.md` §「Sparkle 本地安装」· §「AI Agent 操作约束」
