import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { createCommittedRepo, removeTempDirs, writeRepoFile } from './testing/gitRepoFixture'
import { BUILD_STAMP_REL_PATH } from './writeBuildStampCore'

const ROOT = path.resolve(import.meta.dirname, '..')
const TSX = path.join(ROOT, 'node_modules/.bin/tsx')
const CLI = path.join(ROOT, 'scripts/write-build-stamp.ts')

after(removeTempDirs)

/** 在仓库目录里跑一次真实的写入脚本，返回它打印的结论行。 */
function runWriteBuildStamp(cwd: string): string {
  return execFileSync(TSX, [CLI], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

function bakedStamp(cwd: string): string {
  return readFileSync(path.join(cwd, BUILD_STAMP_REL_PATH), 'utf8')
}

describe('write-build-stamp CLI', () => {
  it('bakes the HEAD commit and the package version', () => {
    const repo = createCommittedRepo()
    runWriteBuildStamp(repo.dir)
    const baked = bakedStamp(repo.dir)
    assert.match(baked, new RegExp(`SPARKLE_GIT_COMMIT = '${repo.head.slice(0, 7)}'`))
    assert.match(baked, /SPARKLE_SEMVER = '9\.9\.9'/)
  })

  it('bakes a clean build again while the previous build stamp is still uncommitted', () => {
    const repo = createCommittedRepo()
    assert.match(runWriteBuildStamp(repo.dir), /dirty=0/)
    assert.match(runWriteBuildStamp(repo.dir), /dirty=0/)
    assert.match(bakedStamp(repo.dir), /SPARKLE_GIT_DIRTY = false/)
  })

  it('bakes dirty once a source file has been edited', () => {
    const repo = createCommittedRepo()
    writeRepoFile(repo.dir, 'src/app.ts', 'export const a = 2\n')
    assert.match(runWriteBuildStamp(repo.dir), /dirty=1/)
    assert.match(bakedStamp(repo.dir), /SPARKLE_GIT_DIRTY = true/)
  })
})
