import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  createCommittedRepo,
  makeTempDir,
  removeTempDirs,
  writeRepoFile
} from './testing/gitRepoFixture'
import {
  BUILD_STAMP_REL_PATH,
  formatSparkleBuildStamp,
  readBuildGitFacts
} from './writeBuildStampCore'

after(removeTempDirs)

describe('formatSparkleBuildStamp', () => {
  it('formats YYYY.MMDD.HHMM in local time', () => {
    const stamp = formatSparkleBuildStamp(new Date(2026, 6, 27, 18, 52))
    assert.equal(stamp, '2026.0727.1852')
  })
})

describe('readBuildGitFacts', () => {
  it('reports the short HEAD hash and a clean tree', () => {
    const repo = createCommittedRepo()
    assert.deepEqual(readBuildGitFacts(repo.dir), { commit: repo.head.slice(0, 7), dirty: false })
  })

  it('does not count the previous build rewriting the build stamp as dirty', () => {
    const repo = createCommittedRepo()
    writeRepoFile(repo.dir, BUILD_STAMP_REL_PATH, "export const SPARKLE_GIT_COMMIT = 'new'\n")
    assert.equal(readBuildGitFacts(repo.dir).dirty, false)
  })

  it('counts an edited source file as dirty', () => {
    const repo = createCommittedRepo()
    writeRepoFile(repo.dir, 'src/app.ts', 'export const a = 2\n')
    assert.equal(readBuildGitFacts(repo.dir).dirty, true)
  })

  it('counts an untracked file as dirty', () => {
    const repo = createCommittedRepo()
    writeRepoFile(repo.dir, 'src/new.ts', 'export const b = 1\n')
    assert.equal(readBuildGitFacts(repo.dir).dirty, true)
  })

  it('stays dirty when a source edit sits next to the rewritten build stamp', () => {
    const repo = createCommittedRepo()
    writeRepoFile(repo.dir, BUILD_STAMP_REL_PATH, "export const SPARKLE_GIT_COMMIT = 'new'\n")
    writeRepoFile(repo.dir, 'src/app.ts', 'export const a = 2\n')
    assert.equal(readBuildGitFacts(repo.dir).dirty, true)
  })

  it('judges the whole repository when started from a subdirectory', () => {
    const repo = createCommittedRepo()
    const nested = path.join(repo.dir, 'nested')
    mkdirSync(nested)
    writeRepoFile(repo.dir, 'src/app.ts', 'export const a = 2\n')
    assert.equal(readBuildGitFacts(nested).dirty, true)
  })

  it('still ignores the rewritten build stamp when started from a subdirectory', () => {
    const repo = createCommittedRepo()
    const nested = path.join(repo.dir, 'nested')
    mkdirSync(nested)
    writeRepoFile(repo.dir, BUILD_STAMP_REL_PATH, "export const SPARKLE_GIT_COMMIT = 'new'\n")
    assert.equal(readBuildGitFacts(nested).dirty, false)
  })

  it('does not exempt a build-stamp-named file in another directory', () => {
    const repo = createCommittedRepo()
    writeRepoFile(repo.dir, `other/${BUILD_STAMP_REL_PATH}`, 'x')
    assert.equal(readBuildGitFacts(repo.dir).dirty, true)
  })

  it('records an unknown commit and dirty outside a git repository', () => {
    const dir = makeTempDir('sparkle-build-stamp-nogit-')
    assert.deepEqual(readBuildGitFacts(dir), { commit: 'unknown', dirty: true })
  })
})

describe('BUILD_STAMP_REL_PATH', () => {
  it('names the file the drift judge treats as not affecting the binary', () => {
    const judge = readFileSync(
      path.join(import.meta.dirname, '..', 'src/main/core/buildDriftPureCore.ts'),
      'utf8'
    )
    assert.ok(judge.includes(`const BUILD_STAMP_PATH = '${BUILD_STAMP_REL_PATH}'`))
  })
})
