// [INPUT] magpie 本地网关 127.0.0.1:3425（持有 Antigravity 账号凭证）
// [OUTPUT] MagpieResponse · requestMagpie · discoverAgyModel
// [POS] agy 探测用的最小 magpie HTTP 客户端：只负责发请求/读模型列表，不做任何节点归因判断。
// 为什么必须借 magpie：cloudcode-pa 的地域校验发生在认证之后，无凭证请求只会拿到 401，
// 无法区分「地区被拒」与「未认证」（已实测）。

import http from 'node:http'

const MAGPIE_BASE_URL = 'http://127.0.0.1:3425'
const MAGPIE_API_KEY = 'magpie'
const MAGPIE_MODEL_PREFIX = 'antigravity/'
const DEFAULT_TIMEOUT_MS = 20_000

export type MagpieResponse =
  | { kind: 'response'; status: number; body: string }
  /** 本地网关没起来（magpie 未启动）——继续测没有任何意义。 */
  | { kind: 'unreachable' }
  /** 单个节点的请求超时——只代表这个节点慢，不代表必须中止整轮巡检。 */
  | { kind: 'timeout' }

export function requestMagpie(
  urlPath: string,
  payload?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<MagpieResponse> {
  return new Promise((resolve) => {
    const url = new URL(`${MAGPIE_BASE_URL}${urlPath}`)
    const body = payload === undefined ? undefined : JSON.stringify(payload)
    let settled = false
    const timeoutState: { timer?: NodeJS.Timeout } = {}

    const finish = (value: MagpieResponse): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutState.timer) {
        clearTimeout(timeoutState.timer)
      }
      resolve(value)
    }

    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${MAGPIE_API_KEY}`,
          'content-length': String(Buffer.byteLength(body ?? ''))
        }
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          // 只需要看得到错误信息，正文超长时截断避免占内存。
          if (text.length < 8192) {
            text += chunk.slice(0, 8192 - text.length)
          }
        })
        response.on('end', () =>
          finish({ kind: 'response', status: response.statusCode ?? 0, body: text })
        )
        response.on('error', () => finish({ kind: 'unreachable' }))
      }
    )

    timeoutState.timer = setTimeout(() => {
      request.destroy()
      finish({ kind: 'timeout' })
    }, timeoutMs)

    request.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND'
          ? { kind: 'unreachable' }
          : { kind: 'timeout' }
      )
    })

    if (body !== undefined) {
      request.write(body)
    }
    request.end()
  })
}

/** 从 magpie 的 OpenAI 兼容接口里挑一个 antigravity 模型（优先最便宜的 flash）。 */
export async function discoverAgyModel(): Promise<string | null> {
  const response = await requestMagpie('/v1/models', undefined, 5000)
  if (response.kind !== 'response' || response.status !== 200) {
    return null
  }
  try {
    const parsed = JSON.parse(response.body) as { data?: Array<{ id?: string }> }
    const ids = (parsed.data ?? [])
      .map((model) => String(model.id ?? '').trim())
      .filter((id) => id.startsWith(MAGPIE_MODEL_PREFIX))
    return ids.find((id) => id.includes('flash')) ?? ids[0] ?? null
  } catch {
    return null
  }
}
