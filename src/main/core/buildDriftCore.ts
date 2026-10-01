// [INPUT] buildStamp 内烘焙的 app git 事实 + 仓库当前 git 事实
// [OUTPUT] logBuildDriftAtStartup: 把 app 与仓库是否漂移写进 app 日志
// [POS] 漂移判定运行时入口；判定逻辑 SSOT 在 buildDriftPureCore.ts。
import { execFileSync } from 'child_process'
import os from 'os'
import path from 'path'
import { SPARKLE_GIT_COMMIT, SPARKLE_GIT_DIRTY } from '../../shared/buildStamp'
import { detectBuildDrift, isTrackedDirtyOutsideBuildStamp, normalizeCommit } from './buildDriftPureCore'
import { appendAppLog } from '../utils/log'

/** 部署态仓库根：构建机路径兜底，用于 GUI cwd 不在仓库内时定位。 */
const REPO_ROOT_FALLBACK = '/Users/yululiu/projects/OpenSource/sparkle'

let driftLogged = false

/** 工作区是否脏：忽略构建期必然改写的 buildStamp，其余任何已跟踪改动都算脏。 */
function isDirtyOutsideBuildStamp(run: (args: string[]) => string): boolean {
  return !isTrackedDirtyOutsideBuildStamp(
    run(['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean),
    'src/shared/buildStamp.ts'
  )
}

/**
 * 读取仓库 git 事实；非 git 仓库或命令失败时返回 unknown，判定结果即「需重建」。
 *
 * cwd 取 app 安装位置而非 process.cwd()：GUI 由 LaunchAgent 拉起时 cwd 是 `/`，
 * 相对路径的 git 命令会失败。向上逐级查找含 `.git` 的祖先目录。
 */
function readRepoGitFacts(): { commit: string; dirty: boolean } {
  const run = (args: string[], cwd: string): string => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return ''
    }
  }

  // 开发态：仓库就在 cwd 或其祖先目录
  let dir = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (run(['rev-parse', '--git-dir'], dir).length > 0) {
      return {
        commit: normalizeCommit(run(['rev-parse', 'HEAD'], dir)),
        dirty: isDirtyOutsideBuildStamp((args) => run(args, dir)),
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }

  // 部署态：仓库在源码固定位置，不依赖 cwd
  for (const root of [REPO_ROOT_FALLBACK, path.join(os.homedir(), 'projects', 'OpenSource', 'sparkle')]) {
    if (run(['rev-parse', '--git-dir'], root).length > 0) {
      return {
        commit: normalizeCommit(run(['rev-parse', 'HEAD'], root)),
        dirty: isDirtyOutsideBuildStamp((args) => run(args, root)),
      }
    }
  }

  return { commit: 'unknown', dirty: false }
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
