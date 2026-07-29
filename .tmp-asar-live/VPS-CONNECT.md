# 两台自建 VPS 连接指南

> **Public repo note**: 真实 IP、SSH 端口、密钥等敏感信息勿写入 git。本文档使用占位符；生产值请保存在私有运维文档或本地 override 中。

本文档说明 KR-VPS（首尔）与 JP-VPS（东京）的三种「连接」方式。当前 Sparkle 架构下，两台 VPS **彼此不直连**，均由本地 Mac 上的 Sparkle/mihomo 分别接入。详见 [VPS-INFRA.md](./VPS-INFRA.md)。

---

## 架构概览

```
Mac (Sparkle / mihomo TUN)
  ├─ KR-VPS-Reality / HY2 / TUIC   (:443 / :8443 / :8444)
  └─ JP-VPS-Reality / HY2 / TUIC   (:443 / :8443 / :8444)
         ↓                              ↓
    sing-box (首尔)                sing-box (东京)
         ↓                              ↓
      目标网站                        目标网站
```

| 连接类型 | 路径 | 当前是否已部署 |
|----------|------|----------------|
| 运维 SSH | 你 → 各台 VPS | ✅ 已部署 |
| 客户端代理 | Mac → VPS → 互联网 | ✅ 已部署（Sparkle 主路径） |
| VPS 互连 | KR ↔ JP 私有网络 | ❌ 需额外搭建 |

---

## 1. 运维 SSH 连接

两台 VPS 均已加固：**密钥认证 + 非标 SSH 端口 + fail2ban**。

### 1.1 基本命令

```bash
# 首尔 KR-VPS
ssh -p <SSH_PORT> root@<KR_VPS_IP>

# 东京 JP-VPS
ssh -p <SSH_PORT> root@<JP_VPS_IP>
```

**前提**：本机 `~/.ssh/id_ed25519.pub` 已写入两台 VPS 的 `/root/.ssh/authorized_keys`。

### 1.2 SSH config（推荐）

在 `~/.ssh/config` 追加：

```
Host kr-vps
  HostName <KR_VPS_IP>
  Port <SSH_PORT>
  User root
  IdentityFile ~/.ssh/id_ed25519

Host jp-vps
  HostName <JP_VPS_IP>
  Port <SSH_PORT>
  User root
  IdentityFile ~/.ssh/id_ed25519
```

之后：

```bash
ssh kr-vps
ssh jp-vps
```

### 1.3 安全要点

| 项目 | 配置 |
|------|------|
| 端口 | 非默认（勿用 22） |
| 认证 | 仅 ed25519 密钥，密码登录已禁用 |
| Root | `PermitRootLogin prohibit-password` |
| 防护 | fail2ban（maxretry=3, bantime=1h） |

---

## 2. 本地客户端连接（Sparkle 主路径）

Mac 通过 Sparkle/mihomo 订阅 VPS 节点，流量路径为 **Mac → VPS sing-box → 目标**。

### 2.1 VPS 端

每台 VPS 运行 sing-box 单进程，暴露三类 inbound：

| 协议 | 端口 | 节点名示例 |
|------|------|------------|
| VLESS + REALITY | 443/tcp | KR-VPS-Reality / JP-VPS-Reality |
| Hysteria2 | 8443/tcp+udp | KR-VPS-HY2 / JP-VPS-HY2 |
| TUIC | 8444/udp | KR-VPS-TUIC / JP-VPS-TUIC |

- 配置路径：`/etc/sing-box/config.json`
- 节点订阅：`/root/sparkle-nodes.yaml`
- 状态检查：`systemctl status sing-box`
- 安装脚本：`scripts/vps-deploy/install-singbox-seoul-cursor.sh`（首尔）、`install-singbox-tokyo-general.sh`（东京）
- 迁移脚本：`scripts/vps-deploy/migrate-to-singbox-only.sh`

### 2.2 防火墙（UFW，两台一致）

| 端口 | 协议 | 用途 |
|------|------|------|
| 443 | tcp + udp | VLESS + REALITY |
| 8443 | tcp + udp | Hysteria2 (QUIC) |
| 8444 | udp | TUIC (QUIC) |
| `<SSH_PORT>` | tcp | SSH |

```bash
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 8443/tcp
ufw allow 8443/udp
ufw allow 8444/udp
ufw allow <SSH_PORT>/tcp
ufw enable
```

### 2.3 Mac 端（Sparkle）

1. 启动 Sparkle，确保 mihomo TUN 模式生效
2. 在代理列表中选择 KR 或 JP 节点（Reality 稳定性优先，Cursor 默认 `KR-VPS-Reality`）
3. Cursor 专用组：`🎯 Cursor 3.1.15 专用`，探测 URL 为 `https://api2.cursor.sh`

### 2.4 运维禁忌

**禁止频繁 `systemctl restart sing-box`**。一次 restart 会 RST 所有进行中连接（Reality / HY2 / TUIC 同进程），包括：

- Cursor Agent / Chat 长连接 SSE
- 本地 mihomo 已建立的 proxy session
- 进行中的 HY2/TUIC QUIC 流

**推荐维护顺序**：

1. 确认无 Cursor parallel agent / marathon 会话
2. 改配置 → `sing-box check -c /etc/sing-box/config.json`
3. `systemctl restart sing-box` **仅一次**
4. 本地 Sparkle 观察节点延迟与 `api2.cursor.sh` 连通性

---

## 3. 两台 VPS 互相直连（Site-to-Site）

若需 **KR ↔ JP 内网互通**（SSH 走私有 IP、链式转发等），当前架构未包含，推荐 **WireGuard**。

### 3.1 安装（两台均执行）

```bash
apt update && apt install -y wireguard
```

### 3.2 生成密钥（各台独立执行）

```bash
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
chmod 600 /etc/wireguard/privatekey
```

### 3.3 KR-VPS 配置 `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.0.0.1/24
PrivateKey = <KR_PRIVATE_KEY>
ListenPort = 51820

[Peer]
PublicKey = <JP_PUBLIC_KEY>
AllowedIPs = 10.0.0.2/32
Endpoint = <JP_VPS_IP>:51820
PersistentKeepalive = 25
```

### 3.4 JP-VPS 配置 `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.0.0.2/24
PrivateKey = <JP_PRIVATE_KEY>
ListenPort = 51820

[Peer]
PublicKey = <KR_PUBLIC_KEY>
AllowedIPs = 10.0.0.1/32
Endpoint = <KR_VPS_IP>:51820
PersistentKeepalive = 25
```

### 3.5 启动与验证

```bash
# 两台均执行
ufw allow 51820/udp
systemctl enable --now wg-quick@wg0

# KR 上验证
ping 10.0.0.2
ssh root@10.0.0.2   # 若 JP 允许 wg0 来源 SSH
```

### 3.6 替代方案

| 方案 | 适用场景 |
|------|----------|
| **Tailscale / Headscale** | 多机 mesh，零配置 NAT 穿透 |
| **sing-box chain outbound** | A 收流量 → 经 B 出网（中转/链式代理） |

链式代理需在 sing-box 的 `outbounds` 中配置 VLESS/HY2 客户端指向对端 inbound，复杂度高于 WireGuard，仅在需要「流量经 A 中转再到 B 出网」时使用。

---

## 4. 快速对照

| 你的目标 | 使用方案 | 文档章节 |
|----------|----------|----------|
| 登录 VPS 改 sing-box 配置 | SSH | §1 |
| Mac / Cursor 走代理上网 | Sparkle 订阅节点 | §2 |
| 首尔 VPS ping 通东京 VPS 内网 | WireGuard | §3 |
| 流量 KR 入口 → JP 出口 | sing-box chain | §3.6 |

---

## 5. 相关文件

| 文件 | 说明 |
|------|------|
| [VPS-INFRA.md](./VPS-INFRA.md) | 服务器规格、防火墙、sing-box 运维规范 |
| `scripts/vps-deploy/` | 安装与迁移脚本 |
| `src/main/core/cursorDedicatedDefault.ts` | Cursor 默认 VPS 节点逻辑 |

---

## 6. 运维交接（完整 Handover）

本节供接任人一次性掌握「有什么、在哪、怎么验、怎么修」。**真实 IP / 端口 / UUID / 密钥不进 git**，填私有运维表。

### 6.1 私有信息清单（模板，勿提交 git）

在本地或 1Password / Bitwarden 维护 **`VPS-OPS-PRIVATE.md`**（或等价表格），至少包含：

| 字段 | KR-VPS（首尔） | JP-VPS（东京） |
|------|----------------|----------------|
| 云厂商 / 机房 | Vultr Seoul | Vultr Tokyo |
| 公网 IP | `<KR_VPS_IP>` | `<JP_VPS_IP>` |
| SSH 端口 | `<SSH_PORT>` | `<SSH_PORT>` |
| SSH 密钥 | `~/.ssh/id_ed25519`（或指定路径） | 同左 |
| VLESS UUID | 见 `/root/sparkle-nodes.yaml` | 同左 |
| Reality public-key / short-id | 同上 | 同上 |
| HY2 password | 同上 | 同上 |
| TUIC uuid / password | 同上（若启用） | 同上 |
| sing-box clash_api secret | `/root/.sing-box-clash-secret`（若启用审计） | 同左 |
| WireGuard 私钥 | 若已部署 §3 | 同左 |

**VPS 上一键导出节点（接任人首步）**：

```bash
ssh kr-vps 'cat /root/sparkle-nodes.yaml'
ssh jp-vps 'cat /root/sparkle-nodes.yaml'
```

### 6.2 资产与职责分工

| 项目 | KR-VPS | JP-VPS |
|------|--------|--------|
| 地理 | 韩国首尔 | 日本东京 |
| 主要用途 | Cursor 长连接优先（公司网 Reality 更稳） | 通用流量 / 备用 Reality |
| sing-box | 单进程 :443 / :8443 / :8444 | 同左 |
| 节点前缀 | `KR-VPS-*` | `JP-VPS-*` |
| 内核调优 | `/etc/sysctl.d/99-cursor-hy2.conf` | 同左 |
| 已退役服务 | xray、hysteria-server（disable，勿重启） | 同左 |

**Sparkle 侧默认策略**（`cursorDedicatedDefault.ts`）：

- Cursor 专用组 `🎯 Cursor 3.1.15 专用` 默认 **`KR-VPS-Reality`**
- 次选 **`JP-VPS-Reality`**
- **避免** Cursor marathon 使用 `*-HY2` / `*-TUIC`（UDP 不稳定，易断 SSE）

### 6.3 新 VPS 从零部署（或重建节点）

**推荐**：仓库内 `migrate-to-singbox-only.sh`（与生产 KR/JP 对齐）。

```bash
# 1. 本机上传脚本
scp -P <SSH_PORT> scripts/vps-deploy/migrate-to-singbox-only.sh root@<VPS_IP>:/root/

# 2. SSH 登录后执行（NODE_PREFIX 决定 Sparkle 节点名）
#    general = Reality + HY2 + TUIC（三节点）
#    cursor  = Reality + HY2（无 TUIC）
ssh -p <SSH_PORT> root@<VPS_IP>
bash /root/migrate-to-singbox-only.sh general KR-VPS   # 首尔示例
# bash /root/migrate-to-singbox-only.sh general JP-VPS   # 东京示例

# 3. 确认
systemctl is-active sing-box
cat /root/sparkle-nodes.yaml
ufw status numbered
```

**可选脚本**（历史/分场景，端口可能与生产不一致，部署后核对 UFW）：

| 脚本 | 场景 |
|------|------|
| `install-singbox-seoul-cursor.sh` | 首尔 Cursor 专用（Reality + HY2） |
| `install-singbox-tokyo-general.sh` | 东京通用（Reality + HY2 + TUIC） |
| `enable-singbox-audit-logging.sh` | 开启文件审计 + clash_api（127.0.0.1:19090） |

**SSH 加固（新机器必做，与 [VPS-INFRA.md](./VPS-INFRA.md) 一致）**：

1. 写入本机 `ed25519` 公钥 → `authorized_keys`
2. 改 SSH 端口、禁用密码登录
3. `apt install fail2ban` + UFW 仅放行 §2.2 端口
4. 关闭 UFW 上的 22/tcp（若已改端口）

### 6.4 节点同步到 Mac（Sparkle）

两台 VPS **不会自动推送**节点到 Mac，需人工同步：

```
VPS /root/sparkle-nodes.yaml
        ↓ scp / 复制 proxies 段
Mac Sparkle Profile（proxies 列表）
        ↓ generateProfile
mihomo proxy-provider：~/Library/Application Support/sparkle/profiles/<profileId>-proxies.yaml
        ↓
UI：🎯 Cursor 3.1.15 专用 / 代理列表可见 KR-VPS-*、JP-VPS-*
```

**操作步骤**：

1. 从两台 VPS 取得 `sparkle-nodes.yaml` 的 `proxies:` 列表
2. Sparkle → **配置 / Profile** → 编辑当前 profile → **proxies** 区域合并（节点 `name` 必须与 `KR-VPS-*` / `JP-VPS-*` 一致）
3. 保存并 **重新生成 / 重启 Core**（Sparkle 会将 leaf 写入 proxy-provider 文件）
4. 打开 **🎯 Cursor 3.1.15 专用**，确认出现 6 个 VPS leaf（KR×3 + JP×3，若均为 general 角色）
5. 选手动固定 **`KR-VPS-Reality`** 或等待自动默认逻辑生效

**Mac 侧路径（排障用）**：

| 路径 | 内容 |
|------|------|
| `~/Library/Application Support/sparkle/profiles/` | profile YAML + `{id}-proxies.yaml` |
| Sparkle 日志 | 应用内日志 / `core-*.log`（节点切换、Cursor 默认） |

### 6.5 连通性验收清单（交接必跑）

接任人应在 **Mac + 两台 VPS** 各执行一遍，打勾存档。

#### A. VPS 本机

```bash
systemctl is-active sing-box          # → active
ss -tlnp | grep -E '443|8443'         # Reality/HY2 监听
ss -ulnp | grep -E '8443|8444'        # HY2/TUIC UDP
curl -fsS4 --max-time 5 ifconfig.me   # 公网 IP 与 DNS 记录一致
tail -20 /var/log/sing-box/sing-box.log  # 无持续 auth failed
```

#### B. Mac → VPS（Sparkle 开启 TUN）

| 检查项 | 预期 |
|--------|------|
| 代理列表 KR/JP Reality 延迟 | 非全红；Reality 可用即使 UI delay 偶发 0 |
| 选 KR-VPS-Reality → 访问 `https://api2.cursor.sh` | 通 |
| Cursor 专用组当前节点 | `KR-VPS-Reality`（或已知例外） |
| 高级 → 网络三角诊断 | marketplace 通 + api2 通 → 路径正常 |

#### C. SSH

```bash
ssh kr-vps 'hostname && uptime'
ssh jp-vps 'hostname && uptime'
```

#### D. （可选）WireGuard

```bash
ssh kr-vps 'ping -c 3 10.0.0.2'
```

### 6.6 日常运维 SOP

| 场景 | 操作 | 注意 |
|------|------|------|
| 查看 sing-box 状态 | `systemctl status sing-box` | 勿频繁 restart |
| 改 inbound 密钥 | 改 `config.json` → check → **单次** restart | 同步 Mac profile + provider |
| 轮换 UUID/密码 | 改 VPS config + 重写 `sparkle-nodes.yaml` | Mac proxies **必须**同步更新 |
| Cursor 断流 | 先查是否误切 HY2/TUIC；改回 Reality | 见 BUGFIX_LOG |
| 审计 / 连接证据 | `enable-singbox-audit-logging.sh` | clash_api 仅 127.0.0.1 |
| 内核 UDP 问题 | 确认 `99-cursor-hy2.conf` 已 `sysctl --system` | KR/JP 应对齐 |

### 6.7 故障排查（决策树）

```
Mac 无法上网 / Cursor api2 失败
├─ Sparkle 未开 TUN / Core 未运行 → 重启 Sparkle
├─ 仅 Cursor 失败，其他正常
│   ├─ 专用组是否 HY2/TUIC → 切 KR-VPS-Reality
│   └─ 三角诊断：marketplace OK、KR+JP api2 均失败 → 公司网到 VPS 路径问题（VPS 可能仍存活）
├─ 全部 VPS 节点 UI 超时
│   ├─ Reality 实际可用 → 已知 provider delay UI 误报，以 api2 实测为准
│   └─ Reality 也不通 → SSH 上 VPS 查 sing-box / UFW / 云厂商防火墙
├─ REALITY authentication failed 激增
│   ├─ 是否刚 restart sing-box → 等客户端重连，勿连续 restart
│   └─ Mac 节点 UUID/public-key 是否与 VPS 不一致 → 重新同步 §6.4
└─ 仅 JP 或仅 KR 失败 → 单台 VPS / 单区域线路问题，切另一台 Reality
```

### 6.8 接任人第一周建议

1. 填完 §6.1 私有表，确认能 `ssh kr-vps` / `ssh jp-vps`
2. 跑完 §6.5 验收清单并保存截图或日志片段
3. 阅读 [VPS-INFRA.md](./VPS-INFRA.md)「禁止频繁 restart」与 2026-06-20 事故记录
4. 在 Sparkle 确认 Cursor 专用组为 **Reality**，理解 `cursorDedicatedDefault.ts` 默认逻辑
5. **不要**在未同步 Mac profile 的情况下单独轮换 VPS 密钥

### 6.9 文档索引

| 文档 / 代码 | 用途 |
|-------------|------|
| **本文 VPS-CONNECT.md** | 怎么连、怎么交接、怎么验 |
| [VPS-INFRA.md](./VPS-INFRA.md) | 规格、UFW、restart 规范、安全加固历史 |
| `BUGFIX_LOG.md` | Sparkle ↔ VPS 历史故障与修复 |
| `scripts/vps-deploy/` | 安装、迁移、审计脚本 |
| `networkTriangulationDiagnosticCore.ts` | Mac 侧三角诊断逻辑 |
| `customProxyGroups.ts` | Cursor 专用组注入与 VPS filter |
