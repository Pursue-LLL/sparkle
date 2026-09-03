import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterCollectiveDeathLogLines,
  formatCollectiveDeathBugReport,
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

  it('formats AI-pasteable report with environment block', () => {
    const report = formatCollectiveDeathBugReport({
      trigger: 'emergency_core_recovery',
      tsMs: 1_700_000_000_000,
      sparkleSemver: '1.30.53',
      sparkleBuildStamp: '2026.0902.1416',
      cursorConnectionCount: 49,
      leafId: 'JP-VPS-HY2',
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
