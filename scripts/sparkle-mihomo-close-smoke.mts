#!/usr/bin/env tsx
/** Mihomo close API smoke — DELETE /connections/{id} must reach controller (not "is not a function"). */
import { existsSync } from 'node:fs'
import http from 'node:http'

const SOCKET_PATH = process.env.SPARKLE_MIHOMO_SOCKET ?? '/tmp/sparkle-mihomo-api.sock'
const SMOKE_ID = 'sparkle-close-smoke-nonexistent'

function request(method: string, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        headers: { Host: 'localhost' },
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

async function main(): Promise<void> {
  if (!existsSync(SOCKET_PATH)) {
    console.error(`[mihomo-close-smoke] FAIL: socket missing ${SOCKET_PATH}`)
    process.exit(1)
  }
  try {
    const list = await request('GET', '/connections')
    if (list.statusCode < 200 || list.statusCode >= 500) {
      console.error(`[mihomo-close-smoke] FAIL: GET /connections status=${list.statusCode}`)
      process.exit(1)
    }
    const del = await request('DELETE', `/connections/${encodeURIComponent(SMOKE_ID)}`)
    if (del.statusCode >= 500) {
      console.error(`[mihomo-close-smoke] FAIL: DELETE status=${del.statusCode} body=${del.body}`)
      process.exit(1)
    }
    console.log(`[mihomo-close-smoke] OK status=${del.statusCode}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[mihomo-close-smoke] FAIL: ${msg}`)
    process.exit(1)
  }
}

void main()
