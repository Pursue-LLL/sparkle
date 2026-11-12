import assert from 'node:assert/strict'
import { before, beforeEach, describe, it } from 'node:test'
import { DEFAULT_GENERAL_DELAY_TEST_URL } from './cursorProxyGroup'
import { apiError, callOf, installMihomoApiMocks, rig } from './mihomoApiRig'
import type * as MihomoApi from './mihomoApi'

describe('mihomoApi delay tests', () => {
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

  const delayCall = (): { url: string; params: Record<string, unknown> } => {
    const [call] = rig.calls
    return {
      url: call.url,
      params: (call.config as { params: Record<string, unknown> }).params
    }
  }

  const timeoutFor = async (
    appTimeout: number | undefined,
    override: number | undefined
  ): Promise<unknown> => {
    rig.calls = []
    rig.appConfig = { delayTestTimeout: appTimeout }
    await api.mihomoProxyDelay('n1', undefined, { timeoutMs: override })
    return delayCall().params.timeout
  }

  it('uses the configured probe URL and timeout', async () => {
    rig.appConfig = { delayTestUrl: 'https://probe.example', delayTestTimeout: 4321 }

    await api.mihomoProxyDelay('节点 1')

    assert.deepEqual(delayCall(), {
      url: '/proxies/%E8%8A%82%E7%82%B9%201/delay',
      params: { url: 'https://probe.example', timeout: 4321 }
    })
  })

  it('prefers an explicit URL and timeout, and forwards the expected status', async () => {
    rig.appConfig = { delayTestUrl: 'https://probe.example', delayTestTimeout: 4321 }

    await api.mihomoProxyDelay('n1', 'https://explicit.example', {
      timeoutMs: 1500.9,
      expectedStatus: '200'
    })

    assert.deepEqual(delayCall().params, {
      url: 'https://explicit.example',
      timeout: 1500,
      expected: '200'
    })
  })

  it('falls back from an unusable override to the app setting, then to the default', async () => {
    assert.equal(await timeoutFor(4321.7, 0), 4321)
    assert.equal(await timeoutFor(4321, Number.NaN), 4321)
    assert.equal(await timeoutFor(-5, -1), 10000)
    assert.equal(await timeoutFor(undefined, undefined), 10000)
    assert.equal(delayCall().params.url, DEFAULT_GENERAL_DELAY_TEST_URL)
  })

  it('accepts one millisecond as a timeout but not zero', async () => {
    assert.equal(await timeoutFor(4321, 1), 1)
    assert.equal(await timeoutFor(1, undefined), 1)
    assert.equal(await timeoutFor(0, undefined), 10000)
  })

  it('does not send an expected status the group test was not given', async () => {
    await api.mihomoGroupDelay('自动选择')

    assert.equal('expected' in delayCall().params, false)
  })

  it('tests a group the same way, through the group endpoint', async () => {
    rig.appConfig = { delayTestUrl: 'https://probe.example', delayTestTimeout: 4321 }

    await api.mihomoGroupDelay('自动 选择', undefined, { expectedStatus: '204' })

    assert.deepEqual(delayCall(), {
      url: '/group/%E8%87%AA%E5%8A%A8%20%E9%80%89%E6%8B%A9/delay',
      params: { url: 'https://probe.example', timeout: 4321, expected: '204' }
    })
  })

  it('does not touch the provider endpoints when a proxy answers normally', async () => {
    rig.reply = () => ({ delay: 88 })

    assert.deepEqual(await api.mihomoProxyDelay('n1'), { delay: 88 })
    assert.equal(rig.calls.length, 1)
  })

  describe('a node that only exists inside a provider', () => {
    const PROVIDERS = { providers: { 'sparkle-fast': { proxies: [{ name: 'leaf 1' }] } } }

    const routeLeafLookup = (failure: unknown, proxies: Record<string, unknown>): void => {
      rig.reply = ({ url }) => {
        if (url.endsWith('/delay')) throw failure
        if (url === '/proxies') return { proxies }
        if (url === '/providers/proxies') return PROVIDERS
        return { delay: 123 }
      }
    }

    it('falls back to the provider’s single-node health check when the core does not know the node', async () => {
      routeLeafLookup(apiError('Resource not found'), {})
      rig.appConfig = { delayTestTimeout: 4321 }

      const result = await api.mihomoProxyDelay('leaf 1', 'https://probe.example', {
        expectedStatus: '200'
      })

      assert.deepEqual(result, { delay: 123 })
      assert.deepEqual(
        rig.calls.at(-1),
        callOf('get', '/providers/proxies/sparkle-fast/leaf%201/healthcheck', undefined, {
          params: { url: 'https://probe.example', timeout: 4321, expected: '200' }
        })
      )
    })

    it('also falls back when the node is simply missing from /proxies', async () => {
      routeLeafLookup(apiError('boom'), {})

      assert.deepEqual(await api.mihomoProxyDelay('leaf 1'), { delay: 123 })
    })

    it('omits the expected status from the provider check when none was asked for', async () => {
      routeLeafLookup(apiError('Resource not found'), {})

      await api.mihomoProxyDelay('leaf 1')

      const { params } = rig.calls.at(-1)!.config as { params: Record<string, unknown> }
      assert.equal('expected' in params, false)
    })

    it('reports a genuine probe failure of a known node instead of retrying elsewhere', async () => {
      routeLeafLookup(apiError('An error occurred in the delay test'), { 'leaf 1': {} })

      await assert.rejects(api.mihomoProxyDelay('leaf 1'), {
        message: 'An error occurred in the delay test'
      })
      assert.deepEqual(
        rig.calls.map(({ url }) => url),
        ['/proxies/leaf%201/delay', '/proxies']
      )
    })

    it('reports the original error when no provider owns the node either', async () => {
      routeLeafLookup(apiError('Resource not found'), {})

      await assert.rejects(api.mihomoProxyDelay('ghost'), { message: 'Resource not found' })
    })
  })
})
