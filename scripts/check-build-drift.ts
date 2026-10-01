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

function readRepoFacts(normalizeCommit: Normalize): { commit: string; dirty: boolean } {
  return {
    commit: normalizeCommit(run(['git', 'rev-parse', 'HEAD'], process.cwd())),
    dirty: run(['git', 'status', '--porcelain'], process.cwd()).length > 0,
  }
}

/** app.asar 内烘焙的 commit 由构建期生成；此处从解包产物读取 buildStamp 事实。 */
function readAppFacts(normalizeCommit: Normalize): { commit: string; dirty: boolean } | undefined {
  if (!fs.existsSync(APP_ASAR)) {
    return undefined
  }
  // buildStamp 事实同时写入 app 日志（[BuildDrift] 行）与 shared/buildStamp 模块。
  // 打包后无法直接 import，这里读取同源日志判定，避免解包 100MB+ asar。
  const logDir = path.join(os.homedir(), 'Library/Application Support/sparkle/logs')
  const files = fs.existsSync(logDir) ? fs.readdirSync(logDir).filter((f) => f.startsWith('app-')) : []
  files.sort()
  for (const file of files.reverse().slice(0, 5)) {
    const text = fs.readFileSync(path.join(logDir, file), 'utf8')
    const match = text.match(/\[BuildDrift\]:\s*app_commit=(\S+)\s+app_dirty=(\d)/g)?.pop()
    if (!match) {
      continue
    }
    const commit = match.match(/app_commit=(\S+)/)?.[1] ?? ''
    const dirty = match.match(/app_dirty=(\d)/)?.[1] === '1'
    return { commit: normalizeCommit(commit), dirty }
  }
  return undefined
}

async function main(): Promise<void> {
  const { detectBuildDrift, normalizeCommit } = await import(
    '../src/main/core/buildDriftPureCore'
  )
  const result = detectBuildDrift(readAppFacts(normalizeCommit), readRepoFacts(normalizeCommit))
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
