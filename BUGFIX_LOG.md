# Sparkle Bugfix Log

> **2026-07-22 最新**：① **BUG-2026-07-22-002** — marathon read ETIMEDOUT（0946940c）· P8 `connect_stream_keepalive` @ **1.26.51** ② **BUG-2026-07-22-001** — nudge dial 风暴（4950032b）· defer @ conn≥80 @ **1.26.51**

每次修复用户可感知 bug 后 **必须追加一条**。架构教训与 Cursor 代理操作手册见 [reports/cursor-marathon-playbook.md](reports/cursor-marathon-playbook.md)、[src/main/core/_ARCH.md](src/main/core/_ARCH.md)；本文件只做 **修复台账**（症状 → 根因 → 计划/实际修复 → 版本 → 证据）。

## 记录模板（复制追加）

```markdown
### BUG-YYYY-MM-DD-NNN · vX.Y.Z · 模块名

| 字段 | 内容 |
| --- | --- |
| **状态** | OPEN / FIXED / PARTIAL |
| **症状** | 用户看到什么 / 什么操作失败 |
| **关联产品** | Sparkle / Cursor Usage Guard / Cursor IDE |
| **bug 存在版本** | Sparkle x.y.z（及关联扩展版本） |
| **修复目标版本** | Sparkle x.y.z+1 |
| **根因** | 证据（log / 代码路径 :行号） |
| **修复** | 文件 + 行为变化（一句话） |
| **反复次数** | 第 N 次发现 / 第 M 次修复尝试 |
| **为何反复** | 架构/监控盲区反思 |
| **踩坑** | 后续开发者必读教训 |
| **回归** | 单测 / 手动验证 |
| **用户动作** | 临时 workaround |
| **代码位置** | grep 锚点 |
```

---

## 2026-07-18

### BUG-2026-07-18-005 · v1.26.46 · provider 写入路径二次 guard + 审计日志

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | provider 模式下 `199e64b94e8-vps-proxies.yaml` 重写后仍无 `smux: false`；Factory 审计日志不触发 |
| **修复** | `generateProxyProvider` 写入前二次 `applyVlessVisionMuxGuard`；`setupProfileProviders` 写 VPS 后 `[Provider]: vless_vision_mux_guard` 日志 |
| **回归** | test:node-quality |

### BUG-2026-07-18-004 · v1.26.45 · vision mux guard unconditional smux:false

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 1.26.44 guard 仅在 `smux===true` 时关闭；mihomo 对未显式配置的 vless 可能隐式 sing-mux → 长 marathon 仍 tls-reset/BAD_DECRYPT |
| **bug 存在版本** | Sparkle **1.26.44** |
| **修复目标版本** | Sparkle **1.26.45** |
| **根因** | guard 未对「无 smux 字段」的 vision 节点写入 `smux: false`，隐式 mux 仍可启用 |
| **修复** | `normalizeVlessVisionProxy` **无条件** `smux: false`；启动日志输出 guarded 节点名列表 |
| **回归** | `vlessVisionMuxGuardCore.test.ts` · test:node-quality **131/131** |
| **用户动作** | 安装 **1.26.45** pkg 并重启 Sparkle（触发 generateProfile） |
| **代码位置** | `vlessVisionMuxGuardCore.ts` · `factory.ts` |

### BUG-2026-07-18-003 · v1.26.44 · Reality vision+multiplex → post-turn TLS BAD_DECRYPT

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | RID `b6f815d1` 7min marathon turnEnded 后 Connect BAD_DECRYPT；KR sing-box @ A-69s mux EOF；短 probe 全绿 |
| **bug 存在版本** | Sparkle **≤1.26.43** |
| **修复目标版本** | Sparkle **1.26.44** |
| **根因** | sing-box [#1535](https://github.com/SagerNet/sing-box/issues/1535)：**xtls-rprx-vision 与 multiplex 不兼容**，内层 api2 TLS 解密失败；triage 仅 grep JP VPS 漏采 active KR |
| **修复** | `vlessVisionMuxGuardCore.ts` 生成 profile 时强制 vision 节点 strip multiplex + smux=false；triage 按 ledger/core @ A 解析 active VPS（KR/JP）grep sing-box；**triage SSH grep 引号 bug 修复**（base64 传 pattern + ±2min + log.1 轮转） |
| **回归** | `vlessVisionMuxGuardCore.test.ts` |
| **用户动作** | 安装 **1.26.44** pkg 并重启 core（触发 `generateProfile` 重写 provider）；**不杀连接、不切节点、不限制并行** |
| **代码位置** | `vlessVisionMuxGuardCore.ts` · `provider.ts` · `factory.ts` · `triage-cursor-disconnect.sh` |

### BUG-2026-07-18-002 · v1.26.43 · triage V5.4 空采 + HY2 Marathon 定责

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | triage 脚本 V5.4 恒空；RID `1a4bfbe0` HY2 Marathon 断连无法 definitive |
| **bug 存在版本** | Sparkle triage **≤1.26.42** |
| **修复目标版本** | Sparkle **1.26.43** |
| **根因** | `journalctl --since 5 min ago` 取采集时刻非 A 时刻；真实日志在 `/var/log/sing-box/sing-box.log` UTC 前缀 |
| **修复** | triage 按 `INCIDENT_UTC±1min` grep file log + V5.5 restart 窗口 |
| **回归** | 手动补采 + triage 脚本 · test:node-quality **126/126** |
| **用户动作** | 无锁定；KR-Reality 仅 bootstrap 默认，manual 切换才持久化 |
| **代码位置** | `triage-cursor-disconnect.sh` |

### BUG-2026-07-18-001 · v1.26.42 · Cursor 专用组手动切换被 bootstrap 覆盖

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 代理组页点选 Cursor 专用节点后，重启 Sparkle/core 又变回 KR-Reality；体感「无法切换」 |
| **bug 存在版本** | Sparkle **1.26.38–1.26.41** |
| **修复目标版本** | Sparkle **1.26.42** |
| **根因** | `shouldUpgradeCursorDedicatedNode` 强制 JP-Reality→KR-Reality；无 manual 选择持久化；bootstrap 覆盖用户确认后的节点 |
| **修复** | `cursorDedicatedSelectionCore.ts` 持久化 manual 选择；`mihomoChangeProxy(source:manual)` 写入；bootstrap 优先 restore manual；移除跨区 Reality 强制 upgrade |
| **回归** | `cursorDedicatedDefault.test.ts` · `cursorDedicatedSelectionCore.test.ts` · test:node-quality **126/126** |
| **用户动作** | 升级 1.26.42 后代理组页切换（仍有 ConfirmModal 确认） |
| **代码位置** | `cursorDedicatedDefault.ts` · `cursorDedicatedSelectionCore.ts` · `mihomoApi.ts` |

## 2026-07-17

### BUG-2026-07-17-006 · v1.26.38 · VPS 与商用混 provider 导致 76 节点 batch api2 测速尖峰

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 6 自建 VPS UI 测速频繁 >500ms / 尖峰 2000–4481ms；商用节点也被迫 api2 health-check |
| **关联产品** | Sparkle ≤1.26.37 |
| **根因** | `resolveProviderHealthCheckUrl` 见任意 VPS leaf 即整 provider 改 api2；76 leaf 每 300s 批量探测竞争 TUN |
| **修复** | `vpsProviderSplitCore` + `setupProfileProviders`：商用 `{profileId}`（generate_204）+ VPS `{profileId}-vps`（api2）；Cursor 专用组 `use: [profileId-vps]` |
| **回归** | `vpsProviderSplitCore.test.ts` · `providerVpsSplit.test.ts` · `customProxyGroups.test.ts` |
| **用户动作** | 安装 Sparkle **1.26.38** 并重启 core（自动重写 provider 文件） |

---

### BUG-2026-07-17-006 · v1.26.39 · Agent-stability-first（禁 L1 + Hygiene 保护 api2）

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 1.26.38 后 partition_stale 仍可能 L1 关 critical-host；Hygiene 可能清 api2 长 idle |
| **修复** | `marketplaceOk → none`（禁 L1 split-brain 杀流）；Hygiene 跳过 critical transport host；`cursorCriticalTransportCore.ts` 共享 SSOT |
| **防回归** | `agent-stability-first regression guard` 单测（healthy + partition_stale + hung → none） |
| **用户动作** | 安装 Sparkle **1.26.40+** pkg（含 1.26.39 Agent-stability-first + deep sign 启动修复） |

---

### BUG-2026-07-17-007 · v1.26.40 · 从 dist 直接启动 / pkg 未覆盖 → DYLD Team ID 崩溃

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | Sparkle **1.26.39** 启动即崩溃：`DYLD Library missing` · `@rpath/Electron Framework` · `different Team IDs` · dyld 尝试加载 `dist/mac-arm64/.../Electron Framework` |
| **关联产品** | Sparkle 本地 dev 构建 ≤1.26.39 |
| **根因** | ① **双击 `dist/mac-arm64/Sparkle.app` 直接运行**（非 `/Applications`）· ② electron-builder adhoc 分签名，主二进制与 Electron Framework **Team ID 不一致** · ③ `sudo installer` 未完整覆盖时 `/Applications` 仍为旧版（如 1.26.36）而用户从 dist 启动 |
| **修复** | `scripts/deepSignMac.cjs` + electron-builder 根级 `afterSign`：`codesign --deep --force --sign -` 整包重签后再打 pkg |
| **禁止** | ❌ `open dist/mac-arm64/Sparkle.app` 作为日常使用 · ❌ ditto/cp 覆盖（见 BUG-003）· ❌ 只更新 Info.plist 不替换 Framework · ❌ 复制到 `~/Applications/Sparkle.app`（与 `/Applications` 并存 → Dock 双图标） |
| **正确流程** | `bash scripts/install-sparkle-local.sh`（见 **「Sparkle 本地安装（标准 · 唯一路径）」**）· 或 pkg + `chown` + `codesign` |
| **dev 自测** | 1.26.40+ build 后 dist app 可短暂启动验证；**生产环境只用 `/Applications`** |
| **回归** | build log 出现 `replacing existing signature`；`open dist/.../Sparkle.app` 不 DYLD 崩溃 |
| **用户动作** | 安装 **1.26.40+** pkg，勿从 dist 启动 |

---

### BUG-2026-07-17-005 · v1.26.38 · CTHC L0 误杀 Agent SSE（1.26.36 回归）

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | 今日 Included 计次暴增；单次请求 token 攒不到 20M；`L0 closed N hung` ×112 |
| **关联产品** | Sparkle 1.26.36 |
| **根因** | `decideRecoveryAction` 在 1.26.36 把 hung→L0 提到 healthy 之前；hung_scan 每 30s 杀 Agent 长连接 |
| **证据** | 07-16 app log L0=0 hung=19 action=none；07-17 L0=112/56 events；git a64e9fd diff |
| **修复** | 恢复 healthy 优先；**移除 L0 阶梯**（零 mihomo 吞吐 ≠ 可杀） |
| **回归** | `cursorTransportHealthCore.test.ts` |
| **用户动作** | 安装 Sparkle **1.26.38** pkg 并重启 core |

---

### BUG-2026-07-17-004 · v1.26.37 · vpsL4Probe fake-ip 假阴性

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | ledger `scope=vps` 周期性失败（`Connection closed by 198.18.x.x`），与 `scope=active` JP/KR 同时 OK 矛盾；定责误判 L4 |
| **关联产品** | Sparkle 1.26.36 |
| **根因** | `ssh kr-vps`/`jp-vps` 无 `HostName` 时经 TUN fake-ip 匹配「漏网之鱼」；`ensureVpsDirectBypass` 仅有 IP-CIDR 无 SSH 别名 DOMAIN DIRECT |
| **修复** | `vpsDirectBypass` 注入 `DOMAIN,kr-vps/jp-vps,DIRECT`；`vpsL4ProbeCore` 用 `ssh -G` + leaf 公网 IP 回退 + `ProxyCommand=none`；path 错误写 `authoritative=false` + `probe_attribution` |
| **回归** | `vpsL4ProbeCore.test.ts` · `vpsDirectBypass.test.ts` |
| **用户动作** | 安装 Sparkle **1.26.37** pkg 并重启 core |

---

### BUG-2026-07-17-002 · v1.26.36 · CTHC L0 误杀 Agent Connect 流

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | Agent 仅跑 ~1min 即 `WritableIterable is closed`；events `hung=7` + L0 杀连接；IFM 误标 marathon |
| **关联产品** | Sparkle 1.26.33 + Cursor Usage Guard |
| **根因** | `HUNG_CONNECTION_MIN_AGE_MS=60s` 过短；tool/thinking 间隙 Connect 流零 mihomo 吞吐仍存活；L0 无 newest 保护 |
| **修复** | hung 阈值 **60s→12min**；`selectHungCursorConnectionsToClose` 每 host **保留最新 6 条** 不 L0 杀（并行 Agent 保护） |
| **回归** | `cursorTransportHealthCore.test.ts`（newest 保护 + 12min 阈值） |
| **用户动作** | 安装 Sparkle **1.26.36** pkg 并重启 Sparkle core（**禁止 ditto/cp 覆盖**，见 BUG-2026-07-17-003） |

---

### BUG-2026-07-17-003 · v1.26.35 · ditto/cp 覆盖安装导致 DYLD 崩溃

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（流程文档化） |
| **症状** | Sparkle **1.26.35** 启动即崩溃：`DYLD Library missing` · Electron Framework **Team ID 与主二进制不一致**（`mapping process and mapped file have different Team IDs`） |
| **关联产品** | Sparkle 本地 dev 构建 → `/Applications/Sparkle.app` |
| **根因** | 用 **`ditto` / `cp -R`** 把 `dist/mac-arm64/Sparkle.app` **覆盖**到已安装的 `/Applications/Sparkle.app`，只替换了部分文件；旧版 **Electron Framework** 签名残留，与新 `Sparkle` 主二进制不匹配。**或**从 **`dist/mac-arm64` 直接 `open`**（≤1.26.39 adhoc 分签名，见 BUG-007） |
| **禁止** | ❌ `ditto dist/mac-arm64/Sparkle.app /Applications/Sparkle.app` · ❌ `cp -R` 覆盖 · ❌ 在旧 app 上「增量复制」 · ❌ **`open dist/mac-arm64/Sparkle.app` 日常使用**（必须 `installer` 到 `/Applications`） |
| **正确流程** | 见下方 **「Sparkle 本地 pkg 升级（标准）」** · build **≥1.26.40** 含 `afterSign` deep sign（BUG-007） |
| **验证** | ① `PlistBuddy … CFBundleShortVersionString` = 目标版本 ② `open -a Sparkle` 不崩溃 ③ app-log 出现 `mihomo API ready` ④ `ls /tmp/sparkle-mihomo-api.sock` |

#### Sparkle 本地安装（标准 · 唯一路径）

**Canonical 路径**：仅 `/Applications/Sparkle.app`。禁止与 `~/Applications/Sparkle.app` 并存（service/GUI 分裂 · Gatekeeper 混乱 · `spawn …/sparkle-service ENOENT`）。

**推荐（dev 构建 + 安装 · 一条命令）**：

```bash
cd /path/to/sparkle
pnpm run upgrade:mac
# 等价：bash scripts/upgrade-sparkle-local.sh
```

**仅安装已构建 dist（不重编）**：

```bash
bash scripts/install-sparkle-local.sh
```

**upgrade:mac 流程**：`electron-vite build` → `electron-builder --mac dir`（含 `afterSign` deepSignMac）→ 校验 asar 非 stale → `install-sparkle-local.sh`（`rm -rf` 后 **整包 ditto**，禁止覆盖）→ **Finder POSIX 启动**（绕过 adhoc Gatekeeper 闪退）→ 验证版本 + GUI + mihomo socket。

**禁止**：

- ❌ 只跑 `electron-builder` 不先 `electron-vite build`（asar 缺新代码，见 BUG-004）
- ❌ `open -a` / 双击启动 adhoc 新 CDHash 包（`exit=1` 像闪退，见 BUG-004）
- ❌ install 后二次 `codesign`（CDHash 变 · Gatekeeper 批准作废，BUG-002）
- ❌ ditto/cp **覆盖**旧 `/Applications/Sparkle.app`（DYLD Team ID，BUG-003）
- ❌ `~/Applications/Sparkle.app` 与 `/Applications` 并存（split-brain，BUG-001）

脚本行为：quit GUI（graceful → `pkill -9`）→ 停 `sparkle-service` → **迁移/删除** `~/Applications/Sparkle.app` → `rm -rf` + `ditto` 到 `/Applications` → `xattr -cr` → **不重签** → Finder 启动 → 校验 GUI 运行。

**长期最稳**：Apple Developer ID + notarize（免 Gatekeeper · 可恢复「输密码 pkg 即用」）。

#### AI Agent 操作约束（防重复踩坑）

> 供 Cursor Agent / 自动化脚本读取；**Sparkle 问题只写 sparkle 仓 `BUGFIX_LOG.md`**，勿改 `tools/cursor-usage-watch/docs/BUGFIX_LOG_315.md`（Guard 3.1.15 补丁专账）。

| 必须 | 禁止 |
| --- | --- |
| `pnpm run upgrade:mac` 或 `bash scripts/upgrade-sparkle-local.sh` | 只跑 `electron-builder` 不先 `electron-vite build`（stale asar） |
| 安装前 `rm -rf /Applications/Sparkle.app` 再 **整包 ditto** | ditto/cp **覆盖**旧 app（DYLD · BUG-003） |
| 启动：`install-sparkle-local.sh` 内 Finder POSIX open | 双击 / `open -a` 作为 adhoc 新包首选（Gatekeeper exit=1 像闪退） |
| 仅 `/Applications/Sparkle.app` 单路径 | `~/Applications/Sparkle.app` 并存（split-brain · BUG-001） |
| install 后 **不重签** | install/pkg 后二次 `codesign`（CDHash 变 · BUG-002） |
| 定责读 triage 证据包 + A 时刻三源 | 用 B 时刻探针否定 A 时刻断连 |

**验证安装成功**：`defaults read … CFBundleShortVersionString` · `pgrep -x Sparkle` · `/tmp/sparkle-mihomo-api.sock` · asar 含预期符号（如 `token_gap_force_nudge` @≥1.26.50）。

**等价 pkg 流程**（无 dev 构建时）：

```bash
# 1. 构建（勿 SKIP_PREPARE，pkg 应 ~186MB+，见 BUG-2026-07-09-003）
#    ≥1.26.40：electron-builder afterSign 自动 deep adhoc 重签（BUG-007）
cd /path/to/sparkle
pnpm run build:mac
PKG="dist/sparkle-macos-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' dist/mac-arm64/Sparkle.app/Contents/Info.plist)-arm64.pkg"

# 2. 退出旧进程
osascript -e 'tell application "Sparkle" to quit' 2>/dev/null || true
pkill -f 'sparkle-service service run' 2>/dev/null || true
rm -rf ~/Applications/Sparkle.app 2>/dev/null || true

# 3. 整包替换（必须 rm 旧 app 再 installer，不可 ditto 覆盖）
sudo rm -rf /Applications/Sparkle.app
sudo installer -pkg "$PKG" -target /
sudo chown -R "$(whoami):staff" /Applications/Sparkle.app
xattr -cr /Applications/Sparkle.app
# 勿二次 codesign — 会改 CDHash、作废 Gatekeeper 批准（见 BUG-2026-07-21-002）

# 4. 验证并启动（install 脚本已自动 Finder 启动；pkg 手动时用下面两行）
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Sparkle.app/Contents/Info.plist
osascript -e 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"'
# 等 ~10s 后：tail ~/Library/Application\ Support/sparkle/logs/app-*.log | rg 'mihomo API ready'
```

无交互 sudo 时可用（会弹 macOS 授权框）：

```bash
osascript -e "do shell script \"pkill -9 -x Sparkle 2>/dev/null; pkill -9 -f 'sparkle-service service run' 2>/dev/null; rm -rf /Applications/Sparkle.app; installer -pkg '$PKG' -target /\" with administrator privileges"
```

**CTHC 逻辑变更**（如 1.26.34→1.26.35 hung keep 4）需 **Sparkle UI + sparkle-service 都重启** 后进内存；仅替换二进制不重启 service 仍跑旧逻辑。

---

### BUG-2026-07-17-001 · v1.26.33 · CTHC hung scan 不触发 L0

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | Marathon 46min + 2 路 Agent 断连；events 显示 `hung_connection_count` 12–17 但 `recovery_action=none`；短 probe 全绿 |
| **根因** | `cursorTransportHealthCore.ts` `decideRecoveryAction` 在 `attribution==='healthy'` 时直接 `return 'none'`，hung scan 固定 healthy + 假 probe，L0 分支永不可达 |
| **修复** | hung>0 且 L0 冷却就绪时优先返回 L0；`describeRecoveryBlockReason` 对 healthy+hung 报告 `L0_cooldown` |
| **回归** | `cursorTransportHealthCore.test.ts`（healthy+hung→L0） |
| **用户动作** | 重启 Sparkle core；**保持并行 Agent**（排查手册禁止建议减并行） |

---

## 2026-07-14

### BUG-2026-07-14-001 · v1.26.23 · VPS 稳定性 / provider leaf 测速误报

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.23**） |
| **症状** | ① UI 显示全部 VPS 节点「超时」② 默认回 `KR-VPS-TUIC`（UDP 最不稳）③ HY2/TUIC health 抖动时用户误以为 VPS 挂了并手动切走，掐断 marathon SSE |
| **根因** | ① provider leaf `/proxies/{name}/delay` 固定 404，fallback 读最后一条 health 历史，delay=0 即 UI 全红（Reality 实际可用）② `cursorDedicatedDefault.ts:8` 默认 `KR-VPS-TUIC` 与 2026-07-14 实测证据相反（TUIC auth timeout 17 次/12 天）③ provider health-check 用 `http://generate_204` 与 Cursor api2 流量不一致 |
| **修复** | ① 默认节点 → `JP-VPS-Reality`，TUIC/HY2 标 suboptimal ② VPS provider health-check → `https://api2.cursor.sh` ③ `mihomoProxyDelay` provider fallback 先 trigger healthcheck，取最近成功 delay（跳过尾部 delay=0） |
| **回归** | `cursorDedicatedDefault.test.ts` · `providerHealthCheck.test.ts` · `mihomoProviderDelay.test.ts` |
| **用户动作** | 升级 **1.26.23** 并 **重启 Sparkle 一次**（非 VPS）；专用组可固定 `JP-VPS-Reality` |

---

## 2026-07-09

### BUG-2026-07-09-001 · v1.26.15 · mihomo TUN 出站池僵死 + 自愈闭环缺陷

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.16** 已合入 CTHC） |
| **症状** | ① Cursor Network Diagnostic：`api2` 全系（SSL/API/Ping/Chat/Agent）约 **77s** 后统一 `ConnectError: [unavailable]`；`marketplace.cursorapi.com` / `prod.authentication.cursor.sh` 仍 **200**（364–837ms）。② Cursor Usage Guard（扩展 **0.13.388**）Dashboard 刷新报「**网络连接失败 (Network Error)**」。③ Agent `lastSseCase: heartbeat` + `[unavailable]`，Usage Guard patch-135 正确拦截 auto-retry。④ **退出并重启 Sparkle 后立刻恢复**；换代理节点无效。 |
| **关联产品** | Sparkle **1.26.15**（主因）· Usage Guard **0.13.388**（受害方）· Cursor **3.1.15** |
| **bug 存在版本** | Sparkle **≥1.26.x**；铁证采集于 **1.26.15** |
| **修复版本** | Sparkle **1.26.16** |
| **反复次数** | 第 1 次台账 · 第 1 次代码修复 |
| **修复** | 新增 **CTHC**（`cursorTransportHealthCore.ts` + `cursorTransportHealth.ts`）：L0 挂死连接 / L1 split-brain 清池 / L2 TUN 软清空 / L3 restartCore；删除缓存冒充健康；探针归因不计入节点评分 |
| **回归** | `cursorTransportHealthCore.test.ts` 7 场景全绿 · `cursorConnectionHygieneCore.test.ts` 6 场景全绿 |
| **用户动作** | 升级 Sparkle **1.26.16** 并重启应用；无需手动退出 Sparkle 作为常规 workaround |
| **提交** | —（待用户 commit） |

#### 根因链（第一性原理 · 每条有证据）

**结论：不是 VPS/商用节点质量问题，是 mihomo TUN 出站池僵死 + Sparkle 监控/清理/恢复三重失灵形成的死循环。**

```
① 触发：macOS 网络变动 → mihomo 报 TUN interface lost
   [日志] ~/Library/Application Support/sparkle/logs/core-2026-7-5.log
          "[TUN] default interface lost by monitor"
   [日志] app-2026-7-3.log:1413 "TUN interface lost — restarting mihomo core"
          app-2026-7-3.log:1422-1427 后续 3× "restart skipped (cooldown active)"

② 出站连接池污染：旧 socket 占住，新 api2 连接进入 TUN 后卡住
   [日志] core-2026-7-9.log:31974+ @ 10:41:01 CST
          路由正确 "🎯 Cursor 3.1.15 专用[KR-VPS-TUIC]"，与用户 02:41:39Z 诊断同时段
   [用户诊断] 02:41:39 → 02:42:56 全系 api2 [unavailable]（~77s）
              Marketplace 515ms OK → 不同域名/出站路径未污染

③ 连接清理清不动「挂死」连接
   [代码] cursorConnectionHygieneCore.ts:19
          CURSOR_CONN_IDLE_MIN_AGE_MS = 35 * 60_000  （35 分钟）
   [代码] cursorConnectionHygieneCore.ts:54-58
          isIdleCursorConnection：要求 age≥35min 且 upload/download speed=0
   [代码] cursorConnectionHygiene.ts:13-14
          HYGIENE_INTERVAL_MS=10min，HYGIENE_START_DELAY_MS=12min
   → 等待 api2 响应中的挂死连接（<77s）永远不会被清理
   [日志] app-2026-7-*.log 中零条 "CursorConnectionHygiene" → 僵死期未触发有效清理

④ 连接数≥20 时监控主动失明（关键闭环缺陷）
   [代码] cursorConnectionHygieneCore.ts:4
          CURSOR_CONN_PROBE_DEFER_THRESHOLD = 20
   [代码] networkStabilityMonitor.ts:478-483
          conn≥20 → 跳过真实 HEAD 探针，仅写 cached_defer 事件
   [代码] networkStabilityMonitor.ts:85
          RECENT_PROBE_MAX_AGE_MS = 90_000
   → 僵死期若 conn≥20，90s 内缓存 probe_ok 可冒充健康

⑤ TUN 恢复被误判跳过
   [代码] networkStabilityMonitor.ts:234-258
          TUN lost debounce 后 api2 短探针 OK → "skip restartCore"
   [代码] networkStabilityMonitor.ts:221-226, 614-619
          shouldDeferTunCoreRestart → shouldDeferCursorFailover（缓存 90s 内 OK 即 defer）
   [代码] networkStabilityMonitor.ts:31-32
          TUN_RESTART_COOLDOWN_MS = 10min → 连续 TUN lost 只 restart 一次

⑥ 用户只能手动退出 Sparkle（强制 restartCore）打破死循环
```

#### 次要加剧因素（非本次 77s 全系挂死主因）

| 因素 | 证据 | 影响 |
| --- | --- | --- |
| `PROCESS-NAME` 规则泄漏到商用 `节点选择` | [代码] cursorRuleInjection.ts:76-83, 150 · [日志] core-2026-7-9.log 统计：api2 ProcessName 泄漏 **10222** 次 / 专用 AND **13170** 次 | 部分连接绕开 VPS 专用组；**不是** 10:41 主因（同时段多为 KR-VPS-TUIC） |
| `store-fake-ip: true` | [配置] work/config.yaml:4147 · [代码] utils/template.ts:180 · fakeIpRoutingIntegrity.ts:4-11 | TUN 事件后 fake-ip 映射可能过期，加剧 TLS 挂死 |
| 短探针 timeout 15s | [代码] networkStabilityMonitor.ts:27 PROBE_TIMEOUT_MS=15000 | 探针看不到 77s 级挂死 |

#### Usage Guard 侧说明（受害，非根因）

| 项目 | 内容 |
| --- | --- |
| **调用接口** | `https://cursor.com/api/usage` · `/api/usage-summary` · `/api/dashboard/get-filtered-usage-events` |
| **错误文案** | `poller.ts:513-514` → `fetch failed` / `econnrefused` / `enotfound` 统一为「网络连接失败 (Network Error)」 |
| **与 Sparkle 关系** | 扩展进程 `Cursor Helper (Plugin)` 流量经 mihomo TUN；出站池僵死时 `cursor.com` fetch 同样超时 |

#### 修复方案（**1.26.16 已实装 · CTHC**）

**原则：打破死循环；`restartCore` 仅最后手段（会断进行中的 Agent SSE）。**

| 优先级 | 文件 | 实际改动 |
| --- | --- | --- |
| P0 | `cursorTransportHealthCore.ts` + `cursorTransportHealth.ts`（新） | **CTHC** 恢复阶梯 L0–L3：挂死连接关闭 → split-brain 清池 → TUN 软清空 → restartCore（10min cooldown） |
| P0 | `networkStabilityMonitor.ts` | api2+marketplace 双探针；conn≥20 强制真实探针；禁止缓存冒充健康；TUN lost 走 CTHC 阶梯 |
| P1 | `cursorRuleInjection.ts` | 3.1.15 专用模式 **删除** PROCESS-NAME→节点选择 fallback |
| P1 | `proxyHealthMonitor.ts` · `mihomoApi.ts` | failover defer 仅在 **live** 探针通过后生效 |
| P1 | `nodeProbeStats.ts` · `commercialNodeBenchmark.ts` | `probe_attribution`；`transport_partition_stale` **不计入** VPS 节点评分 |
| P2 | `scripts/prepare.ts` | `SKIP_PREPARE=1` 时若 `extra/sidecar/mihomo` 缺失则 **fail-fast**（防打包空内核） |
| — | `cursorProxyGroup.ts` | 删除未使用 `GENERAL_PROXY_GROUP_NAME`（修复 Rolldown panic） |

**1.26.16 未改 / 遗留：**

- `store-fake-ip` 仍为 `true`（P2 暂缓）
- 35min marathon idle 清理阈值 **不变**（与 CTHC **30s hung 扫描 + 12min 零吞吐判定** 并存；1.26.35+ L0 保留每 host 最新 4 条）
- **专用组 VPS UI 不可见** → 见 **BUG-2026-07-09-002**（1.26.17 修复）

#### 为何此前「翻来覆去修不好」（反思）

1. **症状像节点问题**：api2 超时 → 自然怀疑 VPS/商用节点；但日志证明路由正确时仍挂死。
2. **监控在僵死期失明**：conn≥20 defer + 90s 缓存 → 系统自认为健康，不触发恢复。
3. **清理门槛过高**：35min idle 阈值是为 marathon 保守设计，无法处理 **分钟级** 出站池污染。
4. **TUN restart 有 cooldown**：一次 restart 后 10min 内跳过后续 TUN lost（app-2026-7-3 铁证）。
5. **跨产品归因错误**：Usage Guard「网络连接失败」被当成扩展 bug，实际是 Sparkle TUN 僵死的外显。

#### 踩坑经验（后续开发者必读）

1. **「换节点」不能治 TUN 僵死** — 赛中/僵死期换 Selector 只会 RST 进行中的 SSE（见 playbook §核心原则）。退出 Sparkle = restartCore 才是用户验证过的 workaround。
2. **短探针 OK ≠ api2 可用** — HEAD 15s 超时内 OK，不代表 gRPC 双向流 / 77s 挂死不存在；不得用缓存 probe 阻止 TUN 恢复。
3. **conn≥20 defer 是双刃剑** — 为 marathon 减探针负载，但在僵死期造成监控失明；defer 必须带「强制真实探针」逃逸阀。
4. **区分域名** — `api2.cursor.sh` 僵死时 `marketplace.cursorapi.com` 仍可通；不要用后者 OK 推断前者 OK。
5. **日志判责顺序** — 先看 `core-*.log` 同时段路由规则 → 再看 `network-stability-events.jsonl` → 最后看 Usage Guard Output；避免在扩展侧打补丁。

#### 代码位置（grep 锚点）

| 模块 | 路径 | 关键符号 |
| --- | --- | --- |
| 探针 defer | `src/main/core/networkStabilityMonitor.ts:478-483` | `shouldDeferNetworkProbeForCursorLoad` |
| 探针缓存 | `src/main/core/networkStabilityMonitor.ts:85, 591-610` | `RECENT_PROBE_MAX_AGE_MS` · `getRecentHealthyCursorProbe` |
| TUN 恢复跳过 | `src/main/core/networkStabilityMonitor.ts:221-258` | `shouldDeferTunCoreRestart` · `confirmTunInterfaceLostAfterDebounce` |
| TUN cooldown | `src/main/core/networkStabilityMonitor.ts:31-32, 322-327` | `TUN_RESTART_COOLDOWN_MS` |
| 连接清理阈值 | `src/main/core/cursorConnectionHygieneCore.ts:4, 19` | `CURSOR_CONN_PROBE_DEFER_THRESHOLD` · `CURSOR_CONN_IDLE_MIN_AGE_MS` |
| 清理周期 | `src/main/core/cursorConnectionHygiene.ts:13-14` | `HYGIENE_INTERVAL_MS` · `HYGIENE_START_DELAY_MS` |
| 规则泄漏 | `src/main/core/cursorRuleInjection.ts:76-83, 150` | `injectCursorGeneralProxyFallbackRules` |
| 关闭连接 API | `src/main/core/mihomoApi.ts:120-146` | `mihomoCloseConnection` · `mihomoCloseConnections` |
| fake-ip | `src/main/core/fakeIpRoutingIntegrity.ts:4-11` | `TIER0_FAKE_IP_FILTER` |
| 架构索引 | `src/main/core/_ARCH.md` | `networkStabilityMonitor` · `cursorConnectionHygiene` |

#### 日志铁证索引

| 时间 | 文件 | 片段 |
| --- | --- | --- |
| 2026-07-03 | `~/Library/Application Support/sparkle/logs/app-2026-7-3.log:1413-1427` | TUN restart 1× + cooldown skip 3× |
| 2026-07-05 | `~/Library/Application Support/sparkle/logs/core-2026-7-5.log` | `[TUN] default interface lost by monitor` |
| 2026-07-09 10:41 CST | `core-2026-7-9.log:31974+` | 路由 KR-VPS-TUIC 正确，api2 仍挂 |
| 2026-07-09 10:41 UTC+8 | 用户 Cursor Network Diagnostic | api2 全系 77s unavailable；Marketplace OK |

---

### BUG-2026-07-09-002 · v1.26.15–1.26.16 · 专用组 6 个 VPS 节点 UI 不可见

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.17** 已构建安装） |
| **症状** | Sparkle「代理」页展开「🎯 Cursor 3.1.15 专用」时，用户 **只能看到 5 个 Sparkle-自动-*** 区域组，**看不到** KR/JP 共 **6 个自建 VPS** 节点。用户误以为节点丢失或被删除。 |
| **关联产品** | Sparkle **1.26.15–1.26.16** · Cursor **3.1.15** |
| **bug 存在版本** | Sparkle **≥1.26.x**（引入 `use+filter` provider 模式注入专用组后）；用户于 **1.26.16** 升级后反馈 |
| **修复版本** | Sparkle **1.26.17** |
| **反复次数** | 第 1 次用户报告 · 第 1 次代码修复 |
| **根因** | mihomo 在 `proxy-providers` + `use+filter` 模式下：6 个 VPS leaf 存在于 provider 与 `group.all`，但 **不注册进** `/proxies` 字典。Sparkle `mihomoGroups()` 仅用 `proxies.proxies[name]` 映射成员 → VPS 名解析为 `undefined` → UI `proxy &&` 过滤掉。 |
| **修复** | 新增 `mihomoGroupMembersCore.ts`：`buildProviderProxyLookup` + `resolveGroupMemberProxies`；`mihomoApi.ts:mihomoGroups()` 拉 `/providers/proxies` 补全缺失 leaf（含 delay/history/alive）。 |
| **回归** | `mihomoGroupMembersCore.test.ts` 2 场景全绿 |
| **用户动作** | 升级 **1.26.17** 并重启；展开专用组应见 **11 项**（5 区域自动 + 6 VPS）；推荐手动选 **KR-VPS-TUIC** |
| **提交** | —（待用户 commit） |

#### 根因证据（本机 2026-07-09 13:23 CST）

| 数据源 | 6 个 VPS | 命令/路径 |
| --- | --- | --- |
| provider `199e64b94e8` | ✅ 6/6，`alive: true` | `GET /providers/proxies/199e64b94e8` via `/tmp/sparkle-mihomo-api-noperm.sock` |
| 专用组 `group.all` | ✅ 11 项（5+6） | `GET /proxies/🎯 Cursor 3.1.15 专用` |
| `/proxies` 字典 | ❌ VPS **0 条**（仅 29 个组级条目） | `GET /proxies` |
| 节点定义文件 | ✅ 6/6 在 profile | `~/Library/Application Support/sparkle/profiles/199e64b94e8-proxies.yaml:2-62` |
| 运行时路由 | ✅ 仍走 VPS | `core-2026-7-9.log` 大量 `专用[KR-VPS-TUIC]` |

**关键代码路径：**

- [代码] `mihomoApi.ts:170`（修复前）`newGroup.all.map((name) => proxies.proxies[name])`
- [代码] `proxies.tsx:292` `group.all.filter((proxy) => proxy && ...)`
- [代码] `customProxyGroups.ts:225-234` 专用组 `use+filter: (?i)vps` 注入逻辑（**正确**，非根因）
- [配置] `work/config.yaml:49-59` 专用组 `use: [199e64b94e8]` + `filter: (?i)vps` + 5 个 Sparkle-自动前置

#### 与 BUG-2026-07-09-001 的区分（避免再误判）

| 维度 | TUN 僵死 (001) | VPS UI 不可见 (002) |
| --- | --- | --- |
| 用户感知 | api2 77s unavailable / Usage Guard 网络错误 | 专用组里「没有」6 个 VPS |
| 节点是否真的丢 | 否，路由仍走 KR-VPS-TUIC | 否，provider 与 group.all 均有 |
| 换 VPS 能否自愈 | 不能 | 不涉及（纯 UI 层） |
| 修复版本 | 1.26.16 CTHC | 1.26.17 provider 补全 |

#### 踩坑经验

1. **`use+filter` ≠ UI 自动可见** — mihomo 运行时能解析 provider leaf，但 `/proxies` 字典不一定包含 leaf；Sparkle UI 必须合并 `/providers/proxies`。
2. **「看不到节点」先查三层** — ① profile yaml ② provider API ③ `/proxies` 字典 vs `group.all`；不要先怀疑 VPS 宕机。
3. **专用组实际有 11 项** — 5 个 `Sparkle-自动-*` 是 `appendRegionalAutoGroupsToCursorDedicated` 有意前置的商用逃生（`defaultAutoSwitchProxy.ts:241-264`），不是替代 VPS。
4. **当前选中可能是商用** — 修复前 `now` 常为 `Sparkle-自动-新加坡`；节点可见后应切回 `KR-VPS-TUIC`（`cursorDedicatedDefault.ts:8`）。

#### 代码位置

| 模块 | 路径 |
| --- | --- |
| Provider 补全（新） | `src/main/core/mihomoGroupMembersCore.ts` |
| Groups 聚合 | `src/main/core/mihomoApi.ts` · `mihomoGroups` |
| UI 渲染 | `src/renderer/src/pages/proxies.tsx:285-310` |
| 专用组注入 | `src/main/core/customProxyGroups.ts:215-246` |
| 单测 | `src/main/core/mihomoGroupMembersCore.test.ts` |

---

### BUG-2026-07-09-003 · v1.26.16 构建 · 空 sidecar 导致安装后内核失败

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（流程加固 + 重装恢复） |
| **症状** | `SKIP_PREPARE=1 pnpm run build:mac` 产出 **~171MB** pkg（正常 **~186MB**）；安装后 Sparkle 重启报 **内核失败**，mihomo 未监听 `:7890`。 |
| **关联产品** | Sparkle **1.26.16** 本地构建 |
| **bug 存在版本** | 构建机 `extra/sidecar/` 为空时；**1.26.16** 首次错误打包 |
| **修复版本** | 同会话恢复：`prepare.ts` fail-fast + 重新下载 mihomo v1.19.28 + 重装完整 pkg |
| **反复次数** | 第 1 次踩坑 · 第 1 次流程修复 |
| **根因** | `SKIP_PREPARE=1` 跳过 sidecar 下载且 **未校验** 本地 `extra/sidecar/mihomo` 是否存在 → electron-builder 打出无内核 pkg。运行时期望路径：`Sparkle.app/Contents/Resources/sidecar/mihomo`（`dirs.ts:100-103`）。 |
| **修复** | `scripts/prepare.ts:16-25`：`SKIP_PREPARE=1` 时 sidecar 缺失 **exit 1**；完整 pkg 必须 **~186MB** 且含 41MB mihomo。 |
| **踩坑** | ① 不要用 pkg 体积显著偏小作静默信号 ② 安装后 `lsof -i :7890` 验证 ③ sidecar 可用 `gh` 镜像拉 mihomo release |
| **用户动作** | 重装含 sidecar 的完整 pkg；或手动 `osascript` 复制 mihomo 到 `Resources/sidecar/` |

---

## 版本索引

| Sparkle 版本 | 本文件条目 | 说明 |
| --- | --- | --- |
| **1.26.36** | BUG-2026-07-17-002 | CTHC L0 hung 12min + keep 6 + DedicatedDefault defer 不误导日志 |
| **1.26.35** | BUG-2026-07-17-003 | ditto 覆盖安装 DYLD 崩溃 + **pkg 升级标准流程** |
| **1.26.15** | BUG-2026-07-09-001 | 僵死 + 自愈闭环缺陷（存在） |
| **1.26.16** | BUG-2026-07-09-001 | CTHC 传输健康控制器 + 探针归因（**FIXED**） |
| **1.26.16** | BUG-2026-07-09-003 | 空 sidecar 打包导致内核失败（流程 **FIXED**） |
| **1.26.17** | BUG-2026-07-09-002 | 专用组 VPS UI 不可见（**FIXED**） |
| **1.26.18** | BUG-2026-07-09-004 | CTHC 可观测性增强（transport_recovery JSONL + block reason） |
| **1.26.19** | BUG-2026-07-09-002/004 | VPS 启动默认选择日志 + provider 测速 fallback |
| **1.26.20** | BUG-2026-07-09-006 | 启动链解耦：post-core 不阻塞 WS 流 |

### BUG-2026-07-09-006 · v1.26.19 · 启动链卡在 post-up 后 CTHC 未启动

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.20**） |
| **症状** | 重启后 `app-*.log` 仅 ~26 行停在 post-up，无 `network stability ... ON`；`~/.sparkle/network-stability-events.jsonl` 无 `transport_recovery`；CTHC 监控未运行 |
| **关联产品** | Sparkle **1.26.19** |
| **bug 存在版本** | Sparkle **≥1.26.16**（CTHC 已合入但启动链依赖 `startMihomoApiStreams` 完成） |
| **修复版本** | Sparkle **1.26.20** |
| **根因** | `waitForCoreReadyByHook` / log 路径 `await startMihomoApiStreams()` 阻塞 `completeCoreInitialization` → `startPromise` 永不 resolve → `index.ts` 中 `startNetworkStabilityMonitor` 45s grace 定时器从未调度 |
| **修复** | ① `manager.ts`：`startMihomoApiStreamsWithGrace`（10s race，失败继续）hook 路径 `void` 不阻塞 ② 新 `postCoreBootstrap.ts`：`runPostCoreBootstrap` 用 API ready 探针 + 8s core init race，解耦 WS 流 ③ `index.ts` 改调 `runPostCoreBootstrap` |
| **回归** | 重启后 `grep PostCoreBootstrap\|network stability app-*.log` 应有 ON 行 |
| **用户动作** | 升级 **1.26.20** 并重启 Sparkle |

---

### BUG-2026-07-09-005 · v1.26.17 · 启动未回 VPS + VPS 测速失败（同一 /proxies 遗漏）

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.19**） |
| **症状** | ① 重启后专用组停留 `Sparkle-自动-*` 商用，未自动回 `KR-VPS-TUIC` ② VPS 节点 UI 测速按钮可能失败 |
| **根因** | 同 BUG-002：`mihomoGroups()` 缺 VPS → `cursorDedicatedDefault.ts` `available.has(KR-VPS-TUIC)` 静默 false；`mihomoProxyDelay` 只调 `/proxies/{leaf}/delay` 对 provider leaf 404 |
| **修复版本** | **1.26.19**（叠加 1.26.17 UI + 1.26.18 日志） |
| **修复** | ① `cursorDedicatedDefault.ts` 安全取 `proxy?.name` + skip 日志 ② `mihomoApi.ts` delay 404 时 fallback `mihomoProxyDelayFromProvider`（provider healthcheck + history） |
| **踩坑** | 看到 `now=Sparkle-自动-新加坡` 不等于用户手动选择，可能是默认选择逻辑被静默 skip |

---

### BUG-2026-07-09-004 · v1.26.17 · CTHC 复现排查日志不足

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.18**） |
| **症状** | TUN 僵死复现时难以判断 CTHC 是否触发、卡在哪一级 cooldown、为何 `action=none` |
| **bug 存在版本** | Sparkle **1.26.16–1.26.17**（CTHC 已上线但仅 L0–L3 执行时写 app log，无结构化决策日志） |
| **修复版本** | Sparkle **1.26.18** |
| **修复** | ① `cursorTransportHealth.ts` 每次恢复决策写 `app-*.log` 一行摘要 + `~/.sparkle/network-stability-events.jsonl` 事件 `transport_recovery` / `transport_hung_scan` ② `describeRecoveryBlockReason` 解释 `L0_cooldown` 等阻塞原因 ③ `probe` 事件补 `recovery_action` + marketplace 字段 |
| **日志路径** | `~/Library/Application Support/sparkle/logs/app-*.log`（搜 `[CursorTransportHealth]:`）· `~/.sparkle/network-stability-events.jsonl`（`kind=transport_recovery`） |
| **踩坑** | 复现时同时打包 **core log + events jsonl + 发生时刻**；单看 Usage Guard 无法判 CTHC 是否漏触发 |

---

## 2026-07-20

### BUG-2026-07-20-001 · Connect split-brain P0–P3 · Sparkle main + Guard ext 0.15.75

| 字段 | 内容 |
| --- | --- |
| **状态** | **DEPLOYED**（2026-07-21 · Sparkle 1.26.48 · Guard 0.15.77） |
| **症状** | 探针全绿时 Connect mass PING timeout（RID 5d03320f 类）零恢复；`agent-transport-failures.jsonl` @ A 无行 |
| **bug 存在版本** | Sparkle **1.26.47** · Guard ext **≤0.15.74** |
| **修复目标版本** | Sparkle **1.26.48+** · Guard ext **0.15.75+** |
| **根因** | ① CTHC `resolveProbeAttribution` 仅探针失败才 stale ② keepalive 仅 api2 HTTP delay ③ MarathonDialTolerance 仅文档 ④ daily Cursor 无 transport jsonl |
| **修复** | P0 `agentTransportFailureSyncCore` · P1 `connectPartitionDetectCore`+reader（含 profiles glob）· P2 双探针 `session_transport_nudge` + partition 时 `ensureCursorMarathonKeepAlive` · P3 `marathonDialTolerance` 热更新 · hung_scan 用 recent probe 非假绿 · 5d03320f replay 单测 |
| **回归** | Guard `agentTransportFailureSyncCore.test` 10/10 · Sparkle connectPartition+reader+marathonDialTolerance+CTHC tests **22/22** |
| **用户动作** | Reload Guard ext · 安装 Sparkle 新 pkg · 并行 Agent 后查 app.log / jsonl |
| **代码位置** | `sparkle/src/main/core/connectPartition*` · `marathonDialTolerance*` · `cursorHy2MarathonKeepalive.ts` · `tools/cursor-usage-watch/src/agentTransportFailureSyncCore.ts` |

### BUG-2026-07-20-002 · v1.26.48 · HY2 marathon EOF（23bb8c85 + a9722f2）· VPS QUIC keepalive

| 字段 | 内容 |
| --- | --- |
| **状态** | **PARTIAL → FIXED @1.26.51**（VPS QUIC + 40s nudge + token_gap @1.26.50；**20s read ETIMEDOUT / api2direct 盲区**见 BUG-2026-07-22-002 P8） |
| **症状** | Marathon ~77–125min 后 Connect mid-stream EOF code 10；短 probe 全绿；案 B a9722f2 @18:23 僵尸无 agent-error |
| **bug 存在版本** | Sparkle **≤1.26.47** · VPS hy2-in 无 marathon 三层 · conntrack 运行时 30/120s |
| **修复目标版本** | Sparkle **1.26.48** · VPS `patch-hy2-in-quic-marathon.sh`（**1.13.14：`udp_timeout` only**；可选升级 **1.14.0-alpha.48** 三字段） |
| **根因** | Mac→JP-VPS-HY2 QUIC 长流 split-brain（partial）；VPS sing-box hy2-in 默认 QUIC idle 过短；内核 conntrack UDP 30s；Sparkle 仅短 HTTP nudge |
| **修复** | ① `cursorHy2MarathonKeepaliveCore.ts` 三字段 SSOT ② VPS 脚本：sysctl + 升级 + hy2-in ③ Guard patch-469–472 ④ triage REPORT（双案） |
| **NOT** | max-steps · VPS outage @A · 18:41 批量断 · Guard cursor-server 自动标签 |
| **回归** | `cursorHy2MarathonKeepaliveCore.test.ts` · connectPartition+CTHC **22/22** · VPS dry-run idempotent |
| **用户动作** | 已完成：Sparkle 1.26.48 · Guard deploy · VPS patch（conntrack=3600 · hy2-in `udp_timeout=3600s` @ sing-box 1.13.14） |
| **代码位置** | `cursorHy2MarathonKeepaliveCore.ts` · `scripts/vps-deploy/patch-hy2-in-quic-marathon.sh` · triage bundle `REPORT.md` |

---

## 2026-07-22

### BUG-2026-07-22-001 · v1.26.51 · HY2 marathon token_gap nudge 连接风暴（4950032b）· nudge defer @ cursor_conn≥80

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.51** 已部署 `/Applications` · `upgrade-sparkle-local.sh`） |
| **症状** | RID `4950032b-c843-4411-b6d3-3c3e78b6a65c` @ **2026-07-22 11:55:30 CST**：61min 马拉松 · `pendingTool=2` · `generation-ended-without-turnEnded` · cursor_conn **33→268** · `session_transport_nudge_failed` · renderer `ECONNRESET api2.cursor.sh` ×4 |
| **关联产品** | Sparkle **1.26.50**（断连时）· Cursor **3.1.15** · JP-VPS-HY2 |
| **bug 存在版本** | Sparkle **1.26.50**（token_gap nudge 无高 conn 保护） |
| **修复目标版本** | Sparkle **1.26.51** |
| **根因** | **L3 HY2 QUIC 长流静默 + nudge 叠加 dial 风暴（definitive）**：token_gap 已标 stale（max_gap 93s）但 `session_transport_nudge` 仍每 15s 开 **2× mihomoProxyDelay** 新 HY2 流；与 Cursor auth refresh TLS 风暴叠加 → conn 268 → QUIC 中途断 → ECONNRESET。**NOT** VPS 宕 · NOT L0 hung · NOT patch 破坏 retry |
| **修复** | `CURSOR_HY2_NUDGE_DEFER_THRESHOLD=80` · `shouldDeferHy2MarathonSessionNudgeForCursorLoad` · `session_transport_nudge_deferred_cursor_load` 日志 · conn≥80 时 **禁止** 新开 api2/api2geo dial，依赖 VPS keep_alive 30s |
| **NOT** | 切节点 · 杀健康 conn · 减并行 · 客户端限时 |
| **反复次数** | **同族 split-brain 第 6 次**（含 2026-07-21 d56b1442 33s EOF · 2026-07-22 0946940c 20s ETIMEDOUT）；**nudge defer 第 1 次实现** |
| **为何反复** | 1.26.50 token_gap @ 20s 用 **短 HTTP 探针救长流**，高 conn 时探针本身变成 **dial 风暴**；短探针全绿 ≠ marathon SSE 正常 |
| **踩坑** | ① conn 33→268 是 **新增 dial** 不是旧 conn 太多 — **禁止** 用 hygiene/prune 杀健康连接 ② `session_transport_nudge_failed` @ 高 conn = 风暴症状不是 VPS 宕 ③ 定责必须 ledger @ A + renderer ECONNRESET 时间线对齐 ④ P8 connect_stream_keepalive @ conn≥80 **尚未统一 defer**（见 BUG-2026-07-22-002 遗漏项） |
| **回归** | `cursorHy2MarathonKeepaliveCore.test.ts` defer 3/3 · test:node-quality **176/176** |
| **用户动作** | 已完成：`pnpm run upgrade:mac` → `/Applications` **1.26.51** 运行中 · app.log 搜 `session_transport_nudge_deferred_cursor_load` |
| **证据包** | `~/Desktop/cursor-triage-4950032b-20260722T133014/` · renderer @ 11:55:30 ECONNRESET |
| **代码位置** | `cursorHy2MarathonKeepaliveCore.ts` · `cursorHy2MarathonKeepalive.ts` |

### BUG-2026-07-22-002 · v1.26.51 · HY2 marathon read ETIMEDOUT（0946940c）· P8 Connect 长流保活 · tokenGapReader 损坏

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.51** 已部署 `/Applications` · **PARTIAL 待 soak 关门**） |
| **症状** | RID `0946940c-c7b1-4c69-85a9-0fba7f4e7ae2` @ **2026-07-22 11:40:25 CST**：84min 马拉松 · `cursor_conn=28–30` · 最后 `toolCallDelta` **11:40:06** → **~20s 静默** → `[unavailable] read ETIMEDOUT` · 14s 内第二 RID `c033803b` 同 JP-VPS-HY2 同错 · Guard intercept-on 断后 `will-retry` **BLOCK**（配额浪费，正交） |
| **关联产品** | Sparkle **1.26.50** @ `/Applications` · Cursor-2 **3.12.17** · JP-VPS-HY2 · Guard WB **1.0.9**（假阳性见 `BUGFIX_LOG_312` BUG-312-2026-07-22-003） |
| **bug 存在版本** | Sparkle **1.26.50**（token_gap nudge 仅 api2/api2geo 短探针 · **无 api2direct Connect 路径保活**）· `cursorStreamTokenGapReader.ts` **函数损坏缺 export**（token gap 信号可能失效） |
| **修复目标版本** | Sparkle **1.26.51** |
| **根因** | **L3 HY2 QUIC Marathon split-brain（definitive）**：ledger @ A+4s **291ms 全绿** · VPS sing-box @ A±2min **零 ERROR**（SSH 实查 hy2-in 3600s 三字段已部署）· 断前仍有 toolCallDelta → **NOT Cursor 服务端** · **NOT max-steps-cap**。机制：`session_transport_nudge` + `token_gap_force_nudge` 在 11:40:10~40 **已在打**，但仅 `mihomoProxyDelay(api2+api2geo)` **新开短 HTTP**，不保活 **api2direct.cursor.sh** 上 AgentService Run 长流 → socket read ETIMEDOUT @ ~20s（= `TOKEN_GAP_FORCE_MS` 窗口） |
| **修复** | ① **P8** `cursorConnectStreamKeepaliveCore.ts` / `cursorConnectStreamKeepalive.ts` — ≥15s meaningful SSE 静默 + conn≥12 → **api2direct + api2** 双探针 · 日志 `connect_stream_keepalive` · ≥12s 冷却 · **非破坏性** ② `readConnectStreamKeepaliveGapSignal` @ 15s 阈值（早于 20s ETIMEDOUT）③ **修复** `cursorStreamTokenGapReader.ts`（恢复 `readMarathonStreamTokenGapSignal` / cold-resume 收集）④ roadmap §14 SSOT |
| **1.26.50 已做但未够** | token_gap @ 20s ✅ · VPS/Mac QUIC 3600s ✅ · 40s session nudge ✅ — **不覆盖「探针全绿 + api2direct 长流 ~20s read timeout」** |
| **反复次数** | **同族 split-brain 第 5 次**（2026-07-18 Reality mux · 2026-07-20 partition · 2026-07-20 VPS QUIC · 2026-07-21 33s server_eof d56b1442 · **本次 20s read ETIMEDOUT**）；P8 **第 1 次实现** |
| **为何反复** | 每层修复只解决 **一个时间尺度 + 一个 host**：VPS 小时级 idle · 40s nudge 分钟级 · 20s token_gap 仍只探 **api2/api2geo**，未触 **Connect 实际 host api2direct**；短探针全绿 → 「网络正常」错觉 |
| **踩坑** | ① `HTTP api2 291ms 全绿 ≠ AgentService Run 长流正常` ② token_gap nudge **连续打仍 ETIMEDOUT** = 探针 **类型** 错，不是 **频率** 不够 ③ 定责必须 SSH VPS @ A + renderer 精确时间线（toolCallDelta→ETIMEDOUT 间隔）④ **勿** 用 GUI 批量 VPS delay 测速判活（见 BUG-2026-07-22-001）⑤ P8 与 BUG-001 defer（conn≥80）**尚未统一** — 极高 conn 时 P8 仍可能加探针，待 soak 后评估是否复用 defer |
| **遗漏 / 待验证** | ① P5 soak：并行 ≥30 conn · ≥60min · app.log `connect_stream_keepalive` ② P8 @ conn≥80 是否需 defer（4950032b 风暴族）③ Guard transport 断后 will-retry BLOCK → P7c 正交 |
| **回归** | `cursorConnectStreamKeepaliveCore.test.ts` 3/3 · test:node-quality **176/176** |
| **用户动作** | 已完成：`pnpm run upgrade:mac` → app.log 搜 `connect_stream_keepalive` · ⌘Q Cursor-2（Guard WB 1.0.9） |
| **证据包** | `~/Desktop/cursor-triage-0946940c-20260722T114605/` · `Cursor-2-data/.../renderer.log` @ 11:40:06 toolCallDelta · `app-2026-7-22.log` token_gap @ 03:40 |
| **代码位置** | `cursorConnectStreamKeepalive*.ts` · `cursorStreamTokenGapReader.ts` · `cursorTransportHealth.ts` · `temp-docs/repair/CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` §14 |

---

## 2026-07-21

### BUG-2026-07-21-003 · v1.26.50 · HY2 Marathon 33s token 静默 → server_eof（d56b1442）· token gap nudge

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（**1.26.50** 已部署 `/Applications` · `upgrade-sparkle-local.sh`） |
| **症状** | RID `d56b1442-dd91-404e-90c7-6bb49aa57d49` @ **2026-07-21 18:54:20 CST**：3 Agent 并行 · JP-VPS-HY2 · Connect SSE **33s 无 token** → `server_eof` / `ConnectError code=10 aborted` → auto resume → Included×2 幽灵计次；UI 后续 resume 假卡死（stock 状态机 desync，非补丁） |
| **关联产品** | Sparkle **1.26.49**（运行中 pkg）· Cursor **3.1.15** 官方（补丁已删） |
| **bug 存在版本** | Sparkle **1.26.48–1.26.49**（含 P0–P3 + VPS QUIC 3600s + 40s nudge，**无 token gap**） |
| **修复目标版本** | Sparkle **1.26.50** |
| **根因** | **L3 HY2 QUIC Marathon split-brain（definitive）**：`gapSinceActivityMs=32796` · `terminalKind=server_eof` · ledger @ A **api2+api2geo 303ms 全绿** · VPS sing-box @ A±2min **error 段空** · 单 RID 断、其他 Agent 同秒仍收 token。P6 **40s** `session_transport_nudge` 周期 **盖不住 ~33s** 服务端 idle：`10:53:37 nudge` → `10:54:20 EOF` → `10:54:37 nudge`（晚 17s）。**NOT** max-steps · NOT Guard block · NOT patch · NOT L0 hung |
| **修复** | ① `cursorStreamTokenGapCore.ts` — 解析 renderer `[ifm-event-v1] stream_activity` / SSE audit（**忽略 heartbeat**）② `cursorStreamTokenGapReader.ts` — renderer tail ③ `cursorTransportHealth.ts` hung_scan：`gap≥20s` + conn≥12 → `tokenGapForce` nudge（15s cooldown）④ 常量 SSOT：`CURSOR_HY2_TOKEN_GAP_FORCE_MS=20000` |
| **1.26.48–49 已做但未够** | VPS hy2-in QUIC 3600s ✅ · MarathonDialTolerance dial 45s ✅ · partition detect ✅ · high_latency nudge (>600ms) ✅ — 均 **不覆盖「探针全绿 + 33s token 静默」** |
| **反复次数** | **同族 split-brain 第 4 次**（2026-07-18 Reality mux · 2026-07-20 P0–P3 partition · 2026-07-20 HY2 VPS QUIC · **本次 33s gap**）；**token gap 机制第 1 次实现** |
| **为何反复** | 每层修复只解决 split-brain **一个时间尺度**：VPS idle（小时级）· 40s nudge（分钟级）· 缺 **20–30s token 级** 自适应触发；短探针全绿造成「已修好」错觉 |
| **踩坑** | ① `HTTP api2 303ms 全绿 ≠ Connect 长流正常` ② 40s nudge **不是** 33s EOF 充分条件 ③ UI 批量测速 Marathon 下 defer → **误报超时**，非 VPS 宕 ④ 定责必须 A 时刻 ledger + VPS sing-box + renderer `gapSinceActivityMs`，禁止 B 时刻否定 A ⑤ 删除 IFM 补丁 **不消除** stock `ConnectError aborted` |
| **回归** | `cursorStreamTokenGapCore.test.ts` 4/4 · `cursorHy2MarathonKeepaliveCore.test.ts` token gap 3/3 · test:node-quality 含新文件 |
| **用户动作** | `pnpm run upgrade:mac`（或 `bash scripts/upgrade-sparkle-local.sh`）→ app.log 搜 `token_gap_force_nudge` |
| **证据包** | `~/Desktop/cursor-triage-d56b1442-20260721T190949/` · `app-2026-7-21.log:885-891` · `renderer-A-full-disconnect.txt:42` |
| **代码位置** | `cursorStreamTokenGapCore.ts` · `cursorStreamTokenGapReader.ts` · `cursorTransportHealth.ts` · `cursorHy2MarathonKeepaliveCore.ts` · `cursorHy2MarathonKeepalive.ts` |

### BUG-2026-07-21-004 · v1.26.50 · 本地安装闪退 / stale asar / Gatekeeper 启动

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（`scripts/upgrade-sparkle-local.sh` · `install-sparkle-local.sh` Finder 启动） |
| **症状** | `install-sparkle-local.sh` 成功但 GUI **闪退/打不开**；`spctl: rejected`；直接运行 `Sparkle` **exit=1**；或安装后 asar **无新功能**（token_gap 字符串缺失） |
| **根因** | ① adhoc 新 CDHash → Gatekeeper rejected；`open -a` / 双击 **不弹批准** → 瞬间 exit（像闪退，非 DYLD）② 只跑 `electron-builder --mac dir` **未先** `electron-vite build` → dist asar 为旧构建 ③ 曾用手动 `codesign` + 损坏 backup → `sealed resource invalid` |
| **修复** | ① `upgrade-sparkle-local.sh`：vite → dir → asar 校验 → install ② `install-sparkle-local.sh`：Finder `open POSIX file` 启动；graceful quit 失败 → `pkill -9` ③ `pnpm run upgrade:mac` SSOT |
| **禁止** | ❌ 跳过 vite 直接 electron-builder · ❌ install 后二次 codesign · ❌ `open -a` 作为 adhoc 首选启动 |
| **正确流程** | `pnpm run upgrade:mac` |
| **长期** | Apple Developer ID + notarize |
| **代码位置** | `scripts/upgrade-sparkle-local.sh` · `scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装」 |

### BUG-2026-07-21-001 · v1.26.48 · 双份 Sparkle（/Applications + ~/Applications）· GUI/service 分裂

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED**（`scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装」SSOT） |
| **症状** | 设置页版本与 `defaults read` 不一致；删 `~/Applications` 副本后 GUI 无法启动；app.log `spawn …/Users/…/sparkle-service ENOENT` |
| **bug 存在版本** | 任意同时存在 **`/Applications/Sparkle.app`** 与 **`~/Applications/Sparkle.app`** 的安装方式 |
| **根因** | pkg/root 装系统目录 + dev 手动复制用户目录 → **service 绑 `/Applications`、GUI 从 `~/Applications` 启动**；Gatekeeper 对新 ditto 拒启（`spctl: rejected`）；root 所有 `/Applications` 无 sudo 无法 `chown`/codesign |
| **修复** | `install-sparkle-local.sh`：quit → 停 service → **删除/备份用户副本** → 仅 `ditto` 到 `/Applications` → `chown` + `xattr -cr` → **不重签**（见 BUG-002）→ 单路径启动校验 |
| **禁止** | ❌ 手动 `cp`/`ditto` 到 `~/Applications` · ❌ `open dist/mac-arm64/Sparkle.app` 日常用 · ❌ 只改 Info.plist |
| **正确流程** | `pnpm run upgrade:mac` |
| **踩坑** | 验证必须 **`pgrep -lf Sparkle.app/Contents/MacOS`** 与 **`sparkle-service`** 路径同属 `/Applications` |
| **代码位置** | `scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装（标准 · 唯一路径）」 |

---

### BUG-2026-07-21-002 · v1.26.48 · install 二次 codesign 作废 Gatekeeper 批准

| 字段 | 内容 |
| --- | --- |
| **状态** | **FIXED** |
| **症状** | `sudo install-sparkle-local.sh` 成功但 GUI **闪退/打不开**；`spctl: rejected`；直接运行 `Sparkle` **exit=1**；以前 `~/Applications` 旧副本可开、换 `/Applications` 新包后不行 |
| **bug 存在版本** | `install-sparkle-local.sh` 在 `ditto` 后 **`codesign --deep --sign -`**（与 pkg 流程末尾二次 sign 同理） |
| **根因** | `build:mac` 已由 `deepSignMac.cjs` deep sign；install **再次 adhoc 重签 → CDHash 变化** → macOS 视为全新未信任 app；同时删除已批准的 `~/Applications` GUI 副本 |
| **修复** | install 脚本：**仅 ditto + xattr -cr**，比对 CDHash；**Finder POSIX 启动**（BUG-004）；状态写入 `~/.sparkle/last-sparkle-cdhash` |
| **禁止** | ❌ install/pkg 后二次 `codesign`（除非 rebuild 失败验签）· ❌ 恢复 `~/Applications` 双路径 |
| **正确流程** | `pnpm run upgrade:mac`；Gatekeeper fallback：Finder Control+打开 **一次** |
| **长期** | Apple Developer ID + notarize 可彻底免 Gatekeeper；无账号时上述流程已是最稳 adhoc 方案 |
| **代码位置** | `scripts/install-sparkle-local.sh` · BUGFIX「Sparkle 本地安装（标准 · 唯一路径）」 |
