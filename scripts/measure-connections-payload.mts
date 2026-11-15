/**
 * 只读测量：真实拉取 mihomo connections 负载，量出体积与 JSON.parse 成本。
 *
 * 为什么需要真实测量：`mihomoStreams.ts` 在内核启动时就常驻 `/connections?interval=500`，
 * 每秒两次对全量 JSON 做 `JSON.parse` 再 IPC 转发。它到底花多少主线程时间，
 * 取决于连接数量与单条记录大小——必须用当前订阅下的真实数据量出来，不能靠推测。
 *
 * 本脚本只做 GET，不修改任何配置或连接。
 */
import { callService } from './lib/serviceSignedRequest'

const CONNECTIONS_PATH = '/core/controller/connections'

async function main(): Promise<void> {
  const response = await callService({
    method: 'GET',
    pathWithQuery: CONNECTIONS_PATH,
    timeoutMs: 15_000
  })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET ${CONNECTIONS_PATH} status=${response.statusCode}`)
  }

  const raw = response.body
  const text = raw.toString('utf8')
  const payload = JSON.parse(text) as {
    downloadTotal?: number
    uploadTotal?: number
    connections?: unknown[]
  }
  const count = payload.connections?.length ?? 0

  // 测量真实 JSON.parse 成本（取 200 次中位数，排除 GC 抖动）
  const samples: number[] = []
  for (let i = 0; i < 200; i++) {
    const start = process.hrtime.bigint()
    const parsed = JSON.parse(text) as { connections?: unknown[] }
    const end = process.hrtime.bigint()
    // 防优化：真的读一下结果
    if (!parsed.connections) throw new Error('unexpected payload shape')
    samples.push(Number(end - start) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]
  const p95 = samples[Math.floor(samples.length * 0.95)]

  // 单条记录平均体积
  const perConnection = count > 0 ? Math.round(raw.length / count) : 0

  console.log(
    JSON.stringify(
      {
        connections: count,
        payloadBytes: raw.length,
        payloadKiB: Number((raw.length / 1024).toFixed(1)),
        bytesPerConnection: perConnection,
        parseMedianMs: Number(median.toFixed(3)),
        parseP95Ms: Number(p95.toFixed(3)),
        // 500ms 间隔 => 每秒 2 次；常驻占用 = 2 * parse
        steadyCpuMsPerSec: Number((median * 2).toFixed(2)),
        steadyCpuPercentOfOneCore: Number(((median * 2) / 10).toFixed(2))
      },
      null,
      2
    )
  )
}

void main().catch((error) => {
  console.error(
    '[measure-connections] FAIL:',
    error instanceof Error ? error.message : String(error)
  )
  process.exit(1)
})
