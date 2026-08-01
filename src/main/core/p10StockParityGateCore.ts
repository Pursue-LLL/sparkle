// [INPUT] artifact-backed stock-vs-telemetry percentile fixtures
// [OUTPUT] runP10StockParityGate — p50/p95/p99 + CI regression guard
// [POS] P10-6 §M.0.15.13 — stock parity requires traceable artifact; synthetic defaults FAIL.

import {
  type P10MeasurementArtifact,
  validateP10MeasurementArtifact,
} from './p10MeasurementArtifactCore'

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

/** Reference-only — never PASS without artifact (§M.0.15.13). */
export const P10_STOCK_PARITY_SYNTHETIC_FIXTURES: readonly P10StockParityFixture[] = [
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

export interface P10StockParityGateInput {
  artifact?: P10MeasurementArtifact<readonly P10StockParityFixture[]>
}

export interface P10StockParityCaseResult {
  metric: string
  ok: boolean
  detail: string
}

export interface P10StockParityGateResult {
  ok: boolean
  artifactBacked: boolean
  cases: P10StockParityCaseResult[]
}

function regressionRatio(stock: number, telemetry: number): number {
  if (stock <= 0) {
    return telemetry <= 0 ? 0 : Number.POSITIVE_INFINITY
  }
  return (telemetry - stock) / stock
}

export function runP10StockParityGate(
  input: P10StockParityGateInput = {},
): P10StockParityGateResult {
  const artifactCheck = validateP10MeasurementArtifact(input.artifact, 'stock_parity')
  if (!artifactCheck.ok) {
    return {
      ok: false,
      artifactBacked: false,
      cases: [{ metric: '*', ok: false, detail: artifactCheck.detail }],
    }
  }

  const fixtures = input.artifact!.payload
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
  return {
    ok: cases.every((item) => item.ok),
    artifactBacked: true,
    cases,
  }
}
