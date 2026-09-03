import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildSparkleConservationReport,
  formatSparkleConservationReport,
  scanAgentTransportFailures,
} from './marathonStabilitySparkleConservationCore'
import { classifyCoreLogLine } from './marathonStabilityAttributionCore'

describe('marathonStabilitySparkleConservationCore', () => {
  it('builds report from sparkle signals only', () => {
    const signals = [
      classifyCoreLogLine(
        'time="2026-09-02T13:05:09.000+08:00" level=warning msg="api2 45.76.104.78:443 connect error: context deadline exceeded"',
      )!,
    ]
    const report = buildSparkleConservationReport({
      sinceMs: Date.parse('2026-09-02T00:00:00.000Z'),
      untilMs: Date.parse('2026-09-02T23:59:59.000Z'),
      signals,
      transportFailures: [],
    })
    assert.equal(report.incidents.length, 1)
    assert.equal(report.incidents[0]!.primaryLayer, 'L3')
  })

  it('renders sparkle-only header without cursor mention as dependency', () => {
    const text = formatSparkleConservationReport(
      buildSparkleConservationReport({
        sinceMs: 0,
        untilMs: 1,
        signals: [],
        transportFailures: [],
      }),
      { dataHome: '/tmp', coreFileCount: 1, appFileCount: 1, linesScanned: 100 },
    )
    assert.match(text, /Sparkle-only/)
    assert.match(text, /无 Cursor 耦合/)
  })

  it('parses agent-transport-failures jsonl in window', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparkle-atf-'))
    const path = join(dir, 'agent-transport-failures.jsonl')
    const ts = Date.parse('2026-09-02T05:00:00.000Z')
    writeFileSync(path, `${JSON.stringify({ ts, requestId: 'abc', reasonType: 'proxy-network' })}\n`)
    const rows = scanAgentTransportFailures(path, ts - 1000, ts + 1000)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.reasonType, 'proxy-network')
  })
})
