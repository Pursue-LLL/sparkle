import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 安装沙箱里「世界」的描述与夹具：一个 App 包长什么样、机器处在什么配置下。
 * 与沙箱本身（命令桩、进程启停、观察）分开，是为了让两边各自保持单一职责。
 */

export interface BundleSpec {
  version: string
  cdhash: string
  serviceBinary?: string
  coreSetuid?: boolean
  /** 写入 Contents/Resources/sim-behavior；键含义见 sandbox-stub.sh 的 behavior()。 */
  behavior?: Record<string, string>
}

export interface WorldSpec {
  mode: 'service' | 'elevated'
  tun: boolean
  /** config.yaml 的 macos26ForceGui；默认 true（GUI 应当常驻）。 */
  forceGui?: boolean
  /** `uname -r` 的返回值，默认 macOS 26。 */
  darwin?: string
  /** 已安装的旧包；null 表示全新安装。 */
  old: BundleSpec | null
  next: BundleSpec
  /** 旧 App 与内核是否正在运行，默认 true。 */
  oldRunning?: boolean
  /** 外部网络是否通，默认 true。 */
  network?: 'ok' | 'down'
}

export function writeBundle(dir: string, spec: BundleSpec): void {
  const contents = join(dir, 'Contents')
  const sidecar = join(contents, 'Resources', 'sidecar')
  const files = join(contents, 'Resources', 'files')
  for (const sub of [join(contents, 'MacOS'), sidecar, files]) {
    mkdirSync(sub, { recursive: true })
  }
  writeFileSync(join(contents, 'version'), `${spec.version}\n`)
  writeFileSync(join(contents, 'CDHASH'), `${spec.cdhash}\n`)
  writeFileSync(join(contents, 'MacOS', 'Sparkle'), '#!/bin/sh\n')
  writeFileSync(join(files, 'sparkle-service'), spec.serviceBinary ?? 'service-v1')
  chmodSync(join(files, 'sparkle-service'), 0o755)
  for (const core of ['mihomo', 'mihomo-alpha']) {
    writeFileSync(join(sidecar, core), `core ${spec.version}\n`)
    chmodSync(join(sidecar, core), spec.coreSetuid ? 0o4755 : 0o755)
  }
  const behavior = Object.entries(spec.behavior ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  writeFileSync(join(contents, 'Resources', 'sim-behavior'), `${behavior}\n`)
}

/**
 * 目录的完整指纹：每个文件的相对路径、权限位（含 setuid）与内容哈希。
 * 回滚前后一致，说明放回去的就是原来那份字节，而不是「看起来差不多」的副本。
 */
export function bundleFingerprint(dir: string): string {
  const lines: string[] = []
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else {
        const digest = createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16)
        lines.push(`${relative(dir, full)} ${(stat.mode & 0o7777).toString(8)} ${digest}`)
      }
    }
  }
  walk(dir)
  return lines.join('\n')
}

export const OLD_BUNDLE: BundleSpec = {
  version: '1.0.0-old',
  cdhash: 'aaaa1111',
  serviceBinary: 'service-v1'
}
export const NEW_BUNDLE: BundleSpec = {
  version: '1.1.0-new',
  cdhash: 'bbbb2222',
  serviceBinary: 'service-v2'
}

export function serviceWorld(overrides: Partial<WorldSpec> = {}): WorldSpec {
  return { mode: 'service', tun: true, old: OLD_BUNDLE, next: NEW_BUNDLE, ...overrides }
}
