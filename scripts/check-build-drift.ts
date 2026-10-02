/**
 * 漂移自检：对比 /Applications 运行的 app 二进制与仓库 HEAD。
 *
 * 退出码 0 = 已同步；1 = 漂移（app 旧于仓库，源码修复未生效）。
 * 供人/CI 主动查询；Sparkle 启动时另有一份同源判定写进 app 日志。
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

/** commit 规范化函数签名；由 buildDriftPureCore 经动态 import 注入，避免 ESM 具名导出限制。 */
type Normalize = (value: string) => string
type IsDirty = (cwd: string) => boolean

/** @electron/asar 为 CJS，动态 import 的类型推断不覆盖具名导出，此处显式约束。 */
interface AsarApi {
  listPackage(asarPath: string): string[]
  extractFile(asarPath: string, filename: string): Buffer
}

/** 定位 app.asar：优先系统级安装（升级脚本的规范目标），回退到用户级。 */
function resolveAppAsar(): string {
  if (process.env.SPARKLE_APP_ASAR) {
    return process.env.SPARKLE_APP_ASAR
  }
  const candidates = [
    path.join(os.homedir(), 'Applications', 'Sparkle.app', 'Contents', 'Resources', 'app.asar'),
    path.join('/Applications', 'Sparkle.app', 'Contents', 'Resources', 'app.asar'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

const APP_ASAR = resolveAppAsar()

function run(args: string[], cwd?: string): string {
  try {
    return execFileSync(args[0], args.slice(1), {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function readRepoFacts(normalizeCommit: Normalize, isDirtyOutside: IsDirty): { commit: string; dirty: boolean } {
  return {
    commit: normalizeCommit(run(['git', 'rev-parse', 'HEAD'], process.cwd())),
    dirty: isDirtyOutside(process.cwd()),
  }
}

/**
 * 读取已安装 app 内烘焙的 git 事实。
 *
 * 直接从 app.asar 的 buildStamp chunk 读取二进制内容——这是权威来源，
 * 不依赖 app 是否已启动、是否写过 [BuildDrift] 日志。chunk 文件名带内容哈希，
 * 需先 list 再按前缀定位。
 */
async function readAppFacts(
  normalizeCommit: Normalize
): Promise<{ commit: string; dirty: boolean } | undefined> {
  const asar = (await import('@electron/asar')) as unknown as AsarApi
  if (!fs.existsSync(APP_ASAR)) {
    return undefined
  }
  const chunk = asar
    .listPackage(APP_ASAR)
    .find((entry) => /\/buildStamp-[^/]+\.js$/.test(entry))
  if (!chunk) {
    return undefined
  }
  const source = asar.extractFile(APP_ASAR, chunk.replace(/^\//, '')).toString('utf8')
  const commit = source.match(/SPARKLE_GIT_COMMIT\s*=\s*"([^"]*)"/)?.[1] ?? ''
  const dirty = /SPARKLE_GIT_DIRTY\s*=\s*true/.test(source)
  if (commit.length === 0) {
    return undefined
  }
  return { commit: normalizeCommit(commit), dirty }
}

async function main(): Promise<void> {
  const { detectBuildDrift, normalizeCommit, isTrackedDirtyOutsideBuildStamp } = await import(
    '../src/main/core/buildDriftPureCore'
  )
  const isDirtyOutside = (cwd: string): boolean =>
    !isTrackedDirtyOutsideBuildStamp(
      run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd)
        .split('\n')
        .filter(Boolean),
      'src/shared/buildStamp.ts'
    )
  const result = detectBuildDrift(
    await readAppFacts(normalizeCommit),
    readRepoFacts(normalizeCommit, isDirtyOutside)
  )
  console.log(`app_asar=${APP_ASAR}`)
  console.log(`[check-drift] ${result.summary}`)
  if (result.drifted) {
    console.log('[check-drift] app 落后于仓库：源码改动未进入二进制，运行时仍在跑旧逻辑。')
    console.log('[check-drift] 修复命令：pnpm run upgrade:mac')
    process.exit(1)
  }
  console.log('[check-drift] app 与仓库一致。')
}

main().catch((error) => {
  console.error('[check-drift] FAIL', error)
  process.exit(2)
})
