// [INPUT] agent-sparkle-upgrade.sh（被测的升级入口，只取出其中的 report_remote_sync 函数在真实 bash 里执行）·
//         testing/shellText::functionBody (POS: 按函数名从 shell 源码里切出一个函数) ·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除) · 本机 git
// [OUTPUT] （无导出，仅测试）
// [POS] 装包前「本地与远程有没有分叉」提示的行为测试：在临时的「远程 + 克隆」里造出同步、有未推送的提交、落后、
//       分叉、没有 upstream 等状态，逐个断言提示文字；并证明它永远不拦截（退出码 0）、不联网（git 调用只有读本地引用的两种）。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { functionBody } from './testing/shellText'
import { makeTempDir } from './testing/tempDirs'

const SCRIPT = path.join(import.meta.dirname, 'agent-sparkle-upgrade.sh')
const REAL_GIT = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim()

/** 不读本机的 git 全局配置（签名、钩子、默认分支名），提交身份固定。 */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com'
}

interface Repo {
  root: string
  origin: string
  work: string
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(REAL_GIT, args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
}

function commitFile(work: string, name: string): void {
  writeFileSync(path.join(work, name), `${name}\n`)
  git(work, 'add', name)
  git(work, 'commit', '-q', '-m', name)
}

function cloneOrigin(repo: Pick<Repo, 'root' | 'origin'>, name: string): string {
  const work = path.join(repo.root, name)
  git(repo.root, 'clone', '-q', repo.origin, work)
  return work
}

/** 一个「裸远程 + 已推送并设好 upstream 的克隆」：此刻两边完全同步。 */
function createSyncedRepo(): Repo {
  const root = makeTempDir('remote-sync-')
  const origin = path.join(root, 'origin.git')
  git(root, 'init', '-q', '--bare', '-b', 'master', origin)
  const work = cloneOrigin({ root, origin }, 'work')
  commitFile(work, 'base.txt')
  git(work, 'push', '-q', '-u', 'origin', 'master')
  return { root, origin, work }
}

/** 另一份克隆往远程推一个提交，再让 `work` 抓取：`work` 的 upstream 引用因此领先一个提交。 */
function pushFromAnotherClone(repo: Repo): void {
  const other = cloneOrigin(repo, 'other')
  commitFile(other, 'theirs.txt')
  git(other, 'push', '-q', 'origin', 'master')
  git(repo.work, 'fetch', '-q')
}

interface Report {
  status: number | null
  stderr: string
  /** 函数执行期间调用过的 git 子命令，按调用顺序。 */
  gitCalls: string[]
}

/**
 * 在 `cwd` 里用 `set -euo pipefail`（与升级入口同款）执行真实脚本里的 report_remote_sync。
 * PATH 最前面放一个记录子命令再转交真 git 的桩；`gitOnPath: false` 时 PATH 里没有 git。
 */
function runReport(cwd: string, gitOnPath = true): Report {
  const stubDir = makeTempDir('remote-sync-stub-')
  const callsLog = path.join(stubDir, 'calls.log')
  writeFileSync(
    path.join(stubDir, 'git'),
    `#!/bin/bash\necho "$1" >> "${callsLog}"\nexec "${REAL_GIT}" "$@"\n`,
    { mode: 0o755 }
  )
  const fn = functionBody(readFileSync(SCRIPT, 'utf8'), 'report_remote_sync')
  const result = spawnSync(
    '/bin/bash',
    [
      '-c',
      `set -euo pipefail\nlog() { echo "[agent-sparkle-upgrade] $*" >&2; }\n${fn}\nreport_remote_sync`
    ],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...GIT_ENV,
        PATH: gitOnPath ? `${stubDir}:${process.env.PATH ?? ''}` : '/nonexistent',
        HOME: cwd,
        // 临时目录万一落在某个仓库里，也不让 git 往上找到它。
        GIT_CEILING_DIRECTORIES: path.dirname(cwd)
      }
    }
  )
  const gitCalls = existsSync(callsLog) ? readFileSync(callsLog, 'utf8').trim().split('\n') : []
  return { status: result.status, stderr: result.stderr, gitCalls }
}

describe('agent-sparkle-upgrade.sh report_remote_sync', () => {
  it('says so when the checkout matches its upstream', () => {
    const report = runReport(createSyncedRepo().work)
    assert.equal(report.status, 0, report.stderr)
    assert.match(report.stderr, /Remote sync: in sync with origin\/master \(as of the last fetch\)/)
    assert.doesNotMatch(report.stderr, /WARN/)
  })

  it('warns about local commits that were never pushed', () => {
    const repo = createSyncedRepo()
    commitFile(repo.work, 'a1.txt')
    commitFile(repo.work, 'a2.txt')
    const report = runReport(repo.work)
    assert.equal(report.status, 0, report.stderr)
    assert.match(
      report.stderr,
      /WARN remote sync: 2 local commit\(s\) not pushed to origin\/master/
    )
  })

  it('warns when the remote has commits this checkout lacks, and names the safe way to catch up', () => {
    const repo = createSyncedRepo()
    pushFromAnotherClone(repo)
    const report = runReport(repo.work)
    assert.equal(report.status, 0, report.stderr)
    assert.match(
      report.stderr,
      /WARN remote sync: origin\/master has 1 commit\(s\) this checkout lacks — fast-forward first \(git merge --ff-only origin\/master\)/
    )
  })

  it('calls out a divergence with both counts', () => {
    const repo = createSyncedRepo()
    commitFile(repo.work, 'a1.txt')
    commitFile(repo.work, 'a2.txt')
    pushFromAnotherClone(repo)
    const report = runReport(repo.work)
    assert.equal(report.status, 0, report.stderr)
    assert.match(
      report.stderr,
      /WARN remote sync: DIVERGED from origin\/master \(behind 1, ahead 2\)/
    )
    assert.match(report.stderr, /never rewrite history or force-push/)
  })

  describe('skips instead of guessing when there is nothing to compare with', () => {
    const SKIPPED = /Remote sync: no upstream branch to compare with — skipped/

    it('on a branch without an upstream', () => {
      const repo = createSyncedRepo()
      git(repo.work, 'checkout', '-q', '-b', 'topic')
      const report = runReport(repo.work)
      assert.equal(report.status, 0, report.stderr)
      assert.match(report.stderr, SKIPPED)
    })

    it('on a detached HEAD', () => {
      const repo = createSyncedRepo()
      git(repo.work, 'checkout', '-q', '--detach')
      const report = runReport(repo.work)
      assert.equal(report.status, 0, report.stderr)
      assert.match(report.stderr, SKIPPED)
    })

    it('outside a git repository', () => {
      const report = runReport(makeTempDir('remote-sync-plain-'))
      assert.equal(report.status, 0, report.stderr)
      assert.match(report.stderr, SKIPPED)
    })

    it('when git itself is not on the PATH', () => {
      const report = runReport(createSyncedRepo().work, false)
      assert.equal(report.status, 0, report.stderr)
      assert.match(report.stderr, SKIPPED)
    })
  })

  it('only reads refs the checkout already has: no fetch, pull, push or ls-remote', () => {
    const repo = createSyncedRepo()
    commitFile(repo.work, 'a1.txt')
    // 远程地址指向不存在的路径：真去联网会失败，而提示照常给出（以桩记录的子命令为准）。
    git(repo.work, 'remote', 'set-url', 'origin', path.join(repo.root, 'gone.git'))
    const report = runReport(repo.work)
    assert.equal(report.status, 0, report.stderr)
    assert.match(report.stderr, /WARN remote sync: 1 local commit\(s\) not pushed/)
    assert.deepEqual([...new Set(report.gitCalls)].sort(), ['rev-list', 'rev-parse'])
  })
})
