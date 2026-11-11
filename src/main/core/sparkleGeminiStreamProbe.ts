// [INPUT] sparkleMailProviderCore::MAIL_PROBE_LISTENER_PORT (POS: 本地隐藏探测监听端口) ·
//         sparkleGeminiProbeCore::evaluateGeminiHtmlEligibility (POS: Gemini 地区判定纯逻辑)
// [OUTPUT] streamProbeGeminiRegionViaLocalListener
// [POS] 经本地隐藏探测监听器对 gemini.google.com 发起流式 GET，只识别 Google GeoIP 地区标记；
// 不含缓存、节点选择与 provider 重建（见 sparkleGeminiProbe）。

import net from 'node:net'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { evaluateGeminiHtmlEligibility } from './sparkleGeminiProbeCore'
import { MAIL_PROBE_LISTENER_PORT } from './sparkleMailProviderCore'

const STREAM_PROBE_TIMEOUT_MS = 5000
const MAX_INSPECTED_HTML_CHARS = 300_000

const GEMINI_HOST = 'gemini.google.com'
const GEMINI_PORT = 443

/**
 * 通过本地隐藏探测监听器 `127.0.0.1:17899` 对 `gemini.google.com:443` 发起带 gzip 的流式 HTTP/1.1 GET 请求，
 * 一旦在解压后的前 ~130KB HTML 中识别到 `vXmutd` 地区码或 `www.google.cn` 即刻断开连接返回结果。
 * 若发生网络超时或连接中断且尚未读到地区标记，返回 `definitive: false`，绝不将网络抖动误判为锁区。
 */
export function streamProbeGeminiRegionViaLocalListener(
  timeoutMs: number = STREAM_PROBE_TIMEOUT_MS
): Promise<{ definitive: boolean; eligible: boolean; countryCode?: string }> {
  return new Promise((resolve) => {
    let settled = false
    let rawSocket: net.Socket | null = null
    let tlsSocket: tls.TLSSocket | null = null
    let gunzip: zlib.Gunzip | null = null

    const finish = (res: {
      definitive: boolean
      eligible: boolean
      countryCode?: string
    }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        gunzip?.destroy()
      } catch {
        // ignore cleanup error
      }
      try {
        tlsSocket?.destroy()
      } catch {
        // ignore cleanup error
      }
      try {
        rawSocket?.destroy()
      } catch {
        // ignore cleanup error
      }
      resolve(res)
    }

    const timer = setTimeout(() => finish({ definitive: false, eligible: true }), timeoutMs)

    rawSocket = net.connect(MAIL_PROBE_LISTENER_PORT, '127.0.0.1')
    rawSocket.once('error', () => finish({ definitive: false, eligible: true }))
    rawSocket.once('connect', () => {
      rawSocket?.write(
        `CONNECT ${GEMINI_HOST}:${GEMINI_PORT} HTTP/1.1\r\nHost: ${GEMINI_HOST}:${GEMINI_PORT}\r\n\r\n`
      )
      let connectBuf = ''
      const onConnectData = (chunk: Buffer): void => {
        connectBuf += chunk.toString('utf8')
        if (!connectBuf.includes('\r\n\r\n')) {
          if (connectBuf.length > 2048) {
            finish({ definitive: false, eligible: true })
          }
          return
        }
        rawSocket?.removeListener('data', onConnectData)
        const statusLine = connectBuf.slice(0, connectBuf.indexOf('\r\n'))
        if (!statusLine.includes(' 200 ')) {
          finish({ definitive: false, eligible: true })
          return
        }

        tlsSocket = tls.connect({
          socket: rawSocket!,
          servername: GEMINI_HOST,
          ALPNProtocols: ['http/1.1'],
          rejectUnauthorized: true
        })
        tlsSocket.once('error', () => finish({ definitive: false, eligible: true }))
        tlsSocket.once('secureConnect', () => {
          tlsSocket?.write(
            `GET /app HTTP/1.1\r\n` +
              `Host: ${GEMINI_HOST}\r\n` +
              `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\n` +
              `Accept: text/html\r\n` +
              `Accept-Encoding: gzip\r\n` +
              `Connection: close\r\n\r\n`
          )

          let headerBuf = Buffer.alloc(0)
          let headerParsed = false
          let isChunked = false
          let chunkRemainder = Buffer.alloc(0)
          let htmlPrefix = ''

          const inspectHtmlChunk = (text: string): void => {
            if (settled) return
            htmlPrefix += text
            const evalRes = evaluateGeminiHtmlEligibility(htmlPrefix)
            if (evalRes.settled) {
              finish({
                definitive: true,
                eligible: evalRes.eligible,
                countryCode: evalRes.countryCode
              })
              return
            }
            if (htmlPrefix.length > MAX_INSPECTED_HTML_CHARS) {
              finish({ definitive: false, eligible: true })
            }
          }

          const feedBodyPayload = (payload: Buffer): void => {
            if (settled || payload.length === 0) return
            if (gunzip) {
              gunzip.write(payload)
            } else {
              inspectHtmlChunk(payload.toString('utf8'))
            }
          }

          const feedRawBody = (buf: Buffer): void => {
            if (settled || buf.length === 0) return
            if (!isChunked) {
              feedBodyPayload(buf)
              return
            }
            chunkRemainder = Buffer.concat([chunkRemainder, buf])
            while (chunkRemainder.length > 0) {
              if (settled) break
              const lineEnd = chunkRemainder.indexOf('\r\n')
              if (lineEnd === -1) break
              const sizeHex = chunkRemainder
                .subarray(0, lineEnd)
                .toString('ascii')
                .split(';')[0]
                .trim()
              const size = Number.parseInt(sizeHex, 16)
              if (Number.isNaN(size) || size === 0) break
              if (chunkRemainder.length < lineEnd + 2 + size + 2) break
              const payload = chunkRemainder.subarray(lineEnd + 2, lineEnd + 2 + size)
              chunkRemainder = chunkRemainder.subarray(lineEnd + 2 + size + 2)
              feedBodyPayload(payload)
            }
          }

          tlsSocket?.on('data', (chunk: Buffer) => {
            if (settled) return
            if (!headerParsed) {
              headerBuf = Buffer.concat([headerBuf, chunk])
              const headerEnd = headerBuf.indexOf('\r\n\r\n')
              if (headerEnd === -1) {
                if (headerBuf.length > 32_768) {
                  finish({ definitive: false, eligible: true })
                }
                return
              }
              headerParsed = true
              const headerStr = headerBuf.subarray(0, headerEnd).toString('utf8')
              const firstLine = headerStr.slice(0, headerStr.indexOf('\r\n'))
              if (!firstLine.includes(' 200')) {
                finish({ definitive: false, eligible: true })
                return
              }
              isChunked = /transfer-encoding:\s*chunked/i.test(headerStr)
              const isGzip = /content-encoding:\s*gzip/i.test(headerStr)
              if (isGzip) {
                gunzip = zlib.createGunzip()
                gunzip.on('error', () => {
                  // ignore trailing gunzip error on early socket close
                })
                gunzip.on('data', (decompressed: Buffer) => {
                  inspectHtmlChunk(decompressed.toString('utf8'))
                })
              }
              const bodyStart = headerBuf.subarray(headerEnd + 4)
              headerBuf = Buffer.alloc(0)
              feedRawBody(bodyStart)
            } else {
              feedRawBody(chunk)
            }
          })

          tlsSocket?.once('end', () => finish({ definitive: false, eligible: true }))
        })
      }
      rawSocket?.on('data', onConnectData)
    })
  })
}
