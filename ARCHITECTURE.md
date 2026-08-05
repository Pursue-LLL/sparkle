# Sparkle — 系统架构

Electron 桌面代理 GUI，主进程驱动 mihomo 内核，为 Cursor Agent 长连接（Marathon SSE）提供稳定出站与可观测性。

## 模块导航

| 路径 | 职责 |
|------|------|
| [src/main/core/_ARCH.md](src/main/core/_ARCH.md) | 主进程核心：mihomo 控制、Cursor 传输健康、Marathon 恢复、探针 ledger |
| [src/renderer/src/components/proxies/_ARCH.md](src/renderer/src/components/proxies/_ARCH.md) | 代理页 UI、节点 badge、build stamp |
| [src/shared/_ARCH.md](src/shared/_ARCH.md) | 跨进程类型与构建标识 |
| [CURSOR-DISCONNECT-TRIAGE.md](CURSOR-DISCONNECT-TRIAGE.md) | Cursor 断连排查 SOP |
| [BUGFIX_LOG.md](BUGFIX_LOG.md) | 网络/安装缺陷台账与 ship 门禁记录 |
| [scripts/_ARCH.md](scripts/_ARCH.md) | 构建/安装/验收脚本（含 Agent SSOT `agent-sparkle-upgrade.sh`） |

## 进程与数据流

```
Renderer (React)
  ↔ preload ↔ Main (Electron)
                  ├ manager.ts — mihomo 生命周期
                  ├ cursorTransportHealth — 30s hung_scan / L0–L3 恢复
                  ├ marathonTransportDialOrchestrator — rescue / warmth / partition
                  ├ hy2ParentSidecar + carrierQuiesceRefresh — HY2 parent UDP refresh (R2)
                  └ api2ProbePlane — ~/.sparkle/api2-probe-ledger.jsonl

mihomo (TUN) → VPS leaf (JP-VPS-TLS / HY2 / …) → api2.cursor.sh / Connect gRPC
```

## 架构约束

1. **Marathon 赛中零 data-plane mutation** — 不切节点、不 failover、不关 healthy inner TCP（critical host 保护）。
2. **短探针 ≠ 长流健康** — ledger `scope=active` 绿不能单独否定 L3 QUIC byte-freeze。
3. **定责 SSOT** — renderer `agent-error` @ A 时刻 + Sparkle app-log @ A±60s + V5 矩阵；IFM 标签不可盲信。
4. **安装 SSOT** — macOS 仅 `/Applications/Sparkle.app`（`pnpm run agent:upgrade:mac` / `upgrade:mac`）；禁止 ditto 覆盖、禁止 Agent 裸 `pnpm build:mac`。
5. **Ship 定义** — git HEAD = 已安装 semver + `verify-byte-death-recovery-gate.mts` PASS + G9 soak `attemptRate≥90%`（见 [BUGFIX_LOG.md](BUGFIX_LOG.md)）。

## 外部依赖

| 组件 | 用途 |
|------|------|
| Mihomo | 代理内核、连接池、provider delay |
| sing-box @ JP-VPS | 入站 Reality / HY2 / TUIC |
| Cursor 3.x | Agent SSE / Connect 长流 |
| `~/.sparkle/` | ledger、transport failures、max-steps snapshot |
