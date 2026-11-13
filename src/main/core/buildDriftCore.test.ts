import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it, mock } from 'node:test'

const logs: string[] = []

describe('logBuildDriftAtStartup wiring', () => {
  const originalCwd = process.cwd()
  let commit = ''

  before(() => {
    // 开发态按 cwd 定位仓库：把 cwd 切进一个只含一个提交的临时仓库
    const dir = mkdtempSync(path.join(tmpdir(), 'sparkle-drift-core-'))
    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@example.com',
          '-c',
          'commit.gpgsign=false',
          ...args
        ],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim()
    git('init', '-q')
    writeFileSync(path.join(dir, 'a.txt'), 'a', 'utf8')
    git('add', '-A')
    git('commit', '-q', '--no-verify', '-m', 'built here')
    commit = git('rev-parse', 'HEAD').slice(0, 7)
    process.chdir(dir)
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
    mock.module('../../shared/buildStamp', {
      exports: { SPARKLE_GIT_COMMIT: commit, SPARKLE_GIT_DIRTY: true }
    })
  })

  after(() => {
    process.chdir(originalCwd)
    mock.reset()
  })

  it('locates the repository from the cwd, logs the verdict with the dirty flag of the app build, and only once per process', async () => {
    const { logBuildDriftAtStartup } = await import('./buildDriftCore')
    await logBuildDriftAtStartup()
    await logBuildDriftAtStartup()
    assert.equal(logs.length, 1)
    assert.ok(
      logs[0].startsWith(
        `[BuildDrift]: app_commit=${commit} app_dirty=1 drift=app_dirty app_commit=${commit} repo_commit=${commit} action=rebuild_required`
      ),
      logs[0]
    )
  })
})
