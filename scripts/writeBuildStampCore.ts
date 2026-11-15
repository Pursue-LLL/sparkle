// [INPUT] Date · 仓库目录（读 git 事实）
// [OUTPUT] formatSparkleBuildStamp: YYYY.MMDD.HHMM build stamp string · readBuildGitFacts: 烧进二进制的 commit 与 dirty ·
//          BUILD_STAMP_REL_PATH: 构建自己改写的标记文件
// [POS] 构建标识格式与 git 事实 SSOT；dev/build/upgrade 写入 src/shared/buildStamp.ts。
import { execFileSync } from 'child_process'

/**
 * 构建自己改写的标记文件（相对仓库根）。
 *
 * 写入目标与「脏」判定的排除项必须是同一个文件，并与漂移判定（buildDriftPureCore）
 * 认定为「不影响二进制」的标记文件一致。
 */
export const BUILD_STAMP_REL_PATH = 'src/shared/buildStamp.ts'

export interface BuildGitFacts {
  commit: string
  dirty: boolean
}

/** YYYY.MMDD.HHMM — local build time, minute precision (UI display SSOT). */
export function formatSparkleBuildStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}.${month}${day}.${hour}${minute}`
}

/** 短 hash 规范化：截断 7 位小写，空值归一 unknown（与 buildDriftPureCore 同规则）。 */
function normalizeCommit(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.length === 0 ? 'unknown' : trimmed.slice(0, 7)
}

/**
 * 读取构建时刻的 git 事实。
 *
 * 上一次构建留下的 buildStamp 改动不算脏：源码仍能由该 commit 复现。若算脏，装包后
 * 不先提交这个文件，下一次构建就会被误记为不可复现，漂移检测据此反复要求重建。
 * 非 git 仓库或 git 命令失败时 commit 记 unknown、dirty 记 true：查不到就不能声称干净，
 * 让漂移检测判定为需重建。
 */
export function readBuildGitFacts(cwd: string): BuildGitFacts {
  const git = (args: readonly string[]): string | undefined => {
    try {
      return execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
    } catch {
      return undefined
    }
  }
  // 路径都以仓库根为基准，不随启动目录变化。
  const status = git(['status', '--porcelain', '--', ':/', `:(top,exclude)${BUILD_STAMP_REL_PATH}`])
  return {
    commit: normalizeCommit(git(['rev-parse', 'HEAD']) ?? ''),
    dirty: status === undefined || status.length > 0
  }
}
