# Cursor Connect Split-Brain · 修复 Roadmap（Sparkle 仓索引）

> **唯一 SSOT**：`/Users/yululiu/projects/AI/open-perplexity/temp-docs/repair/CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md`
>
> 禁止在本目录创建同主题平行 roadmap。所有 P0–P17 实施细节、验收、风险矩阵以 SSOT 为准。

## 最新（2026-07-27）

- **§25 P17 ⚠️部分 ship（1.26.77）** · **§26 P18 待授权** — 闭合 merge dedupe + blind_spot + triage v3.4
- **根因**：L3 JP-VPS-HY2 Connect partition + Sparkle observability dead path（`Cursor/logs` 未 discover · NAL `Stream error reported…` 未 parse）
- **pkg 目标**：Sparkle **≥1.26.77**

## 关联

| 文档 | 关系 |
| --- | --- |
| `CURSOR-DISCONNECT-TRIAGE.md` | 排查 SOP |
| `temp-docs/repair/CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md` | 数据面零 mutation 内核（并行，不重复） |
