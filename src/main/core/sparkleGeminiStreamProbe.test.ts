import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import zlib from 'node:zlib'
import {
  assertCleanedUp,
  CONNECT_OK,
  chunked,
  connections,
  flush,
  INCONCLUSIVE,
  loadProbe,
  MARKER_TW,
  MARKER_ZZ,
  openTunnel,
  PAGE_TW,
  pieces,
  resetConnections,
  responseHead,
  runWith as runProbeWith,
  spyOnGunzip,
  startProbe as startProbeWith,
  VERDICT_TW
} from './sparkleGeminiStreamProbeRig'
import type { Probe } from './sparkleGeminiStreamProbeRig'

describe('streamProbeGeminiRegionViaLocalListener', () => {
  let probe: Probe
  let restoreGunzip: () => void

  const startProbe = (timeoutMs?: number): ReturnType<typeof startProbeWith> =>
    startProbeWith(probe, timeoutMs)
  const runWith = (response: Buffer, pieceSize?: number): ReturnType<typeof runProbeWith> =>
    runProbeWith(probe, response, pieceSize)

  before(async () => {
    probe = await loadProbe()
  })

  beforeEach(() => {
    resetConnections()
    restoreGunzip = spyOnGunzip()
    mock.timers.enable({ apis: ['setTimeout'] })
  })

  afterEach(() => {
    restoreGunzip()
    mock.timers.reset()
  })

  after(() => {
    mock.restoreAll()
  })

  it('asks the local listener for a tunnel to Gemini, then requests the app page over TLS', async () => {
    const { result, raw } = startProbe()

    assert.deepEqual(connections.rawTargets, [[17899, '127.0.0.1']])
    assert.deepEqual(raw.written, [
      'CONNECT gemini.google.com:443 HTTP/1.1\r\nHost: gemini.google.com:443\r\n\r\n'
    ])
    assert.equal(connections.tls.length, 0, 'TLS only starts after the tunnel is accepted')

    const secure = openTunnel(raw)
    assert.deepEqual(connections.tlsOptions, [
      {
        socket: raw,
        servername: 'gemini.google.com',
        ALPNProtocols: ['http/1.1'],
        rejectUnauthorized: true
      }
    ])
    const [request] = secure.written
    assert.match(request, /^GET \/app HTTP\/1\.1\r\n/)
    assert.match(request, /\r\nHost: gemini\.google\.com\r\n/)
    assert.match(request, /\r\nAccept-Encoding: gzip\r\n/)
    assert.match(request, /\r\nConnection: close\r\n\r\n$/)

    secure.emit('data', Buffer.from(responseHead() + PAGE_TW))
    assert.deepEqual(await result, VERDICT_TW)
    assertCleanedUp()
  })

  it('reports a blocked region as a definitive ineligible verdict', async () => {
    const page = `<script>window.WIZ_global_data={${MARKER_ZZ}};</script>`

    assert.deepEqual(await runWith(Buffer.from(responseHead() + page)), {
      definitive: true,
      eligible: false,
      countryCode: 'ZZ'
    })
    assertCleanedUp()
  })

  it('treats the google.cn landing page as blocked even without a region code', async () => {
    const page = '<a href="https://www.google.cn/intl/zh-CN/">'

    assert.deepEqual(await runWith(Buffer.from(responseHead() + page)), {
      definitive: true,
      eligible: false,
      countryCode: 'CN'
    })
  })

  it('reaches the same verdict however the response is split across reads', async () => {
    const response = Buffer.from(responseHead('Transfer-Encoding: chunked'))
    const body = chunked(
      Buffer.from('<html><head>'),
      Buffer.from(`<script>window.WIZ_global_data={${MARKER_TW}};</script>`)
    )
    const whole = Buffer.concat([response, body])

    for (const size of [1, 2, 3, 5, 8, 13, 64, whole.length]) {
      resetConnections()
      assert.deepEqual(await runWith(whole, size), VERDICT_TW, `piece size ${size}`)
    }
  })

  it('decodes gzip bodies, with or without chunked framing', async () => {
    const compressed = zlib.gzipSync(Buffer.from(PAGE_TW))

    for (const [name, head, body] of [
      ['plain gzip', responseHead('Content-Encoding: gzip'), compressed],
      [
        'chunked gzip',
        responseHead('Content-Encoding: gzip', 'Transfer-Encoding: chunked'),
        chunked(compressed.subarray(0, 7), compressed.subarray(7))
      ]
    ] as const) {
      resetConnections()
      const response = Buffer.concat([Buffer.from(head), body])
      assert.deepEqual(await runWith(response, 11), VERDICT_TW, name)
    }
  })

  it('releases the gzip stream together with the sockets', async () => {
    const compressed = zlib.gzipSync(Buffer.from(PAGE_TW))

    await runWith(Buffer.concat([Buffer.from(responseHead('Content-Encoding: gzip')), compressed]))

    assert.equal(connections.gunzip.length, 1)
    assert.equal(connections.gunzip[0].destroyed, true)
  })

  it('keeps reading until the region marker shows up', async () => {
    const { result, raw } = startProbe()
    const secure = openTunnel(raw)

    secure.emit('data', Buffer.from(responseHead() + '<html>no marker yet'))
    secure.emit('data', Buffer.from('<script>window.WIZ_global_data={'))
    assert.equal(connections.raw[0].destroyed, false)
    secure.emit('data', Buffer.from(`${MARKER_TW}};</script>`))

    assert.deepEqual(await result, VERDICT_TW)
  })

  it('is inconclusive when the page is not served with 200', async () => {
    const response = Buffer.from('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')

    assert.deepEqual(await runWith(response), INCONCLUSIVE)
    assertCleanedUp()
  })

  it('is inconclusive when the local listener refuses the tunnel', async () => {
    const { result, raw } = startProbe()

    raw.emit('data', Buffer.from('HTTP/1.1 502 Bad Gateway\r\n\r\n'))

    assert.deepEqual(await result, INCONCLUSIVE)
    assert.equal(connections.tls.length, 0)
    assertCleanedUp()
  })

  it('waits for the whole tunnel reply before judging it', async () => {
    const { result, raw } = startProbe()

    for (const piece of pieces(Buffer.from(CONNECT_OK), 4)) {
      raw.emit('data', piece)
    }
    const secure = connections.tls[0]
    secure.emit('secureConnect')
    secure.emit('data', Buffer.from(responseHead() + PAGE_TW))

    assert.deepEqual(await result, VERDICT_TW)
  })

  it('is inconclusive when the connection itself fails', async () => {
    const result = probe()

    connections.raw[0].emit('error', new Error('connect ECONNREFUSED 127.0.0.1:17899'))

    assert.deepEqual(await result, INCONCLUSIVE)
    assertCleanedUp()
  })

  it('is inconclusive when the TLS handshake fails', async () => {
    const { result, raw } = startProbe()
    raw.emit('data', Buffer.from(CONNECT_OK))

    connections.tls[0].emit('error', new Error('certificate rejected'))

    assert.deepEqual(await result, INCONCLUSIVE)
    assertCleanedUp()
  })

  it('is inconclusive when the server hangs up before the marker', async () => {
    const { result, raw } = startProbe()
    const secure = openTunnel(raw)
    secure.emit('data', Buffer.from(responseHead() + '<html>'))

    secure.emit('end')

    assert.deepEqual(await result, INCONCLUSIVE)
    assertCleanedUp()
  })

  it('never reaches a verdict from unreadable chunk framing and falls back to the timeout', async () => {
    const { result, raw } = startProbe(3000)
    const secure = openTunnel(raw)

    secure.emit('data', Buffer.from(responseHead('Transfer-Encoding: chunked') + 'zz\r\nxx'))
    mock.timers.tick(3000)

    assert.deepEqual(await result, INCONCLUSIVE)
  })

  it('survives a corrupt gzip stream and falls back to the timeout', async () => {
    const { result, raw } = startProbe(3000)
    const secure = openTunnel(raw)

    secure.emit(
      'data',
      Buffer.concat([
        Buffer.from(responseHead('Content-Encoding: gzip')),
        Buffer.from('this is not gzip data at all')
      ])
    )
    // 解压错误由线程池异步产生：等它真正发生，才能证明没有未处理的 error 事件。
    const [gunzip] = connections.gunzip
    for (let attempts = 0; !gunzip.errored && attempts < 200; attempts += 1) {
      await flush()
    }
    await flush()
    assert.ok(gunzip.errored, 'zlib rejected the data')
    mock.timers.tick(3000)

    assert.deepEqual(await result, INCONCLUSIVE)
  })

  it('times out after the requested time and tears everything down', async () => {
    const { result, raw } = startProbe(2500)
    openTunnel(raw)

    mock.timers.tick(2499)
    assert.equal(connections.raw[0].destroyed, false)
    mock.timers.tick(1)

    assert.deepEqual(await result, INCONCLUSIVE)
    assertCleanedUp()
  })

  it('defaults to a five second budget', async () => {
    const result = probe()

    mock.timers.tick(4999)
    assert.equal(connections.raw[0].destroyed, false)
    mock.timers.tick(1)

    assert.deepEqual(await result, INCONCLUSIVE)
  })

  it('stops its timer as soon as a verdict is known', async () => {
    const { result, raw } = startProbe()
    const secure = openTunnel(raw)
    const clear = mock.method(globalThis, 'clearTimeout')

    try {
      secure.emit('data', Buffer.from(responseHead() + PAGE_TW))
      await result

      assert.equal(clear.mock.callCount(), 1)
    } finally {
      clear.mock.restore()
    }
  })

  it('ignores everything that arrives after the verdict and cleans up exactly once', async () => {
    const { result, raw } = startProbe()
    const secure = openTunnel(raw)
    secure.emit('data', Buffer.from(responseHead() + PAGE_TW))
    const verdict = await result
    const clear = mock.method(globalThis, 'clearTimeout')

    try {
      secure.emit('data', Buffer.from(`<script>window.WIZ_global_data={${MARKER_ZZ}};</script>`))
      secure.emit('end')
      raw.emit('error', new Error('late'))
      mock.timers.tick(10_000)

      assert.equal(clear.mock.callCount(), 0, 'the timer was already stopped')
    } finally {
      clear.mock.restore()
    }
    assert.deepEqual(verdict, VERDICT_TW)
    assert.equal(raw.destroyCalls, 1)
    assert.equal(secure.destroyCalls, 1)
  })

  it('still resolves when closing a socket throws', async () => {
    connections.destroyError = new Error('already gone')
    const { result, raw } = startProbe()
    const secure = openTunnel(raw)

    secure.emit('data', Buffer.from(responseHead() + PAGE_TW))

    assert.deepEqual(await result, VERDICT_TW)
    assertCleanedUp()
  })
})
