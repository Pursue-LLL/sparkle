// [INPUT] mihomoIpcPath · filesystem · optional admin remove on macOS
// [OUTPUT] probe + remove zombie mihomo API unix socket before start-only core launch

import { existsSync, unlinkSync } from 'node:fs'
import http from 'node:http'
import { appendAppLog } from '../utils/log'
import { activateUserOwnedMihomoApiSocketFallback } from './mihomoApiSocketOverrideCore'
import {
  resolveCoreStartFootprintDecision,
  shouldRemoveStaleMihomoApiSocket,
  type CoreStartFootprintDecision,
} from './staleMihomoApiSocketCore'

export function probeMihomoApiSocket(socketPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath,
        path: '/version',
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

async function removeStaleSocketWithAdminFallback(socketPath: string): Promise<boolean> {
  try {
    unlinkSync(socketPath)
    return !existsSync(socketPath)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('EACCES') && !msg.includes('EPERM')) {
      return false
    }
  }
  // Do not block on osascript admin rm — caller falls back to user-owned socket path.
  return false
}

export async function resolveCoreFootprintBeforeStartOnly(input: {
  hasChildProcess: boolean
  corePidPath: string
  socketPath: string
}): Promise<CoreStartFootprintDecision> {
  const corePidExists = existsSync(input.corePidPath)
  const socketExists = existsSync(input.socketPath)
  const probeError = socketExists ? await probeMihomoApiSocket(input.socketPath) : null

  let staleSocketRemoved = false
  if (
    !input.hasChildProcess &&
    !corePidExists &&
    socketExists &&
    probeError !== null
  ) {
    staleSocketRemoved = await removeStaleSocketWithAdminFallback(input.socketPath)
    if (staleSocketRemoved) {
      await appendAppLog(
        `[CoreLifecycle]: stale_mihomo_socket_removed path=${input.socketPath} probe=${probeError}\n`,
      )
    } else if (
      shouldRemoveStaleMihomoApiSocket({ exists: true, probeError }) &&
      input.socketPath.startsWith('/tmp/')
    ) {
      const fallbackPath = activateUserOwnedMihomoApiSocketFallback()
      staleSocketRemoved = true
      await appendAppLog(
        `[CoreLifecycle]: stale_mihomo_socket_fallback path=${fallbackPath} primary=${input.socketPath} probe=${probeError}\n`,
      )
    } else {
      await appendAppLog(
        `[CoreLifecycle]: stale_mihomo_socket_remove_failed path=${input.socketPath} probe=${probeError}\n`,
      )
    }
  }

  return resolveCoreStartFootprintDecision({
    hasChildProcess: input.hasChildProcess,
    corePidExists,
    socketExists,
    probeError,
    staleSocketRemoved,
  })
}
