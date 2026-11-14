// [INPUT] node:test mock.module · localProbeSocketsRig (POS: 本地探测通道套接字夹具) ·
//         sparkleGeminiStreamProbe::streamProbeGeminiRegionViaLocalListener (POS: Gemini 流式地区探测)
// [OUTPUT] loadProbe · connections · spyOnGunzip · startProbe/openTunnel/runWith/assertCleanedUp · 响应构造器
// [POS] streamProbeGeminiRegionViaLocalListener 测试夹具：在通用假套接字之上追加 gunzip 流追踪与 Gemini 响应构造器，不触网。

import { mock } from 'node:test'
import zlib from 'node:zlib'
import {
  connections as socketConnections,
  installFakeSockets,
  openTunnel,
  resetConnections as resetSocketConnections
} from './localProbeSocketsRig'
import type { FakeConnection } from './localProbeSocketsRig'
import type { streamProbeGeminiRegionViaLocalListener } from './sparkleGeminiStreamProbe'

export { assertCleanedUp, CONNECT_OK, flush, openTunnel } from './localProbeSocketsRig'

export type Probe = typeof streamProbeGeminiRegionViaLocalListener
export type ProbeResult = Awaited<ReturnType<Probe>>

export const connections = Object.assign(socketConnections, { gunzip: [] as zlib.Gunzip[] })

export function resetConnections(): void {
  resetSocketConnections()
  connections.gunzip.length = 0
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
  installFakeSockets()
  return (await import('./sparkleGeminiStreamProbe')).streamProbeGeminiRegionViaLocalListener
}

export const MARKER_TW = '"vXmutd":"%.@.\\"TW\\",\\"ZZ\\"]"'
export const MARKER_ZZ = '"vXmutd":"%.@.\\"ZZ\\",\\"ZZ\\"]"'
export const PAGE_TW = `<html><script>window.WIZ_global_data={${MARKER_TW}};</script></html>`
export const INCONCLUSIVE: ProbeResult = { definitive: false, eligible: true }
export const VERDICT_TW: ProbeResult = { definitive: true, eligible: true, countryCode: 'TW' }

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
