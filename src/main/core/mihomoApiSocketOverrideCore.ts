// [INPUT] ~/.sparkle/mihomo-api-socket-override
// [OUTPUT] user-owned mihomo API unix socket fallback when /tmp primary is root-stale
// [POS] SSOT — bypass admin rm for zombie /tmp/sparkle-mihomo-api.sock after marathon install.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export const MIHOMO_API_SOCKET_OVERRIDE_FILE = 'mihomo-api-socket-override'

let testOverridePath: string | null = null
let testFallbackSocketPath: string | null = null

export function setMihomoApiSocketOverridePathsForTests(input: {
  overridePath?: string | null
  fallbackSocketPath?: string | null
}): void {
  testOverridePath = input.overridePath ?? null
  testFallbackSocketPath = input.fallbackSocketPath ?? null
}

export function userOwnedMihomoApiSocketPath(): string {
  return testFallbackSocketPath ?? join(homedir(), '.sparkle', 'run', 'mihomo-api.sock')
}

function overrideFilePath(): string {
  return testOverridePath ?? join(homedir(), '.sparkle', MIHOMO_API_SOCKET_OVERRIDE_FILE)
}

export function readMihomoApiSocketOverride(): string | null {
  const filePath = overrideFilePath()
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const line = readFileSync(filePath, 'utf8').split('\n').find((row) => row.trim())?.trim()
    return line ? line : null
  } catch {
    return null
  }
}

export function activateUserOwnedMihomoApiSocketFallback(): string {
  const fallbackPath = userOwnedMihomoApiSocketPath()
  mkdirSync(dirname(fallbackPath), { recursive: true })
  try {
    if (existsSync(fallbackPath)) {
      unlinkSync(fallbackPath)
    }
  } catch {
    // Best-effort — mihomo bind may still succeed if path is free.
  }
  writeFileSync(overrideFilePath(), `${fallbackPath}\n`, 'utf8')
  return fallbackPath
}
