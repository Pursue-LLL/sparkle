#!/usr/bin/env tsx
/** Probe mihomo /connections via direct or service socket — stdout prints cursor_conn count. */
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { countCursorConnections } from './marathonMihomoConnectionsCountCore.ts'

const DIRECT_SOCKET = process.env.SPARKLE_MIHOMO_SOCKET ?? '/tmp/sparkle-mihomo-api.sock'
const SERVICE_SOCKET = process.env.SPARKLE_SERVICE_SOCKET ?? '/tmp/sparkle-service.sock'
const SERVICE_AUTH_PATH =
  process.env.SPARKLE_SERVICE_AUTH ??
  path.join(process.env.HOME ?? '', 'Library/Application Support/sparkle/service-auth.json')

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
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: reqPath,
        method,
        headers: { Host: 'localhost', ...headers },
        timeout: 4000,
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
    req.on('timeout', () => req.destroy(new Error('probe timeout')))
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

async function probeDirect(): Promise<number> {
  const response = await request(DIRECT_SOCKET, 'GET', '/connections')
  if (response.statusCode < 200 || response.statusCode >= 500) {
    throw new Error(`direct status=${response.statusCode}`)
  }
  const data = JSON.parse(response.body) as { connections?: unknown[] }
  return countCursorConnections((data.connections ?? []) as Parameters<typeof countCursorConnections>[0])
}

async function probeService(): Promise<number> {
  if (!existsSync(SERVICE_SOCKET) || !existsSync(SERVICE_AUTH_PATH)) {
    throw new Error('service probe unavailable')
  }
  const auth = JSON.parse(readFileSync(SERVICE_AUTH_PATH, 'utf8')) as ServiceAuth
  const listPath = '/core/controller/connections'
  const headers = signServiceRequest('GET', listPath, Buffer.alloc(0), auth)
  const response = await request(SERVICE_SOCKET, 'GET', listPath, headers)
  if (response.statusCode < 200 || response.statusCode >= 500) {
    throw new Error(`service status=${response.statusCode}`)
  }
  const data = JSON.parse(response.body) as { connections?: unknown[] }
  return countCursorConnections((data.connections ?? []) as Parameters<typeof countCursorConnections>[0])
}

async function main(): Promise<void> {
  if (existsSync(DIRECT_SOCKET)) {
    try {
      process.stdout.write(String(await probeDirect()))
      return
    } catch {
      // fall through
    }
  }
  process.stdout.write(String(await probeService()))
}

void main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`curl_failed:${msg}`)
  process.exit(2)
})
