#!/usr/bin/env tsx
/** Remove zombie /tmp/sparkle-mihomo-api.sock before install when probe fails. */
import { existsSync, unlinkSync } from 'node:fs'
import http from 'node:http'
import {
  formatStaleMihomoApiSocketAction,
  shouldRemoveStaleMihomoApiSocket,
} from './sparkleStaleMihomoSocketHygieneCore.ts'

const SOCKET_PATH = process.env.SPARKLE_MIHOMO_SOCKET ?? '/tmp/sparkle-mihomo-api.sock'

function probeSocket(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path: '/connections',
        method: 'GET',
        headers: { Host: 'localhost' },
        timeout: 2000,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500 ? null : `status=${res.statusCode}`)
      },
    )
    req.on('error', (error) => {
      resolve(error instanceof Error ? error.message : String(error))
    })
    req.on('timeout', () => {
      req.destroy(new Error('probe timeout'))
    })
    req.end()
  })
}

async function main(): Promise<void> {
  const exists = existsSync(SOCKET_PATH)
  const probeError = exists ? await probeSocket() : null
  const input = { exists, probeError }

  const action = formatStaleMihomoApiSocketAction(SOCKET_PATH, input)
  if (!action) {
    console.log(`[sparkle-socket-hygiene] OK socket=${SOCKET_PATH} exists=${exists}`)
    return
  }

  if (!shouldRemoveStaleMihomoApiSocket(input)) {
    return
  }

  try {
    unlinkSync(SOCKET_PATH)
    console.log(`[sparkle-socket-hygiene] ${action}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[sparkle-socket-hygiene] WARN: could not remove ${SOCKET_PATH}: ${msg}`)
    process.exit(0)
  }
}

void main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[sparkle-socket-hygiene] FAIL: ${msg}`)
  process.exit(1)
})
