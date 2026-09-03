import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyAppLogLine,
  classifyCoreLogLine,
  clusterAttributionSignals,
  formatAttributionReport,
  scanLogTextForSignals,
} from './marathonStabilityAttributionCore'

describe('marathonStabilityAttributionCore', () => {
  it('classifies JP VPS inbound connect deadline as L3 definitive', () => {
    const line =
      'time="2026-09-02T05:05:00.000Z" level=warning msg="[TCP] dial 45.76.104.78:443 connect error: context deadline exceeded"'
    const signal = classifyCoreLogLine(line)
    assert.ok(signal)
    assert.equal(signal.layer, 'L3')
    assert.equal(signal.mechanism, 'jp_vps_inbound_connect_deadline')
  })

  it('classifies Sparkle L2 outbound flush as L2', () => {
    const line =
      '2026-09-02T05:05:01.000Z [CursorTransportHealth]: L2 flushed all mihomo outbound'
    const signal = classifyAppLogLine(line)
    assert.ok(signal)
    assert.equal(signal.layer, 'L2')
  })

  it('clusters multi-node deadline burst as L_MULTI', () => {
    const base = Date.parse('2026-09-02T05:09:16.000Z')
    const signals = [
      classifyCoreLogLine(
        `time="2026-09-02T05:09:16.000Z" level=warning msg="dial 1.1.1.1:443 context deadline exceeded"`,
      )!,
      classifyCoreLogLine(
        `time="2026-09-02T05:09:16.500Z" level=warning msg="dial 8.8.8.8:443 context deadline exceeded"`,
      )!,
      classifyCoreLogLine(
        `time="2026-09-02T05:09:17.000Z" level=warning msg="dial google.com:443 context deadline exceeded"`,
      )!,
    ]
    assert.equal(signals.length, 3)
    const incidents = clusterAttributionSignals(signals)
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0]!.primaryLayer, 'L_MULTI')
    assert.ok(incidents[0]!.tsMs >= base)
  })

  it('prefers L3 when JP VPS api2 deadline present even with L2 in window', () => {
    const signals = [
      classifyCoreLogLine(
        'time="2026-09-02T13:05:00.000+08:00" level=warning msg="dial api2.cursor.sh error: 45.76.104.78:443 connect error: context deadline exceeded"',
      )!,
      classifyAppLogLine(
        '2026-09-02T05:05:00.500Z [CursorTransportHealth]: L2 flushed all mihomo outbound',
      )!,
    ]
    const incidents = clusterAttributionSignals(signals)
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0]!.primaryLayer, 'L3')
  })

  it('dedupes identical signals', () => {
    const line =
      'time="2026-09-02T05:05:00.000Z" level=warning msg="45.76.104.78:443 connect error: context deadline exceeded"'
    const a = classifyCoreLogLine(line)!
    const incidents = clusterAttributionSignals([a, a, a])
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0]!.signals.length, 1)
  })

  it('renders report with stats block', () => {
    const sinceMs = Date.parse('2026-09-02T00:00:00.000Z')
    const untilMs = Date.parse('2026-09-02T23:59:59.000Z')
    const report = formatAttributionReport([], {
      sinceMs,
      untilMs,
      stats: {
        coreLinesScanned: 100,
        appLinesScanned: 50,
        stabilityLinesScanned: 10,
        jpVpsConnectErrors: 2,
        jpVpsSuccessRoutes: 800,
        quicStallEvents: 0,
        sparkleProcessHealthy: true,
      },
    })
    assert.match(report, /Phase 0 归因报告/)
    assert.match(report, /JP-VPS-Reality/)
    assert.match(report, /0\.25%/)
  })

  it('scanLogTextForSignals respects time window', () => {
    const core = [
      'time="2026-09-02T05:05:00.000Z" level=warning msg="45.76.104.78:443 connect error: context deadline exceeded"',
      'time="2026-01-01T00:00:00.000Z" level=warning msg="45.76.104.78:443 connect error: context deadline exceeded"',
    ].join('\n')
    const sinceMs = Date.parse('2026-09-02T00:00:00.000Z')
    const untilMs = Date.parse('2026-09-02T23:59:59.000Z')
    const { signals, stats } = scanLogTextForSignals(core, '', '', sinceMs, untilMs)
    assert.equal(signals.length, 1)
    assert.equal(stats.jpVpsConnectErrors, 1)
  })
})
