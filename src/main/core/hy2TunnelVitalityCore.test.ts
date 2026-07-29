import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import {
  HY2_TUNNEL_VITALITY_INTERVAL_MS,
  HY2_TUNNEL_VITALITY_PRE_PARTITION_CHAIN_AGE_MS,
  HY2_TUNNEL_VITALITY_PRE_PARTITION_CONN_THRESHOLD,
  HY2_TUNNEL_VITALITY_PRE_PARTITION_INTERVAL_MS,
  inferNatStaleSuspect,
  NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS,
  resolveHy2TunnelVitalityIntervalMs,
  shouldRunHy2TunnelVitality,
} from './hy2TunnelVitalityCore'
import { MTDO_MARATHON_STREAM_MIN_AGE_MS } from './marathonTransportDialOrchestratorCore'

describe('hy2TunnelVitalityCore', () => {
  it('runs vitality when parent chain age exceeds marathon min age', () => {
    const nowMs = 50_000_000
    assert.equal(
      shouldRunHy2TunnelVitality({
        nowMs,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        lastVitalityAtMs: nowMs - HY2_TUNNEL_VITALITY_INTERVAL_MS,
        activeNode: 'JP-VPS-HY2',
        marathonTruthActive: true,
        maxParentChainAgeMs: MTDO_MARATHON_STREAM_MIN_AGE_MS + 1_000,
      }),
      true,
    )
  })

  it('skips vitality before parent chain reaches marathon min age', () => {
    const nowMs = 50_000_000
    assert.equal(
      shouldRunHy2TunnelVitality({
        nowMs,
        cursorConnectionCount: 20,
        lastVitalityAtMs: 0,
        activeNode: 'JP-VPS-HY2',
        marathonTruthActive: true,
        maxParentChainAgeMs: MTDO_MARATHON_STREAM_MIN_AGE_MS - 1_000,
      }),
      false,
    )
  })

  it('accelerates vitality interval under pre-partition risk (P28)', () => {
    const gate = {
      nowMs: 50_000_000,
      cursorConnectionCount: HY2_TUNNEL_VITALITY_PRE_PARTITION_CONN_THRESHOLD,
      lastVitalityAtMs: 50_000_000 - HY2_TUNNEL_VITALITY_PRE_PARTITION_INTERVAL_MS,
      activeNode: 'JP-VPS-HY2',
      marathonTruthActive: true,
      maxParentChainAgeMs: HY2_TUNNEL_VITALITY_PRE_PARTITION_CHAIN_AGE_MS,
    }
    assert.equal(resolveHy2TunnelVitalityIntervalMs(gate), HY2_TUNNEL_VITALITY_PRE_PARTITION_INTERVAL_MS)
    assert.equal(shouldRunHy2TunnelVitality(gate), true)
    assert.equal(
      shouldRunHy2TunnelVitality({
        ...gate,
        lastVitalityAtMs: gate.nowMs - HY2_TUNNEL_VITALITY_PRE_PARTITION_INTERVAL_MS + 1_000,
      }),
      false,
    )
  })

  it('inferNatStaleSuspect flags split-brain NAT pattern', () => {
    assert.equal(
      inferNatStaleSuspect({
        tokenGapMs: NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS,
        api2ProbeOk: true,
        streamPrimarySub: 'server-eof',
      }),
      true,
    )
    assert.equal(
      inferNatStaleSuspect({
        tokenGapMs: 30_000,
        api2ProbeOk: true,
        streamPrimarySub: 'server-eof',
      }),
      false,
    )
  })
})
