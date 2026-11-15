// [INPUT] App 持久化的服务鉴权密钥（~/Library/Application Support/sparkle/service-auth.json，SPARKLE_SERVICE_AUTH 可覆盖）·
//         sparkle-service 的 unix socket（/tmp/sparkle-service.sock，SPARKLE_SERVICE_SOCKET 可覆盖）
// [OUTPUT] serviceSocketPath · serviceAuthPath: 服务 socket 与鉴权文件的位置 · canonicalizeQuery · computeKeyId ·
//          buildCanonicalRequest · signServiceRequest: SPARKLE-AUTH-V2 规范串与签名 · loadServiceAuth ·
//          requestOverSocket: 经 unix socket 发 HTTP 请求（不签名）· callService: 带签名调用服务 ·
//          ServiceAuth · ServiceResponse · SigningClock · CanonicalRequestInput · SocketRequest · ServiceCall
// [POS] 脚本侧调用 sparkle-service 的唯一 SPARKLE-AUTH-V2 签名实现。规范串与 src/main/service/api.ts
// 逐字段一致（由 serviceSignedRequest.test.ts 用 App 自己的签名反向验证）；脚本不得各自再复制一份。

import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

export interface ServiceAuth {
  publicKey: string
  privateKey: string
  keyId?: string
}

export interface ServiceResponse {
  statusCode: number
  body: Buffer
}

/** 时间戳与 nonce 的来源，测试注入固定值以得到可复现的签名输入。 */
export interface SigningClock {
  now: () => number
  nonce: () => string
}

const REAL_CLOCK: SigningClock = {
  now: () => Date.now(),
  nonce: () => crypto.randomBytes(16).toString('base64url')
}

const DEFAULT_TIMEOUT_MS = 15_000

export function serviceSocketPath(): string {
  return process.env.SPARKLE_SERVICE_SOCKET ?? '/tmp/sparkle-service.sock'
}

export function serviceAuthPath(): string {
  return (
    process.env.SPARKLE_SERVICE_AUTH ??
    path.join(process.env.HOME ?? '', 'Library/Application Support/sparkle/service-auth.json')
  )
}

function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** 查询串按键、值排序后重新编码：签名两端必须对同一个请求得出同一个查询串。 */
export function canonicalizeQuery(search: string): string {
  const source = new URLSearchParams(search)
  const target = new URLSearchParams()
  for (const key of Array.from(new Set(source.keys())).sort()) {
    for (const value of source.getAll(key).sort()) {
      target.append(key, value)
    }
  }
  return target.toString()
}

export function computeKeyId(publicKeyBase64: string): string {
  return sha256Hex(Buffer.from(publicKeyBase64.trim(), 'base64'))
}

export interface CanonicalRequestInput {
  timestamp: string
  nonce: string
  keyId: string
  method: string
  pathWithQuery: string
  bodyHash: string
}

export function buildCanonicalRequest(input: CanonicalRequestInput): string {
  const url = new URL(input.pathWithQuery, 'http://localhost')
  return [
    'SPARKLE-AUTH-V2',
    input.timestamp,
    input.nonce,
    input.keyId,
    input.method.toUpperCase(),
    url.pathname || '/',
    canonicalizeQuery(url.search),
    input.bodyHash
  ].join('\n')
}

export function signServiceRequest(
  method: string,
  pathWithQuery: string,
  body: Buffer,
  auth: ServiceAuth,
  clock: SigningClock = REAL_CLOCK
): Record<string, string> {
  const bodyHash = sha256Hex(body)
  const timestamp = String(clock.now())
  const nonce = clock.nonce()
  const keyId = auth.keyId || computeKeyId(auth.publicKey)
  const canonical = buildCanonicalRequest({
    timestamp,
    nonce,
    keyId,
    method,
    pathWithQuery,
    bodyHash
  })
  const privateKey = crypto.createPrivateKey({ key: auth.privateKey, format: 'pem' })
  return {
    'X-Auth-Version': '2',
    'X-Key-Id': keyId,
    'X-Nonce': nonce,
    'X-Content-SHA256': bodyHash,
    'X-Timestamp': timestamp,
    'X-Signature': crypto.sign(null, Buffer.from(canonical), privateKey).toString('base64')
  }
}

export async function loadServiceAuth(authPath: string = serviceAuthPath()): Promise<ServiceAuth> {
  const raw = await readFile(authPath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<ServiceAuth>
  if (typeof parsed.publicKey !== 'string' || typeof parsed.privateKey !== 'string') {
    throw new Error(`service auth is missing publicKey/privateKey: ${authPath}`)
  }
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey, keyId: parsed.keyId }
}

export interface SocketRequest {
  socketPath: string
  method: string
  path: string
  headers?: Record<string, string>
  body?: Buffer
  timeoutMs?: number
}

export function requestOverSocket(request: SocketRequest): Promise<ServiceResponse> {
  const body = request.body ?? Buffer.alloc(0)
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: request.socketPath,
        path: request.path,
        method: request.method,
        headers: {
          Host: 'localhost',
          ...(body.length > 0 ? { 'Content-Length': String(body.length) } : {}),
          ...request.headers
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks) })
        )
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(
        new Error(`request timed out after ${timeoutMs}ms: ${request.method} ${request.path}`)
      )
    })
    req.end(body)
  })
}

export interface ServiceCall {
  method: string
  pathWithQuery: string
  body?: Buffer
  timeoutMs?: number
  socketPath?: string
  authPath?: string
}

/** 带签名调用一次 sparkle-service API；HTTP 状态码交给调用方判断。 */
export async function callService(call: ServiceCall): Promise<ServiceResponse> {
  const body = call.body ?? Buffer.alloc(0)
  const auth = await loadServiceAuth(call.authPath)
  const headers = signServiceRequest(call.method, call.pathWithQuery, body, auth)
  return requestOverSocket({
    socketPath: call.socketPath ?? serviceSocketPath(),
    method: call.method,
    path: call.pathWithQuery,
    headers: body.length > 0 ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body,
    timeoutMs: call.timeoutMs
  })
}
