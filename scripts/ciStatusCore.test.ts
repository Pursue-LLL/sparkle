// [INPUT] ciStatusCore::CI_WORKFLOW_FILE/CI_STATUS_TIMEOUT_MS/CiStatusDeps/FetchTextResult/parseGithubSlug/parseBadgeState/createFetchText/checkCiStatus (POS: 远程 CI 状态提示的全部判断，git 与网络由调用方注入) ·
//         .github/workflows/build.yml（核对被读取的工作流文件真实存在、且在 push 到 master 时触发）· js-yaml::load (POS: 解析工作流) ·
//         testing/localServer::withLocalServer (POS: 脚本测试共用的本机假 HTTP 服务，跑完回调必关)
// [OUTPUT] （无导出，仅测试）
// [POS] 远程 CI 状态提示的行为测试：远程地址的各种写法、徽章标题的读法（含来自网络的恶意内容）、每一种「跳过」的原因、
//       只读的 git 调用、凭据不进日志、时限覆盖连接与响应体、任何失败都只返回一行而不抛异常。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { load } from 'js-yaml'
import { withLocalServer } from './testing/localServer'
import {
  checkCiStatus,
  CI_STATUS_TIMEOUT_MS,
  CI_WORKFLOW_FILE,
  createFetchText,
  parseBadgeState,
  parseGithubSlug,
  type CiStatusDeps,
  type FetchTextResult
} from './ciStatusCore'

const BASE_URL = 'http://badge.test'
const UPSTREAM_ARGS = ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']
const svg = (title: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"><title>${title}</title></svg>`

describe('parseGithubSlug', () => {
  const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
    ['git@github.com:Pursue-LLL/sparkle.git', 'Pursue-LLL/sparkle'],
    ['git@github.com:Pursue-LLL/sparkle', 'Pursue-LLL/sparkle'],
    ['github.com:o/r.git', 'o/r'],
    ['https://github.com/Pursue-LLL/sparkle.git', 'Pursue-LLL/sparkle'],
    ['https://github.com/Pursue-LLL/sparkle/', 'Pursue-LLL/sparkle'],
    ['http://github.com/o/r', 'o/r'],
    ['ssh://git@github.com/o/r.git', 'o/r'],
    ['ssh://git@github.com:22/o/r.git', 'o/r'],
    ['git://github.com/o/r.git', 'o/r'],
    ['https://user:token@github.com/o/r.git', 'o/r'],
    ['https://github.com/my.org/dotted.repo.name.git', 'my.org/dotted.repo.name'],
    ['  https://github.com/o/r.git\n', 'o/r']
  ]
  const REJECTED = [
    '',
    '/srv/git/r.git',
    'file:///srv/git/r.git',
    'git@gitlab.com:o/r.git',
    'https://gitlab.com/o/r.git',
    'https://github.com.evil.example/o/r.git',
    'https://evilgithub.com/o/r.git',
    'git@evilgithub.com:o/r.git',
    'https://github.com@evil.example/o/r.git',
    'https://github.com/onlyowner',
    'https://github.com/o/r/extra',
    'https://github.com/o/r.git?x=1',
    'https://github.com/../r.git',
    'https://github.com/o/..'
  ]

  for (const [url, slug] of ACCEPTED) {
    it(`reads ${JSON.stringify(url)} as ${slug}`, () => {
      assert.equal(parseGithubSlug(url), slug)
    })
  }

  for (const url of REJECTED) {
    it(`does not take ${JSON.stringify(url)} for a GitHub repository`, () => {
      assert.equal(parseGithubSlug(url), undefined)
    })
  }
})

describe('parseBadgeState', () => {
  it('reads the state after the last separator of the title', () => {
    assert.equal(parseBadgeState(svg('Build - passing')), 'passing')
    assert.equal(parseBadgeState(svg('Build - failing')), 'failing')
    assert.equal(parseBadgeState(svg('Build - no status')), 'no status')
    assert.equal(parseBadgeState(svg('Build - Windows - Passing')), 'passing')
  })

  it('refuses anything that is not a title with a plain lowercase state', () => {
    const unreadable = [
      '',
      '<svg></svg>',
      svg('Build'),
      svg('Build - '),
      svg('Build - 404'),
      svg('Build - passing; rm -rf /'),
      svg('Build - passing\u001b[31m'),
      svg('Build - passing\nWARN forged line'),
      svg(`Build - ${'x'.repeat(40)}`)
    ]
    for (const body of unreadable) {
      assert.equal(parseBadgeState(body), undefined, JSON.stringify(body))
    }
  })
})

interface World {
  /** 当前分支跟踪的远程分支；undefined 表示没有 upstream。 */
  upstream?: string
  remotes?: Readonly<Record<string, string>>
  badge?: FetchTextResult
}

/** 用假的 git 与假的徽章服务跑一次判断，同时记下调用了哪些 git 子命令、请求了哪些地址。 */
async function check(
  world: World
): Promise<{ line: string; gitCalls: string[][]; urls: string[] }> {
  const gitCalls: string[][] = []
  const urls: string[] = []
  const deps: CiStatusDeps = {
    baseUrl: BASE_URL,
    git: (args) => {
      gitCalls.push([...args])
      if (args[0] === 'rev-parse') return world.upstream
      return args[0] === 'remote' ? world.remotes?.[args[2] ?? ''] : undefined
    },
    fetchText: async (url) => {
      urls.push(url)
      return world.badge ?? { ok: true, text: svg('Build - passing') }
    }
  }
  const line = await checkCiStatus(deps)
  return { line, gitCalls, urls }
}

const GITHUB_ORIGIN = { origin: 'git@github.com:Pursue-LLL/sparkle.git' }

describe('checkCiStatus', () => {
  it('reports a passing workflow on the branch the checkout tracks', async () => {
    const { line, urls } = await check({ upstream: 'origin/master', remotes: GITHUB_ORIGIN })
    assert.equal(line, 'CI status: origin/master — passing')
    assert.deepEqual(urls, [
      `${BASE_URL}/Pursue-LLL/sparkle/actions/workflows/${CI_WORKFLOW_FILE}/badge.svg?branch=master`
    ])
  })

  it('warns about a failing workflow and links to the runs of that branch', async () => {
    const { line } = await check({
      upstream: 'origin/master',
      remotes: GITHUB_ORIGIN,
      badge: { ok: true, text: svg('Build - failing') }
    })
    assert.match(line, /^WARN ci status: origin\/master — failing; /)
    assert.ok(line.endsWith(`(${BASE_URL}/Pursue-LLL/sparkle/actions?query=branch%3Amaster)`), line)
  })

  it('states any other workflow state as it is, without warning', async () => {
    for (const state of ['no status', 'pending']) {
      const { line } = await check({
        upstream: 'origin/master',
        remotes: GITHUB_ORIGIN,
        badge: { ok: true, text: svg(`Build - ${state}`) }
      })
      assert.equal(line, `CI status: origin/master — ${state}`)
    }
  })

  it('asks the remote the branch actually belongs to, including branch names with slashes', async () => {
    const { line, gitCalls, urls } = await check({
      upstream: 'fork/feature/a+b',
      remotes: { fork: 'https://github.com/someone/sparkle.git' }
    })
    assert.equal(line, 'CI status: fork/feature/a+b — passing')
    assert.deepEqual(gitCalls[1], ['remote', 'get-url', 'fork'])
    assert.ok(urls[0]?.startsWith(`${BASE_URL}/someone/sparkle/actions/`), String(urls[0]))
    assert.ok(urls[0]?.endsWith('?branch=feature%2Fa%2Bb'), String(urls[0]))
  })

  describe('says "skipped" instead of guessing', () => {
    it('without an upstream on a remote', async () => {
      for (const upstream of [undefined, 'master', '/master']) {
        const { line, urls } = await check({ upstream, remotes: GITHUB_ORIGIN })
        assert.equal(line, 'CI status: no upstream branch on a remote — skipped', String(upstream))
        assert.deepEqual(urls, [])
      }
    })

    it('when the remote is not on GitHub or cannot be read', async () => {
      const notUsable: ReadonlyArray<Readonly<Record<string, string>>> = [
        { origin: 'git@gitlab.com:o/r.git' },
        {}
      ]
      for (const remotes of notUsable) {
        const { line, urls } = await check({ upstream: 'origin/master', remotes })
        assert.equal(line, 'CI status: origin is not a GitHub remote — skipped')
        assert.deepEqual(urls, [])
      }
    })

    it('when the badge cannot be fetched, naming why', async () => {
      for (const reason of ['HTTP 404', 'HTTP 403', 'network error', 'no answer within 6s']) {
        const { line } = await check({
          upstream: 'origin/master',
          remotes: GITHUB_ORIGIN,
          badge: { ok: false, reason }
        })
        assert.equal(line, `CI status: unavailable (${reason}) — skipped`)
      }
    })

    it('when the response is not a status badge', async () => {
      const { line } = await check({
        upstream: 'origin/master',
        remotes: GITHUB_ORIGIN,
        badge: { ok: true, text: '<html><title>Sign in to GitHub</title></html>' }
      })
      assert.equal(line, 'CI status: unavailable (unexpected response) — skipped')
    })

    it('even when the injected git or network code throws', async () => {
      const explode = (): never => {
        throw new Error('boom')
      }
      const expected = 'CI status: unavailable (unexpected error) — skipped'
      assert.equal(
        await checkCiStatus({ baseUrl: BASE_URL, git: explode, fetchText: explode }),
        expected
      )
      assert.equal(
        await checkCiStatus({
          baseUrl: BASE_URL,
          git: (args) => (args[0] === 'rev-parse' ? 'origin/master' : GITHUB_ORIGIN.origin),
          fetchText: explode
        }),
        expected
      )
    })
  })

  it('only reads local git state, and never lets remote credentials reach the output or the request', async () => {
    const { line, gitCalls, urls } = await check({
      upstream: 'origin/master',
      remotes: { origin: 'https://user:s3cret-token@github.com/o/r.git' }
    })
    assert.deepEqual(gitCalls, [UPSTREAM_ARGS, ['remote', 'get-url', 'origin']])
    assert.doesNotMatch(`${line}\n${urls.join('\n')}`, /s3cret|user:/)
  })

  it('always answers with exactly one line', async () => {
    const worlds: World[] = [
      { upstream: 'origin/master', remotes: GITHUB_ORIGIN },
      {
        upstream: 'origin/master',
        remotes: GITHUB_ORIGIN,
        badge: { ok: true, text: svg('Build - failing') }
      },
      {
        upstream: 'origin/master',
        remotes: GITHUB_ORIGIN,
        badge: { ok: false, reason: 'HTTP 500' }
      },
      { upstream: undefined }
    ]
    for (const world of worlds) {
      const { line } = await check(world)
      assert.doesNotMatch(line, /[\r\n]/, line)
    }
  })
})

describe('createFetchText', () => {
  it('returns the body of a successful response', async () => {
    await withLocalServer(
      (_request, response) => response.end('hello'),
      async (origin) => {
        assert.deepEqual(await createFetchText(fetch, 2000)(`${origin}/x`), {
          ok: true,
          text: 'hello'
        })
      }
    )
  })

  it('reports the status of a failing response', async () => {
    await withLocalServer(
      (_request, response) => {
        response.statusCode = 404
        response.end('Not Found')
      },
      async (origin) => {
        assert.deepEqual(await createFetchText(fetch, 2000)(`${origin}/x`), {
          ok: false,
          reason: 'HTTP 404'
        })
      }
    )
  })

  it('reports a refused connection as a network error', async () => {
    let origin = ''
    await withLocalServer(
      () => undefined,
      async (live) => {
        origin = live
      }
    )
    assert.deepEqual(await createFetchText(fetch, 2000)(`${origin}/x`), {
      ok: false,
      reason: 'network error'
    })
  })

  /**
   * 时限一旦失效，请求会永远等下去：测试的超时只能把测试标红，挂着的连接与监听中的服务仍会让进程退不出来。
   * 所以在这里套一个上限，失效表现为失败，`withLocalServer` 也照常收尾（关掉挂着的连接）。
   */
  function settlesWithin<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms)
    })
    return Promise.race([work, limit]).finally(() => clearTimeout(timer))
  }

  it('gives up on a server that never answers', async () => {
    await withLocalServer(
      () => undefined,
      async (origin) => {
        const result = await settlesWithin(createFetchText(fetch, 50)(`${origin}/x`), 5000)
        assert.deepEqual(result, { ok: false, reason: 'no answer within 0.05s' })
      }
    )
  })

  it('gives up on a response whose body never finishes', async () => {
    await withLocalServer(
      (_request, response) => response.write('partial'),
      async (origin) => {
        const result = await settlesWithin(createFetchText(fetch, 50)(`${origin}/x`), 5000)
        assert.deepEqual(result, { ok: false, reason: 'no answer within 0.05s' })
      }
    )
  })

  it('is bounded to a few seconds in production', () => {
    assert.ok(CI_STATUS_TIMEOUT_MS >= 1000 && CI_STATUS_TIMEOUT_MS <= 10_000)
  })
})

describe('CI_WORKFLOW_FILE', () => {
  it('names a workflow that runs when master is pushed', () => {
    const file = path.join(import.meta.dirname, '..', '.github/workflows', CI_WORKFLOW_FILE)
    assert.ok(existsSync(file), `${file} must exist`)
    const workflow = load(readFileSync(file, 'utf8')) as { on: { push: { branches: string[] } } }
    assert.ok(workflow.on.push.branches.includes('master'))
  })
})
