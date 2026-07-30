# Cursor 断连修复 · Sparkle 仓索引

> **唯一 Master SSOT**：`/Users/yululiu/projects/AI/open-perplexity/temp-docs/repair/CURSOR_DISCONNECT_REPAIR_MASTER_SSOT.md`（~3900 行 · 2026-07-30 整合）
>
> **禁止**在本仓复制 Master 全文。变更 §0–§29 / §29.11 请编辑 open-perplexity Master。

## 文档分工

| 主题 | SSOT |
| --- | --- |
| 事故注册表 · §M.0 · §29.11 `81afd4e9` · R-17–R-21 | open-perplexity **Master** |
| MTCP §29 · Connect split-brain P12–P29 | Master **§0–§29**（原 Split-Brain 正文） |
| Marathon 零中断 Mutation Kernel · P21–P27 · §10 定责 | Master **附录 A** + 本仓 [`CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md`](./CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md) 完整正文 |
| L1 ghost / Cursor-2 intercept | Master **附录 B/C** |
| 排查 SOP | 本仓根 [`CURSOR-DISCONNECT-TRIAGE.md`](../../CURSOR-DISCONNECT-TRIAGE.md) |
| BUG 台账 | [`BUGFIX_LOG.md`](../../BUGFIX_LOG.md) **BUG-2026-07-30-001** |

## 最新（2026-07-30）

- **§29.11 TUIC silent stall · 81afd4e9** — L3 definitive · R-17/18/19 待授权 · Operator 赛前 **JP-VPS-TLS**
- **Master 整合** — 原 7 份 Cursor roadmap 合并为单一 SSOT

## 关联

- open-perplexity 薄索引：`temp-docs/repair/CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` → Master
