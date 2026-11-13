// [INPUT] buildDriftPureCore::detectBuildDrift/normalizeCommit/RepoGitFacts (POS: 漂移判定 SSOT) · 系统 git
// [OUTPUT] GitRunner · createGitRunner · readRepoGitFacts · listPathsChangedSince · evaluateBuildDrift
// [POS] 漂移判定的 git 读取层，运行时（buildDriftCore）与 `pnpm run check:drift` 共用同一份实现。
//       任何 git 失败都返回 undefined，调用方据此区分「查不到」与「确实没有改动」。

import { execFileSync } from 'child_process'
import {
  detectBuildDrift,
  normalizeCommit,
  type BuildStampGitFacts,
  type DriftResult,
  type RepoGitFacts
} from './buildDriftPureCore'

/** 执行 git 并返回去掉末尾换行的 stdout；命令失败（含超时）返回 undefined。 */
export type GitRunner = (args: readonly string[]) => string | undefined

/** 启动时同步调用，卡死比查不到更糟，所以设上限。 */
const GIT_TIMEOUT_MS = 5000

export function createGitRunner(cwd: string): GitRunner {
  return (args) => {
    try {
      return execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_TIMEOUT_MS
      }).replace(/\r?\n$/, '')
    } catch {
      return undefined
    }
  }
}

/** 仓库当前 HEAD；不是 git 仓库或命令失败时 commit 为 'unknown'。 */
export function readRepoGitFacts(git: GitRunner): RepoGitFacts {
  return { commit: normalizeCommit(git(['rev-parse', 'HEAD'])) }
}

/** app 里烧进去的是短 hash；限定为十六进制，避免被 git 当成选项。 */
const COMMIT_PREFIX_RE = /^[0-9a-f]{4,40}$/

/**
 * app 构建提交到 HEAD 之间两棵树不同的文件（相对仓库根，重命名拆成旧路径与新路径）。
 *
 * 比较的是树而不是提交序列，所以构建提交不在 HEAD 的祖先链上时同样成立。
 * 构建提交在本仓库里解析不出来（历史被重写、哈希有歧义、浅克隆）或 git 失败时返回 undefined，
 * 空数组只表示两棵树完全一致。
 */
export function listPathsChangedSince(
  git: GitRunner,
  appCommit: string
): readonly string[] | undefined {
  if (!COMMIT_PREFIX_RE.test(appCommit)) {
    return undefined
  }
  const resolved = git(['rev-parse', '--verify', '--quiet', `${appCommit}^{commit}`])
  if (!resolved) {
    return undefined
  }
  const output = git(['diff', '--name-only', '--no-renames', '-z', resolved, 'HEAD'])
  return output === undefined ? undefined : output.split('\0').filter(Boolean)
}

/**
 * 用 git 读到的仓库事实评估 app 是否漂移；运行时与 `check:drift` 共用这一处组合。
 *
 * `git` 为 undefined 表示没找到仓库，判定为「无法确认」。
 */
export function evaluateBuildDrift(
  app: BuildStampGitFacts | undefined,
  git: GitRunner | undefined
): DriftResult {
  return detectBuildDrift(app, git && readRepoGitFacts(git), () =>
    app && git ? listPathsChangedSince(git, normalizeCommit(app.commit)) : undefined
  )
}
