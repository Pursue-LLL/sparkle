#!/usr/bin/env tsx
/** Mihomo close API smoke — DELETE /connections/{id} must reach controller (direct or service mode). */
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const DIRECT_SOCKET = process.env.SPARKLE_MIHOMO_SOCKET ?? '/tmp/sparkle-mihomo-api.sock'
const SERVICE_SOCKET = process.env.SPARKLE_SERVICE_SOCKET ?? '/tmp/sparkle-service.sock'
const SERVICE_AUTH_PATH =
  process.env.SPARKLE_SERVICE_AUTH ??
  path.join(process.env.HOME ?? '', 'Library/Application Support/sparkle/service-auth.json')
const SPARKLE_CONFIG_PATH =
  process.env.SPARKLE_CONFIG ??
  path.join(process.env.HOME ?? '', 'Library/Application Support/sparkle/config.yaml')
const SMOKE_ID = 'sparkle-close-smoke-nonexistent'

interface HttpResult {
  statusCode: number
  body: string
}

interface ServiceAuth {
  privateKey: string
  publicKey: string
  keyId?: string
}

function request(
  socketPath: string,
  method: string,
  reqPath: string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: reqPath,
        method,
        headers: { Host: 'localhost', ...headers },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('mihomo close smoke timeout'))
    })
    req.end()
  })
}

function canonicalizeQuery(urlObj: URL): string {
  const source = new URLSearchParams(urlObj.search)
  const keys = Array.from(new Set(source.keys())).sort()
  const target = new URLSearchParams()
  for (const key of keys) {
    for (const value of source.getAll(key).sort()) {
      target.append(key, value)
    }
  }
  return target.toString()
}

function signServiceRequest(
  method: string,
  pathWithQuery: string,
  body: Buffer,
  auth: ServiceAuth,
): Record<string, string> {
  const urlObj = new URL(pathWithQuery, 'http://localhost')
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex')
  const timestamp = Date.now().toString()
  const nonce = crypto.randomBytes(16).toString('base64url')
  const keyId = auth.keyId ?? crypto.createHash('sha256').update(Buffer.from(auth.publicKey, 'base64')).digest('hex')
  const canonical = [
    'SPARKLE-AUTH-V2',
    timestamp,
    nonce,
    keyId,
    method.toUpperCase(),
    urlObj.pathname || '/',
    canonicalizeQuery(urlObj),
    bodyHash,
  ].join('\n')
  const keyObject = crypto.createPrivateKey({ key: auth.privateKey, format: 'pem' })
  const signature = crypto.sign(null, Buffer.from(canonical), keyObject).toString('base64')
  return {
    'X-Auth-Version': '2',
    'X-Key-Id': keyId,
    'X-Nonce': nonce,
    'X-Content-SHA256': bodyHash,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  }
}

async function smokeViaDirect(): Promise<HttpResult> {
  const list = await request(DIRECT_SOCKET, 'GET', '/connections')
  if (list.statusCode < 200 || list.statusCode >= 500) {
    throw new Error(`GET /connections status=${list.statusCode}`)
  }
  return request(DIRECT_SOCKET, 'DELETE', `/connections/${encodeURIComponent(SMOKE_ID)}`)
}

async function smokeViaService(): Promise<HttpResult> {
  if (!existsSync(SERVICE_SOCKET)) {
    throw new Error(`service socket missing ${SERVICE_SOCKET}`)
  }
  if (!existsSync(SERVICE_AUTH_PATH)) {
    throw new Error(`service auth missing ${SERVICE_AUTH_PATH}`)
  }
  const auth = JSON.parse(readFileSync(SERVICE_AUTH_PATH, 'utf8')) as ServiceAuth
  const listPath = '/core/controller/connections'
  const listHeaders = signServiceRequest('GET', listPath, Buffer.alloc(0), auth)
  const list = await request(SERVICE_SOCKET, 'GET', listPath, listHeaders)
  if (list.statusCode < 200 || list.statusCode >= 500) {
    throw new Error(`GET ${listPath} status=${list.statusCode}`)
  }
  const delPath = `/core/controller/connections/${encodeURIComponent(SMOKE_ID)}`
  const delHeaders = signServiceRequest('DELETE', delPath, Buffer.alloc(0), auth)
  return request(SERVICE_SOCKET, 'DELETE', delPath, delHeaders)
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
