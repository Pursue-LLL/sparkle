import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import {
  chunked,
  connections,
  flush,
  frame,
  INCONCLUSIVE,
  loadProbe,
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

describe('streamProbeGeminiRegionViaLocalListener: framing and size limits', () => {
  let probe: Probe
  let restoreGunzip: () => void

  const startProbe = (timeoutMs?: number): ReturnType<typeof startProbeWith> =>
    startProbeWith(probe, timeoutMs)
  const runWith = (response: Buffer, pieceSize?: number): ReturnType<typeof runProbeWith> =>
    runProbeWith(probe, response, pieceSize)
  const CHUNKED = responseHead('Transfer-Encoding: chunked')

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

  describe('tunnel reply', () => {
    it('tolerates a reply of up to 2 KiB before its header block ends, and gives up beyond it', async () => {
      const { result, raw } = startProbe()
      let settled = false
      void result.then(() => {
        settled = true
      })

      raw.emit('data', Buffer.from('X'.repeat(2048)))
      await flush()
      assert.equal(settled, false)
      assert.equal(raw.destroyed, false)

      raw.emit('data', Buffer.from('X'))
      assert.deepEqual(await result, INCONCLUSIVE)
      assert.equal(connections.tls.length, 0)
    })

    it('leaves later bytes on the connection to the TLS session instead of re-parsing them', async () => {
      const { raw } = startProbe()
      openTunnel(raw)

      raw.emit('data', Buffer.from('\x16\x03\x03 server hello'))
      raw.emit('data', Buffer.from('\r\n\r\n'))

      assert.equal(connections.tls.length, 1, 'exactly one TLS session is started')
    })
  })

  describe('response headers', () => {
    it('tolerates a header block of up to 32 KiB, and gives up beyond it', async () => {
      const { result, raw } = startProbe()
      const secure = openTunnel(raw)

      secure.emit('data', Buffer.alloc(32_768, 'H'))
      assert.equal(raw.destroyed, false)

      secure.emit('data', Buffer.from('H'))
      assert.equal(raw.destroyed, true)
      assert.deepEqual(await result, INCONCLUSIVE)
    })

    it('does not start decoding headers that arrive after the verdict', async () => {
      const { result, raw } = startProbe(1000)
      const secure = openTunnel(raw)
      mock.timers.tick(1000)
      assert.deepEqual(await result, INCONCLUSIVE)

      secure.emit('data', Buffer.from(responseHead('Content-Encoding: gzip') + 'ignored'))

      assert.equal(connections.gunzip.length, 0)
    })
  })

  describe('response body', () => {
    it('inspects up to 300,000 characters of the page, and gives up beyond that', async () => {
      const { result, raw } = startProbe()
      const secure = openTunnel(raw)

      secure.emit('data', Buffer.from(responseHead() + 'a'.repeat(300_000)))
      assert.equal(raw.destroyed, false)

      secure.emit('data', Buffer.from('a'))
      assert.equal(raw.destroyed, true)
      assert.deepEqual(await result, INCONCLUSIVE)
    })

    it('reads an unframed body that trickles in one byte at a time', async () => {
      assert.deepEqual(await runWith(Buffer.from(responseHead() + PAGE_TW), 1), VERDICT_TW)
    })

    it('follows a chunked body made of one-byte chunks', async () => {
      const body = chunked(...pieces(Buffer.from(PAGE_TW), 1))

      assert.deepEqual(await runWith(Buffer.concat([Buffer.from(CHUNKED), body])), VERDICT_TW)
    })

    it('uses a chunk that ends exactly where the received data ends', async () => {
      const { result, raw } = startProbe()
      const secure = openTunnel(raw)

      secure.emit('data', Buffer.concat([Buffer.from(CHUNKED), frame(Buffer.from(PAGE_TW))]))

      assert.equal(raw.destroyed, true, 'no further data is needed to read the last chunk')
      assert.deepEqual(await result, VERDICT_TW)
    })

    it('waits for the end of a chunk-size line that carries an extension', async () => {
      const { result, raw } = startProbe()
      const secure = openTunnel(raw)

      secure.emit('data', Buffer.from(CHUNKED + '1;na'))
      secure.emit('data', Buffer.from('me=v\r\n<\r\n'))
      secure.emit('data', chunked(Buffer.from(PAGE_TW.slice(1))))

      assert.equal(raw.destroyed, true)
      assert.deepEqual(await result, VERDICT_TW)
    })
  })
})
