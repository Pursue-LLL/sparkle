#!/usr/bin/env tsx
// [INPUT] scripts/lib/serviceSignedRequest.ts::callService / requestOverSocket (POS: 脚本侧调用 sparkle-service 的
//         唯一 SPARKLE-AUTH-V2 签名实现，以及无签名的 unix socket HTTP 请求) · 内核直连 socket
//         SPARKLE_MIHOMO_SOCKET · config.yaml 的 corePermissionMode · SPARKLE_MIHOMO_SMOKE_MODE
// [OUTPUT] 对一个不存在的连接 id 发 DELETE，证明关闭连接的请求能到达内核控制器（service 或直连）·
//          状态码 ≥ 500 或两条路径都不通时非零退出
// [POS] mihomo 关闭连接 API 的冒烟检查，装后检查里未就绪只告警。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  callService,
  requestOverSocket,
  serviceAuthPath,
  serviceSocketPath,
  type ServiceResponse
} from './lib/serviceSignedRequest'

const DIRECT_SOCKET = process.env.SPARKLE_MIHOMO_SOCKET ?? '/tmp/sparkle-mihomo-api.sock'
const SERVICE_SOCKET = serviceSocketPath()
const SERVICE_AUTH_PATH = serviceAuthPath()
const SPARKLE_CONFIG_PATH =
  process.env.SPARKLE_CONFIG ??
  path.join(process.env.HOME ?? '', 'Library/Application Support/sparkle/config.yaml')
const SMOKE_ID = 'sparkle-close-smoke-nonexistent'
const REQUEST_TIMEOUT_MS = 5000

interface HttpResult {
  statusCode: number
  body: string
}

function toHttpResult(response: ServiceResponse): HttpResult {
  return { statusCode: response.statusCode, body: response.body.toString('utf8') }
}

async function requestDirect(method: string, reqPath: string): Promise<HttpResult> {
  return toHttpResult(
    await requestOverSocket({
      socketPath: DIRECT_SOCKET,
      method,
      path: reqPath,
      timeoutMs: REQUEST_TIMEOUT_MS
    })
  )
}

async function requestService(method: string, reqPath: string): Promise<HttpResult> {
  return toHttpResult(
    await callService({
      method,
      pathWithQuery: reqPath,
      socketPath: SERVICE_SOCKET,
      authPath: SERVICE_AUTH_PATH,
      timeoutMs: REQUEST_TIMEOUT_MS
    })
  )
}

async function smokeViaDirect(): Promise<HttpResult> {
  const list = await requestDirect('GET', '/connections')
  if (list.statusCode < 200 || list.statusCode >= 500) {
    throw new Error(`GET /connections status=${list.statusCode}`)
  }
  return requestDirect('DELETE', `/connections/${encodeURIComponent(SMOKE_ID)}`)
}

async function smokeViaService(): Promise<HttpResult> {
  if (!existsSync(SERVICE_SOCKET)) {
    throw new Error(`service socket missing ${SERVICE_SOCKET}`)
  }
  if (!existsSync(SERVICE_AUTH_PATH)) {
    throw new Error(`service auth missing ${SERVICE_AUTH_PATH}`)
  }
  const listPath = '/core/controller/connections'
  const list = await requestService('GET', listPath)
  if (list.statusCode < 200 || list.statusCode >= 500) {
    throw new Error(`GET ${listPath} status=${list.statusCode}`)
  }
  return requestService('DELETE', `/core/controller/connections/${encodeURIComponent(SMOKE_ID)}`)
}

function prefersServiceControllerMode(): boolean {
  if (process.env.SPARKLE_MIHOMO_SMOKE_MODE === 'service') {
    return true
  }
  if (process.env.SPARKLE_MIHOMO_SMOKE_MODE === 'direct') {
    return false
  }
  if (!existsSync(SPARKLE_CONFIG_PATH)) {
    return existsSync(SERVICE_SOCKET)
  }
  const configText = readFileSync(SPARKLE_CONFIG_PATH, 'utf8')
  if (/corePermissionMode:\s*service/i.test(configText)) {
    return true
  }
  return existsSync(SERVICE_SOCKET) && !existsSync(DIRECT_SOCKET)
}

async function main(): Promise<void> {
  let del: HttpResult | null = null
  let mode = prefersServiceControllerMode() ? 'service' : 'direct'

  if (mode === 'service') {
    try {
      del = await smokeViaService()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[mihomo-close-smoke] service path failed (${msg}) — trying direct`)
      mode = 'direct'
    }
  }

  if (!del && mode === 'direct' && existsSync(DIRECT_SOCKET)) {
    try {
      del = await smokeViaDirect()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[mihomo-close-smoke] direct path failed (${msg}) — trying service proxy`)
      mode = 'service'
    }
  }

  if (!del) {
    del = await smokeViaService()
  }

  if (del.statusCode >= 500) {
    console.error(`[mihomo-close-smoke] FAIL: DELETE status=${del.statusCode} body=${del.body}`)
    process.exit(1)
  }
  console.log(`[mihomo-close-smoke] OK mode=${mode} status=${del.statusCode}`)
}

void main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[mihomo-close-smoke] FAIL: ${msg}`)
  process.exit(1)
})
