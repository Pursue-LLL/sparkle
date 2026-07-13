# Cursor VPS Node Benchmark (24h)

Generated: 2026-07-08T11:15:49.722Z
Probe target: https://api2.cursor.sh
Window: rolling 24h | Sample interval: 60s | Min samples for ranking: 10
Samples in window: 1500 | VPS nodes tracked: 6
Commercial probe: **off** (legacy commercial jsonl rows ignored in ranking)

## Executive Summary

- **最快 (P50)**: JP-VPS-TUIC — P50 290ms, σ 122.7ms, success 100.0%
- **推荐 (combined)**: KR-VPS-TUIC — combined 87.5, probe 87.5, P50 311ms, jitter 150ms, slow>500ms 3.2%

## Top Ranked VPS (>=10 samples, combined score)

_combined = probe score (success − avg/100 − slow>500 rate×30 − jitter×0.05 − recent_slow_extra) + session score (2h when ≥1 session obs, else 24h: − agent_RST×2)_
_badge gate: success≥95%, slow>500ms≤15%, jitter≤150ms_

1. **KR-VPS-TUIC** (KR-VPS) — combined 87.5, probe 87.5, P50 311ms, slow>500ms 3.2% (−1.0), slow2h 6.3%
2. **KR-VPS-HY2** (KR-VPS) — combined 86.8, probe 86.8, P50 304ms, slow>500ms 3.2% (−1.0), slow2h 12.5%, badge✗ jitter>150ms
3. **JP-VPS-HY2** (JP-VPS) — combined 84.6, probe 84.6, P50 300ms, slow>500ms 5.2% (−1.6), slow2h 6.3%, badge✗ jitter>150ms
4. **JP-VPS-TUIC** (JP-VPS) — combined 83.6, probe 83.6, P50 290ms, slow>500ms 6.0% (−1.8), slow2h 18.8%, badge✗ jitter>150ms
5. **KR-VPS-Reality** (KR-VPS) — combined 76.2, probe 76.2, P50 351ms, slow>500ms 7.0% (−2.1), slow2h 18.8%, badge✗ jitter>150ms
6. **JP-VPS-Reality** (JP-VPS) — combined 68.1, probe 68.1, P50 291ms, slow>500ms 12.7% (−3.8), slow2h 31.3%, badge✗ success<95%

## Lowest Latency VPS (P50, >=5 successful samples)

1. **JP-VPS-TUIC** — P50 290ms, avg 334ms, success 100.0%
2. **JP-VPS-Reality** — P50 291ms, avg 339ms, success 94.8%
3. **JP-VPS-HY2** — P50 300ms, avg 332ms, success 99.6%
4. **KR-VPS-HY2** — P50 304ms, avg 354ms, success 99.6%
5. **KR-VPS-TUIC** — P50 311ms, avg 359ms, success 99.6%
6. **KR-VPS-Reality** — P50 351ms, avg 411ms, success 97.2%

## Full Comparison (VPS)

| Kind | Region | Node | N | Success | Min | P50 | Avg | P90 | P95 | Max | σ | Jitter | CV% |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| VPS | JP-VPS | JP-VPS-TUIC | 250 | 100.0% | 262 | 290 | 334 | 460 | 516 | 1333 | 122.7 | 226 | 36.8 |
| VPS | JP-VPS | JP-VPS-Reality | 250 | 94.8% | 220 | 291 | 339 | 614 | 656 | 1960 | 164.5 | 365 | 48.5 |
| VPS | JP-VPS | JP-VPS-HY2 | 250 | 99.6% | 241 | 300 | 332 | 455 | 503 | 1042 | 99.9 | 203 | 30.1 |
| VPS | KR-VPS | KR-VPS-HY2 | 250 | 99.6% | 279 | 304 | 354 | 457 | 470 | 952 | 101.1 | 166 | 28.6 |
| VPS | KR-VPS | KR-VPS-TUIC | 250 | 99.6% | 283 | 311 | 359 | 456 | 461 | 764 | 91.1 | 150 | 25.4 |
| VPS | KR-VPS | KR-VPS-Reality | 250 | 97.2% | 279 | 351 | 411 | 468 | 646 | 1761 | 184.9 | 295 | 45.0 |

## Metrics

- **P50/P90/P95**: latency percentiles to api2.cursor.sh (mihomo delay API)
- **σ (stdev)**: spread of successful probes; lower = more consistent
- **short_probe**: Sparkle HEAD api2.cursor.sh every 60s (connectivity + delay alert; writes kind:probe jsonl)
- **agentRST**: ECONNRESET failures from Cursor agent (500 Guard + patch-99); ranking uses actual counts only
- **probe score**: success×100 − avg/100 − slow500 penalty − jitter×0.05 − recent slow spike extra
- **session score**: 2h window when ≥1 session obs (agent RST), else 24h; − agent RST×2
- **slow>500ms**: share of successful probes above 500ms; penalty = rate×30
- **combined score**: probe score + session score
- **badge gate**: success≥95%, slow>500ms≤15%, jitter≤150ms — otherwise no UI badge
- **Jitter**: P95 − P50; tail latency risk for long SSE sessions
- **CV%**: coefficient of variation (σ/mean); normalized stability
- **VPS**: canonical HY2/TUIC/Reality leaf nodes (KR/JP); commercial subscription probe is off
