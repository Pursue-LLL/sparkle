import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import { MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import {
  connections,
  flush,
  installFakeSockets,
  openTunnel,
  resetConnections
} from './localProbeSocketsRig'
import type { FakeConnection } from './localProbeSocketsRig'
import type { ThroughputReading } from './sparkleNodeQualityCore'
import type { ThroughputTarget } from './sparkleThroughputProbe'

const SAMPLE = 128 * 1024
const HEAD_206 = 'HTTP/1.1 206 Partial Content\r\nContent-Length: 131072\r\n\r\n'
const FAILED: ThroughputReading = { kind: 'failed' }
const UNAVAILABLE: ThroughputReading = { kind: 'unavailable' }

const clock = { now: 0 }

const withHead = (bodyBytes: number, head = HEAD_206): Buffer =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(bodyBytes)])

describe('measureNodeThroughput', () => {
  let measure: typeof import('./sparkleThroughputProbe').measureNodeThroughput
  let google: ThroughputTarget
  let control: ThroughputTarget
  const selections: Array<[string, string]> = []
  let selectFailure: Error | undefined
  let restoreClock: () => void

  const start = async (
    target: ThroughputTarget = google
  ): Promise<{ result: Promise<ThroughputReading>; raw: FakeConnection; secure: FakeConnection }> => {
    const result = measure('台湾-1', target)
    await flush()
    const raw = connections.raw[0]
    raw.emit('connect')
    return { result, raw, secure: openTunnel(raw) }
  }

  before(async () => {
    installFakeSockets()
    mock.module('./mihomoApi', {
      exports: {
        mihomoChangeProxy: async (group: string, node: string): Promise<boolean> => {
          selections.push([group, node])
          if (selectFailure) {
            throw selectFailure
          }
          return true
        }
      }
    })
    const probe = await import('./sparkleThroughputProbe')
    measure = probe.measureNodeThroughput
    google = probe.GOOGLE_TARGET
    control = probe.CONTROL_TARGET
  })

  beforeEach(() => {
    resetConnections()
    selections.length = 0
    selectFailure = undefined
    clock.now = 0
    const nowMock = mock.method(performance, 'now', () => clock.now)
    restoreClock = () => nowMock.mock.restore()
    mock.timers.enable({ apis: ['setTimeout'] })
  })

  afterEach(() => {
    mock.timers.reset()
    restoreClock()
  })

  after(() => {
    mock.restoreAll()
  })

  describe('the request', () => {
    it('selects the node in the hidden probe group before opening the tunnel', async () => {
      const { result, secure } = await start()
      secure.emit('data', withHead(SAMPLE))
      await result

      assert.deepEqual(selections, [[MAIL_PROBE_HIDDEN_GROUP_NAME, '台湾-1']])
    })

    it('asks the target for the first 128 KiB, uncompressed, over HTTP/1.1', async () => {
      const { result, raw, secure } = await start()
      secure.emit('data', withHead(SAMPLE))
      await result

      assert.deepEqual(raw.written, [
        'CONNECT dl.google.com:443 HTTP/1.1\r\nHost: dl.google.com:443\r\n\r\n'
      ])
      assert.deepEqual(connections.tlsOptions, [
        { socket: raw, servername: 'dl.google.com', rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] }
      ])
      assert.deepEqual(secure.written, [
        'GET /linux/direct/google-chrome-stable_current_amd64.deb HTTP/1.1\r\n' +
          'Host: dl.google.com\r\n' +
          'Range: bytes=0-131071\r\n' +
          'Accept-Encoding: identity\r\n' +
          'User-Agent: Mozilla/5.0\r\n' +
          'Connection: close\r\n\r\n'
      ])
    })

    it('probes the control site on its own host', async () => {
      const { result, raw, secure } = await start(control)
      secure.emit('data', withHead(SAMPLE))
      await result

      assert.deepEqual(raw.written, [
        'CONNECT cdn.jsdelivr.net:443 HTTP/1.1\r\nHost: cdn.jsdelivr.net:443\r\n\r\n'
      ])
      assert.match(secure.written[0], /^GET \/npm\/typescript@5\.4\.5\/lib\/typescript\.js HTTP\/1\.1\r\nHost: cdn\.jsdelivr\.net\r\n/)
    })
  })

  describe('a full sample', () => {
    it('measures from the first data chunk to the last, counting the body bytes of the first one', async () => {
      const { result, secure } = await start()

      clock.now = 1000
      secure.emit('data', withHead(20 * 1024))
      clock.now = 1500
      secure.emit('data', Buffer.alloc(SAMPLE - 20 * 1024))

      assert.deepEqual(await result, { kind: 'measured', kbps: 256 })
    })

    it('does not count the response head as downloaded data', async () => {
      const { result, secure } = await start()

      clock.now = 1000
      secure.emit('data', withHead(0))
      clock.now = 2000
      secure.emit('data', Buffer.alloc(SAMPLE))

      assert.deepEqual(await result, { kind: 'measured', kbps: 128 })
    })

    it('reads a response head that arrives in pieces, timing from the very first byte', async () => {
      const { result, secure } = await start()

      clock.now = 1000
      secure.emit('data', Buffer.from('HTTP/1.1 206 Partial Content\r\nContent-'))
      clock.now = 1100
      secure.emit('data', Buffer.concat([Buffer.from('Length: 131072\r\n\r\n'), Buffer.alloc(SAMPLE)]))

      assert.deepEqual(await result, { kind: 'measured', kbps: 1280 })
    })

    it('times from the first chunk even when the clock still reads zero', async () => {
      const { result, secure } = await start()

      secure.emit('data', withHead(0))
      clock.now = 1000
      secure.emit('data', Buffer.alloc(SAMPLE))

      assert.deepEqual(await result, { kind: 'measured', kbps: 128 })
    })

    it('accepts a plain 200 from a server that ignores the range', async () => {
      const { result, secure } = await start()

      clock.now = 1000
      secure.emit('data', withHead(SAMPLE, 'HTTP/1.1 200 OK\r\nContent-Length: 100000000\r\n\r\n'))

      assert.deepEqual(await result, { kind: 'measured', kbps: 2000 })
    })

    it('caps the rate when everything arrives at once', async () => {
      const { result, secure } = await start()

      clock.now = 1000
      secure.emit('data', withHead(SAMPLE))

      assert.deepEqual(await result, { kind: 'measured', kbps: 2000 })
    })

    it('stops at the first verdict: closes both sockets once and ignores the rest', async () => {
      const { result, raw, secure } = await start()
      secure.emit('data', withHead(SAMPLE))
      await result

      secure.emit('data', Buffer.alloc(1000))
      secure.emit('end')
      mock.timers.tick(5000)

      assert.equal(raw.destroyCalls, 1)
      assert.equal(secure.destroyCalls, 1)
    })

    it('stops its deadline timer as soon as a verdict is known', async () => {
      const { result, secure } = await start()
      const clear = mock.method(globalThis, 'clearTimeout')

      try {
        secure.emit('data', withHead(SAMPLE))
        await result

        assert.equal(clear.mock.callCount(), 1)
      } finally {
        clear.mock.restore()
      }
    })
  })

  describe('a partial sample', () => {
    it('measures what arrived by the 5 second deadline, over the time since the first chunk', async () => {
      const { result, secure } = await start()

      clock.now = 500
      secure.emit('data', withHead(10 * 1024))
      clock.now = 4000
      secure.emit('data', Buffer.alloc(20 * 1024))
      clock.now = 5000
      mock.timers.tick(5000)

      const reading = (await result) as { kind: string; kbps: number }
      assert.equal(reading.kind, 'measured')
      assert.ok(Math.abs(reading.kbps - 30 / 4.5) < 1e-9)
    })

    it('holds out until the deadline, not a millisecond sooner', async () => {
      const { result, secure } = await start()
      clock.now = 500
      secure.emit('data', withHead(1024))

      clock.now = 4999
      mock.timers.tick(4999)
      assert.equal(secure.destroyed, false)
      clock.now = 5000
      mock.timers.tick(1)

      assert.equal((await result).kind, 'measured')
      assert.equal(secure.destroyed, true)
    })

    it('needs at least one second of observation after the first chunk', async () => {
      const first = await start()
      clock.now = 4001
      first.secure.emit('data', withHead(1024))
      clock.now = 5000
      mock.timers.tick(5000)
      assert.deepEqual(await first.result, FAILED)

      resetConnections()
      const second = await start()
      clock.now = 4000
      second.secure.emit('data', withHead(1024))
      clock.now = 5000
      mock.timers.tick(5000)
      assert.equal((await second.result).kind, 'measured')
    })

    it('counts a node that sent a response head but no data as failed', async () => {
      const { result, secure } = await start()
      clock.now = 100
      secure.emit('data', withHead(0))
      clock.now = 5000
      mock.timers.tick(5000)

      assert.deepEqual(await result, FAILED)
    })

    it('counts a node that sent nothing at all as failed', async () => {
      const { result } = await start()
      clock.now = 5000
      mock.timers.tick(5000)

      assert.deepEqual(await result, FAILED)
    })

    it('measures what arrived when the server closes the connection early', async () => {
      const { result, secure } = await start()
      clock.now = 1000
      secure.emit('data', withHead(40 * 1024))
      clock.now = 3000
      secure.emit('end')

      assert.deepEqual(await result, { kind: 'measured', kbps: 20 })
    })

    it('does not trust a response that ends before there is anything to measure', async () => {
      const { result, secure } = await start()
      clock.now = 1000
      secure.emit('data', withHead(2 * 1024))
      clock.now = 1050
      secure.emit('end')

      assert.deepEqual(await result, FAILED)
    })
  })

  describe('a response that cannot be measured', () => {
    it('fails on an error status and hangs up at once', async () => {
      const { result, raw, secure } = await start()

      secure.emit('data', Buffer.from('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n'))

      assert.deepEqual(await result, FAILED)
      assert.equal(raw.destroyed, true)
      assert.equal(secure.destroyed, true)
    })

    it('fails on a response head that never ends', async () => {
      const { result, secure } = await start()

      secure.emit('data', Buffer.from(`HTTP/1.1 206 Partial Content\r\nX-Pad: ${'x'.repeat(32 * 1024)}`))

      assert.deepEqual(await result, FAILED)
      assert.equal(secure.destroyed, true)
    })

    it('keeps reading a response head that is exactly at the size limit', async () => {
      const { result, secure } = await start()
      const prefix = 'HTTP/1.1 206 Partial Content\r\nX-Pad: '

      clock.now = 1000
      secure.emit('data', Buffer.from(prefix + 'x'.repeat(32 * 1024 - prefix.length)))
      assert.equal(secure.destroyed, false)
      clock.now = 1100
      secure.emit('data', Buffer.concat([Buffer.from('\r\n\r\n'), Buffer.alloc(SAMPLE)]))

      assert.deepEqual(await result, { kind: 'measured', kbps: 1280 })
    })
  })

  describe('failures to open the tunnel', () => {
    it('is unavailable when the local listener cannot be reached', async () => {
      const result = measure('台湾-1', google)
      await flush()

      connections.raw[0].emit('error', new Error('ECONNREFUSED'))

      assert.deepEqual(await result, UNAVAILABLE)
    })

    it('is unavailable when the local listener refuses the tunnel', async () => {
      const result = measure('台湾-1', google)
      await flush()
      const raw = connections.raw[0]
      raw.emit('connect')

      raw.emit('data', Buffer.from('HTTP/1.1 503 Service Unavailable\r\n\r\n'))

      assert.deepEqual(await result, UNAVAILABLE)
    })

    it('blames the node when the tunnel breaks after it was accepted', async () => {
      const { result, raw } = await start()

      raw.emit('error', new Error('ECONNRESET'))

      assert.deepEqual(await result, FAILED)
    })

    it('blames the node when the TLS handshake fails', async () => {
      const result = measure('台湾-1', google)
      await flush()
      const raw = connections.raw[0]
      raw.emit('connect')
      raw.emit('data', Buffer.from('HTTP/1.1 200 Connection established\r\n\r\n'))

      connections.tls[0].emit('error', new Error('certificate rejected'))

      assert.deepEqual(await result, FAILED)
    })

    it('is unavailable, and opens no connection, when the node cannot be selected', async () => {
      selectFailure = new Error('controller down')

      assert.deepEqual(await measure('台湾-1', google), UNAVAILABLE)
      assert.equal(connections.raw.length, 0)
    })
  })
})
