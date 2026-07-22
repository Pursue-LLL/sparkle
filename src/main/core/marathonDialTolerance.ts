import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getCurrentProfileItem } from '../config'
import { profilesDir } from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { appendAppLog } from '../utils/log'
import { applyVlessVisionMuxGuard } from './vlessVisionMuxGuardCore'
import {
  applyMarathonDialToleranceToProxies,
  resolveMarathonDialTimeoutSec,
} from './marathonDialToleranceCore'
import { reloadMihomoProfileProviders, resolveVpsProviderId } from './provider'

let lastAppliedDialTimeoutSec: number | undefined

function vpsProviderFilePath(profileId: string): string {
  return path.join(profilesDir(), `${resolveVpsProviderId(profileId)}-proxies.yaml`)
}

/** Hot-update VPS leaf dial-timeout when parallel Cursor load crosses marathon threshold. */
export async function syncMarathonDialToleranceIfNeeded(
  cursorConnectionCount: number,
): Promise<boolean> {
  const dialTimeoutSec = resolveMarathonDialTimeoutSec(cursorConnectionCount)
  if (lastAppliedDialTimeoutSec === dialTimeoutSec) {
    return false
  }

  const profile = await getCurrentProfileItem()
  const providerPath = vpsProviderFilePath(profile.id)
  if (!existsSync(providerPath)) {
    return false
  }

  const raw = await readFile(providerPath, 'utf8')
  const parsed = parseYaml(raw) as { proxies?: unknown[] } | null
  const proxies = Array.isArray(parsed?.proxies) ? parsed.proxies : []
  if (proxies.length === 0) {
    return false
  }

  const result = applyMarathonDialToleranceToProxies(proxies, cursorConnectionCount)
  const guardedProxies = applyVlessVisionMuxGuard(result.proxies)
  if (!result.changed && lastAppliedDialTimeoutSec === dialTimeoutSec) {
    return false
  }

  await writeFile(providerPath, stringifyYaml({ proxies: guardedProxies }), 'utf8')
  await reloadMihomoProfileProviders(profile.id, true)
  lastAppliedDialTimeoutSec = dialTimeoutSec
  await appendAppLog(
    `[MarathonDialTolerance]: dial_timeout=${dialTimeoutSec}s cursor_conn=${cursorConnectionCount}\n`,
  )
  return true
}

export function resetMarathonDialToleranceStateForTests(): void {
  lastAppliedDialTimeoutSec = undefined
}
