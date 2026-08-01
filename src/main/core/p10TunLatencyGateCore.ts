// [INPUT] artifact-backed TUN vs mixed-port latency pairing
// [OUTPUT] runP10TunLatencyGate — paired p50/p95 tax guard for marathon profile
// [POS] P10-6 §M.0.15.13 — TUN tax = paired (TUN − mixed); synthetic defaults FAIL.

import {
  computePairedTunTaxMs,
  type P10MeasurementArtifact,
  validateP10MeasurementArtifact,
} from './p10MeasurementArtifactCore'

export interface P10TunLatencyFixture {
  samples: number
  tun: { p50Ms: number; p95Ms: number }
  mixedPort: { p50Ms: number; p95Ms: number }
  maxTunP50TaxMs: number
  maxTunP95TaxMs: number
}

/** Reference-only numbers — never PASS without artifact (§M.0.15.13). */
export const P10_TUN_LATENCY_SYNTHETIC_FIXTURE: P10TunLatencyFixture = {
  samples: 200,
  tun: { p50Ms: 35, p95Ms: 88 },
  mixedPort: { p50Ms: 302, p95Ms: 516 },
  maxTunP50TaxMs: 50,
  maxTunP95TaxMs: 100,
}

export interface P10TunLatencyGateInput {
  artifact?: P10MeasurementArtifact<P10TunLatencyFixture>
}

export interface P10TunLatencyGateResult {
  ok: boolean
  artifactBacked: boolean
  samples: number
  tunP50Ms: number
  mixedPortP50Ms: number
  tunP95Ms: number
  mixedPortP95Ms: number
  p50TaxMs: number
  p95TaxMs: number
  detail: string
}

export function runP10TunLatencyGate(
  input: P10TunLatencyGateInput = {},
): P10TunLatencyGateResult {
  const artifactCheck = validateP10MeasurementArtifact(input.artifact, 'tun_latency')
  if (!artifactCheck.ok) {
    return {
      ok: false,
      artifactBacked: false,
      samples: 0,
      tunP50Ms: 0,
      mixedPortP50Ms: 0,
      tunP95Ms: 0,
      mixedPortP95Ms: 0,
      p50TaxMs: 0,
      p95TaxMs: 0,
      detail: artifactCheck.detail,
    }
  }

  const fixture = input.artifact!.payload
  const p50TaxMs = computePairedTunTaxMs(fixture.tun.p50Ms, fixture.mixedPort.p50Ms)
  const p95TaxMs = computePairedTunTaxMs(fixture.tun.p95Ms, fixture.mixedPort.p95Ms)
  const ok =
    fixture.samples >= 100 &&
    Math.abs(p50TaxMs) <= fixture.maxTunP50TaxMs &&
    Math.abs(p95TaxMs) <= fixture.maxTunP95TaxMs
  return {
    ok,
    artifactBacked: true,
    samples: fixture.samples,
    tunP50Ms: fixture.tun.p50Ms,
    mixedPortP50Ms: fixture.mixedPort.p50Ms,
    tunP95Ms: fixture.tun.p95Ms,
    mixedPortP95Ms: fixture.mixedPort.p95Ms,
    p50TaxMs,
    p95TaxMs,
    detail: ok
      ? `${artifactCheck.detail}; paired tax p50=${p50TaxMs}ms p95=${p95TaxMs}ms (samples=${fixture.samples})`
      : `paired tax exceeded p50=${p50TaxMs}/${fixture.maxTunP50TaxMs} p95=${p95TaxMs}/${fixture.maxTunP95TaxMs}`,
  }
}
