import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import { InvalidProfileContentError } from '../core/profileContentCore'

const STORED = 'proxies:\n  - {name: 旧节点, type: ss, server: old.example.com, port: 8388}\n'
const FRESH = 'proxies:\n  - {name: 新节点, type: ss, server: new.example.com, port: 8388}\n'

const reply = { status: 200, body: '', hangUp: false }
const rebuilt: string[] = []

describe('remote subscription content', () => {
  let root: string
  let server: Server
  let port: number
  let profile: typeof import('./profile')

  const storedFile = (): string => path.join(root, 'profiles', 'main.yaml')
  const profileYaml = (): string => path.join(root, 'profile.yaml')

  /** 远程订阅条目：第三方 URL 走直连下载，sub-store 条目走本地 sub-store 服务。 */
  const remoteItem = (substore: boolean): ProfileItem => ({
    id: 'main',
    name: '主订阅',
    type: 'remote',
    url: substore ? '/download/main' : `http://127.0.0.1:${port}/sub`,
    substore,
    autoUpdate: true,
    updated: 1
  })

  const storedUpdated = async (): Promise<number | undefined> =>
    (await profile.getProfileConfig(true)).items.find((item) => item.id === 'main')?.updated

  before(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-profile-content-'))
    mkdirSync(path.join(root, 'profiles'))

    server = createServer((request, response) => {
      if (reply.hangUp) {
        request.socket.destroy()
        return
      }
      response.statusCode = reply.status
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end(reply.body)
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    port = (server.address() as AddressInfo).port

    // axios 会读环境里的代理变量；本机回环请求必须绕开它。
    process.env.NO_PROXY = '127.0.0.1'
    process.env.no_proxy = '127.0.0.1'

    mock.module('../utils/dirs', {
      exports: {
        profileConfigPath: (): string => profileYaml(),
        profilesDir: (): string => path.join(root, 'profiles'),
        profilePath: (id: string): string => path.join(root, 'profiles', `${id}.yaml`),
        mihomoProfileWorkDir: (id: string): string => path.join(root, 'work', id)
      }
    })
    mock.module('./controledMihomo', {
      exports: { getControledMihomoConfig: async () => ({ 'mixed-port': 7890 }) }
    })
    mock.module('../core/manager', { exports: { restartCore: async (): Promise<void> => {} } })
    mock.module('../core/provider', { exports: { deleteProvider: async (): Promise<void> => {} } })
    mock.module('../core/runtimeConfigSync', {
      exports: { regenerateAndSyncProfile: async (): Promise<void> => {} }
    })
    mock.module('../resolve/server', { exports: { subStorePort: port } })
    mock.module('../utils/userAgent', { exports: { getUserAgent: async () => 'sparkle-test' } })
    mock.module('../utils/log', { exports: { appendAppLog: async (): Promise<void> => {} } })
    mock.module('./mergeProfile', {
      exports: {
        rebuildDependentMergeProfiles: async (id: string): Promise<void> => {
          rebuilt.push(id)
        }
      }
    })
    profile = await import('./profile')
  })

  beforeEach(async () => {
    reply.status = 200
    reply.body = ''
    reply.hangUp = false
    rebuilt.length = 0
    writeFileSync(storedFile(), STORED, 'utf8')
    writeFileSync(
      profileYaml(),
      JSON.stringify({
        current: 'local1',
        items: [remoteItem(false), { id: 'local1', name: '本地', type: 'local', updated: 1 }]
      }),
      'utf8'
    )
    await profile.getProfileConfig(true)
  })

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
    rmSync(root, { recursive: true, force: true })
  })

  const rejectedAsInvalid = (error: unknown): boolean =>
    error instanceof InvalidProfileContentError && error.message.includes('主订阅')

  for (const [description, body] of [
    ['an error page', '<html><body>Service Unavailable</body></html>'],
    ['an empty body', ''],
    ['a JSON error body', '{"error":"traffic exhausted"}'],
    ['a configuration whose sections are all empty', 'port: 7890\nrules: []\n']
  ] as const) {
    it(`keeps the stored subscription when the server answers with ${description}`, async () => {
      reply.body = body

      await assert.rejects(profile.addProfileItem(remoteItem(false)), rejectedAsInvalid)

      assert.equal(readFileSync(storedFile(), 'utf8'), STORED)
      assert.deepEqual(rebuilt, [])
      assert.equal(await storedUpdated(), 1)
    })
  }

  it('stores a valid configuration, rebuilds dependent merges and advances the update time', async () => {
    reply.body = FRESH

    await profile.addProfileItem(remoteItem(false))

    assert.equal(readFileSync(storedFile(), 'utf8'), FRESH)
    assert.deepEqual(rebuilt, ['main'])
    assert.ok(((await storedUpdated()) ?? 0) > 1)
  })

  it('applies the same check to sub-store downloads', async () => {
    reply.body = 'sub-store is starting'
    await assert.rejects(profile.addProfileItem(remoteItem(true)), rejectedAsInvalid)
    assert.equal(readFileSync(storedFile(), 'utf8'), STORED)

    reply.body = FRESH
    await profile.addProfileItem(remoteItem(true))
    assert.equal(readFileSync(storedFile(), 'utf8'), FRESH)
  })

  it('reports an HTTP error status as a request failure rather than invalid content', async () => {
    reply.status = 503
    reply.body = '<html>busy</html>'

    await assert.rejects(
      profile.addProfileItem(remoteItem(false)),
      (error: unknown) => error instanceof Error && !(error instanceof InvalidProfileContentError)
    )

    assert.equal(readFileSync(storedFile(), 'utf8'), STORED)
  })

  it('keeps the subscription address out of a network failure message', async () => {
    reply.hangUp = true
    // 令牌放在路径与查询串里：错误信息会写进 App 日志，只能带协议、主机与端口。
    const url = `http://127.0.0.1:${port}/link/PATHSECRET0123?token=QUERYSECRET`

    await assert.rejects(
      profile.addProfileItem({ ...remoteItem(false), url }),
      new Error(`网络连接被重置或超时：http://127.0.0.1:${port}`)
    )

    assert.equal(readFileSync(storedFile(), 'utf8'), STORED)
  })
})
