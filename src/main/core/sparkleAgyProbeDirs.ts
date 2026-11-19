// [INPUT] node:fs 临时目录 · utils/yaml::parseYaml (POS: YAML 解析与序列化) ·
//         sparkleAgyProviderCore::AGY_NODE_PROVIDER_FILENAME (POS: agy provider 与分组配置) ·
//         sparkleAgyProbeWorld::Proxy (POS: agy 探针测试的共享状态与夹具数据)
// [OUTPUT] homeDir/dataDirPath/profilesDirPath/probeDir/probeCliDir · resetAgyDirs · writeCache/readCache/cacheFileExists · readProviderMembers
// [POS] sparkleAgy 行为测试的临时文件系统：整个测试进程共用一个临时根目录，用例之间各自重建 home / data / profiles；
// 探测缓存、provider 文件与探测目录都是这里的真实文件。仅供测试使用。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseYaml } from '../utils/yaml'
import type { Proxy } from './sparkleAgyProbeWorld'
import { AGY_NODE_PROVIDER_FILENAME } from './sparkleAgyProviderCore'

const CACHE_FILENAME = 'sparkle-agy-nodes.json'

/** 整个测试进程共用一个临时根目录，进程结束时清理；用例之间各自重建 home/data/profiles。 */
const root = mkdtempSync(path.join(tmpdir(), 'sparkle-agy-probe-'))
process.once('exit', () => rmSync(root, { recursive: true, force: true }))

const dirs = {
  home: path.join(root, 'home'),
  data: path.join(root, 'data'),
  profiles: path.join(root, 'profiles')
}

export const homeDir = (): string => dirs.home
export const dataDirPath = (): string => dirs.data
export const profilesDirPath = (): string => dirs.profiles
export const probeDir = (): string => path.join(dirs.data, 'agy-probe')
export const probeCliDir = (): string => path.join(probeDir(), 'antigravity-cli')
const cacheFile = (): string => path.join(dirs.data, CACHE_FILENAME)
const providerFile = (): string => path.join(dirs.profiles, AGY_NODE_PROVIDER_FILENAME)

export function writeCache(records: Record<string, unknown>): void {
  writeFileSync(cacheFile(), JSON.stringify(records), 'utf8')
}

export function readCache(): Record<string, { usable: boolean; rttMs: number; checkedAt: number }> {
  return JSON.parse(readFileSync(cacheFile(), 'utf8'))
}

export function cacheFileExists(): boolean {
  try {
    readFileSync(cacheFile())
    return true
  } catch {
    return false
  }
}

export function readProviderMembers(): string[] | undefined {
  try {
    const { proxies = [] } = parseYaml<{ proxies?: Proxy[] }>(readFileSync(providerFile(), 'utf8'))
    return proxies.map((proxy) => String(proxy.name))
  } catch {
    return undefined
  }
}

/** 每个用例从空目录开始，并让真实 HOME 指向其中的 home。 */
export function resetAgyDirs(): void {
  for (const dir of Object.values(dirs)) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
  process.env.HOME = dirs.home
}
