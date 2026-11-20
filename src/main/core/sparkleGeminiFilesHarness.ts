// [INPUT] node:fs · node:os · node:path ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_FILENAME (POS: sparkle-fast provider 文件生成) ·
//         sparkleGeminiProviderCore::GEMINI_NODE_PROVIDER_FILENAME (POS: gemini provider 与分组配置) ·
//         sparkleGeminiStabilityCore::GeminiStabilityEntry (POS: Gemini 节点稳定度台账的纯规则) ·
//         utils/yaml::parseYaml (POS: YAML 解析与序列化)
// [OUTPUT] dirs · resetDirs · writeCache · writeCacheRaw · readCache · cacheFileExists · writeLedger · writeLedgerRaw · readLedger · removeDataDir · dataFileNames · readProviderOrder · readGeminiProviderOrder
// [POS] Gemini 行为测试夹具的临时目录与文件读写：地区缓存、稳定度台账与两份 provider 文件都走这里的真实文件。
//       整个测试进程共用一个临时根目录，进程结束时清理；用例之间各自重建 data/profiles 子目录。仅供测试使用。

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseYaml } from '../utils/yaml'
import { FAST_NODE_PROVIDER_FILENAME } from './sparkleFastProviderCore'
import { GEMINI_NODE_PROVIDER_FILENAME } from './sparkleGeminiProviderCore'
import type { GeminiStabilityEntry } from './sparkleGeminiStabilityCore'

const CACHE_FILENAME = 'sparkle-gemini-nodes.json'
const LEDGER_FILENAME = 'sparkle-gemini-stability.json'

const root = mkdtempSync(path.join(tmpdir(), 'sparkle-gemini-probe-'))
process.once('exit', () => rmSync(root, { recursive: true, force: true }))

export const dirs = { data: path.join(root, 'data'), profiles: path.join(root, 'profiles') }

/** 清空并重建两个子目录，让每个用例从空目录开始。 */
export function resetDirs(): void {
  for (const dir of [dirs.data, dirs.profiles]) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
}

const cacheFile = (): string => path.join(dirs.data, CACHE_FILENAME)
const ledgerFile = (): string => path.join(dirs.data, LEDGER_FILENAME)
const providerFile = (): string => path.join(dirs.profiles, FAST_NODE_PROVIDER_FILENAME)
const geminiProviderFile = (): string => path.join(dirs.profiles, GEMINI_NODE_PROVIDER_FILENAME)

export function writeCache(records: Record<string, unknown>): void {
  writeFileSync(cacheFile(), JSON.stringify(records), 'utf8')
}

export function writeCacheRaw(text: string): void {
  writeFileSync(cacheFile(), text, 'utf8')
}

export function readCache(): Record<
  string,
  { eligible: boolean; countryCode: string; checkedAt: number }
> {
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

export function writeLedger(entries: Record<string, GeminiStabilityEntry>): void {
  writeFileSync(ledgerFile(), JSON.stringify(entries), 'utf8')
}

export function writeLedgerRaw(text: string): void {
  writeFileSync(ledgerFile(), text, 'utf8')
}

export function readLedger(): Record<string, GeminiStabilityEntry> {
  return JSON.parse(readFileSync(ledgerFile(), 'utf8'))
}

/** 删掉数据目录，让后续落盘必然失败。 */
export function removeDataDir(): void {
  rmSync(dirs.data, { recursive: true, force: true })
}

export function dataFileNames(): string[] {
  return readdirSync(dirs.data).sort()
}

function readOrder(file: string): string[] | undefined {
  try {
    const { proxies = [] } = parseYaml<{ proxies?: Array<Record<string, unknown>> }>(
      readFileSync(file, 'utf8')
    )
    return proxies.map((proxy) => String(proxy.name))
  } catch {
    return undefined
  }
}

export const readProviderOrder = (): string[] | undefined => readOrder(providerFile())
export const readGeminiProviderOrder = (): string[] | undefined => readOrder(geminiProviderFile())
