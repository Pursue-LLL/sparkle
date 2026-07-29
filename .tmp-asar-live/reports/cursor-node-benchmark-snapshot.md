# Cursor Node Benchmark Snapshot — VPS + Commercial

Generated: 2026-06-28T14:14:37.273Z
Probe target: https://api2.cursor.sh
Method: mihomo `/proxies/{name}/delay` | Rounds per node: 5 | Nodes: 26

## Executive Summary

- **自建最快 P50**: JP-VPS-TUIC — 360ms (σ 189.6ms, jitter 475ms)
- **商业最快 P50**: 🇨🇳 台湾 I0 | AI、动态IP | 2x — 275ms (σ 5.5ms)
- **推荐**: 商业 P50 暂领先，建议继续 24h rolling 验证

## Rankings (probe score)

1. **[商业] 🇨🇳 台湾 I0 | AI、动态IP | 2x** — probe 96.7, slow>500 0%, P50 275ms, P95 286ms, success 100%
2. **[自建] JP-VPS-Reality** — probe 95.9, slow>500 0%, P50 365ms, P95 377ms, success 100%
3. **[自建] KR-VPS-TUIC** — probe 76.2, slow>500 40%, P50 466ms, P95 606ms, success 100%
4. **[商业] 🇨🇳 台湾 V1 | 皖日隧道、ChatGPT、Netflix(TW) | 3x** — probe 66.6, slow>500 20%, P50 283ms, P95 756ms, success 100%
5. **[自建] JP-VPS-TUIC** — probe 65.7, slow>500 20%, P50 360ms, P95 835ms, success 100%
6. **[自建] JP-VPS-HY2** — probe 64.8, slow>500 60%, P50 563ms, P95 801ms, success 100%
7. **[商业] 🇸🇬 新加坡 G1 | 直连、移动优化 | 3x** — probe 58.3, slow>500 20%, P50 312ms, P95 939ms, success 100%
8. **[自建] KR-VPS-HY2** — probe 57.2, slow>500 40%, P50 400ms, P95 901ms, success 100%
9. **[商业] 🇸🇬 新加坡 V0 | 移动优化、IPv6、新开机 | 1x** — probe -17.3, slow>500 20%, P50 315ms, P95 2395ms, success 100%
10. **[自建] KR-VPS-Reality** — probe -52.4, slow>500 33%, P50 397ms, P95 2243ms, success 60%

## Full Comparison (sorted by P50)

| Kind | Region | Node | N | OK% | Min | P50 | Avg | P90 | P95 | Max | σ | Jitter | CV% |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 商业 | TW | 🇨🇳 台湾 I0 | AI、动态IP | 2x | 5 | 100% | 270 | 275 | 277 | 286 | 286 | 286 | 5.5 | 11 | 2.0 |
| 商业 | TW | 🇨🇳 台湾 V1 | 皖日隧道、ChatGPT、Netflix(TW) | 3x | 5 | 100% | 276 | 283 | 379 | 756 | 756 | 756 | 188.8 | 473 | 49.9 |
| 商业 | SG | 🇸🇬 新加坡 G1 | 直连、移动优化 | 3x | 5 | 100% | 310 | 312 | 437 | 939 | 939 | 939 | 250.9 | 627 | 57.4 |
| 商业 | SG | 🇸🇬 新加坡 V0 | 移动优化、IPv6、新开机 | 1x | 5 | 100% | 311 | 315 | 730 | 2395 | 2395 | 2395 | 832.4 | 2080 | 114.0 |
| 自建 | JP | JP-VPS-TUIC | 5 | 100% | 359 | 360 | 456 | 835 | 835 | 835 | 189.6 | 475 | 41.6 |
| 自建 | JP | JP-VPS-Reality | 5 | 100% | 254 | 365 | 346 | 377 | 377 | 377 | 46.6 | 12 | 13.5 |
| 自建 | KR | KR-VPS-Reality | 5 | 60% | 396 | 397 | 1012 | 2243 | 2243 | 2243 | 870.4 | 1846 | 86.0 |
| 自建 | KR | KR-VPS-HY2 | 5 | 100% | 393 | 400 | 570 | 901 | 901 | 901 | 217.2 | 501 | 38.1 |
| 自建 | KR | KR-VPS-TUIC | 5 | 100% | 393 | 466 | 477 | 606 | 606 | 606 | 81.1 | 140 | 17.0 |
| 自建 | JP | JP-VPS-HY2 | 5 | 100% | 362 | 563 | 532 | 801 | 801 | 801 | 162.0 | 238 | 30.4 |

_Rolling 24h auto report: enable Sparkle commercialNodeBenchmark + rebuild for hourly updates._
