// [INPUT] buildStamp 内烘焙的 app git 事实 + 仓库当前 git 事实
// [OUTPUT] logBuildDriftAtStartup: 把 app 与仓库是否漂移写进 app 日志
// [POS] 漂移判定运行时入口；判定逻辑 SSOT 在 buildDriftPureCore.ts。
import { execFileSync } from 'child_process'
import { SPARKLE_GIT_COMMIT, SPARKLE_GIT_DIRTY } from '../../shared/buildStamp'
import { detectBuildDrift, normalizeCommit } from './buildDriftPureCore'
import { appendAppLog } from '../utils/log'

let driftLogged = false

/** 读取仓库 git 事实；非 git 仓库或命令失败时返回 unknown，判定结果即「需重建」。 */
function readRepoGitFacts(): { commit: string; dirty: boolean } {
  const run = (args: string[]): string => {
    try {
      return execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return ''
    }
  }
  return {
    commit: normalizeCommit(run(['rev-parse', 'HEAD'])),
    dirty: run(['status', '--porcelain']).length > 0,
  }
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
    const result = detectBuildDrift(
      { commit: SPARKLE_GIT_COMMIT, dirty: SPARKLE_GIT_DIRTY },
      readRepoGitFacts()
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
