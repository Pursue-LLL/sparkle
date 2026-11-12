import assert from 'node:assert/strict'
import { before, beforeEach, describe, it } from 'node:test'
import { apiError, callOf, installMihomoApiMocks, rig, streamStubs } from './mihomoApiRig'
import type { HttpMethod } from './mihomoApiRig'
import type * as MihomoApi from './mihomoApi'

describe('mihomoApi', () => {
  let api: typeof MihomoApi

  before(async () => {
    installMihomoApiMocks()
    api = await import('./mihomoApi')
  })

  beforeEach(async () => {
    rig.reset()
    rig.reply = () => ({})
    await api.getAxios(true)
    rig.calls = []
    rig.direct = []
  })

  describe('controller connection', () => {
    it('talks to the core over its unix socket and reuses the connection', async () => {
      const first = await api.getAxios()
      const second = await api.getAxios()

      assert.equal(first, second)
      assert.deepEqual(rig.direct, [], 'no new connection was needed')
    })

    it('builds the direct connection with the socket path, base URL and timeout', async () => {
      await api.getAxios(true)

      assert.deepEqual(rig.direct[0].defaults, {
        baseURL: 'http://localhost',
        socketPath: '/run/mihomo.sock',
        timeout: 15000
      })
    })

    it('goes through the signed service endpoint in service mode', async () => {
      rig.appConfig = { corePermissionMode: 'service' }

      const instance = await api.getAxios()

      assert.deepEqual(
        rig.signed.map((entry) => entry.baseURL),
        ['http://localhost/core/controller']
      )
      assert.equal(instance, rig.signed[0].instance)
    })

    it('reuses the service connection until the service socket moves', async () => {
      rig.appConfig = { corePermissionMode: 'service' }

      const first = await api.getAxios()
      assert.equal(await api.getAxios(), first)
      assert.equal(rig.signed.length, 1, 'reused while nothing changed')

      rig.servicePath = '/run/other-service.sock'
      assert.notEqual(await api.getAxios(), first)
      assert.equal(rig.signed.length, 2)
    })

    it('rebuilds the connection when the permission mode changes, in both directions', async () => {
      rig.appConfig = { corePermissionMode: 'service' }
      await api.getAxios()
      rig.appConfig = { corePermissionMode: 'elevated' }
      await api.getAxios()

      assert.equal(rig.signed.length, 1)
      assert.equal(rig.direct.length, 1)
    })

    it('rebuilds the connection when the socket path changes', async () => {
      rig.ipcPath = '/run/other.sock'

      await api.getAxios()

      assert.equal(rig.direct[0].defaults.socketPath, '/run/other.sock')
    })

    it('hands back the response body, not the HTTP envelope', async () => {
      rig.reply = () => ({ version: 'v1.19.32' })

      assert.deepEqual(await api.mihomoVersion(), { version: 'v1.19.32' })
    })

    it('rejects with the core’s error body when it sent one', async () => {
      rig.reply = () => {
        throw apiError('Resource not found')
      }

      await assert.rejects(api.mihomoVersion(), { message: 'Resource not found' })
    })

    it('rejects with the transport error when there is no response', async () => {
      const failure = new Error('socket hang up')
      rig.reply = () => {
        throw failure
      }

      await assert.rejects(api.mihomoVersion(), failure)
    })

    it('exposes the stream controls implemented in mihomoStreams', () => {
      for (const [name, stub] of Object.entries(streamStubs)) {
        assert.equal((api as unknown as Record<string, unknown>)[name], stub, name)
      }
    })
  })

  describe('requests', () => {
    const REQUESTS: ReadonlyArray<{
      name: string
      run: () => Promise<unknown>
      expected: { method: HttpMethod; url: string; data?: unknown; config?: unknown }
    }> = [
      {
        name: 'mihomoVersion',
        run: () => api.mihomoVersion(),
        expected: { method: 'get', url: '/version' }
      },
      {
        name: 'mihomoConfig',
        run: () => api.mihomoConfig(),
        expected: { method: 'get', url: '/configs' }
      },
      {
        name: 'patchMihomoConfig',
        run: () => api.patchMihomoConfig({ mode: 'global' }),
        expected: { method: 'patch', url: '/configs', data: { mode: 'global' } }
      },
      {
        name: 'reloadMihomoConfigFromDisk',
        run: () => api.reloadMihomoConfigFromDisk(),
        expected: {
          method: 'put',
          url: '/configs?force=true',
          data: { path: '', payload: '' },
          config: { timeout: 30_000 }
        }
      },
      {
        name: 'mihomoCloseConnection',
        run: () => api.mihomoCloseConnection('a b/c'),
        expected: { method: 'delete', url: '/connections/a%20b%2Fc' }
      },
      {
        name: 'mihomoGetConnections',
        run: () => api.mihomoGetConnections(),
        expected: { method: 'get', url: '/connections' }
      },
      {
        name: 'mihomoFlushFakeIpCache',
        run: () => api.mihomoFlushFakeIpCache(),
        expected: { method: 'post', url: '/cache/fakeip/flush' }
      },
      {
        name: 'mihomoCloseConnections (all)',
        run: () => api.mihomoCloseConnections(),
        expected: { method: 'delete', url: '/connections' }
      },
      {
        name: 'mihomoRules',
        run: () => api.mihomoRules(),
        expected: { method: 'get', url: '/rules' }
      },
      {
        name: 'mihomoProxies',
        run: () => api.mihomoProxies(),
        expected: { method: 'get', url: '/proxies' }
      },
      {
        name: 'mihomoProxyProviders',
        run: () => api.mihomoProxyProviders(),
        expected: { method: 'get', url: '/providers/proxies' }
      },
      {
        name: 'mihomoUpdateProxyProviders',
        run: () => api.mihomoUpdateProxyProviders('my provider'),
        expected: { method: 'put', url: '/providers/proxies/my%20provider' }
      },
      {
        name: 'mihomoRuleProviders',
        run: () => api.mihomoRuleProviders(),
        expected: { method: 'get', url: '/providers/rules' }
      },
      {
        name: 'mihomoUpdateRuleProviders',
        run: () => api.mihomoUpdateRuleProviders('规则'),
        expected: { method: 'put', url: '/providers/rules/%E8%A7%84%E5%88%99' }
      },
      {
        name: 'mihomoGroupDetail',
        run: () => api.mihomoGroupDetail('🎯 Cursor'),
        expected: { method: 'get', url: '/proxies/%F0%9F%8E%AF%20Cursor' }
      },
      {
        name: 'mihomoRulesDisable',
        run: () => api.mihomoRulesDisable({ '0': true }),
        expected: { method: 'patch', url: '/rules/disable', data: { '0': true } }
      },
      {
        name: 'mihomoUpgrade',
        run: () => api.mihomoUpgrade('alpha channel'),
        expected: {
          method: 'post',
          url: '/upgrade?channel=alpha%20channel',
          data: undefined,
          config: { timeout: 90000 }
        }
      },
      {
        name: 'mihomoUpgradeGeo',
        run: () => api.mihomoUpgradeGeo(),
        expected: {
          method: 'post',
          url: '/upgrade/geo',
          data: undefined,
          config: { timeout: 90000 }
        }
      },
      {
        name: 'mihomoUpgradeUI',
        run: () => api.mihomoUpgradeUI(),
        expected: {
          method: 'post',
          url: '/upgrade/ui',
          data: undefined,
          config: { timeout: 90000 }
        }
      }
    ]

    for (const { name, run, expected } of REQUESTS) {
      it(`${name} sends exactly one ${expected.method.toUpperCase()} ${expected.url}`, async () => {
        await run()

        assert.deepEqual(rig.calls, [
          callOf(expected.method, expected.url, expected.data, expected.config)
        ])
      })
    }

    describe('core upgrade', () => {
      const upgradeOn = async (platform: NodeJS.Platform): Promise<string[]> => {
        const original = Object.getOwnPropertyDescriptor(process, 'platform')!
        Object.defineProperty(process, 'platform', { ...original, value: platform })
        try {
          await api.mihomoUpgrade('alpha')
        } finally {
          Object.defineProperty(process, 'platform', original)
        }
        return rig.calls.map(({ method, url }) => `${method} ${url}`)
      }

      it('puts the core log level back to info first on Windows', async () => {
        assert.deepEqual(await upgradeOn('win32'), [
          'patch /configs',
          'post /upgrade?channel=alpha'
        ])
        assert.deepEqual(rig.calls[0].data, { 'log-level': 'info' })
      })

      it('only asks for the upgrade elsewhere', async () => {
        assert.deepEqual(await upgradeOn('darwin'), ['post /upgrade?channel=alpha'])
      })
    })

    it('closes only the connections routed through the named chain, ignoring ones that fail', async () => {
      rig.reply = ({ method, url }) => {
        if (method === 'get') {
          return {
            connections: [
              { id: 'a', chains: ['节点', '自动选择'] },
              { id: 'b', chains: ['DIRECT'] },
              { id: 'c' },
              { id: 'd', chains: ['自动选择'] }
            ]
          }
        }
        if (url === '/connections/a') {
          throw apiError('already closed')
        }
        return {}
      }

      await api.mihomoCloseConnections('自动选择')

      assert.deepEqual(
        rig.calls.map(({ method, url }) => `${method} ${url}`),
        ['get /connections', 'delete /connections/a', 'delete /connections/d']
      )
    })

    it('closes nothing when the core reports no connections', async () => {
      rig.reply = () => ({})

      await api.mihomoCloseConnections('自动选择')

      assert.deepEqual(
        rig.calls.map(({ method }) => method),
        ['get']
      )
    })
  })

  describe('releasing a pinned group', () => {
    it('tells the sticky-pin tracker first, then clears the pin', async () => {
      rig.reply = () => {
        assert.deepEqual(rig.unfixed, ['🎯 Cursor 专用'], 'tracker is told before the request')
        return { now: 'n1' }
      }

      const detail = await api.mihomoUnfixedProxy('🎯 Cursor 专用')

      assert.deepEqual(detail, { now: 'n1' })
      assert.deepEqual(rig.calls, [
        callOf('delete', '/proxies/%F0%9F%8E%AF%20Cursor%20%E4%B8%93%E7%94%A8')
      ])
    })
  })
})
