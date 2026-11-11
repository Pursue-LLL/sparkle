// [INPUT] mihomoApi::mihomoChangeProxy (POS: mihomo 控制器访问层) · 本地隐藏探测监听器 127.0.0.1:17899 (__sparkle_mail_probe__) · 目标邮件端口
// [OUTPUT] withLocalProbeChannelLock · probeSingleNodeMailPorts
// [POS] 邮件 993/465 与 Gemini 地区探测共用的本地探测通道：串行切换隐藏组节点并做 TLS Banner 校验；端口失败返回 false，通道异常抛出。

import net from 'node:net'
import tls from 'node:tls'
import { performance } from 'node:perf_hooks'
import { MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import { mihomoChangeProxy } from './mihomoApi'
import { MAIL_PROBE_LISTENER_PORT } from './sparkleMailProviderCore'

const PORT_PROBE_TIMEOUT_MS = 3500

const IMAP_HOST = 'imap.gmail.com'
const IMAP_PORT = 993
const IMAP_BANNER_PREFIX = '* OK'

const SMTP_HOST = 'smtp.gmail.com'
const SMTP_PORT = 465
const SMTP_BANNER_PREFIX = '220'

/** 通过本地隐藏探测监听器 `127.0.0.1:17899` 对目标邮件端口执行 HTTP CONNECT + TLS 握手 + 首行协议 Banner 校验。 */
function probeTlsBannerViaLocalListener(
  host: string,
  port: number,
  expectedBannerPrefix: string,
  timeoutMs: number = PORT_PROBE_TIMEOUT_MS
): Promise<{ ok: boolean; rttMs: number }> {
  return new Promise((resolve) => {
    const startMs = performance.now()
    let settled = false
    let rawSocket: net.Socket | null = null
    let tlsSocket: tls.TLSSocket | null = null

    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        tlsSocket?.destroy()
      } catch {
        // ignore socket cleanup errors
      }
      try {
        rawSocket?.destroy()
      } catch {
        // ignore socket cleanup errors
      }
      resolve({ ok, rttMs: Math.max(1, Math.round(performance.now() - startMs)) })
    }

    const timer = setTimeout(() => finish(false), timeoutMs)

    rawSocket = net.connect(MAIL_PROBE_LISTENER_PORT, '127.0.0.1')
    rawSocket.once('error', () => finish(false))
    rawSocket.once('connect', () => {
      rawSocket?.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
      let connectBuf = ''
      const onConnectData = (chunk: Buffer): void => {
        connectBuf += chunk.toString('utf8')
        const headerEnd = connectBuf.indexOf('\r\n\r\n')
        if (headerEnd === -1) {
          if (connectBuf.length > 2048) finish(false)
          return
        }
        rawSocket?.removeListener('data', onConnectData)
        const statusLine = connectBuf.slice(0, connectBuf.indexOf('\r\n'))
        if (!statusLine.includes(' 200 ')) {
          finish(false)
          return
        }

        tlsSocket = tls.connect({
          socket: rawSocket!,
          servername: host,
          rejectUnauthorized: true
        })
        tlsSocket.once('error', () => finish(false))
        tlsSocket.once('data', (bannerChunk: Buffer) => {
          const banner = bannerChunk.toString('utf8').trim()
          finish(banner.startsWith(expectedBannerPrefix))
        })
      }
      rawSocket?.on('data', onConnectData)
    })
  })
}

let probeChannelTail: Promise<void> = Promise.resolve()

/**
 * 进程级互斥锁：本地隐藏探测监听器 `127.0.0.1:17899`（`__sparkle_mail_probe__`）为单通道，
 * 邮件端口探测与 Gemini 地区内容探测共享该通道时必须串行切换节点，防止并发串台。
 */
export async function withLocalProbeChannelLock<T>(
  nodeName: string,
  task: () => Promise<T>
): Promise<T> {
  const prev = probeChannelTail
  let release!: () => void
  probeChannelTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    await mihomoChangeProxy(MAIL_PROBE_HIDDEN_GROUP_NAME, nodeName)
    return await task()
  } finally {
    release()
  }
}

/**
 * 实测单个节点的 `imap.gmail.com:993`（收件）与 `smtp.gmail.com:465`（发件）是否双通。
 * 端口/Banner 失败返回 `alive:false`；探测通道或 mihomo API 异常会抛出，调用方不得把异常当成节点死亡。
 */
export async function probeSingleNodeMailPorts(
  nodeName: string
): Promise<{ alive: boolean; rttMs: number }> {
  return await withLocalProbeChannelLock(nodeName, async () => {
    const imapRes = await probeTlsBannerViaLocalListener(IMAP_HOST, IMAP_PORT, IMAP_BANNER_PREFIX)
    if (!imapRes.ok) {
      return { alive: false, rttMs: 0 }
    }

    const smtpRes = await probeTlsBannerViaLocalListener(SMTP_HOST, SMTP_PORT, SMTP_BANNER_PREFIX)
    if (!smtpRes.ok) {
      return { alive: false, rttMs: 0 }
    }

    return {
      alive: true,
      rttMs: Math.round((imapRes.rttMs + smtpRes.rttMs) / 2)
    }
  })
}
