import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  digestWorkingTreeDiff,
  evaluateDistFreshness,
  formatSourceTreeHash,
  resolveWorkingTreeDiffText,
} from './sparkleDistFreshnessCore'

describe('sparkleDistFreshnessCore', () => {
  const current = {
    semver: '1.30.40',
    buildStamp: '2026.0829.1600',
    gitCommit: 'e6e16ee',
    sourceTreeHash: formatSourceTreeHash('e6e16ee', digestWorkingTreeDiff('')),
  }

  it('treats matching meta as fresh', () => {
    const result = evaluateDistFreshness({ distMeta: current, current })
    assert.equal(result.fresh, true)
    assert.equal(result.reason, 'ok')
  })

  it('rejects missing dist meta', () => {
    const result = evaluateDistFreshness({ distMeta: null, current })
    assert.equal(result.fresh, false)
    assert.equal(result.reason, 'missing_dist_meta')
  })

  it('rejects git commit drift on same semver', () => {
    const result = evaluateDistFreshness({
      distMeta: { ...current, gitCommit: 'deadbeef' },
      current,
    })
    assert.equal(result.fresh, false)
    assert.equal(result.reason, 'git_commit_drift')
  })

  it('rejects dirty working tree drift', () => {
    const dirtyHash = formatSourceTreeHash('e6e16ee', digestWorkingTreeDiff('diff'))
    const result = evaluateDistFreshness({
      distMeta: current,
      current: { ...current, sourceTreeHash: dirtyHash },
    })
    assert.equal(result.fresh, false)
    assert.equal(result.reason, 'source_tree_drift')
  })

  it('rejects semver mismatch even when git matches', () => {
    const result = evaluateDistFreshness({
      distMeta: { ...current, semver: '1.30.39' },
      current,
    })
    assert.equal(result.fresh, false)
    assert.equal(result.reason, 'semver_mismatch')
  })

  it('ADVERSARIAL: a failed git diff must never look like a clean tree', () => {
    const failed = resolveWorkingTreeDiffText({ ok: false, gitCommit: 'abc' })
    const clean = resolveWorkingTreeDiffText({ ok: true, text: '', gitCommit: 'abc' })
    assert.match(failed, /git_diff_failed@abc/)
    assert.notEqual(digestWorkingTreeDiff(failed), digestWorkingTreeDiff(clean))
  })

  it('ADVERSARIAL: a multi-MB diff is never the empty-string hash', () => {
    const emptyHash = digestWorkingTreeDiff('')
    const bigHash = digestWorkingTreeDiff('x'.repeat(2 * 1024 * 1024))
    assert.notEqual(bigHash, emptyHash)
  })
})
