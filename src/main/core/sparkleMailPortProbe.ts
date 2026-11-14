// [INPUT] localProbeTunnel::openLocalProbeTunnel (POS: 本地隐藏探测监听器传输层) ·
//         localProbeChannel::withLocalProbeChannelLock (POS: 本地隐藏探测监听器串行化入口) · 目标邮件端口
// [OUTPUT] probeSingleNodeMailPorts
// [POS] 邮件 993/465 的 TLS Banner 校验：经共享本地探测通道实测单节点收发件两个端口；端口失败返回 false，通道异常抛出。

import { performance } from 'node:perf_hooks'
import { withLocalProbeChannelLock } from './localProbeChannel'
import { openLocalProbeTunnel } from './localProbeTunnel'

const PORT_PROBE_TIMEOUT_MS = 3500

const IMAP_HOST = 'imap.gmail.com'
const IMAP_PORT = 993
const IMAP_BANNER_PREFIX = '* OK'

const SMTP_HOST = 'smtp.gmail.com'
const SMTP_PORT = 465
const SMTP_BANNER_PREFIX = '220'

/** 经本地探测通道对目标邮件端口完成 CONNECT + TLS 握手，并校验服务端首行协议 Banner。 */
function probeTlsBannerViaLocalListener(
  host: string,
  port: number,
  expectedBannerPrefix: string,
  timeoutMs: number = PORT_PROBE_TIMEOUT_MS
): Promise<{ ok: boolean; rttMs: number }> {
  return new Promise((resolve) => {
    const startMs = performance.now()
    let settled = false

    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      tunnel.destroy()
      resolve({ ok, rttMs: Math.max(1, Math.round(performance.now() - startMs)) })
    }

    const tunnel = openLocalProbeTunnel({
      host,
      port,
      onFailure: () => finish(false),
      onSecure: (socket) => {
        socket.once('data', (bannerChunk: Buffer) => {
          finish(bannerChunk.toString('utf8').trim().startsWith(expectedBannerPrefix))
        })
      }
    })

    // 先建隧道再起定时器：隧道创建同步抛错时，不会留下一个去访问未初始化 tunnel 的悬空定时器。
    const timer = setTimeout(() => finish(false), timeoutMs)
  })
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
