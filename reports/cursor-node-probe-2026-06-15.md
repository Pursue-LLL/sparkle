# Cursor 节点探测报告（自建 + 商业）

Generated: 2026-06-15T09:07:44+08:00  
Probe target: `https://api2.cursor.sh`  
Method: Sparkle mihomo API `/proxies/{name}/delay`  
Rounds per node: 5  

## 结论

| **最快** | 商业 **🇭🇰 台湾 V3 | 广港隧道、ChatGPT | 3x**（中位 256ms） |
| **最稳** | 自建 **KR-VPS-HY2**（±3.0ms） |

**推荐**：Cursor 组默认 **JP-VPS-HY2**；KR 作低抖动备用。

## 详细结果

| # | 类型 | 节点 | 中位 | 平均 | 延迟范围 | σ | 成功 |
|---|---|---|---:|---:|---|---:|---:|
| 1 | 商业 | **🇭🇰 台湾 V3 | 广港隧道、ChatGPT | 3x** | 256ms | 256ms
| 2 | 自建 | **JP-VPS-HY2** | 273ms | 278ms
| 3 | 商业 | **🇯🇵 日本 I2 | SVIP、AI、IPv6 | 3x** | 332ms | 332ms
| 4 | 商业 | **🇯🇵 日本 V0 | 移动优化 | 2x** | 365ms | 371ms
| 5 | 自建 | **KR-VPS-HY2** | 454ms | 453ms

---

- 一次性手动探针（**不会自动刷新**）；商业节点 24h 自动报告见 `sparkle/reports/commercial-node-report.md`
- Sparkle override: `~/Library/Application Support/sparkle/override/c7sgvps01.yaml`
