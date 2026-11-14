import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import { MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import {
  CONNECT_OK,
  connections,
  flush,
  installFakeSockets,
  openTunnel,
  resetConnections
} from './localProbeSocketsRig'
import type { FakeConnection } from './localProbeSocketsRig'
import type { probeSingleNodeMailPorts } from './sparkleMailPortProbe'

const IMAP_CONNECT = 'CONNECT imap.gmail.com:993 HTTP/1.1\r\nHost: imap.gmail.com:993\r\n\r\n'
const SMTP_CONNECT = 'CONNECT smtp.gmail.com:465 HTTP/1.1\r\nHost: smtp.gmail.com:465\r\n\r\n'
const IMAP_BANNER = Buffer.from('* OK Gimap ready for requests\r\n')
const SMTP_BANNER = Buffer.from('220 smtp.gmail.com ESMTP ready\r\n')
const DEAD = { alive: false, rttMs: 0 }

describe('probeSingleNodeMailPorts', () => {
  let probe: typeof probeSingleNodeMailPorts
  const selections: Array<[string, string]> = []

  /** 等本次探测拿到通道锁并向本地监听器发起第 index 条连接，再让它连上并完成隧道与 TLS 握手。 */
  const establish = async (
    index: number
  ): Promise<{ raw: FakeConnection; secure: FakeConnection }> => {
    await flush()
    const raw = connections.raw[index]
    raw.emit('connect')
    return { raw, secure: openTunnel(raw, index) }
  }

  before(async () => {
    installFakeSockets()
    mock.module('./mihomoApi', {
      exports: {
        mihomoChangeProxy: async (group: string, node: string): Promise<boolean> => {
          selections.push([group, node])
          return true
        }
      }
    })
    probe = (await import('./sparkleMailPortProbe')).probeSingleNodeMailPorts
  })

  beforeEach(() => {
    resetConnections()
    selections.length = 0
    mock.timers.enable({ apis: ['setTimeout'] })
  })

  afterEach(() => {
    mock.timers.reset()
  })

  after(() => {
    mock.restoreAll()
  })

  it('reports a node alive when both Gmail ports greet with their protocol banner', async () => {
    const result = probe('台湾-1')
    const imap = await establish(0)
    imap.secure.emit('data', IMAP_BANNER)
    const smtp = await establish(1)
    smtp.secure.emit('data', SMTP_BANNER)

    const verdict = await result

    assert.equal(verdict.alive, true)
    assert.ok(verdict.rttMs >= 1)
    assert.deepEqual(selections, [[MAIL_PROBE_HIDDEN_GROUP_NAME, '台湾-1']])
    assert.deepEqual(connections.rawTargets, [
      [17899, '127.0.0.1'],
      [17899, '127.0.0.1']
    ])
    assert.deepEqual(imap.raw.written, [IMAP_CONNECT])
    assert.deepEqual(smtp.raw.written, [SMTP_CONNECT])
    assert.deepEqual(connections.tlsOptions, [
      { socket: imap.raw, servername: 'imap.gmail.com', rejectUnauthorized: true },
      { socket: smtp.raw, servername: 'smtp.gmail.com', rejectUnauthorized: true }
    ])
    for (const socket of [imap.raw, imap.secure, smtp.raw, smtp.secure]) {
      assert.equal(socket.destroyCalls, 1)
    }
  })

  it('trims whitespace around the banner before matching its prefix', async () => {
    const result = probe('台湾-1')
    ;(await establish(0)).secure.emit('data', Buffer.from('\r\n  * OK hello\r\n'))
    ;(await establish(1)).secure.emit('data', Buffer.from(' 220 hello\r\n'))

    assert.equal((await result).alive, true)
  })

  it('does not try SMTP once the IMAP banner is wrong', async () => {
    const result = probe('台湾-1')
    ;(await establish(0)).secure.emit('data', Buffer.from('* BYE go away\r\n'))

    assert.deepEqual(await result, DEAD)
    assert.equal(connections.raw.length, 1)
  })

  it('reports a node dead when the SMTP banner is wrong', async () => {
    const result = probe('台湾-1')
    ;(await establish(0)).secure.emit('data', IMAP_BANNER)
    ;(await establish(1)).secure.emit('data', Buffer.from('421 busy\r\n'))

    assert.deepEqual(await result, DEAD)
  })

  it('reports dead and builds no TLS socket when the listener refuses the tunnel', async () => {
    const result = probe('台湾-1')
    await flush()
    const raw = connections.raw[0]
    raw.emit('connect')
    raw.emit('data', Buffer.from('HTTP/1.1 503 Service Unavailable\r\n\r\n'))

    assert.deepEqual(await result, DEAD)
    assert.equal(connections.tls.length, 0)
    assert.equal(raw.destroyed, true)
  })

  it('reassembles a tunnel reply that arrives in pieces', async () => {
    const result = probe('台湾-1')
    await flush()
    const raw = connections.raw[0]
    raw.emit('connect')
    raw.emit('data', Buffer.from(CONNECT_OK.slice(0, 20)))
    assert.equal(connections.tls.length, 0)
    raw.emit('data', Buffer.from(CONNECT_OK.slice(20)))
    assert.equal(connections.tls.length, 1)
    connections.tls[0].emit('secureConnect')
    connections.tls[0].emit('data', Buffer.from('* BYE\r\n'))

    assert.deepEqual(await result, DEAD)
  })

  it('gives up on a tunnel reply that never ends', async () => {
    const result = probe('台湾-1')
    await flush()
    const raw = connections.raw[0]
    raw.emit('connect')
    raw.emit('data', Buffer.from('x'.repeat(2049)))

    assert.deepEqual(await result, DEAD)
    assert.equal(connections.tls.length, 0)
  })

  it('reports dead when the connection to the listener fails', async () => {
    const result = probe('台湾-1')
    await flush()
    connections.raw[0].emit('error', new Error('ECONNREFUSED'))

    assert.deepEqual(await result, DEAD)
    assert.equal(connections.raw[0].destroyed, true)
  })

  it('reports dead when the TLS handshake fails', async () => {
    const result = probe('台湾-1')
    await flush()
    const raw = connections.raw[0]
    raw.emit('connect')
    raw.emit('data', Buffer.from(CONNECT_OK))
    connections.tls[0].emit('error', new Error('certificate rejected'))

    assert.deepEqual(await result, DEAD)
    assert.equal(connections.tls[0].destroyed, true)
    assert.equal(raw.destroyed, true)
  })

  it('gives up on a silent server after 3.5 seconds', async () => {
    const result = probe('台湾-1')
    const imap = await establish(0)

    mock.timers.tick(3499)
    assert.equal(imap.raw.destroyed, false)
    mock.timers.tick(1)

    assert.deepEqual(await result, DEAD)
    assert.equal(imap.raw.destroyed, true)
    assert.equal(imap.secure.destroyed, true)
  })

  it('ignores whatever arrives after the verdict', async () => {
    const result = probe('台湾-1')
    const imap = await establish(0)
    imap.secure.emit('data', Buffer.from('* BYE\r\n'))
    imap.secure.emit('data', IMAP_BANNER)
    imap.raw.emit('error', new Error('late'))
    mock.timers.tick(3500)

    assert.deepEqual(await result, DEAD)
    assert.equal(connections.raw.length, 1)
    assert.equal(imap.raw.destroyCalls, 1)
    assert.equal(imap.secure.destroyCalls, 1)
  })

  it('still resolves when closing a socket throws', async () => {
    connections.destroyError = new Error('already closed')
    const result = probe('台湾-1')
    ;(await establish(0)).secure.emit('data', Buffer.from('* BYE\r\n'))

    assert.deepEqual(await result, DEAD)
  })
})
