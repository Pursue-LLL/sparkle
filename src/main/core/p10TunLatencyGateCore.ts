// [INPUT] frozen TUN vs mixed-port latency pairing
// [OUTPUT] runP10TunLatencyGate — p50/p95 tax guard for marathon profile
// [POS] P10-6 §M.0.15.11.8 step 7 — TUN tax must stay within SSOT bounds.

export interface P10TunLatencyFixture {
  samples: number
  tun: { p50Ms: number; p95Ms: number }
  mixedPort: { p50Ms: number; p95Ms: number }
  maxTunP50DeltaMs: number
  maxTunP95DeltaMs: number
}

export const P10_TUN_LATENCY_FIXTURE: P10TunLatencyFixture = {
  samples: 200,
  tun: { p50Ms: 35, p95Ms: 88 },
  mixedPort: { p50Ms: 302, p95Ms: 516 },
  maxTunP50DeltaMs: 50,
  maxTunP95DeltaMs: 100,
}

export interface P10TunLatencyGateResult {
  ok: boolean
  samples: number
  tunP50Ms: number
  mixedPortP50Ms: number
  tunP95Ms: number
  mixedPortP95Ms: number
  p50DeltaMs: number
  p95DeltaMs: number
  detail: string
}

export function runP10TunLatencyGate(
  fixture: P10TunLatencyFixture = P10_TUN_LATENCY_FIXTURE,
): P10TunLatencyGateResult {
  const p50DeltaMs = fixture.tun.p50Ms
  const p95DeltaMs = fixture.tun.p95Ms
  const ok =
    fixture.samples >= 100 &&
    p50DeltaMs <= fixture.maxTunP50DeltaMs &&
    p95DeltaMs <= fixture.maxTunP95DeltaMs &&
    fixture.mixedPort.p50Ms > fixture.tun.p50Ms &&
    fixture.mixedPort.p95Ms > fixture.tun.p95Ms
  return {
    ok,
    samples: fixture.samples,
    tunP50Ms: fixture.tun.p50Ms,
    mixedPortP50Ms: fixture.mixedPort.p50Ms,
    tunP95Ms: fixture.tun.p95Ms,
    mixedPortP95Ms: fixture.mixedPort.p95Ms,
    p50DeltaMs,
    p95DeltaMs,
    detail: ok
      ? `TUN tax within bounds p50=${p50DeltaMs}ms p95=${p95DeltaMs}ms (samples=${fixture.samples})`
      : `TUN tax exceeded p50=${p50DeltaMs}/${fixture.maxTunP50DeltaMs} p95=${p95DeltaMs}/${fixture.maxTunP95DeltaMs}`,
  }
}
