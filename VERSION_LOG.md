# Sparkle Version Log

> **基线用途**：Agent 迭代以本文档 **最新可用条目** 为 SSOT，避免能力回退、重复踩坑、反复返工。  
> **关联**：`BUGFIX_LOG.md`（缺陷明细）· `scripts/_ARCH.md`（Agent 升级入口）

---

## 2026-09-01 18:30 CST · **生产基线 @1.30.52 INSTALLED cb85a3b** · Recovery + fake-ip 三环闭合 · **待 30min soak PASS**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.52** · CDHash **`17c22f704c7cc88b5ee56188c4581c8e26f36072`** |
| **Git 链** | `d33cbf1` → `6e92e53` → `08b4153` → `252de75` → **`cb85a3b`（HEAD · 已装 asar）** |
| **装包** | `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1 pnpm run agent:upgrade:mac` ×2（10:24 + 10:28 CST） |
| **T0** | `2026-09-01T10:29:11Z` · `[CoreLifecycle]: post_ready fake_ip_flush reason=cold_start` |
| **平台** | macOS **26** · service core · marathon active（cursor_conn 7–24 装包期） |
| **状态** | **当前最佳可用基线** — Agent 迭代以此为准；**禁止回退**到无 `recovery_coordinator` / 无 emoji-CIDR-sanitize 的 asar |

### 核心能力（2026-09-01 18:30 验证）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| **Emergency 120s cooldown + in-flight mutex** | ✅ INSTALLED | `emergency_cooldown_active` @10:08 · `d33cbf1` |
| **CircuitBreaker open/block only** | ✅ INSTALLED | 无 CB 并行 emergency admission |
| **RecoveryCoordinator failover-first** | ✅ INSTALLED | policy `failover_leaf` before emergency · `252de75` dispatch count |
| **R-31 failover bypass** | ✅ INSTALLED | `source=recovery_coordinator` · asar 3 hits · `08b4153` |
| **Tier0-Direct fake-ip-filter** | ✅ RUNTIME | `+.cn` / `+.qq.com` in `work/config.yaml` fake-ip-filter |
| **198.18 CIDR trap 移除** | ✅ RUNTIME | `generateProfile` @10:28:59 → `integrity_patches` · **TRAP_ABSENT** post-regen |
| **CoreLifecycle post-ready flush** | ✅ RUNTIME | cold_start + emergency 路径均见 `fake_ip_flush outcome=executed` |
| **T0 后零 emergency** | ✅ 短窗 | 10:29+ 无 `emergency_admitted` · 无 i/o timeout（18:29 窗） |
| **30min marathon soak** | ⏳ PENDING | T0+30min → 10:59+ 需零 emergency 循环 |
| **failover 实战** | ⏳ PENDING | 待下次 HY2 byte-death · 期望 `recovery_failover_lateral_escape` |
| **Cursor Network Diagnostic 10/10** | ⏳ PENDING | 用户可选 |

### Git 交付链（9/1 四轮迭代 · 同族第 4+ 轮）

| Commit | 模块 | 修复什么 | 遗漏/导致什么 |
| --- | --- | --- | --- |
| `d33cbf1` | emergency + CB | in-flight mutex · 120s cooldown · CB 仅 open | failover 仍被 R-31 拦 · 198.18 trap 仍在 |
| `6e92e53` | CoreLifecycle + Tier0 | post-ready flush · cn suffix filter | sanitize 不匹配 `🎯 Direct` → trap 每次 regen 写回 |
| `08b4153` | marathonProtocolContract | `recovery_coordinator` bypass lateral block | 未单独装包前 failover 仍 `source=manual` 被拒 |
| `252de75` | recoveryCoordinatorPolicy | failover 失败可重试 · 成功才锁 | — |
| `cb85a3b` | fakeIpRoutingIntegrity | 198.18/198.19 CIDR **无条件移除** | — |

### 架构 SSOT（Agent 必读 · 勿回退）

1. **RecoveryCoordinator** — 唯一 owner：failover（≤2 dispatch）→ emergency；CB 只计数/open
2. **CoreLifecycle** — 每次 core ready → `mihomoFlushFakeIpCache`
3. **ensureFakeIpRoutingIntegrity** — profile build 时 Tier0-Direct + **strip 198.18/198.19 CIDR（任意 outbound 名）**
4. **failover switch source** — 必须 `recovery_coordinator`（非 `manual`）才能 bypass R-31

### 踩坑 SSOT（9/1 血泪 · 防复发）

1. **sanitize 只匹配字面 `DIRECT`** — 订阅用 `🎯 Direct` → Layer1 从未生效 → **每次 generateProfile 写回陷阱**（BUG-001-R2）
2. **failoverAttempted 在 dispatch 时置 true** — 一次 R-31 拒绝 → **永久 emergency 路径**（BUG-003）
3. **failover 用 source=manual** — R-31 `blocked_suboptimal_lateral` HY2→Reality（BUG-003）
4. **装包 ≠ 验 runtime config** — Tier0 进 filter 但 CIDR trap 仍在 = **半生效假象**
5. **错误验收** — 「0 timeout 窄窗」「0 emergency 装包后 5min」≠ PASS；须 T0+30min + trap absent + failover 实战
6. **profile regen 被 marathon guard defer** — `--sparkle-profile-update-due` @ cursor_conn>0 → deferred queue；**generateProfile on cold_start 才是可靠路径**

### 变更计数

- **BUG-2026-09-01-001**：R0→**R2**（3 轮）· fake-ip 同族 **第 3 次** partial fix
- **BUG-2026-09-01-002**：R0→**R1**（2 轮）· emergency 同族 **第 2 轮** partial → 三环 cb85a3b
- **BUG-2026-09-01-003**：**新增** · failover R-31 + permanent lock
- **9/1 总 commit**：5（d33cbf1→cb85a3b）· **48× emergency_admitted** 装包前（10:00–10:23）

### 验收门禁（soak PASS 前勿标 DONE）

- [x] install CDHash `17c22f70…` · asar 含 `recovery_coordinator`
- [x] `work/config.yaml` 无 `198.18.0.0/16` IP-CIDR rule
- [x] T0 后 `fake_ip_flush outcome=executed`
- [ ] T0+30min 零 `emergency_admitted` @ cursor_conn>0
- [ ] 下次 HY2 stall → `failover_leaf outcome=executed`（非 `switch_blocked source=manual`）
- [ ] core log Direct i/o timeout 不增长
- [ ] Cursor Network Diagnostic 10/10（可选）

---

## 2026-09-01 17:30 CST · **Recovery + CoreLifecycle 双 SSOT @1.30.52 CODE-DONE** · fake-ip Direct + emergency 循环 · **已被 18:30 基线取代**

| 字段 | 内容 |
| --- | --- |
| **版本** | git **d33cbf1+** · prod 装包 CDHash 待更新 |
| **目标** | 马拉松期 Cursor/Codex 稳定 + 国内 Direct 不 timeout + core restart 不雪崩 |
| **状态** | ~~代码+单测 23/23 PASS · 装包+soak 进行中~~ → **部分交付 · 见 18:30 基线** |

### 交付清单

| 模块 | 能力 | 状态 |
| --- | --- | --- |
| RecoveryCoordinator | failover-first · emergency in-flight + 120s cooldown | ✅ d33cbf1 |
| CircuitBreaker | open/block only（无 duplicate emergency） | ✅ d33cbf1 |
| Tier0-Direct | cn suffix + Direct 规则 → fake-ip-filter | ✅ 6e92e53 |
| CoreLifecycle | post-ready fake-ip flush | ✅ 6e92e53 |

### 验收门禁

- [x] install 后 `[CoreLifecycle]: fake_ip_flush outcome=executed`
- [ ] 30min 无 emergency 循环 — **装包前 FAIL（48× admitted）**
- [ ] core log Direct fake-ip timeout 不增长 — **717 累计 · trap 未除**
- [ ] Cursor Network Diagnostic（用户可选）

---

## 2026-09-01 17:00 CST · **Phase-1 Recovery Convergence + Hotfix @1.30.53 CODE-DONE** · emergency 马拉松自激回归 · **待 install**

| 字段 | 内容 |
| --- | --- |
| **版本** | git **1.30.53**（待装）· prod `/Applications/Sparkle.app` → **1.30.52** · build `2026.0901.1605` |
| **平台** | macOS **26.5.2** · service core · marathon active |
| **状态** | Phase-1 **smoke PASS** · 马拉松 soak **FAIL（回归）** · hotfix **CODE-DONE 待装** |

### Phase-1 交付（1.30.52）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| Recovery Coordinator | ✅ | `recoveryCoordinator.ts` single entry |
| Emergency core recovery | ✅ smoke | `EmergencyRecoverySmoke outcome=PASS` @08:17 UTC |
| Byte-death verifier | ✅ | `recoveryByteDeathVerifierCore` |
| UDP absent bypass 移除 | ✅ | no birth-reset on absent |
| Circuit OPEN → emergency | ✅ | 能执行（旧 deadlock 闭合） |

### 回归 + Hotfix（1.30.53）

| 问题 | 修复 |
| --- | --- |
| 马拉松期每 2–3min core restart | `emergencyRecoveryInFlight` + 120s cooldown |
| UDP absent 跳过 failover | policy: cursor_conn>0 → `failover_leaf` 优先 |
| Coordinator + breaker 双触发 | admission 层 in-flight gate |

### 待验门禁

- [ ] `pnpm run agent:upgrade:mac` 装 1.30.53
- [ ] 马拉松 30min 零 `emergency_core_recovery_completed` 循环
- [ ] Cursor Network Diagnostic 10/10
- [ ] 手动：🎯 Cursor 专用切 **JP-VPS-TLS** 作即时止血

---

## 2026-08-29 23:31 CST · **生产基线 @1.30.40 INSTALLED** · Marathon Data-Plane Guard R3 · Cursor Reconnecting 闭合 · **P0–P3 PASS**

| 字段 | 内容 |
| --- | --- |
| **版本** | `/Applications/Sparkle.app` → **1.30.40** · CDHash 装包于 **23:28 CST** · git 含 R3 Layer-0（与 asar 同步） |
| **平台** | macOS **26.5.2** · service core · headless + `macos26ForceGui: true` |
| **订阅** | `77caf1sub001` · providers `77caf1sub001` + `77caf1sub001-vps` |
| **会话** | composer `3d9338e6-094a-45ba-a652-53077afbc757` |
| **状态** | **当前最佳可用基线** — Agent 迭代以此为准；禁止回退到无 Layer-0 的 asar |

### 核心能力（2026-08-29 23:31 验证）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| **Marathon 数据面零突变** | ✅ P0–P3 | `verify-marathon-data-plane-soak-gate` PASS · defer_events=10 · 零 `mihomo core started` since T0 |
| ProfileUpdaterCli / second-instance | ✅ defer | `deferred data_plane_mutation_blocked cursor_conn=9–24` |
| reload-mihomo-via-service.mjs | ✅ defer | `reload_deferred { blockColdRestart: true }` |
| startCore Layer-0 | ✅ | `core_cold_restart_blocked caller=profile-update-cli/startCore` |
| CI 防回归 | ✅ | `verify-marathon-mutation-callers` in upgrade Stage-A |
| Deferred profile queue | ✅ | `deferred_profile_update_queued` → conn→0 补跑 |
| 代理 :7890 | ✅ | api2.cursor.sh / generate_204 |
| 单测 | ✅ 25+ | guard + Layer-0 + deferred + soak script |

### R3 架构改动（**已装 /Applications**）

| 层 | 模块 | 作用 |
| --- | --- | --- |
| **Layer-0** | `startCoreMutationGuardCore.ts` · `manager.startCore()` | 任何 caller 无法旁路 cold restart |
| **Caller SSOT** | `profileUpdateDueCli.ts` · `index.ts` second-instance | 共用 `runGuardedDueProfileUpdates*` |
| **Defer 统一** | `appConfigMihomoReloadGuardCore.ts` | conn>0 即 block（禁止 conn≥12 分裂） |
| **P2 Queue** | `deferredProfileUpdateDue.ts` | marathon 期 defer · idle 补跑 |
| **P1 CI** | `verify-marathon-mutation-callers.mts` | startCore/restartCore allowlist |
| **P3 Soak** | `verify-marathon-data-plane-soak-gate.mts` | post-install + agent upgrade gate |
| **脚本** | `reload-mihomo-via-service.mjs` | 读 `~/.sparkle/marathon-core-restart-guard.json` |

### 同会话其他 git 改动（**部分未装 asar · 待下次 upgrade**）

| BUG | 状态 | 说明 |
| --- | --- | --- |
| BUG-2026-08-29-002 | CODE-DONE git | ♻️→Sparkle 自动选择 — **需 regen 后 patch 或 reinstall** |
| BUG-2026-08-29-003 | MITIGATED | macos26ForceGui 偏好 |
| BUG-2026-08-29-004 | CODE-DONE git | service provider parity COMPATIBLE placeholder |
| BUG-2026-08-29-005 | CODE-DONE git | Cursor HY2 manual optimal 切换 |

### 已知遗漏（非 Reconnecting 阻塞）

| 优先级 | 项 |
| --- | --- |
| P1 | 002/004/005 git 补丁需 `agent:upgrade:mac` 与 R3 同包装入 asar |
| P2 | byte-death G3 attemptRate soak（独立 BUG-2026-08-06 族） |

### 踩坑 SSOT（Agent 必读）

1. **禁止 caller 层单独 guard** — mutation 必须经 `startCore/restartCore/stopCore` 或 mihomoApi provider guard。
2. **LaunchAgent 5min → second-instance** — 必须走 guarded path（22:48 事故主因）。
3. **装包** `pnpm run agent:upgrade:mac`；禁止 ditto；marathon 时 `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1`。
4. **验证三连**：`verify-marathon-mutation-callers` + soak gate + app-log 无 `mihomo core started` @ cursor_conn>0。
5. **Reconnecting 归因**：Sparkle 数据面突变 → ECONNRESET → `[nal_agent_retries]` UI；**非 Cursor 补丁 bug**。

### 变更计数

- **BUG-2026-08-29-001**：R0→R3（4 轮）· 同族 data-plane mutation 第 4+ 次 · **R3 架构闭合**
- **升级入口**：`scripts/agent-sparkle-upgrade.sh`（含 P3 soak gate）

---

## 2026-08-29 23:21 CST · **基线 @1.30.40 + git 未装包补丁** · 订阅自动选择 + macOS 26 GUI · **已被 23:31 基线取代**

| 字段 | 内容 |
| --- | --- |
| **版本** | **已安装** `/Applications/Sparkle.app` → **1.30.40** · **git 工作区** 含未安装补丁（见下） |
| **订阅** | `77caf1sub001`（新订阅）· providers `77caf1sub001` + `77caf1sub001-vps` |
| **平台** | macOS **26.5.2** · service core · headless 默认 + **`macos26ForceGui: true`** |
| **会话** | open-perplexity composer `3d9338e6-094a-45ba-a652-53077afbc757` |
| **状态** | **相对可用且较好** — 代理/GUI/自动选择均已验证；git 补丁 **未打入 asar**，regen 后 ♻️ 可能短暂回归 |

### 当前能力（已验证 2026-08-29 23:21）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 代理 :7890 | ✅ 204/200 | `curl -x :7890 generate_204` / `api2.cursor.sh` |
| Sparkle GUI | ✅ 运行中 | `pgrep -x Sparkle` · `macos26ForceGui: true` |
| 订阅 ♻️ → Sparkle 自动选择 | ✅ 运行时 | disk+runtime `♻️`=0 · `🔰 手动选择 now=自动选择` |
| Sparkle-自动-* 区域组 | ✅ GUI 可选 | `work/config.yaml` 各 select 组含区域 url-test |
| 🎯 Cursor 专用 | ✅ | 在 `自动选择` fallback 链末尾 · VPS HY2 manual（BUG-005 git） |
| 🇭🇰 香港节点 | ✅ | 非全局；域名规则注入 · 新订阅 HK 节点可见 |
| Service provider parity | ✅ git | 换订阅后 disk/runtime 不一致会触发 service restart（marathon 可 defer） |

### 本基线 git 改动（**未 install → /Applications**）

| 模块 | 改动摘要 | 文件 |
| --- | --- | --- |
| **订阅自动选择统一** | 删除 `♻️ 自动选择` url-test 组；引用/规则改 `自动选择`；select 组暴露 `Sparkle-自动-*` | `defaultAutoSwitchProxy.ts` · 单测 14/14 |
| **macOS 26 GUI 偏好** | `--sparkle-force-gui` / env 启动时持久化 `macos26ForceGui`；用户 config 已写 `true` | `macos26ForceGuiPreferenceCore.ts` · `index.ts` |
| **GUI 启动 SSOT** | `scripts/open-sparkle-gui-macos26.sh` | 备用 |
| **Service provider parity** | 换 profile 后 service core provider ID 不一致 → restart | `serviceCoreProviderParityCore.ts` · `manager.ts` |
| **Cursor HY2 手动切换** | 允许 manual 切到 `JP-VPS-HY2`（optimal VPS）· 仍拦 suboptimal 横向 | `marathonProtocolContractCore.ts` |
| **过渡热修脚本** | regen 后临时修复 config | `scripts/patch-work-config.ts` |

### 已知遗漏 / 待办（防止误判「已 100% 固化」）

| 优先级 | 项 | 说明 |
| --- | --- | --- |
| **P0** | **`pnpm run agent:upgrade:mac`** | ~~Layer-0~~ **R3 已装**；002/004/005 git 补丁仍待同包装入 |
| **P1** | **regen 不带 ♻️** | 装包前每次 headless/GUI bootstrap 可能还原 ♻️ → 需 `patch-work-config.ts` 或等 install |
| **P2** | **Marathon upgrade 等待** | `agent:upgrade:mac` 构建后可能等 safe window ~10min — Agent **禁止同步死等** |

### 踩坑 SSOT（本版本总结）

1. **macOS 26 默认 headless**：`open -a Sparkle` 无窗口 ≠ 未启动；看 `pgrep mihomo` + `:7890`。要 GUI：`macos26ForceGui: true` 或 `--sparkle-force-gui`。
2. **♻️ vs 自动选择**：订阅 `♻️ 自动选择` 是 flat url-test，与 Sparkle `自动选择`→`Sparkle-自动-*` **并行竞争**；必须 factory 层 rewrite，不能只靠 GUI 默认。
3. **换订阅 COMPATIBLE**：service 模式 mihomo 未 restart → runtime provider 旧 ID；cold restart 或 `serviceCoreProviderParityCore`。
4. **Agent 卡死**：禁止 `reload-mihomo-via-service.mjs` 无超时等待；禁止同步等 marathon install；大 yaml 用 `rg -c` 限 scope。
5. **HK 非全局**：仅 X/Grok/Stripe 等域名规则走 `🇭🇰 香港节点`；`自动选择` 区域优先级不含 HK。

### 变更历史计数（自 2026-08 马拉松期）

- **semver 线**：1.30.40（当前安装）· git 同版本未 bump
- **本夜缺陷条目**：BUG-2026-08-29-001 R3 闭合 + 002~005 · 见 BUGFIX_LOG
- **同族复发**：data-plane mutation @ active Cursor（BUG-001 第 4+ 次）— **R3 Layer-0 已闭合**（见 23:31 基线）

---

## 模板（后续版本追加在上方）

```markdown
## YYYY-MM-DD HH:MM TZ · 标题 @semver · 状态

| 字段 | 内容 |
| **版本** | |
| **状态** | |
| **能力** | |
| **改动** | |
| **遗漏** | |
```
