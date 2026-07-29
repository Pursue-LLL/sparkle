# Cursor Connect Split-Brain · 修复 Roadmap（Sparkle 仓索引）

> **MTCP split-brain / P17–P29 唯一 SSOT**：`/Users/yululiu/projects/AI/open-perplexity/temp-docs/repair/CURSOR_CONNECT_SPLITBRAIN_REPAIR_ROADMAP.md` **§29**
>
> **Marathon 零中断 / L7 / P21–P23 / R-01–R-11 SSOT**：[`CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md`](./CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md) **§10–§17**（**禁止**另建同主题 roadmap）
>
> **实施/发版以 open-perplexity SSOT §29 为准**。§27/§28 为分 plane 细节。

## 最新（2026-07-28）

- **§29 MTCP Phase 4** — 500 Included 终极方案（P19 Execution + P20 Stability · 一批次 · 十四门禁 · pkg 1.26.83+）
- **P21 BUG-021** — `.DS_Store` ENOTDIR 致 MTDO 全灭 · **1.26.85** · 见 Marathon SSOT §11.1
- **P22 段轮换** — 长段 silent EOF / 省 Continue · 见 Marathon SSOT §11.2 · **R-02**
- **定责 c69260ad @14:47** — PRIMARY L7 segment cap + AMPLIFIER BUG-021 · 见 Marathon SSOT §10.1
- **定责 c8346504 @15:41** — PRIMARY **L3** mass PING code=14 · rescue 滞后 · 见 open-perplexity SSOT **§29.10**
- **定责 67699e2d @17:30（F 案）** — PRIMARY **L3** mass PING partition 余波 · AMPLIFIER 45GB vscdb · 见 Marathon SSOT **§10.5d + §11.8 P28**
- **军师结论**：P21 未装 = §29 观测面 dead · 必须先 P21 再 soak §29 · **L7 用 P22 · L3 用 §29**

## 关联

| 文档 | 关系 |
| --- | --- |
| `CURSOR-DISCONNECT-TRIAGE.md` | 排查 SOP |
| `CURSOR-MARATHON-ZERO-DISRUPTION-ROADMAP.md` | IDLE apply / 零 mutation 内核 |
