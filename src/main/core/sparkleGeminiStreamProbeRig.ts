// [INPUT] node:test mock.module · node:net / node:tls 的假连接
// [OUTPUT] loadProbe · connections · FakeConnection · spyOnGunzip · startProbe/openTunnel/runWith/assertCleanedUp · 响应构造器
// [POS] streamProbeGeminiRegionViaLocalListener 测试夹具：用可手动触发事件的假套接字替换 net / tls，不触网。

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'node:test'
import zlib from 'node:zlib'
import type { streamProbeGeminiRegionViaLocalListener } from './sparkleGeminiStreamProbe'

export type Probe = typeof streamProbeGeminiRegionViaLocalListener
export type ProbeResult = Awaited<ReturnType<Probe>>

export class FakeConnection extends EventEmitter {
  written: string[] = []
  destroyed = false
  destroyCalls = 0
  destroyError: Error | undefined

  write(data: string | Buffer): boolean {
    this.written.push(String(data))
    return true
  }

  destroy(): this {
    this.destroyed = true
    this.destroyCalls += 1
    if (this.destroyError) {
      throw this.destroyError
    }
    return this
  }
}

export const connections = {
  raw: [] as FakeConnection[],
  tls: [] as FakeConnection[],
  rawTargets: [] as unknown[][],
  tlsOptions: [] as Record<string, unknown>[],
  gunzip: [] as zlib.Gunzip[],
  destroyError: undefined as Error | undefined
}

export function resetConnections(): void {
  connections.raw.length = 0
  connections.tls.length = 0
  connections.rawTargets.length = 0
  connections.tlsOptions.length = 0
  connections.gunzip.length = 0
  connections.destroyError = undefined
}

function track(list: FakeConnection[]): FakeConnection {
  const connection = new FakeConnection()
  connection.destroyError = connections.destroyError
  list.push(connection)
  return connection
}

/** 记录探测方创建的每个 gunzip 流，便于断言其生命周期；返回还原函数。 */
export function spyOnGunzip(): () => void {
  const createGunzip = zlib.createGunzip
  const spy = mock.method(zlib, 'createGunzip', (options?: zlib.ZlibOptions): zlib.Gunzip => {
    const stream = createGunzip(options)
    connections.gunzip.push(stream)
    return stream
  })
  return () => spy.mock.restore()
}

/** 替换 net / tls 后再加载被测模块（模块在加载时绑定 net / tls）。 */
export async function loadProbe(): Promise<Probe> {
  const fakeNet = {
    connect: (...args: unknown[]): FakeConnection => {
      connections.rawTargets.push(args)
      return track(connections.raw)
    }
  }
  const fakeTls = {
    connect: (options: Record<string, unknown>): FakeConnection => {
      connections.tlsOptions.push(options)
      return track(connections.tls)
    }
  }
  mock.module('node:net', { exports: { default: fakeNet, ...fakeNet } })
  mock.module('node:tls', { exports: { default: fakeTls, ...fakeTls } })
  return (await import('./sparkleGeminiStreamProbe')).streamProbeGeminiRegionViaLocalListener
}

export const CONNECT_OK = 'HTTP/1.1 200 Connection established\r\n\r\n'
export const MARKER_TW = '"vXmutd":"%.@.\\"TW\\",\\"ZZ\\"]"'
export const MARKER_ZZ = '"vXmutd":"%.@.\\"ZZ\\",\\"ZZ\\"]"'
export const PAGE_TW = `<html><script>window.WIZ_global_data={${MARKER_TW}};</script></html>`
export const INCONCLUSIVE: ProbeResult = { definitive: false, eligible: true }
export const VERDICT_TW: ProbeResult = { definitive: true, eligible: true, countryCode: 'TW' }

export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export function responseHead(...headers: string[]): string {
  return ['HTTP/1.1 200 OK', 'Content-Type: text/html', ...headers].join('\r\n') + '\r\n\r\n'
}

/** 一个分块传输帧：`<十六进制长度>\r\n<数据>\r\n`。 */
export function frame(part: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${part.length.toString(16)}\r\n`), part, Buffer.from('\r\n')])
}

/** 完整分块正文，以终止块 `0\r\n\r\n` 收尾。 */
export function chunked(...parts: Buffer[]): Buffer {
  return Buffer.concat([...parts.map(frame), Buffer.from('0\r\n\r\n')])
}

export function pieces(data: Buffer, size: number): Buffer[] {
  const result: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += size) {
    result.push(data.subarray(offset, offset + size))
  }
  return result
}

/** 发起探测，并让到本地监听器的连接建立（探测方随即发出 CONNECT）。 */
export function startProbe(
  probe: Probe,
  timeoutMs?: number
): { result: Promise<ProbeResult>; raw: FakeConnection } {
  const result = probe(timeoutMs)
  const raw = connections.raw[0]
  raw.emit('connect')
  return { result, raw }
}

/** 本地监听器接受隧道，TLS 握手完成。 */
export function openTunnel(raw: FakeConnection): FakeConnection {
  raw.emit('data', Buffer.from(CONNECT_OK))
  const secure = connections.tls[0]
  secure.emit('secureConnect')
  return secure
}

export async function runWith(
  probe: Probe,
  response: Buffer,
  pieceSize = response.length
): Promise<ProbeResult> {
  const { result, raw } = startProbe(probe)
  const secure = openTunnel(raw)
  for (const piece of pieces(response, pieceSize)) {
    secure.emit('data', piece)
  }
  return result
}

export function assertCleanedUp(): void {
  assert.ok(connections.raw[0].destroyed, 'raw socket destroyed')
  for (const secure of connections.tls) {
    assert.ok(secure.destroyed, 'tls socket destroyed')
  }
}
