/**
 * 漂移自检：对比 /Applications 运行的 app 二进制与仓库 HEAD。
 *
 * 退出码 0 = 已同步（含「仓库只多了文档 / 测试 / buildStamp 提交」）；1 = 漂移（app 旧于仓库，源码修复未生效）。
 * 供人/CI 主动查询；Sparkle 启动时另有一份同源判定写进 app 日志。
 */
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
    path.join('/Applications', 'Sparkle.app', 'Contents', 'Resources', 'app.asar')
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

const APP_ASAR = resolveAppAsar()

/**
 * 读取已安装 app 内烘焙的 git 事实。
 *
 * 直接从 app.asar 的主进程 bundle 读取烧进二进制的标记——这是权威来源，
 * 不依赖 app 是否已启动、是否写过 [BuildDrift] 日志。标记按内容定位，不依赖 chunk 文件名
 * （打包器可把 buildStamp 拆成带哈希的独立 chunk，也可内联进 index.js）。
 */
async function readAppFacts(
  normalizeCommit: Normalize
): Promise<{ commit: string; dirty: boolean } | undefined> {
  if (!fs.existsSync(APP_ASAR)) {
    return undefined
  }
  const { readBakedBuildStampFromAsar } = await import('./sparkleBakedBuildStampCore')
  const stamp = readBakedBuildStampFromAsar(APP_ASAR)
  return stamp && { commit: normalizeCommit(stamp.commit), dirty: stamp.dirty }
}

async function main(): Promise<void> {
  const { normalizeCommit } = await import('../src/main/core/buildDriftPureCore')
  const { createGitRunner, evaluateBuildDrift } = await import('../src/main/core/buildDriftGit')
  const result = evaluateBuildDrift(
    await readAppFacts(normalizeCommit),
    createGitRunner(process.cwd())
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
