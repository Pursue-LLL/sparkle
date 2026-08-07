import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasTrailingMihomoDelayTimeout,
  latestSuccessfulProxyDelayHistoryEntry,
  proxyDelayDisplayColor,
  resolveVpsLeafEffectiveAlive,
  resolveVpsLeafProxyDelayDisplay,
  assertProxyDelayDisplaySampleIntegrity,
} from './proxyDelayDisplayCore'
import type { LatencyTruthSummary } from './latencyTruthFromLedgerCore'

const healthyVpsBody: LatencyTruthSummary = {
  vpsBodyP50: 510,
  vpsBodySamples: 3,
  vpsBodyLastTs: '2026-08-07T06:18:00.000Z',
  macFullPathP50: null,
  macFullPathSamples: 0,
  macFullPathLastTs: null,
}

describe('proxyDelayDisplayCore', () => {
  it('prefers mac full path p50 over mihomo history', () => {
    const display = resolveVpsLeafProxyDelayDisplay(
      [{ time: '2026-08-07T06:00:00.000Z', delay: 420 }],
      {
        vpsBodyP50: 510,
        vpsBodySamples: 2,
        vpsBodyLastTs: '2026-08-07T06:10:00.000Z',
        macFullPathP50: 296,
        macFullPathSamples: 4,
        macFullPathLastTs: '2026-08-07T06:15:00.000Z',
      },
    )
    assert.equal(display.delayMs, 296)
    assert.equal(display.source, 'mac_full_path')
    assert.equal(display.sampleTime, '2026-08-07T06:15:00.000Z')
  })

  it('uses mihomo history when successful samples exist', () => {
    const display = resolveVpsLeafProxyDelayDisplay(
      [
        { time: '2026-08-07T06:00:00.000Z', delay: 420 },
        { time: '2026-08-07T06:01:00.000Z', delay: 0 },
      ],
      healthyVpsBody,
    )
    assert.equal(display.delayMs, 420)
    assert.equal(display.source, 'mihomo_history')
    assert.equal(display.mihomoProbeTimedOut, false)
  })

  it('falls back to vps body ssh when trailing mihomo probe timed out', () => {
    const display = resolveVpsLeafProxyDelayDisplay(
      [{ time: '2026-08-07T06:19:00.000Z', delay: 0 }],
      healthyVpsBody,
    )
    assert.equal(display.delayMs, 510)
    assert.equal(display.source, 'vps_body_ssh')
    assert.equal(display.sampleTime, '2026-08-07T06:18:00.000Z')
    assert.equal(display.mihomoProbeTimedOut, true)
    assert.equal(proxyDelayDisplayColor(display), 'warning')
  })

  it('does not treat stale successful history as timeout when trailing zero exists', () => {
    const latest = latestSuccessfulProxyDelayHistoryEntry([
      { time: '2026-08-07T06:00:00.000Z', delay: 330 },
      { time: '2026-08-07T06:19:00.000Z', delay: 0 },
    ])
    assert.equal(latest?.delay, 330)
    assert.equal(hasTrailingMihomoDelayTimeout(latest ? [latest, { time: 'x', delay: 0 }] : []), true)
  })

  it('shows true timeout only when mihomo and vps body both unavailable', () => {
    const display = resolveVpsLeafProxyDelayDisplay(
      [{ time: '2026-08-07T06:19:00.000Z', delay: 0 }],
      {
        vpsBodyP50: null,
        vpsBodySamples: 0,
        vpsBodyLastTs: null,
        macFullPathP50: null,
        macFullPathSamples: 0,
        macFullPathLastTs: null,
      },
    )
    assert.equal(display.delayMs, 0)
    assert.equal(display.source, 'none')
    assert.equal(proxyDelayDisplayColor(display), 'danger')
  })

  it('overrides mihomo alive=false when vps body healthy and udp probe timed out', () => {
    assert.equal(
      resolveVpsLeafEffectiveAlive(false, healthyVpsBody, true),
      true,
    )
    assert.equal(
      resolveVpsLeafEffectiveAlive(false, healthyVpsBody, false),
      false,
    )
  })

  it('enforces sample integrity contract on all display branches', () => {
    const cases = [
      resolveVpsLeafProxyDelayDisplay(
        [{ time: '2026-08-07T06:00:00.000Z', delay: 420 }],
        {
          vpsBodyP50: 510,
          vpsBodySamples: 2,
          vpsBodyLastTs: '2026-08-07T06:10:00.000Z',
          macFullPathP50: 296,
          macFullPathSamples: 4,
          macFullPathLastTs: '2026-08-07T06:15:00.000Z',
        },
      ),
      resolveVpsLeafProxyDelayDisplay(
        [{ time: '2026-08-07T06:19:00.000Z', delay: 420 }],
        healthyVpsBody,
      ),
      resolveVpsLeafProxyDelayDisplay(
        [{ time: '2026-08-07T06:19:00.000Z', delay: 0 }],
        healthyVpsBody,
      ),
      resolveVpsLeafProxyDelayDisplay(
        [{ time: '2026-08-07T06:19:00.000Z', delay: 0 }],
        {
          vpsBodyP50: null,
          vpsBodySamples: 0,
          vpsBodyLastTs: null,
          macFullPathP50: null,
          macFullPathSamples: 0,
          macFullPathLastTs: null,
        },
      ),
      resolveVpsLeafProxyDelayDisplay(undefined, null),
    ]
    for (const display of cases) {
      assert.doesNotThrow(() => assertProxyDelayDisplaySampleIntegrity(display))
    }
    assert.equal(cases[0]?.delayKind, 'p50')
    assert.equal(cases[1]?.delayKind, 'last_probe')
    assert.equal(cases[2]?.delayKind, 'p50')
    assert.equal(cases[3]?.delayKind, 'probe_timeout')
    assert.equal(cases[4]?.delayKind, 'none')
  })
})
