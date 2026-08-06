import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluatePreInstallHygiene,
  PRE_INSTALL_DISK_BLOCK_USED_PCT,
  PRE_INSTALL_JOURNAL_TRUNCATE_THRESHOLD_BYTES,
} from './sparklePreInstallHygieneCore.ts'

describe('sparklePreInstallHygieneCore', () => {
  it('passes when journal and disk are healthy', () => {
    const plan = evaluatePreInstallHygiene({
      journalBytes: PRE_INSTALL_JOURNAL_TRUNCATE_THRESHOLD_BYTES,
      dataVolumeUsedPct: 80,
    })
    assert.equal(plan.blockUpgrade, false)
    assert.equal(plan.truncateJournal, false)
    assert.equal(plan.reason, 'ok')
  })

  it('truncates oversized journal without blocking upgrade', () => {
    const plan = evaluatePreInstallHygiene({
      journalBytes: PRE_INSTALL_JOURNAL_TRUNCATE_THRESHOLD_BYTES + 1,
      dataVolumeUsedPct: 80,
    })
    assert.equal(plan.blockUpgrade, false)
    assert.equal(plan.truncateJournal, true)
  })

  it('blocks upgrade when disk pressure is critical', () => {
    const plan = evaluatePreInstallHygiene({
      journalBytes: 0,
      dataVolumeUsedPct: PRE_INSTALL_DISK_BLOCK_USED_PCT,
    })
    assert.equal(plan.blockUpgrade, true)
    assert.equal(plan.truncateJournal, false)
  })
})
