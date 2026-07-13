# VPS 基础设施

## 服务器列表

### KR-VPS (韩国首尔)

| 项目 | 值 |
|---|---|
| IP | 141.164.43.229 |
| 机房 | Vultr Seoul |
| vCPU | 1 |
| RAM | 1024 MB |
| 存储 | 25 GB SSD |
| OS | Ubuntu (Linux 7.0.0-22-generic) |

**服务**（sing-box 单进程，2026-07-02 实测）:
- **sing-box**（VLESS+REALITY :443 · Hysteria2 :8443 · TUIC :8444）
- 节点订阅: `/root/sparkle-nodes.yaml`（KR-VPS-Reality / KR-VPS-HY2 / KR-VPS-TUIC）
- 已退役: `xray`、`hysteria-server`（独立守护进程，inactive）

### JP-VPS (日本东京)

| 项目 | 值 |
|---|---|
| IP | 45.76.104.78 |
| 机房 | Vultr Tokyo |
| vCPU | 1 |
| RAM | 1024 MB |
| 存储 | 25 GB SSD |

**服务**（sing-box 单进程，2026-07-02 实测）:
- **sing-box**（VLESS+REALITY :443 · Hysteria2 :8443 · TUIC :8444）
- 节点订阅: `/root/sparkle-nodes.yaml`（JP-VPS-Reality / JP-VPS-HY2 / JP-VPS-TUIC）
- 内核调优: `/etc/sysctl.d/99-cursor-hy2.conf`（2026-07-02 补部署，与 KR 对齐）
- 已退役: `xray`、`hysteria-server`（独立守护进程，inactive）

## SSH 登录

两台均已加固为密钥认证 + 非标端口：

```bash
# KR-VPS
ssh -p 29222 root@141.164.43.229

# JP-VPS
ssh -p 29222 root@45.76.104.78
```

- 端口: **29222**（非默认 22）
- 认证: **仅密钥**（ed25519），已禁用密码登录
- PermitRootLogin: prohibit-password
- fail2ban: 已启用（maxretry=3, bantime=1h）

## 防火墙 (UFW)

两台服务器 UFW 规则一致：

| 端口 | 协议 | 用途 |
|---|---|---|
| 443/tcp | TCP | sing-box VLESS+REALITY |
| 443/udp | UDP | sing-box |
| 8443/tcp | TCP | sing-box Hysteria2 |
| 8443/udp | UDP | sing-box Hysteria2 (QUIC) |
| 8444/udp | UDP | sing-box TUIC (QUIC) |
| 29222/tcp | TCP | SSH |

## sing-box 配置（KR-VPS / JP-VPS）

- 路径: `/etc/sing-box/config.json`
- 状态: `systemctl status sing-box`
- 迁移脚本: `scripts/vps-deploy/migrate-to-singbox-only.sh`
- 内核调优: `/etc/sysctl.d/99-cursor-hy2.conf`（UDP buffer + conntrack）

### 运维规范：禁止频繁 restart

KR/JP 均为 **sing-box 单进程**（Reality :443 · HY2 :8443 · TUIC :8444 同进程）。  
**不要频繁执行 `systemctl restart sing-box`** — 一次 restart 会 **RST 所有进行中连接**（Reality / HY2 / TUIC 全部中断），包括：

- Cursor Agent / Chat 的长连接 SSE
- 本地 mihomo 上已建立的 proxy session
- 正在进行的 HY2/TUIC QUIC 流

**何时可以 restart**

- 修改 `/etc/sing-box/config.json` 且必须生效时
- sing-box 进程异常（`systemctl is-active sing-box` 非 active）时
- **无 Cursor Agent 在跑**、可接受短暂断连的维护窗口

**维护顺序（推荐）**

1. 确认 Cursor 无 parallel agent / marathon 会话
2. 改配置 → `sing-box check -c /etc/sing-box/config.json`（若版本支持）
3. `systemctl restart sing-box` **仅一次**
4. 本地 Sparkle 观察节点延迟与一条 `api2.cursor.sh` 连接，勿连续 restart 试配置

**禁止**

- 调试时连续多次 `restart`（「不行再重启」）
- Agent 赛中 SSH 上去 restart（等同强制掐断 SSE，易 stream-eof / Continue 计次）
- 用 restart 代替 `reload` 做无必要的配置试探（无热加载需求时仍应合并为单次 restart）

> 历史对照：2026-06-20 曾因 **人为三次 `systemctl restart xray`** 导致 KR Reality 大量断连（见下）。  
> 迁 sing-box 后协议合一，**同一规则适用**：频繁 restart sing-box = 三类节点同时掉线。

## 历史（已废弃）

独立 Xray / hysteria-server 配置路径（`/etc/xray/config.json`、`/etc/hysteria/config.yaml`）仅作遗留文件，服务已 disable。

## 安全加固记录

### 2026-06-20: SSH 安全加固

**问题**: 服务器遭受持续 SSH 暴力破解（176.65.139.94 等多个 IP），每秒数次尝试。

**执行的操作**:
1. 添加 ed25519 SSH 公钥
2. SSH 端口 22 → 29222
3. 禁用密码登录 (PasswordAuthentication no)
4. 安装 fail2ban (3 次失败后 ban 1 小时)
5. UFW 关闭旧端口 22

### 2026-06-20: KR-VPS Reality 断连排查

**现象**: Cursor 通过 KR-VPS-Reality 节点大量 REALITY authentication failed (1909次) 和 EOF (1379次)。

**根因**: Xray 在 UTC 03:37/04:05/04:30 被人为重启了 3 次（从 120.244.221.207 SSH 登录后执行 systemctl restart xray），重启期间所有 Reality 连接中断。

**结论**: 非节点配置问题，是人为重启导致。HY2 节点（Hysteria2）未受影响（已稳定运行 5 天）。  
**现行（sing-box 单进程）**: 上述结论同样适用于 `systemctl restart sing-box` — 见上文 **「运维规范：禁止频繁 restart」**。
