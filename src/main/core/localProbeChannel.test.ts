import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'
import { MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import type { withLocalProbeChannelLock } from './localProbeChannel'
import { ensureMailProbeListener } from './sparkleMailProviderCore'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('withLocalProbeChannelLock', () => {
  let lock: typeof withLocalProbeChannelLock
  let proxyUrl: string
  const events: string[] = []
  let selectFailure: Error | undefined

  before(async () => {
    mock.module('./mihomoApi', {
      exports: {
        mihomoChangeProxy: async (group: string, node: string): Promise<boolean> => {
          events.push(`select:${group}:${node}`)
          if (selectFailure) {
            throw selectFailure
          }
          return true
        }
      }
    })
    const channel = await import('./localProbeChannel')
    lock = channel.withLocalProbeChannelLock
    proxyUrl = channel.LOCAL_PROBE_PROXY_URL
  })

  beforeEach(() => {
    events.length = 0
    selectFailure = undefined
  })

  after(() => {
    mock.restoreAll()
  })

  it('offers the address the hidden probe listener is configured to serve', () => {
    const profile = {} as MihomoConfig
    ensureMailProbeListener(profile, 'profile-1')

    const [listener] = (profile.listeners ?? []) as Array<{
      listen: string
      port: number
      proxy: string
    }>

    assert.equal(proxyUrl, `http://${listener.listen}:${listener.port}`)
    assert.equal(listener.proxy, MAIL_PROBE_HIDDEN_GROUP_NAME)
  })

  it('points the hidden probe group at the node before the task runs and returns its result', async () => {
    const result = await lock('台湾-1', async () => {
      events.push('task')
      return 42
    })

    assert.equal(result, 42)
    assert.deepEqual(events, [`select:${MAIL_PROBE_HIDDEN_GROUP_NAME}:台湾-1`, 'task'])
  })

  it('runs tasks one at a time, in call order, each on its own node', async () => {
    const firstGate = deferred()
    const first = lock('节点A', async () => {
      events.push('A:start')
      await firstGate.promise
      events.push('A:end')
    })
    const second = lock('节点B', async () => {
      events.push('B:start')
    })
    await settle()

    assert.deepEqual(events, [`select:${MAIL_PROBE_HIDDEN_GROUP_NAME}:节点A`, 'A:start'])

    firstGate.resolve()
    await Promise.all([first, second])

    assert.deepEqual(events, [
      `select:${MAIL_PROBE_HIDDEN_GROUP_NAME}:节点A`,
      'A:start',
      'A:end',
      `select:${MAIL_PROBE_HIDDEN_GROUP_NAME}:节点B`,
      'B:start'
    ])
  })

  it('releases the channel when the task throws, and rethrows to its caller', async () => {
    await assert.rejects(
      lock('节点A', async () => {
        throw new Error('task failed')
      }),
      /task failed/
    )

    assert.equal(await lock('节点B', async () => 'ok'), 'ok')
  })

  it('releases the channel when the node cannot be selected, without running the task', async () => {
    selectFailure = new Error('controller down')
    await assert.rejects(
      lock('节点A', async () => {
        events.push('task')
      }),
      /controller down/
    )
    selectFailure = undefined

    assert.equal(await lock('节点B', async () => 'ok'), 'ok')
    assert.ok(!events.includes('task'))
  })
})
