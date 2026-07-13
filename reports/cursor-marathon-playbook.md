# Cursor Marathon 代理操作手册

> SSOT 交叉引用：`open-perplexity/tools/CURSOR_500_GUARD_ROADMAP.md` §5.4  
> 代码证据：`src/main/core/confirmCursorProxySwitch.ts` · `cursorNetworkOptimize.ts`

## 核心原则

1. **换 mihomo 节点 ≠ Cursor 计次**，但会 **RST 进行中的 Agent SSE** → 触发 stream-eof → 逼用户 Continue → **浪费 Included**。
2. **赛中（有 parallel agent 在跑）绝不换节点** — 比 TLS 偶发更危险。
3. TLS / stream 优化靠 **赛前** stack 配好，不是靠赛中切换。
4. **api2 全系 ~77s `[unavailable]` 且 Marketplace 仍 200** → 多为 **Sparkle/mihomo TUN 出站池僵死**，不是节点坏了；**退出 Sparkle 重启** 有效，换节点无效。详见 [BUGFIX_LOG.md](../BUGFIX_LOG.md) BUG-2026-07-09-001。

## 赛前（无 Agent 在跑）

- [ ] `cursorBidiOptimize=true`（默认）
- [ ] TUN 开；系统 HTTP 代理关（`cursorSysProxyLock`）
- [ ] Cursor 域名走 `🎯 Cursor-专用` **Selector**（固定节点）
- [ ] **禁止** Cursor 流量走 UrlTest / 自动选择 / 故障转移
- [ ] 节点通过 **60s api2 短探测**（`api2.cursor.sh` HEAD；`network-stability-events.jsonl` kind:probe）
- [ ] keep-alive-idle ≥ 3600s；fake-ip-filter 含 `+.cursor.sh` / `+.workers.dev`
- [ ] VPS 维护：**禁止频繁** `systemctl restart sing-box`（单进程，restart 断所有 Reality/HY2/TUIC；见 `VPS-INFRA.md` §运维规范）

## 赛中（marathon + parallel）

- [ ] **不**手动切 Selector 节点（托盘切换会弹窗警告）
- [ ] **不**依赖 ProxyHealthMonitor 对 Cursor 组 auto-failover
- [ ] Cursor Guard：**拦截 ON** → 断连后 **Continue 1 次**（同 session）
- [ ] 容忍 stream-eof / resource_exhausted（Cursor 服务端；换节点无效）

## 赛后（全 Agent idle）

- [ ] 短探测连续失败 / agent RST 增多 → **此时** 换 Cursor 专用节点给下一轮
- [ ] 查 `~/.sparkle/network-stability-events.jsonl`

## 断连 vs 代理（日志对照）

| `connectCode` / errMsg | 层 | 赛中换节点有帮助? |
|------------------------|-----|-------------------|
| stream-eof / LostConnection | Cursor SSE | ❌ |
| 8 resource_exhausted | Cursor 服务端 | ❌ |
| 13 max-steps | Cursor 服务端 | ❌ |
| 10 tls-handshake | 代理（重连握手） | ❌ 赛中切更糟；赛前 stack |

## 常见误区

| 误区 | 事实 |
|------|------|
| 「TLS 失败就换节点」 | 换节点会断现有/重连中的 TCP；Continue 前换仍可能掐流 |
| 「换节点会多计一次」 | 节点切换本身不计次；**断连后的 Continue 才计次** |
| 「关并行更稳」 | 违背 500 次「一次做最多事」目标；stall 阈值已按并行抬高 |
| 「compact 每次都 +1」 | 通常同 generation 内 token 快照；见 Guard compact 对账 |
