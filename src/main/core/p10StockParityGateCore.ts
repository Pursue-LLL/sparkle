// [INPUT] frozen stock-vs-telemetry percentile fixtures
// [OUTPUT] runP10StockParityGate — p50/p95/p99 + CI regression guard
// [POS] P10-6 §M.0.15.11.8 step 6 — stock parity must not regress beyond frozen tolerance.

export interface P10PercentileSnapshot {
  samples: number
  p50: number
  p95: number
  p99: number
}

export interface P10StockParityFixture {
  metric: string
  stock: P10PercentileSnapshot
  telemetry: P10PercentileSnapshot
  maxRegressionRatio: number
}

/** Frozen JP-VPS-HY2 marathon pairing baseline (observe-only epoch). */
export const P10_STOCK_PARITY_FIXTURES: readonly P10StockParityFixture[] = [
  {
    metric: 'first_token_ms',
    stock: { samples: 120, p50: 820, p95: 1450, p99: 2100 },
    telemetry: { samples: 120, p50: 845, p95: 1490, p99: 2150 },
    maxRegressionRatio: 0.08,
  },
  {
    metric: 'http_start_ms',
    stock: { samples: 120, p50: 290, p95: 520, p99: 780 },
    telemetry: { samples: 120, p50: 305, p95: 540, p99: 810 },
    maxRegressionRatio: 0.1,
  },
  {
    metric: 'disconnect_rate_per_100',
    stock: { samples: 100, p50: 4, p95: 9, p99: 14 },
    telemetry: { samples: 100, p50: 4, p95: 10, p99: 15 },
    maxRegressionRatio: 0.15,
  },
]

export interface P10StockParityCaseResult {
  metric: string
  ok: boolean
  detail: string
}

export interface P10StockParityGateResult {
  ok: boolean
  cases: P10StockParityCaseResult[]
}

function regressionRatio(stock: number, telemetry: number): number {
  if (stock <= 0) {
    return telemetry <= 0 ? 0 : Number.POSITIVE_INFINITY
  }
  return (telemetry - stock) / stock
}

export function runP10StockParityGate(
  fixtures: readonly P10StockParityFixture[] = P10_STOCK_PARITY_FIXTURES,
): P10StockParityGateResult {
  const cases: P10StockParityCaseResult[] = []
  for (const fixture of fixtures) {
    const p50Ratio = regressionRatio(fixture.stock.p50, fixture.telemetry.p50)
    const p95Ratio = regressionRatio(fixture.stock.p95, fixture.telemetry.p95)
    const p99Ratio = regressionRatio(fixture.stock.p99, fixture.telemetry.p99)
    const sampleOk =
      fixture.stock.samples === fixture.telemetry.samples && fixture.stock.samples >= 100
    const ok =
      sampleOk &&
      p50Ratio <= fixture.maxRegressionRatio &&
      p95Ratio <= fixture.maxRegressionRatio &&
      p99Ratio <= fixture.maxRegressionRatio
    cases.push({
      metric: fixture.metric,
      ok,
      detail: ok
        ? `samples=${fixture.stock.samples} p50=${fixture.telemetry.p50}/${fixture.stock.p50} p95=${fixture.telemetry.p95}/${fixture.stock.p95}`
        : `regression p50=${p50Ratio.toFixed(3)} p95=${p95Ratio.toFixed(3)} p99=${p99Ratio.toFixed(3)} max=${fixture.maxRegressionRatio}`,
    })
  }
  return { ok: cases.every((item) => item.ok), cases }
}
