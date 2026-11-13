import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectBuildDrift, isBinaryRelevantPath, normalizeCommit } from './buildDriftPureCore'

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

describe('isBinaryRelevantPath', () => {
  it('treats documentation, test files and the build stamp as not touching the binary', () => {
    for (const path of [
      'README.md',
      'src/main/core/_ARCH.md',
      'scripts/scripts_20261107_20261113_BUGFIX_LOG.md',
      'NOTES.MD',
      'src/main/core/factory.test.ts',
      'scripts/sparkleBakedBuildStampCore.test.ts',
      'src/renderer/src/pages/proxies.test.tsx',
      'src/shared/buildStamp.ts'
    ]) {
      assert.equal(isBinaryRelevantPath(path), false, path)
    }
  })

  it('treats source, config, lockfile and scripts as touching the binary', () => {
    for (const path of [
      'src/main/core/factory.ts',
      'src/main/core/factoryRig.ts',
      'src/renderer/src/pages/proxies.tsx',
      'src/shared/types.d.ts',
      'package.json',
      'pnpm-lock.yaml',
      'electron-builder.yml',
      'electron.vite.config.ts',
      'scripts/upgrade-sparkle-local.sh',
      'scripts/check-build-drift.ts'
    ]) {
      assert.equal(isBinaryRelevantPath(path), true, path)
    }
  })

  it('treats everything under the shipped directories as binary content, documents included', () => {
    assert.equal(isBinaryRelevantPath('extra/files/README.md'), true)
    assert.equal(isBinaryRelevantPath('resources/icon.png'), true)
    assert.equal(isBinaryRelevantPath('resources/notes.md'), true)
  })

  it('only exempts the stamp at its exact path', () => {
    assert.equal(isBinaryRelevantPath('src/shared/buildStamp.test.ts'), false)
    assert.equal(isBinaryRelevantPath('docs/src/shared/buildStamp.ts'), true)
    assert.equal(isBinaryRelevantPath('src/shared/buildStamp.ts.bak'), true)
  })

  it('does not mistake names that merely contain the markers for docs or tests', () => {
    assert.equal(isBinaryRelevantPath('src/main/md.ts'), true)
    assert.equal(isBinaryRelevantPath('src/main/core/contest.ts'), true)
    assert.equal(isBinaryRelevantPath('src/main/core/a.test.ts.map'), true)
  })
})

describe('detectBuildDrift', () => {
  const app = { commit: 'a1b2c3d', dirty: false }

  it('reports no drift when commits match and app is clean', () => {
    const r = detectBuildDrift(app, { commit: 'A1B2C3D' })
    assert.equal(r.reason, 'match')
    assert.equal(r.drifted, false)
    assert.equal(r.appCommit, 'a1b2c3d')
    assert.equal(r.repoCommit, 'a1b2c3d')
  })

  it('detects commit mismatch — the stale-app case that caused the AnyTLS regression', () => {
    const r = detectBuildDrift({ commit: '40710f7', dirty: false }, { commit: '9999999' })
    assert.equal(r.reason, 'commit_mismatch')
    assert.equal(r.drifted, true)
    assert.equal(r.appCommit, '40710f7')
    assert.equal(r.repoCommit, '9999999')
  })

  it('flags a dirty app build as unreproducible even when commits match', () => {
    const r = detectBuildDrift({ commit: 'a1b2c3d', dirty: true }, { commit: 'a1b2c3d' })
    assert.equal(r.reason, 'app_dirty')
    assert.equal(r.drifted, true)
  })

  it('flags unknown app commit as drift requiring rebuild', () => {
    const r = detectBuildDrift({ commit: '', dirty: false }, { commit: 'a1b2c3d' })
    assert.equal(r.reason, 'app_unknown')
    assert.equal(r.drifted, true)
  })

  it('flags unknown repo commit as drift', () => {
    const r = detectBuildDrift(app, undefined)
    assert.equal(r.reason, 'app_unknown')
    assert.equal(r.drifted, true)
  })

  it('always emits a summary containing the action hint when drifted', () => {
    const cases = [
      detectBuildDrift(app, { commit: 'bbb2222' }),
      detectBuildDrift({ commit: 'aaa1111', dirty: true }, { commit: 'aaa1111' }),
      detectBuildDrift(undefined, undefined)
    ]
    for (const c of cases) {
      assert.match(c.summary, /app_commit=/)
      assert.match(c.summary, /repo_commit=/)
      assert.match(c.summary, /action=/)
    }
  })

  describe('commits that differ', () => {
    const repo = { commit: 'b2c3d4e' }

    it('is not drift when the commits in between only touched docs, tests and the stamp', () => {
      const r = detectBuildDrift(app, repo, () => [
        'BUGFIX_LOG.md',
        'src/main/core/factory.test.ts',
        'src/shared/buildStamp.ts'
      ])
      assert.equal(r.reason, 'non_binary_ahead')
      assert.equal(r.drifted, false)
      assert.equal(
        r.summary,
        'drift=none app_commit=a1b2c3d repo_commit=b2c3d4e ahead_files=3 binary_files_changed=0'
      )
    })

    it('is not drift when the two trees are identical (empty change list)', () => {
      const r = detectBuildDrift(app, repo, () => [])
      assert.equal(r.reason, 'non_binary_ahead')
      assert.equal(r.drifted, false)
      assert.match(r.summary, /ahead_files=0 binary_files_changed=0/)
    })

    it('is drift as soon as one changed file can reach the binary, and says how many', () => {
      const r = detectBuildDrift(app, repo, () => [
        'README.md',
        'src/main/core/factory.ts',
        'package.json'
      ])
      assert.equal(r.reason, 'commit_mismatch')
      assert.equal(r.drifted, true)
      assert.match(r.summary, /binary_files_changed=2 action=rebuild_required/)
    })

    it('a single file that can reach the binary is enough', () => {
      const r = detectBuildDrift(app, repo, () => ['README.md', 'src/main/core/factory.ts'])
      assert.equal(r.reason, 'commit_mismatch')
      assert.match(r.summary, /binary_files_changed=1 /)
    })

    it('does not guess when the change list is unavailable', () => {
      const r = detectBuildDrift(app, repo, () => undefined)
      assert.equal(r.reason, 'commit_mismatch')
      assert.equal(r.drifted, true)
      assert.match(r.summary, /ahead_check=unavailable action=rebuild_required/)
    })

    it('does not guess when no change-list provider is given', () => {
      const r = detectBuildDrift(app, repo)
      assert.equal(r.reason, 'commit_mismatch')
      assert.match(r.summary, /ahead_check=unavailable/)
    })

    it('a dirty app is still unreproducible even if the commits in between touched only docs', () => {
      const r = detectBuildDrift({ commit: 'a1b2c3d', dirty: true }, repo, () => ['README.md'])
      assert.equal(r.reason, 'app_dirty')
      assert.equal(r.drifted, true)
    })

    it('only asks for the change list when the commits differ', () => {
      let calls = 0
      const provider = (): readonly string[] => {
        calls += 1
        return []
      }
      detectBuildDrift(app, { commit: 'a1b2c3d' }, provider)
      detectBuildDrift({ commit: 'a1b2c3d', dirty: true }, repo, provider)
      detectBuildDrift({ commit: '', dirty: false }, repo, provider)
      detectBuildDrift(app, undefined, provider)
      assert.equal(calls, 0)
      detectBuildDrift(app, repo, provider)
      assert.equal(calls, 1)
    })
  })
})
