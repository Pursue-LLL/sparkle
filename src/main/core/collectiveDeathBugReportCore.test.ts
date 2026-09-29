import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterCollectiveDeathLogLines,
  formatCollectiveDeathBugReport,
  orderAppLogNamesNewestFirst,
  parseAppLogDayKey,
} from './collectiveDeathBugReportCore'

describe('collectiveDeathBugReportCore', () => {
  it('filters diagnostic log lines by marker', () => {
    const lines = [
      'noise line',
      '[EmergencyCoreRecovery]: outcome=admitted drain_ms=15000',
      '[MihomoQuicStallRecovery]: outcome=skipped reason=marathon_active_zero_data_plane_mutation',
      'another noise',
    ]
    const filtered = filterCollectiveDeathLogLines(lines)
    assert.equal(filtered.length, 2)
    assert.match(filtered[0] ?? '', /EmergencyCoreRecovery/)
  })

  it('drops stale log lines outside the incident window (iron rule #3)', () => {
    const nowMs = Date.parse('2026-09-14T09:56:36.177Z')
    const lines = [
      '2026-09-09T15:59:04.702Z [Hy2ParentByteDeathRecovery]: outcome=failed action=none reason=byte_death_udp_absent_requires_core_restart',
      '2026-09-14T09:56:10.177Z [MihomoQuicStallRecovery]: outcome=executed action=vitality_dial',
      '[EmergencyCoreRecovery]: outcome=admitted drain_ms=15000',
    ]
    const filtered = filterCollectiveDeathLogLines(lines, nowMs)
    assert.equal(filtered.length, 2)
    assert.ok(filtered.every((line) => !line.includes('2026-09-09')))
  })

  it('keeps recent window lines and timestamp-less lines', () => {
    const nowMs = Date.parse('2026-09-14T09:56:36.177Z')
    const lines = [
      '2026-09-14T09:56:31.173Z [MihomoQuicSilentStall]: outcome=observed recovery=R-33',
      '[Hy2ParentSidecar]: outcome=failed action=sidecar_dial',
    ]
    const filtered = filterCollectiveDeathLogLines(lines, nowMs)
    assert.equal(filtered.length, 2)
  })

  it('orders app logs by calendar day, not lexicographic string sort', () => {
    const ordered = orderAppLogNamesNewestFirst([
      'app-2026-9-9.log',
      'app-2026-9-15.log',
      'app-2026-9-14.log',
      'app-2026-10-1.log',
      'noise.txt',
    ])
    assert.deepEqual(ordered, [
      'app-2026-10-1.log',
      'app-2026-9-15.log',
      'app-2026-9-14.log',
      'app-2026-9-9.log',
    ])
    assert.ok(parseAppLogDayKey('app-2026-9-15.log') > parseAppLogDayKey('app-2026-9-9.log'))
    assert.equal(parseAppLogDayKey('app-2026-9-15.log'), Date.UTC(2026, 8, 15))
  })

  it('formats AI-pasteable report with environment block', () => {
    const report = formatCollectiveDeathBugReport({
      trigger: 'emergency_core_recovery',
      tsMs: 1_700_000_000_000,
      sparkleSemver: '1.30.53',
      sparkleBuildStamp: '2026.0902.1416',
      cursorConnectionCount: 49,
      leafId: 'KR-VPS-HY2',
      evidenceReason: 'byte_death_udp_absent_requires_core_restart',
      drainMs: 15_000,
      logLines: ['[EmergencyCoreRecovery]: outcome=admitted'],
      stabilityEventLines: ['{"kind":"mihomo_quic_silent_stall"}'],
      longevitySnapshotJson: '{"httpParentChainAgeMs":81656460}',
    })
    assert.match(report, /# Sparkle Collective Death Bug Report/)
    assert.match(report, /sparkle_version: 1\.30\.53/)
    assert.match(report, /cursor_conn: 49/)
    assert.match(report, /EmergencyCoreRecovery/)
    assert.match(report, /Instructions for AI/)
  })
})
