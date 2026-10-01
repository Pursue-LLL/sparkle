import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectBuildDrift, normalizeCommit } from './buildDriftPureCore'

describe('normalizeCommit', () => {
  it('truncates to 7 chars and lowercases', () => {
    assert.equal(normalizeCommit('A1B2C3D4E5F6'), 'a1b2c3d')
  })

  it('normalizes empty and nullish to unknown', () => {
    assert.equal(normalizeCommit(''), 'unknown')
    assert.equal(normalizeCommit('   '), 'unknown')
    assert.equal(normalizeCommit(undefined), 'unknown')
    assert.equal(normalizeCommit(null), 'unknown')
  })

  it('keeps short hashes intact', () => {
    assert.equal(normalizeCommit('abc123'), 'abc123')
  })
})

describe('detectBuildDrift', () => {
  it('reports no drift when commits match and app is clean', () => {
    const r = detectBuildDrift({ commit: 'a1b2c3d', dirty: false }, { commit: 'A1B2C3D', dirty: true })
    assert.equal(r.reason, 'match')
    assert.equal(r.drifted, false)
    assert.equal(r.appCommit, 'a1b2c3d')
    assert.equal(r.repoCommit, 'a1b2c3d')
  })

  it('detects commit mismatch — the stale-app case that caused the AnyTLS regression', () => {
    const r = detectBuildDrift({ commit: '40710f7', dirty: false }, { commit: '9999999', dirty: false })
    assert.equal(r.reason, 'commit_mismatch')
    assert.equal(r.drifted, true)
    assert.equal(r.appCommit, '40710f7')
    assert.equal(r.repoCommit, '9999999')
  })

  it('flags a dirty app build as unreproducible even when commits match', () => {
    const r = detectBuildDrift({ commit: 'a1b2c3d', dirty: true }, { commit: 'a1b2c3d', dirty: false })
    assert.equal(r.reason, 'app_dirty')
    assert.equal(r.drifted, true)
  })

  it('treats repo-side dirtiness as not drifted — the commit is still authoritative', () => {
    const r = detectBuildDrift({ commit: 'a1b2c3d', dirty: false }, { commit: 'a1b2c3d', dirty: true })
    assert.equal(r.reason, 'match')
    assert.equal(r.drifted, false)
  })

  it('flags unknown app commit as drift requiring rebuild', () => {
    const r = detectBuildDrift({ commit: '', dirty: false }, { commit: 'a1b2c3d', dirty: false })
    assert.equal(r.reason, 'app_unknown')
    assert.equal(r.drifted, true)
  })

  it('flags unknown repo commit as drift', () => {
    const r = detectBuildDrift({ commit: 'a1b2c3d', dirty: false }, undefined)
    assert.equal(r.reason, 'app_unknown')
    assert.equal(r.drifted, true)
  })

  it('always emits a summary containing the action hint', () => {
    const cases = [
      detectBuildDrift({ commit: 'aaa1111', dirty: false }, { commit: 'bbb2222', dirty: false }),
      detectBuildDrift({ commit: 'aaa1111', dirty: true }, { commit: 'aaa1111', dirty: false }),
      detectBuildDrift(undefined, undefined),
    ]
    for (const c of cases) {
      assert.match(c.summary, /app_commit=/)
      assert.match(c.summary, /repo_commit=/)
      assert.match(c.summary, /action=/)
    }
  })
})
