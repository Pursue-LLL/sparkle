/** Read-only mihomo controller access via direct or Sparkle service unix socket. */
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const DIRECT_SOCKET = process.env.SPARKLE_MIHOMO_SOCKET ?? '/tmp/sparkle-mihomo-api.sock'
const SERVICE_SOCKET = process.env.SPARKLE_SERVICE_SOCKET ?? '/tmp/sparkle-service.sock'
const SERVICE_AUTH_PATH =
  process.env.SPARKLE_SERVICE_AUTH ??
  path.join(process.env.HOME ?? '', 'Library/Application Support/sparkle/service-auth.json')

export interface MihomoHttpResult {
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
): Promise<MihomoHttpResult> {
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
    req.on('timeout', () => req.destroy(new Error('mihomo request timeout')))
    req.end()
  })
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
  const keyId =
    auth.keyId ?? crypto.createHash('sha256').update(Buffer.from(auth.publicKey, 'base64')).digest('hex')
  const canonical = [
    'SPARKLE-AUTH-V2',
    timestamp,
    nonce,
    keyId,
    method.toUpperCase(),
    urlObj.pathname || '/',
    '',
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

async function requestDirect(method: string, reqPath: string): Promise<MihomoHttpResult> {
  return request(DIRECT_SOCKET, method, reqPath)
}

async function requestService(method: string, reqPath: string): Promise<MihomoHttpResult> {
  if (!existsSync(SERVICE_SOCKET) || !existsSync(SERVICE_AUTH_PATH)) {
    throw new Error('service probe unavailable')
  }
  const auth = JSON.parse(readFileSync(SERVICE_AUTH_PATH, 'utf8')) as ServiceAuth
  const servicePath = reqPath.startsWith('/core/controller') ? reqPath : `/core/controller${reqPath}`
  const headers = signServiceRequest(method, servicePath, Buffer.alloc(0), auth)
  return request(SERVICE_SOCKET, method, servicePath, headers)
}

export async function mihomoControllerGet(reqPath: string): Promise<MihomoHttpResult> {
  if (existsSync(DIRECT_SOCKET)) {
    try {
      const direct = await requestDirect('GET', reqPath)
      if (direct.statusCode >= 200 && direct.statusCode < 500) {
        return direct
      }
    } catch {
      // fall through
    }
  }
  return requestService('GET', reqPath)
}

export async function mihomoProxyDelayMs(input: {
  proxy: string
  url: string
  timeoutMs?: number
}): Promise<number | undefined> {
  const timeoutMs = input.timeoutMs ?? 3000
  const query = `/proxies/${encodeURIComponent(input.proxy)}/delay?timeout=${timeoutMs}&url=${encodeURIComponent(input.url)}`
  const response = await mihomoControllerGet(query)
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return undefined
  }
  try {
    const parsed = JSON.parse(response.body) as { delay?: number }
    return typeof parsed.delay === 'number' && parsed.delay >= 0 ? parsed.delay : undefined
  } catch {
    return undefined
  }
}
