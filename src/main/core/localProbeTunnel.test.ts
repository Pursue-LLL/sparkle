import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import {
  CONNECT_OK,
  connections,
  FakeConnection,
  installFakeSockets,
  resetConnections
} from './localProbeSocketsRig'
import type { LocalProbeFailure, LocalProbeTunnel } from './localProbeTunnel'

const CONNECT_REQUEST = 'CONNECT dl.example.com:443 HTTP/1.1\r\nHost: dl.example.com:443\r\n\r\n'

describe('openLocalProbeTunnel', () => {
  let open: typeof import('./localProbeTunnel').openLocalProbeTunnel
  const secured: FakeConnection[] = []
  const failures: LocalProbeFailure[] = []

  const start = (
    alpnProtocols?: readonly string[]
  ): { tunnel: LocalProbeTunnel; raw: FakeConnection } => {
    const tunnel = open({
      host: 'dl.example.com',
      port: 443,
      alpnProtocols,
      onSecure: (socket) => secured.push(socket as unknown as FakeConnection),
      onFailure: (reason) => failures.push(reason)
    })
    return { tunnel, raw: connections.raw[0] }
  }

  /** 让底层连接就绪并被监听器接受，返回随后创建的 TLS 连接。 */
  const accept = (raw: FakeConnection): FakeConnection => {
    raw.emit('connect')
    raw.emit('data', Buffer.from(CONNECT_OK))
    return connections.tls[0]
  }

  before(async () => {
    installFakeSockets()
    open = (await import('./localProbeTunnel')).openLocalProbeTunnel
  })

  beforeEach(() => {
    resetConnections()
    secured.length = 0
    failures.length = 0
  })

  after(() => {
    mock.restoreAll()
  })

  describe('establishing the tunnel', () => {
    it('dials the local probe listener and asks it to CONNECT to the target', () => {
      const { raw } = start()
      assert.deepEqual(connections.rawTargets, [[17899, '127.0.0.1']])
      assert.deepEqual(raw.written, [])

      raw.emit('connect')

      assert.deepEqual(raw.written, [CONNECT_REQUEST])
      assert.equal(connections.tls.length, 0)
    })

    it('verifies the certificate for the target host and negotiates no ALPN by default', () => {
      const { raw } = start()

      accept(raw)

      assert.deepEqual(connections.tlsOptions, [
        { socket: raw, servername: 'dl.example.com', rejectUnauthorized: true }
      ])
    })

    it('negotiates the ALPN protocols it is given', () => {
      const { raw } = start(['http/1.1'])

      accept(raw)

      assert.deepEqual(connections.tlsOptions, [
        {
          socket: raw,
          servername: 'dl.example.com',
          rejectUnauthorized: true,
          ALPNProtocols: ['http/1.1']
        }
      ])
    })

    it('hands the TLS socket over only once the handshake has finished', () => {
      const { raw } = start()
      const secure = accept(raw)
      assert.deepEqual(secured, [])

      secure.emit('secureConnect')

      assert.deepEqual(secured, [secure])
      assert.deepEqual(failures, [])
    })

    it('reassembles a tunnel reply that arrives in pieces', () => {
      const { raw } = start()
      raw.emit('connect')

      raw.emit('data', Buffer.from(CONNECT_OK.slice(0, 15)))
      assert.equal(connections.tls.length, 0)
      raw.emit('data', Buffer.from(CONNECT_OK.slice(15)))

      assert.equal(connections.tls.length, 1)
    })

    it('stops reading the tunnel reply once it has been accepted', () => {
      const { raw } = start()
      accept(raw)

      raw.emit('data', Buffer.from(CONNECT_OK))

      assert.equal(connections.tls.length, 1)
    })
  })

  describe('classifying failures', () => {
    it('blames the listener when it cannot be reached', () => {
      const { raw } = start()

      raw.emit('error', new Error('ECONNREFUSED'))

      assert.deepEqual(failures, ['listener'])
    })

    it('blames the listener when it refuses the CONNECT', () => {
      const { raw } = start()
      raw.emit('connect')

      raw.emit('data', Buffer.from('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'))

      assert.deepEqual(failures, ['listener'])
      assert.equal(connections.tls.length, 0)
    })

    it('blames the listener when the reply never ends', () => {
      const { raw } = start()
      raw.emit('connect')

      raw.emit('data', Buffer.from('x'.repeat(2048)))
      assert.deepEqual(failures, [])
      raw.emit('data', Buffer.from('x'))

      assert.deepEqual(failures, ['listener'])
    })

    it('blames the node when the connection drops after the tunnel was accepted', () => {
      const { raw } = start()
      accept(raw)

      raw.emit('error', new Error('ECONNRESET'))

      assert.deepEqual(failures, ['node'])
    })

    it('blames the node when the TLS handshake fails', () => {
      const { raw } = start()
      const secure = accept(raw)

      secure.emit('error', new Error('certificate rejected'))

      assert.deepEqual(failures, ['node'])
      assert.deepEqual(secured, [])
    })
  })

  describe('destroying the tunnel', () => {
    it('closes the TLS socket before the underlying connection', () => {
      const { tunnel, raw } = start()
      const secure = accept(raw)
      const order: string[] = []
      secure.destroy = (): FakeConnection => (order.push('tls'), secure)
      raw.destroy = (): FakeConnection => (order.push('raw'), raw)

      tunnel.destroy()

      assert.deepEqual(order, ['tls', 'raw'])
    })

    it('closes only the underlying connection when the tunnel was never accepted', () => {
      const { tunnel, raw } = start()

      tunnel.destroy()

      assert.equal(raw.destroyCalls, 1)
      assert.equal(connections.tls.length, 0)
    })

    it('still closes the second socket when closing the first one throws', () => {
      connections.destroyError = new Error('already closed')
      const { tunnel, raw } = start()
      const secure = accept(raw)

      assert.doesNotThrow(() => tunnel.destroy())

      assert.equal(secure.destroyCalls, 1)
      assert.equal(raw.destroyCalls, 1)
    })

    it('survives errors that arrive after it was destroyed', () => {
      const { tunnel, raw } = start()
      const secure = accept(raw)
      tunnel.destroy()

      assert.doesNotThrow(() => {
        raw.emit('error', new Error('late'))
        raw.emit('error', new Error('later'))
        secure.emit('error', new Error('late'))
        secure.emit('error', new Error('later'))
      })
    })
  })
})
