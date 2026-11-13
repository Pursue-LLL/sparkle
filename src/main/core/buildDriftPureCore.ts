// [INPUT] BuildStampGitFacts — app 内构建时记录的 git 事实 · RepoGitFacts — 仓库当前 commit ·
//         可选的「app 构建提交之后改了哪些文件」（buildDriftGit::listPathsChangedSince）
// [OUTPUT] detectBuildDrift: 漂移判定结果 · isBinaryRelevantPath: 路径改动是否会进入 app 二进制
// [POS] 防漂移判定 SSOT；write-build-stamp 写入 git 事实，startup 与 CLI 共用此判定。

/** 构建时烧进二进制的 git 事实。 */
export interface BuildStampGitFacts {
  commit: string
  dirty: boolean
}

/**
 * 仓库当前 git 事实。
 *
 * 只有 commit：工作区未提交的改动不会进入已安装的 app，不构成漂移，所以不读 dirty。
 */
export interface RepoGitFacts {
  commit: string
}

/** 短 hash 规范化：截断到 7 位，统一小写，空值归一为 'unknown'。 */
export function normalizeCommit(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim().toLowerCase()
  if (trimmed.length === 0) {
    return 'unknown'
  }
  return trimmed.slice(0, 7)
}

export type DriftReason =
  | 'match'
  | 'non_binary_ahead'
  | 'commit_mismatch'
  | 'app_dirty'
  | 'app_unknown'

/** 构建期自动改写的标记文件：它记录的是构建本身，提交它不代表源码变了。 */
const BUILD_STAMP_PATH = 'src/shared/buildStamp.ts'

/** 随 extraResources 整体拷进 app 的目录：里面任何文件（文档也一样）都算二进制内容。 */
const SHIPPED_DIR_PREFIXES = ['extra/', 'resources/'] as const

const DOC_PATH_RE = /\.md$/i

/** 测试文件只被测试入口引用，不会进入 electron-vite 打出来的 bundle。 */
const TEST_PATH_RE = /\.test\.[cm]?[jt]sx?$/

/**
 * 仓库里某个路径的改动是否可能改变 app 二进制。
 *
 * 只把文档、测试文件、buildStamp 判为「不影响」，其余一律保守地算影响：
 * 漏判（把影响二进制的改动当成无关）会让人误以为 app 已是最新，比多报一次重建代价大得多。
 * 路径是相对仓库根的 git 路径。
 */
export function isBinaryRelevantPath(path: string): boolean {
  if (path === BUILD_STAMP_PATH) {
    return false
  }
  if (SHIPPED_DIR_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true
  }
  return !DOC_PATH_RE.test(path) && !TEST_PATH_RE.test(path)
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
 * commit 不同时，`listPathsChangedSinceApp` 给出 app 构建提交到仓库 HEAD 之间改动的文件：
 * 全部是文档 / 测试 / buildStamp 时，二进制内容没变，不算漂移（`non_binary_ahead`）。
 * 返回 undefined 表示查不到（构建提交不在本仓库、git 失败），此时不猜，按落后处理。
 * 只在 commit 不同时才会调用它，避免相同 commit 的常见路径多跑 git。
 */
export function detectBuildDrift(
  app: BuildStampGitFacts | undefined,
  repo: RepoGitFacts | undefined,
  listPathsChangedSinceApp?: () => readonly string[] | undefined
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
        'action=rebuild_required（无法确认 app 包含最新代码，请执行 pnpm run upgrade:mac）'
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
        'action=rebuild_required（构建时工作区不干净，该构建不可复现，请执行 pnpm run upgrade:mac）'
    }
  }

  if (appCommit !== repoCommit) {
    const changedPaths = listPathsChangedSinceApp?.()
    const binaryFilesChanged = changedPaths?.filter(isBinaryRelevantPath).length
    if (changedPaths !== undefined && binaryFilesChanged === 0) {
      return {
        reason: 'non_binary_ahead',
        drifted: false,
        appCommit,
        repoCommit,
        summary:
          `drift=none app_commit=${appCommit} repo_commit=${repoCommit} ` +
          `ahead_files=${changedPaths.length} binary_files_changed=0`
      }
    }
    const aheadDetail =
      binaryFilesChanged === undefined
        ? 'ahead_check=unavailable'
        : `binary_files_changed=${binaryFilesChanged}`
    return {
      reason: 'commit_mismatch',
      drifted: true,
      appCommit,
      repoCommit,
      summary:
        `drift=commit_mismatch app_commit=${appCommit} repo_commit=${repoCommit} ${aheadDetail} ` +
        'action=rebuild_required（app 比仓库旧，修复未生效，请执行 pnpm run upgrade:mac）'
    }
  }

  return {
    reason: 'match',
    drifted: false,
    appCommit,
    repoCommit,
    summary: `drift=none app_commit=${appCommit} repo_commit=${repoCommit}`
  }
}
