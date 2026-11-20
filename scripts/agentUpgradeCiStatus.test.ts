// [INPUT] agent-sparkle-upgrade.sh（被测的升级入口，只取出其中的 report_ci_status 函数在真实 bash 里执行）·
//         testing/shellText::functionBody (POS: 按函数名从 shell 源码里切出一个函数) ·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除) ·
//         testing/localServer::withLocalServer (POS: 脚本测试共用的本机假 HTTP 服务，跑完回调必关) ·
//         ciStatusCli.mts（端到端那一组真实运行它，经 tsx 子进程）· 本机 git
// [OUTPUT] （无导出，仅测试）
// [POS] 装前「远程 CI 是红是绿」提示的行为测试：先用桩替换探针，证明函数把探针打印的那一行带进日志、探针失败或没输出时
//       说「跳过」、任何情况下退出码都是 0（`set -euo pipefail` 下也不拦截装包）；再用真实的探针对本机假服务跑端到端，
//       覆盖通过、失败、404、连接被拒、不在 git 仓库里这几种实际会遇到的状态。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { withLocalServer } from './testing/localServer'
import { functionBody } from './testing/shellText'
import { makeTempDir } from './testing/tempDirs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/agent-sparkle-upgrade.sh')
const REAL_TSX = path.join(ROOT, 'node_modules/.bin/tsx')
const PREFIX = '[agent-sparkle-upgrade] '
const FALLBACK = `${PREFIX}CI status: probe did not run — skipped\n`

/** 不读本机的 git 全局配置，提交身份固定。 */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com'
}

interface Report {
  status: number | null
  stderr: string
}

interface RunOptions {
  cwd: string
  /** 脚本里的 `$TSX`：桩或真实的 tsx。 */
  tsx: string
  /** 脚本里的 `$ROOT`：探针脚本按它定位。 */
  root: string
  env?: NodeJS.ProcessEnv
}

/** 用 `set -euo pipefail`（与升级入口同款）在真实 bash 里执行脚本里的 report_ci_status。 */
function runReport({ cwd, tsx, root, env }: RunOptions): Promise<Report> {
  const fn = functionBody(readFileSync(SCRIPT, 'utf8'), 'report_ci_status')
  const script = `set -euo pipefail\nlog() { echo "${PREFIX}$*" >&2; }\nTSX="$1"\nROOT="$2"\n${fn}\nreport_ci_status`
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', script, 'bash', tsx, root], {
      cwd,
      env: env ?? { PATH: process.env.PATH, HOME: cwd },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (status) => resolve({ status, stderr }))
  })
}

function fakeTsx(body: string): string {
  const file = path.join(makeTempDir('ci-status-tsx-'), 'tsx')
  writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 })
  return file
}

describe('agent-sparkle-upgrade.sh report_ci_status (probe replaced by a stub)', () => {
  const cwd = makeTempDir('ci-status-cwd-')

  it('relays the one line the probe prints, through the upgrade log', async () => {
    const tsx = fakeTsx('echo "CI status: origin/master — passing"')
    const report = await runReport({ cwd, tsx, root: ROOT })
    assert.equal(report.status, 0, report.stderr)
    assert.equal(report.stderr, `${PREFIX}CI status: origin/master — passing\n`)
  })

  it('runs the probe script from the checkout it lives in', async () => {
    const calls = path.join(makeTempDir('ci-status-calls-'), 'calls.log')
    const tsx = fakeTsx(`echo "$1" >> "${calls}"; echo "CI status: x — passing"`)
    const root = makeTempDir('ci-status-root-')
    await runReport({ cwd, tsx, root })
    assert.equal(readFileSync(calls, 'utf8'), `${root}/scripts/ciStatusCli.mts\n`)
  })

  it('says the probe did not run when it fails without printing anything', async () => {
    const report = await runReport({ cwd, tsx: fakeTsx('exit 7'), root: ROOT })
    assert.equal(report.status, 0, report.stderr)
    assert.equal(report.stderr, FALLBACK)
  })

  it('says the probe did not run when it prints nothing', async () => {
    const report = await runReport({ cwd, tsx: fakeTsx('exit 0'), root: ROOT })
    assert.equal(report.status, 0, report.stderr)
    assert.equal(report.stderr, FALLBACK)
  })

  it('says the probe did not run when tsx is missing', async () => {
    const report = await runReport({ cwd, tsx: path.join(cwd, 'no-such-tsx'), root: ROOT })
    assert.equal(report.status, 0, report.stderr)
    assert.equal(report.stderr, FALLBACK)
  })

  it("keeps the probe's own stderr noise (Node deprecation warnings and the like) out of the log", async () => {
    const tsx = fakeTsx(
      'echo "(node:1) DeprecationWarning: noise" >&2; echo "CI status: x — passing"'
    )
    const report = await runReport({ cwd, tsx, root: ROOT })
    assert.equal(report.stderr, `${PREFIX}CI status: x — passing\n`)
  })
})

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 一个已提交、跟踪着 `origin/master` 的检出，`origin` 指向一个 GitHub 地址（不会被真的访问）。 */
function createTrackingCheckout(): string {
  const dir = makeTempDir('ci-status-repo-')
  git(dir, 'init', '-q', '-b', 'master')
  writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', 'a.txt')
  git(dir, 'commit', '-q', '-m', 'a')
  git(dir, 'remote', 'add', 'origin', 'git@github.com:acme/widget.git')
  git(dir, 'update-ref', 'refs/remotes/origin/master', 'HEAD')
  git(dir, 'config', 'branch.master.remote', 'origin')
  git(dir, 'config', 'branch.master.merge', 'refs/heads/master')
  return dir
}

interface FakeBadge {
  status: number
  body: string
}

/** 本机的假徽章服务：记下收到的请求路径，按 `answer` 回应；跑完 `body` 后关闭。 */
async function withBadgeServer(
  answer: FakeBadge,
  body: (baseUrl: string, requests: string[]) => Promise<void>
): Promise<void> {
  const requests: string[] = []
  await withLocalServer(
    (request, response) => {
      requests.push(request.url ?? '')
      response.statusCode = answer.status
      response.end(answer.body)
    },
    (origin) => body(origin, requests)
  )
}

const badge = (state: string): FakeBadge => ({
  status: 200,
  body: `<svg xmlns="http://www.w3.org/2000/svg"><title>Build - ${state}</title></svg>`
})

/** 真实的 tsx + 真实的探针，工作目录是 `cwd`，徽章站点指向 `baseUrl`。 */
function runReal(cwd: string, baseUrl: string): Promise<Report> {
  return runReport({
    cwd,
    tsx: REAL_TSX,
    root: ROOT,
    env: {
      ...GIT_ENV,
      HOME: cwd,
      SPARKLE_CI_STATUS_BASE_URL: baseUrl,
      // 临时目录万一落在某个仓库里，也不让 git 往上找到它。
      GIT_CEILING_DIRECTORIES: path.dirname(cwd)
    }
  })
}

describe('agent-sparkle-upgrade.sh report_ci_status (real probe against a local badge server)', () => {
  it('reports a passing workflow, asking for the badge of the tracked branch', async () => {
    assert.ok(existsSync(REAL_TSX), 'node_modules/.bin/tsx must be installed')
    await withBadgeServer(badge('passing'), async (baseUrl, requests) => {
      // 站点地址带结尾的斜杠也不能把请求路径拼成 `//acme/…`。
      const report = await runReal(createTrackingCheckout(), `${baseUrl}/`)
      assert.equal(report.status, 0, report.stderr)
      assert.equal(report.stderr, `${PREFIX}CI status: origin/master — passing\n`)
      assert.deepEqual(requests, [
        '/acme/widget/actions/workflows/build.yml/badge.svg?branch=master'
      ])
    })
  })

  it('warns about a failing workflow without failing the step', async () => {
    await withBadgeServer(badge('failing'), async (baseUrl) => {
      const report = await runReal(createTrackingCheckout(), baseUrl)
      assert.equal(report.status, 0, report.stderr)
      assert.ok(
        report.stderr.startsWith(`${PREFIX}WARN ci status: origin/master — failing; `),
        report.stderr
      )
      assert.ok(
        report.stderr.includes(`(${baseUrl}/acme/widget/actions?query=branch%3Amaster)`),
        report.stderr
      )
    })
  })

  it('skips when the badge is not there (HTTP 404)', async () => {
    await withBadgeServer({ status: 404, body: 'Not Found' }, async (baseUrl) => {
      const report = await runReal(createTrackingCheckout(), baseUrl)
      assert.equal(report.status, 0, report.stderr)
      assert.equal(report.stderr, `${PREFIX}CI status: unavailable (HTTP 404) — skipped\n`)
    })
  })

  it('skips when nothing answers at all', async () => {
    let closedBaseUrl = ''
    await withBadgeServer(badge('passing'), async (baseUrl) => {
      closedBaseUrl = baseUrl
    })
    const report = await runReal(createTrackingCheckout(), closedBaseUrl)
    assert.equal(report.status, 0, report.stderr)
    assert.equal(report.stderr, `${PREFIX}CI status: unavailable (network error) — skipped\n`)
  })

  it('skips outside a git repository, without asking the network', async () => {
    await withBadgeServer(badge('passing'), async (baseUrl, requests) => {
      const report = await runReal(makeTempDir('ci-status-plain-'), baseUrl)
      assert.equal(report.status, 0, report.stderr)
      assert.equal(report.stderr, `${PREFIX}CI status: no upstream branch on a remote — skipped\n`)
      assert.deepEqual(requests, [])
    })
  })
})
