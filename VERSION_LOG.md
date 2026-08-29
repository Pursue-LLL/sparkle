# Sparkle Version Log

> **基线用途**：Agent 迭代以本文档 **最新可用条目** 为 SSOT，避免能力回退、重复踩坑、反复返工。  
> **关联**：`BUGFIX_LOG.md`（缺陷明细）· `scripts/_ARCH.md`（Agent 升级入口）

---

## 2026-08-29 23:21 CST · **基线 @1.30.40 + git 未装包补丁** · 订阅自动选择 + macOS 26 GUI · **RUNTIME OK · 待 install 固化**

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
| **P0** | **`pnpm run agent:upgrade:mac`** | 将上述 git 改动打入 `/Applications`；marathon 忙时可 `SPARKLE_OVERRIDE_P23_MARATHON_INSTALL=1` |
| **P0** | **Layer-0 startCore 硬门禁** | BUG-2026-08-29-001 仍未闭合；见 BUGFIX_LOG |
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
- **本夜缺陷条目**：BUG-2026-08-29-002 ~ 005 + BUG-001 Layer-0 pending · 见 BUGFIX_LOG
- **同族复发**：data-plane mutation @ active Cursor（BUG-001 第 4+ 次）— 根治仍待 Layer-0

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
