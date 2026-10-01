// [INPUT] BuildStampFacts — app 内构建时记录的 git 事实 + 仓库当前 git 事实
// [OUTPUT] detectBuildDrift: 漂移判定结果
// [POS] 防漂移判定 SSOT；write-build-stamp 写入 git 事实，startup 与 CLI 共用此判定。

/** 构建时烧进二进制的 git 事实。 */
export interface BuildStampGitFacts {
  commit: string
  dirty: boolean
}

/** 仓库当前 git 事实。 */
export interface RepoGitFacts {
  commit: string
  dirty: boolean
}

/** 短 hash 规范化：截断到 7 位，统一小写，空值归一为 'unknown'。 */
export function normalizeCommit(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim().toLowerCase()
  if (trimmed.length === 0) {
    return 'unknown'
  }
  return trimmed.slice(0, 7)
}

export type DriftReason = 'match' | 'commit_mismatch' | 'app_dirty' | 'app_unknown'

/**
 * 判定工作区是否脏，忽略构建期自动改写的 buildStamp。
 *
 * `write-build-stamp` 每次构建都刷新时间戳，该文件必然处于 modified 状态；
 * 把它计入 dirty 会让所有正常构建都被判为「不可复现」，判定永久失真。
 */
export function isTrackedDirtyOutsideBuildStamp(
  porcelainLines: readonly string[],
  buildStampPath: string
): boolean {
  return porcelainLines.some((line) => {
    const status = line.slice(0, 2)
    const target = line.slice(3).trim()
    if (status.includes('?')) {
      return true
    }
    if (target !== buildStampPath && !target.endsWith('/' + buildStampPath)) {
      return true
    }
    return false
  })
}

export interface DriftResult {
  reason: DriftReason
  drifted: boolean
  appCommit: string
  repoCommit: string
  /** 人类可读单行结论，直接进日志。 */
  summary: string
}

/**
 * 判定 app 二进制与仓库是否漂移。
 *
 * app 侧 dirty 表示「构建时工作区有未提交改动」——该构建无法用 commit 复现，
 * 判定为漂移，因为无法确认它包含哪些代码。
 *
 * 仓库侧 dirty 不算漂移：commit 仍是权威标识，未提交改动不会进入 app。
 */
export function detectBuildDrift(
  app: BuildStampGitFacts | undefined,
  repo: RepoGitFacts | undefined
): DriftResult {
  const appCommit = normalizeCommit(app?.commit)
  const repoCommit = normalizeCommit(repo?.commit)
  const appDirty = app?.dirty === true

  if (appCommit === 'unknown' || repoCommit === 'unknown') {
    return {
      reason: 'app_unknown',
      drifted: true,
      appCommit,
      repoCommit,
      summary:
        `drift=unknown app_commit=${appCommit} repo_commit=${repoCommit} ` +
        'action=rebuild_required（无法确认 app 包含最新代码，请执行 pnpm run upgrade:mac）',
    }
  }

  if (appDirty) {
    return {
      reason: 'app_dirty',
      drifted: true,
      appCommit,
      repoCommit,
      summary:
        `drift=app_dirty app_commit=${appCommit} repo_commit=${repoCommit} ` +
        'action=rebuild_required（构建时工作区不干净，该构建不可复现，请执行 pnpm run upgrade:mac）',
    }
  }

  if (appCommit !== repoCommit) {
    return {
      reason: 'commit_mismatch',
      drifted: true,
      appCommit,
      repoCommit,
      summary:
        `drift=commit_mismatch app_commit=${appCommit} repo_commit=${repoCommit} ` +
        'action=rebuild_required（app 比仓库旧，修复未生效，请执行 pnpm run upgrade:mac）',
    }
  }

  return {
    reason: 'match',
    drifted: false,
    appCommit,
    repoCommit,
    summary: `drift=none app_commit=${appCommit} repo_commit=${repoCommit}`,
  }
}
