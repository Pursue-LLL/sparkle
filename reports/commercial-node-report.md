# Cursor Node Benchmark (24h) — VPS + Commercial

Generated: 2026-07-07T01:20:27.730Z
Probe target: https://api2.cursor.sh
Window: rolling 24h | Sample interval: 60s | Min samples for ranking: 10
Samples in window: 16661 | Nodes tracked: 36 (VPS 6 + commercial 30)

## Executive Summary

- **自建最快 (P50)**: JP-VPS-Reality — P50 292ms, σ 236.8ms, success 95.3%
- **自建推荐 (combined)**: KR-VPS-HY2 — combined 86.4, probe 86.4, P50 297ms, jitter 161ms, slow>500ms 0.9% (badge blocked: jitter>150ms)
- **商业最快 (P50)**: 🇭🇰 日本 V3 | 广港隧道、ChatGPT、Netflix(JP) | 3x — P50 214ms, σ 100.3ms
- **商业推荐 (combined)**: 🇯🇵 美国 M1 | 皖日隧道、Netflix(US)、SVIP | 3x — combined 97.5, probe 97.5, P50 230ms, slow>500ms 0.0%
- **推荐**: 商业节点 P50 领先自建 78ms，可 A/B 验证后切换

## Top Ranked (>=10 samples, combined score)

_combined = probe score (success − avg/100 − slow>500 rate×30 − jitter×0.05 − recent_slow_extra) + session score (2h when ≥1 session obs, else 24h: − agent_RST×2)_
_badge gate: success≥95%, slow>500ms≤15%, jitter≤150ms_

1. **[商业] 🇯🇵 美国 M1 | 皖日隧道、Netflix(US)、SVIP | 3x** (日本) — combined 97.5, probe 97.5, P50 230ms
2. **[商业] 🇸🇬 美国 M2 | Netflix(US)、新开机 | 3x** (新加坡) — combined 93.4, probe 93.4, P50 247ms, slow>500ms 1.5% (−0.5)
3. **[商业] 🇨🇳 台湾 V1 | 皖日隧道、ChatGPT、Netflix(TW) | 3x** (台湾) — combined 91.2, probe 91.2, P50 273ms, slow>500ms 3.1% (−0.9)
4. **[商业] 🇯🇵 日本 V1 | 亚太隧道、IPv6 | 3x** (日本) — combined 91.1, probe 91.1, P50 234ms, slow>500ms 1.4% (−0.4)
5. **[商业] 🇭🇰 日本 V3 | 广港隧道、ChatGPT、Netflix(JP) | 3x** (日本) — combined 89.5, probe 89.5, P50 214ms, slow>500ms 1.8% (−0.5)
6. **[商业] 🇯🇵 日本 I1 | ChatGPT、Netflix(JP) | 3x** (日本) — combined 88.8, probe 88.8, P50 226ms, slow>500ms 2.1% (−0.6)
7. **[商业] 🇸🇬 美国 I2 | IPv6、ChatGPT网页、新开机 | 2x** (新加坡) — combined 87.8, probe 87.8, P50 232ms, slow>500ms 1.9% (−0.6), badge✗ success<95%
8. **[商业] 🇭🇰 台湾 V3 | 广港隧道、ChatGPT | 3x** (台湾) — combined 86.5, probe 86.5, P50 272ms, slow>500ms 2.1% (−0.6), badge✗ jitter>150ms
9. **[自建] KR-VPS-HY2** (KR-VPS) — combined 86.4, probe 86.4, P50 297ms, slow>500ms 0.9% (−0.3), slow2h 3.3%, badge✗ jitter>150ms
10. **[商业] 🇸🇬 美国 M1 | 皖日隧道、Netflix(US)、SVIP、新开机 | 3x** (新加坡) — combined 85.4, probe 85.4, P50 290ms, slow>500ms 4.5% (−1.4), badge✗ jitter>150ms
11. **[商业] 🇨🇳 台湾 I0 | AI、动态IP | 2x** (台湾) — combined 84.5, probe 84.5, P50 269ms, slow>500ms 3.4% (−1.0), slow2h 4.2%, badge✗ success<95%
12. **[自建] KR-VPS-Reality** (KR-VPS) — combined 83.6, probe 83.6, P50 438ms, slow>500ms 5.4% (−1.6), slow2h 1.7%, badge✗ jitter>150ms

## Lowest Latency (P50, >=5 successful samples)

1. **[商业] 🇭🇰 日本 V3 | 广港隧道、ChatGPT、Netflix(JP) | 3x** — P50 214ms, avg 234ms, success 96.5%
2. **[商业] 🇭🇰 日本 V2 | 广港隧道、东京 | 3x** — P50 226ms, avg 261ms, success 96.9%
3. **[商业] 🇯🇵 日本 I1 | ChatGPT、Netflix(JP) | 3x** — P50 226ms, avg 250ms, success 97.6%
4. **[商业] 🇯🇵 日本 I2 | SVIP、AI、IPv6 | 3x** — P50 227ms, avg 255ms, success 94.8%
5. **[商业] 🇯🇵 美国 M1 | 皖日隧道、Netflix(US)、SVIP | 3x** — P50 230ms, avg 230ms, success 100.0%
6. **[商业] 🇸🇬 美国 I2 | IPv6、ChatGPT网页、新开机 | 2x** — P50 232ms, avg 249ms, success 92.7%
7. **[商业] 🇯🇵 日本 V1 | 亚太隧道、IPv6 | 3x** — P50 234ms, avg 250ms, success 96.9%
8. **[商业] 🇸🇬 美国 M2 | Netflix(US)、新开机 | 3x** — P50 247ms, avg 255ms, success 97.8%
9. **[商业] 🇭🇰 台湾 M1 | 港澳B站、Netflix(TW)、SVIP、新开机 | 3x** — P50 255ms, avg 292ms, success 100.0%
10. **[商业] 🇨🇳 台湾 I0 | AI、动态IP | 2x** — P50 269ms, avg 288ms, success 91.3%
11. **[商业] 🇭🇰 台湾 V3 | 广港隧道、ChatGPT | 3x** — P50 272ms, avg 314ms, success 100.0%
12. **[商业] 🇨🇳 台湾 V1 | 皖日隧道、ChatGPT、Netflix(TW) | 3x** — P50 273ms, avg 285ms, success 100.0%

## Full Comparison

| Kind | Region | Node | N | Success | Min | P50 | Avg | P90 | P95 | Max | σ | Jitter | CV% |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 商业 | 日本 | 🇭🇰 日本 V3 | 广港隧道、ChatGPT、Netflix(JP) | 3x | 288 | 96.5% | 203 | 214 | 234 | 250 | 298 | 1556 | 100.3 | 84 | 42.9 |
| 商业 | 日本 | 🇭🇰 日本 V2 | 广港隧道、东京 | 3x | 288 | 96.9% | 216 | 226 | 261 | 249 | 441 | 1979 | 170.3 | 215 | 65.3 |
| 商业 | 日本 | 🇯🇵 日本 I1 | ChatGPT、Netflix(JP) | 3x | 288 | 97.6% | 215 | 226 | 250 | 266 | 338 | 1055 | 101.5 | 112 | 40.6 |
| 商业 | 日本 | 🇯🇵 日本 I2 | SVIP、AI、IPv6 | 3x | 288 | 94.8% | 221 | 227 | 255 | 266 | 408 | 1154 | 107.4 | 181 | 42.2 |
| 商业 | 日本 | 🇯🇵 美国 M1 | 皖日隧道、Netflix(US)、SVIP | 3x | 16 | 100.0% | 227 | 230 | 230 | 233 | 233 | 233 | 2.2 | 3 | 0.9 |
| 商业 | 新加坡 | 🇸🇬 美国 I2 | IPv6、ChatGPT网页、新开机 | 2x | 287 | 92.7% | 223 | 232 | 249 | 243 | 268 | 1545 | 114.0 | 36 | 45.8 |
| 商业 | 日本 | 🇯🇵 日本 V1 | 亚太隧道、IPv6 | 3x | 288 | 96.9% | 228 | 234 | 250 | 273 | 291 | 910 | 65.5 | 57 | 26.2 |
| 商业 | 新加坡 | 🇸🇬 美国 M2 | Netflix(US)、新开机 | 3x | 270 | 97.8% | 234 | 247 | 255 | 267 | 275 | 794 | 57.0 | 28 | 22.4 |
| 商业 | 台湾 | 🇭🇰 台湾 M1 | 港澳B站、Netflix(TW)、SVIP、新开机 | 3x | 16 | 100.0% | 248 | 255 | 292 | 258 | 844 | 844 | 142.7 | 589 | 48.9 |
| 商业 | 台湾 | 🇨🇳 台湾 I0 | AI、动态IP | 2x | 286 | 91.3% | 247 | 269 | 288 | 294 | 326 | 1126 | 94.8 | 57 | 32.9 |
| 商业 | 台湾 | 🇭🇰 台湾 V3 | 广港隧道、ChatGPT | 3x | 288 | 100.0% | 245 | 272 | 314 | 444 | 466 | 1040 | 101.4 | 194 | 32.3 |
| 商业 | 台湾 | 🇨🇳 台湾 V1 | 皖日隧道、ChatGPT、Netflix(TW) | 3x | 287 | 100.0% | 242 | 273 | 285 | 318 | 374 | 707 | 60.1 | 101 | 21.0 |
| 商业 | 台湾 | 🇭🇰 台湾 V2 | 广港隧道、ChatGPT(原生) | 3x | 288 | 98.6% | 266 | 279 | 340 | 465 | 521 | 1184 | 137.6 | 242 | 40.5 |
| 商业 | 日本 | 🇯🇵 美国 M3 | 皖日隧道、Netflix(US)、ChatGPT | 3x | 287 | 97.6% | 219 | 290 | 330 | 359 | 571 | 2056 | 174.7 | 281 | 52.9 |
| 商业 | 新加坡 | 🇸🇬 美国 M1 | 皖日隧道、Netflix(US)、SVIP、新开机 | 3x | 270 | 98.5% | 258 | 290 | 318 | 351 | 461 | 974 | 107.3 | 171 | 33.8 |
| 自建 | JP-VPS | JP-VPS-Reality | 1439 | 95.3% | 218 | 292 | 375 | 646 | 690 | 3251 | 236.8 | 398 | 63.2 |
| 自建 | KR-VPS | KR-VPS-HY2 | 1439 | 97.9% | 281 | 297 | 319 | 444 | 458 | 774 | 58.7 | 161 | 18.4 |
| 自建 | JP-VPS | JP-VPS-TUIC | 1439 | 98.1% | 236 | 304 | 359 | 490 | 511 | 3110 | 185.8 | 207 | 51.8 |
| 自建 | JP-VPS | JP-VPS-HY2 | 1439 | 97.9% | 242 | 306 | 358 | 485 | 504 | 2866 | 164.3 | 198 | 45.9 |
| 商业 | 日本 | 🇭🇰 日本 M2 | 深港隧道、Netflix(JP)、AI | 3x | 288 | 16.3% | 250 | 311 | 297 | 324 | 325 | 329 | 26.2 | 14 | 8.8 |
| 商业 | 新加坡 | 🇭🇰 新加坡 V2 | 深港隧道、ChatGPT、SVIP、BHE | 3x | 288 | 16.3% | 297 | 312 | 334 | 327 | 332 | 1335 | 148.0 | 20 | 44.3 |
| 商业 | 日本 | 🇯🇵 日本 I3 | ChatGPT网页、Netflix(JP)、Gemini | 3x | 286 | 16.1% | 244 | 317 | 319 | 369 | 437 | 609 | 72.3 | 120 | 22.6 |
| 商业 | 新加坡 | 🇭🇰 新加坡 M1 | 广港隧道、Netflix(SG) | 3x | 288 | 100.0% | 315 | 331 | 376 | 509 | 524 | 1505 | 110.2 | 193 | 29.3 |
| 商业 | 新加坡 | 🇸🇬 新加坡 I1 | IPv6 | 2x | 288 | 15.6% | 311 | 334 | 334 | 349 | 350 | 351 | 11.1 | 16 | 3.3 |
| 商业 | 新加坡 | 🇭🇰 新加坡 M2 | 广港隧道、BHE、YouTube免广告 | 3x | 288 | 96.2% | 318 | 353 | 433 | 583 | 765 | 1460 | 193.0 | 412 | 44.6 |
| 商业 | 新加坡 | 🇸🇬 新加坡 I2 | SVIP、YouTube免广告 | 3x | 287 | 95.1% | 316 | 353 | 418 | 563 | 692 | 1410 | 154.1 | 339 | 36.9 |
| 商业 | 日本 | 🇭🇰 日本 M1 | 广港隧道、Netflix(JP)、Tokyo | 3x | 288 | 64.6% | 315 | 371 | 422 | 547 | 724 | 1266 | 141.3 | 353 | 33.5 |
| 商业 | 新加坡 | 🇸🇬 马来西亚 B15 | 皖日隧道、ChatGPT、Netflix(SG) | 3x | 283 | 98.6% | 328 | 383 | 462 | 715 | 1067 | 2153 | 237.2 | 684 | 51.4 |
| 商业 | 日本 | 🇯🇵 日本 V0 | 移动优化 | 2x | 287 | 90.6% | 318 | 390 | 460 | 892 | 986 | 1664 | 201.2 | 596 | 43.8 |
| 自建 | KR-VPS | KR-VPS-Reality | 1439 | 98.4% | 277 | 438 | 410 | 468 | 619 | 3210 | 194.7 | 181 | 47.5 |
| 自建 | KR-VPS | KR-VPS-TUIC | 1439 | 98.0% | 279 | 457 | 473 | 473 | 760 | 2636 | 132.2 | 303 | 27.9 |
| 商业 | 新加坡 | 🇸🇬 澳大利亚 V1 | 直连、IPv6、新开机 | 2x | 287 | 20.2% | 493 | 505 | 761 | 1310 | 1325 | 2093 | 421.8 | 820 | 55.4 |
| 商业 | 新加坡 | 🇸🇬 新加坡 V1 | 直连 | 2x | 272 | 20.2% | 486 | 513 | 720 | 1248 | 1262 | 2229 | 393.0 | 749 | 54.6 |
| 商业 | 新加坡 | 🇸🇬 新加坡 V0 | 移动优化、IPv6 | 1x | 287 | 55.4% | 477 | 565 | 623 | 595 | 1255 | 2258 | 266.7 | 690 | 42.8 |
| 商业 | 新加坡 | 🇸🇬 新加坡 G1 | 直连、移动优化 | 3x | 287 | 59.6% | 477 | 585 | 649 | 640 | 1250 | 1622 | 241.7 | 665 | 37.3 |

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
- **自建 (VPS)**: HY2 leaf nodes from Sparkle override; **商业**: subscription SG/TW/JP
