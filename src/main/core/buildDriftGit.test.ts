import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  createGitRunner,
  evaluateBuildDrift,
  listPathsChangedSince,
  readRepoGitFacts,
  type GitRunner
} from './buildDriftGit'

/** 在临时目录里建一个真实 git 仓库；提交不受本机全局 git 配置（签名、钩子）影响。 */
function createRepo(): {
  dir: string
  git: (...args: string[]) => string
  commit: (message: string) => string
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkle-drift-git-'))
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
  return {
    dir,
    git,
    commit: (message) => {
      git('add', '-A')
      git('commit', '-q', '--no-verify', '-m', message)
      return git('rev-parse', 'HEAD')
    }
  }
}

function write(dir: string, relPath: string, content: string): void {
  const abs = path.join(dir, relPath)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

describe('createGitRunner', () => {
  it('returns trimmed stdout, and undefined when git fails', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    const head = repo.commit('first')
    const git = createGitRunner(repo.dir)
    assert.equal(git(['rev-parse', 'HEAD']), head)
    assert.equal(git(['rev-parse', '--verify', '--quiet', 'no-such-ref^{commit}']), undefined)
  })

  it('returns undefined outside a repository', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'sparkle-drift-nogit-'))
    const git = createGitRunner(outside)
    assert.equal(git(['rev-parse', '--git-dir']), undefined)
  })

  it('returns undefined when the working directory does not exist', () => {
    assert.equal(createGitRunner('/nonexistent/sparkle-drift')(['status']), undefined)
  })
})

describe('readRepoGitFacts', () => {
  it('reads HEAD as a normalized 7-character commit', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    const head = repo.commit('first')
    assert.deepEqual(readRepoGitFacts(createGitRunner(repo.dir)), { commit: head.slice(0, 7) })
  })

  it('reports unknown outside a repository and in a repository without commits', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'sparkle-drift-nogit-'))
    assert.deepEqual(readRepoGitFacts(createGitRunner(outside)), { commit: 'unknown' })
    const empty = createRepo()
    assert.deepEqual(readRepoGitFacts(createGitRunner(empty.dir)), { commit: 'unknown' })
  })
})

describe('listPathsChangedSince', () => {
  it('lists the files that differ between the app commit and HEAD, using a short hash', () => {
    const repo = createRepo()
    write(repo.dir, 'src/a.ts', 'a')
    write(repo.dir, 'README.md', 'r')
    const appCommit = repo.commit('built here').slice(0, 7)
    write(repo.dir, 'README.md', 'r2')
    write(repo.dir, 'src/b.ts', 'b')
    repo.commit('docs and a new file')
    const changed = listPathsChangedSince(createGitRunner(repo.dir), appCommit)
    assert.deepEqual([...(changed ?? [])].sort(), ['README.md', 'src/b.ts'])
  })

  it('returns an empty list when HEAD is the app commit, and when the trees are identical', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    const appCommit = repo.commit('first').slice(0, 7)
    const git = createGitRunner(repo.dir)
    assert.deepEqual(listPathsChangedSince(git, appCommit), [])
    repo.git('commit', '-q', '--no-verify', '--allow-empty', '-m', 'empty')
    assert.deepEqual(listPathsChangedSince(git, appCommit), [])
  })

  it('reports a rename as both the old and the new path, so a source file renamed into a doc is not hidden', () => {
    const repo = createRepo()
    write(repo.dir, 'src/main/core/engine.ts', 'export const engine = 1\n'.repeat(20))
    const appCommit = repo.commit('built here').slice(0, 7)
    renameSync(
      path.join(repo.dir, 'src/main/core/engine.ts'),
      path.join(repo.dir, 'src/main/core/engine.md')
    )
    repo.commit('rename')
    const changed = listPathsChangedSince(createGitRunner(repo.dir), appCommit) ?? []
    assert.deepEqual([...changed].sort(), ['src/main/core/engine.md', 'src/main/core/engine.ts'])
  })

  it('keeps paths with spaces and non-ASCII characters intact', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    const appCommit = repo.commit('first').slice(0, 7)
    write(repo.dir, 'docs/说明 文档.md', 'x')
    repo.commit('docs')
    assert.deepEqual(listPathsChangedSince(createGitRunner(repo.dir), appCommit), [
      'docs/说明 文档.md'
    ])
  })

  it('compares trees, so a build commit outside the history of HEAD still works', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    repo.commit('base')
    repo.git('switch', '-q', '-c', 'other')
    write(repo.dir, 'src/other.ts', 'o')
    const otherCommit = repo.commit('built on another branch').slice(0, 7)
    repo.git('switch', '-q', '-')
    assert.deepEqual(listPathsChangedSince(createGitRunner(repo.dir), otherCommit), [
      'src/other.ts'
    ])
  })

  it('returns undefined when the app commit is not in this repository, instead of an empty list', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    repo.commit('first')
    assert.equal(listPathsChangedSince(createGitRunner(repo.dir), '76ac0dd'), undefined)
  })

  it('returns undefined outside a repository, for unknown, and for values git could read as options', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'sparkle-drift-nogit-'))
    assert.equal(listPathsChangedSince(createGitRunner(outside), 'a1b2c3d'), undefined)
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    repo.commit('first')
    const git = createGitRunner(repo.dir)
    assert.equal(listPathsChangedSince(git, 'unknown'), undefined)
    assert.equal(listPathsChangedSince(git, '--output=/tmp/x'), undefined)
    assert.equal(listPathsChangedSince(git, ''), undefined)
    assert.equal(listPathsChangedSince(git, 'A1B2C3D'), undefined)
  })

  it('never lets git see a value that is not a hex commit prefix', () => {
    const calls: string[][] = []
    const spy: GitRunner = (args) => {
      calls.push([...args])
      return undefined
    }
    for (const value of [
      '--output=/tmp/x',
      '-h',
      'unknown',
      '',
      'HEAD',
      'abc',
      'a1b2c3d;rm',
      'A1B2C3D'
    ]) {
      assert.equal(listPathsChangedSince(spy, value), undefined, value)
    }
    assert.deepEqual(calls, [])
  })

  it('stops after the lookup when the commit cannot be resolved, and diffs against the resolved hash', () => {
    const calls: string[][] = []
    const unresolved: GitRunner = (args) => {
      calls.push([...args])
      return undefined
    }
    assert.equal(listPathsChangedSince(unresolved, 'a1b2c3d'), undefined)
    assert.equal(calls.length, 1)

    calls.length = 0
    const resolving: GitRunner = (args) => {
      calls.push([...args])
      return args[0] === 'rev-parse' ? 'a1b2c3d0000000000000000000000000000000ff' : 'x.md\0y.ts\0'
    }
    assert.deepEqual(listPathsChangedSince(resolving, 'a1b2c3d'), ['x.md', 'y.ts'])
    assert.deepEqual(calls[1], [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      'a1b2c3d0000000000000000000000000000000ff',
      'HEAD'
    ])
  })

  it('returns undefined, not an empty list, when the commit resolves but the diff itself fails', () => {
    const diffFails: GitRunner = (args) =>
      args[0] === 'rev-parse' ? 'a1b2c3d0000000000000000000000000000000ff' : undefined
    assert.equal(listPathsChangedSince(diffFails, 'a1b2c3d'), undefined)
  })

  it('returns undefined when git itself fails (a diff that cannot run is not "no changes")', () => {
    const failing = createGitRunner('/nonexistent/sparkle-drift')
    assert.equal(listPathsChangedSince(failing, 'a1b2c3d'), undefined)
  })
})

describe('evaluateBuildDrift', () => {
  it('is in sync at the build commit', () => {
    const repo = createRepo()
    write(repo.dir, 'src/main/a.ts', 'a')
    const appCommit = repo.commit('built here').slice(0, 7)
    const r = evaluateBuildDrift({ commit: appCommit, dirty: false }, createGitRunner(repo.dir))
    assert.equal(r.reason, 'match')
    assert.equal(r.drifted, false)
  })

  it('stays in sync when only docs and the build stamp were committed after the build', () => {
    const repo = createRepo()
    write(repo.dir, 'src/main/a.ts', 'a')
    write(repo.dir, 'README.md', 'r')
    const appCommit = repo.commit('built here').slice(0, 7)
    write(repo.dir, 'README.md', 'r2')
    write(repo.dir, 'src/shared/buildStamp.ts', 'stamp')
    write(repo.dir, 'src/main/a.test.ts', 'test')
    repo.commit('docs, stamp and a test')
    const r = evaluateBuildDrift({ commit: appCommit, dirty: false }, createGitRunner(repo.dir))
    assert.equal(r.reason, 'non_binary_ahead')
    assert.equal(r.drifted, false)
    assert.match(r.summary, /ahead_files=3 binary_files_changed=0$/)
  })

  it('reports drift once a source file changed after the build', () => {
    const repo = createRepo()
    write(repo.dir, 'src/main/a.ts', 'a')
    const appCommit = repo.commit('built here').slice(0, 7)
    write(repo.dir, 'src/main/a.ts', 'a2')
    write(repo.dir, 'README.md', 'r')
    repo.commit('fix')
    const r = evaluateBuildDrift({ commit: appCommit, dirty: false }, createGitRunner(repo.dir))
    assert.equal(r.reason, 'commit_mismatch')
    assert.equal(r.drifted, true)
    assert.match(r.summary, /binary_files_changed=1 action=rebuild_required/)
  })

  it('reports drift without guessing when the build commit is not in the repository', () => {
    const repo = createRepo()
    write(repo.dir, 'README.md', 'r')
    repo.commit('first')
    const r = evaluateBuildDrift({ commit: '76ac0dd', dirty: false }, createGitRunner(repo.dir))
    assert.equal(r.reason, 'commit_mismatch')
    assert.match(r.summary, /ahead_check=unavailable/)
  })

  it('cannot confirm anything without a repository or without app facts', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    const head = repo.commit('first').slice(0, 7)
    assert.equal(
      evaluateBuildDrift({ commit: head, dirty: false }, undefined).reason,
      'app_unknown'
    )
    assert.equal(evaluateBuildDrift(undefined, createGitRunner(repo.dir)).reason, 'app_unknown')
  })

  it('still flags a dirty build when the repository only gained docs', () => {
    const repo = createRepo()
    write(repo.dir, 'a.txt', 'a')
    const appCommit = repo.commit('built here').slice(0, 7)
    write(repo.dir, 'README.md', 'r')
    repo.commit('docs')
    const r = evaluateBuildDrift({ commit: appCommit, dirty: true }, createGitRunner(repo.dir))
    assert.equal(r.reason, 'app_dirty')
  })
})
