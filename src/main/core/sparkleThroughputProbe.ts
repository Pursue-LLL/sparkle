// [INPUT] localProbeTunnel::openLocalProbeTunnel (POS: 本地隐藏探测监听器传输层) ·
//         localProbeChannel::withLocalProbeChannelLock (POS: 本地隐藏探测监听器串行化入口) ·
//         sparkleNodeQualityCore::ThroughputReading (POS: 节点质量闸门纯决策层)
// [OUTPUT] measureNodeThroughput · GOOGLE_TARGET · CONTROL_TARGET · ThroughputTarget
// [POS] 单节点下载吞吐实测：经共享本地探测通道（隐藏组固定在被测节点）向目标发 HTTP Range 请求，只取前 128 KiB，
// 以「首个数据块之后的耗时」折算 KB/s（与 curl 的 size_download / (time_total - time_starttransfer) 同口径）。
// 流量固定在 128 KiB 以内；这是 mihomo 存活探测（握手/204 延迟）看不到的维度。
// 只汇报读数，不做判断（阈值与裁决在 sparkleNodeQualityCore）。

import { performance } from 'node:perf_hooks'
import { withLocalProbeChannelLock } from './localProbeChannel'
import { openLocalProbeTunnel } from './localProbeTunnel'
import type { ThroughputReading } from './sparkleNodeQualityCore'

export interface ThroughputTarget {
  host: string
  path: string
}

/** 主目标：Chrome 官方安装包。dl.google.com 与用户访问 Google 走同一类出口，且长期稳定、支持 Range。 */
export const GOOGLE_TARGET: ThroughputTarget = {
  host: 'dl.google.com',
  path: '/linux/direct/google-chrome-stable_current_amd64.deb'
}

/** 对照目标：与 Google 无关的 CDN，用来排除主目标上的偶然读数。 */
export const CONTROL_TARGET: ThroughputTarget = {
  host: 'cdn.jsdelivr.net',
  path: '/npm/typescript@5.4.5/lib/typescript.js'
}

const TARGET_PORT = 443
const SAMPLE_BYTES = 128 * 1024
const PROBE_TIMEOUT_MS = 5000
const MAX_RESPONSE_HEAD_BYTES = 32 * 1024

/** 读数上限：数据在一两个包里到齐时耗时趋近于 0，折算出的速率没有意义。 */
const RATE_CAP_KBPS = 2000

/**
 * 没读满样本就收尾（超时 / 对端提前关闭）时，从首个数据块起至少要观察这么久才折算速率；
 * 窗口太短的零星字节算不出吞吐，首包到得这么晚本身就说明这条线路不可用。
 */
const MIN_SAMPLE_WINDOW_MS = 1000

const FAILED: ThroughputReading = { kind: 'failed' }

const HTTP_OK_STATUS = /^HTTP\/1\.[01] (200|206)\b/

function downloadSample(target: ThroughputTarget): Promise<ThroughputReading> {
  return new Promise((resolve) => {
    let settled = false
    let head = Buffer.alloc(0)
    let headParsed = false
    let bodyBytes = 0
    let firstChunkAtMs: number | undefined

    const observedMs = (): number =>
      firstChunkAtMs === undefined ? 0 : performance.now() - firstChunkAtMs
    const reading = (): ThroughputReading => ({
      kind: 'measured',
      kbps: Math.min(bodyBytes / 1024 / (Math.max(observedMs(), 1) / 1000), RATE_CAP_KBPS)
    })
    const partialReading = (): ThroughputReading =>
      bodyBytes > 0 && observedMs() >= MIN_SAMPLE_WINDOW_MS ? reading() : FAILED

    const finish = (result: ThroughputReading): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      tunnel.destroy()
      resolve(result)
    }

    const tunnel = openLocalProbeTunnel({
      host: target.host,
      port: TARGET_PORT,
      alpnProtocols: ['http/1.1'],
      onFailure: (failure) => finish(failure === 'listener' ? { kind: 'unavailable' } : FAILED),
      onSecure: (socket) => {
        socket.write(
          `GET ${target.path} HTTP/1.1\r\n` +
            `Host: ${target.host}\r\n` +
            `Range: bytes=0-${SAMPLE_BYTES - 1}\r\n` +
            `Accept-Encoding: identity\r\n` +
            `User-Agent: Mozilla/5.0\r\n` +
            `Connection: close\r\n\r\n`
        )
        socket.on('data', (chunk: Buffer) => {
          firstChunkAtMs ??= performance.now()
          if (headParsed) {
            bodyBytes += chunk.length
          } else {
            head = Buffer.concat([head, chunk])
            const headEnd = head.indexOf('\r\n\r\n')
            if (headEnd === -1) {
              if (head.length > MAX_RESPONSE_HEAD_BYTES) {
                finish(FAILED)
              }
              return
            }
            if (!HTTP_OK_STATUS.test(head.subarray(0, head.indexOf('\r\n')).toString('ascii'))) {
              finish(FAILED)
              return
            }
            headParsed = true
            bodyBytes = head.length - (headEnd + 4)
          }
          if (bodyBytes >= SAMPLE_BYTES) {
            finish(reading())
          }
        })
        socket.once('end', () => finish(partialReading()))
      }
    })

    const timer = setTimeout(() => finish(partialReading()), PROBE_TIMEOUT_MS)
  })
}

/**
 * 实测单个节点到目标的下载吞吐。
 * 隧道建立后的失败（超时无数据、连接被重置、响应状态异常）是节点的证据，读数为 `failed`；
 * 监听器不可达或切换隐藏组节点失败属于本机探测设施问题，读数为 `unavailable`，调用方不得当作节点故障。
 */
export async function measureNodeThroughput(
  nodeName: string,
  target: ThroughputTarget
): Promise<ThroughputReading> {
  try {
    return await withLocalProbeChannelLock(nodeName, () => downloadSample(target))
  } catch {
    return { kind: 'unavailable' }
  }
}
