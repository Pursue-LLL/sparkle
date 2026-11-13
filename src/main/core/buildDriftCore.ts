// [INPUT] buildStamp 内烘焙的 app git 事实 · buildDriftGit::evaluateBuildDrift (POS: 仓库 git 读取与漂移评估)
// [OUTPUT] logBuildDriftAtStartup: 把 app 与仓库是否漂移写进 app 日志
// [POS] 漂移判定运行时入口：定位仓库、读事实、写日志；判定逻辑 SSOT 在 buildDriftPureCore.ts。
import os from 'os'
import path from 'path'
import { SPARKLE_GIT_COMMIT, SPARKLE_GIT_DIRTY } from '../../shared/buildStamp'
import { createGitRunner, evaluateBuildDrift, type GitRunner } from './buildDriftGit'
import { appendAppLog } from '../utils/log'

/** 部署态仓库根：构建机路径兜底，用于 GUI cwd 不在仓库内时定位。 */
const REPO_ROOT_FALLBACK = '/Users/yululiu/projects/OpenSource/sparkle'

/** 开发态向上最多找几级祖先目录。 */
const MAX_ANCESTOR_DEPTH = 6

let driftLogged = false

/**
 * 定位仓库并返回绑定到它的 git 执行器；找不到时返回 undefined，判定结果即「需重建」。
 *
 * 先从 cwd 向上逐级找含 `.git` 的祖先目录（开发态），再试源码固定位置（部署态）：
 * GUI 由 LaunchAgent 拉起时 cwd 是 `/`，只靠 cwd 会找不到仓库。
 */
function locateRepoGit(): GitRunner | undefined {
  const candidates: string[] = []
  let dir = process.cwd()
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    candidates.push(dir)
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  candidates.push(REPO_ROOT_FALLBACK, path.join(os.homedir(), 'projects', 'OpenSource', 'sparkle'))

  for (const candidate of candidates) {
    const git = createGitRunner(candidate)
    if (git(['rev-parse', '--git-dir'])) {
      return git
    }
  }
  return undefined
}

/**
 * 启动时记录 app 与仓库的漂移状态（每个进程仅记录一次）。
 *
 * 漂移意味着「源码已修、app 仍旧」，运行中的二进制仍在执行旧逻辑——
 * 这是历史上 AnyTLS 修复被静默回退的直接成因，必须留痕以便事后判定。
 */
export async function logBuildDriftAtStartup(): Promise<void> {
  if (driftLogged) {
    return
  }
  driftLogged = true
  try {
    const result = evaluateBuildDrift(
      { commit: SPARKLE_GIT_COMMIT, dirty: SPARKLE_GIT_DIRTY },
      locateRepoGit()
    )
    await appendAppLog(
      `[BuildDrift]: app_commit=${result.appCommit} app_dirty=${SPARKLE_GIT_DIRTY ? 1 : 0} ${result.summary}\n`
    )
  } catch (error) {
    await appendAppLog(
      `[BuildDrift]: drift_check_failed err=${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}
