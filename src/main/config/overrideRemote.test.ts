import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it, mock } from 'node:test'

describe('remote override download', () => {
  let server: Server
  let port: number
  let override: typeof import('./override')

  before(async () => {
    // 收到请求就掐断连接：客户端得到 ECONNRESET，走「网络连接被重置」这条错误文本。
    server = createServer((request) => {
      request.socket.destroy()
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    port = (server.address() as AddressInfo).port

    // axios 会读环境里的代理变量；本机回环请求必须绕开它。
    process.env.NO_PROXY = '127.0.0.1'
    process.env.no_proxy = '127.0.0.1'

    mock.module('../utils/dirs', {
      exports: { overrideConfigPath: (): string => '', overridePath: (): string => '' }
    })
    // 混合端口为 0 表示不经本机代理下载。
    mock.module('./controledMihomo', {
      exports: { getControledMihomoConfig: async () => ({ 'mixed-port': 0 }) }
    })
    mock.module('./profile', { exports: { getCertFingerprint: (): string => '' } })
    override = await import('./override')
  })

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  })

  it('keeps the override address out of a network failure message', async () => {
    // 令牌放在路径与查询串里：错误信息会写进日志，只能带协议、主机与端口。
    const url = `http://127.0.0.1:${port}/script/PATHSECRET0123?token=QUERYSECRET`

    await assert.rejects(
      override.createOverride({ type: 'remote', url }),
      new Error(`网络连接被重置或超时：http://127.0.0.1:${port}`)
    )
  })
})
