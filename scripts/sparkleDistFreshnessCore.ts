// [INPUT] git commit + working-tree digest
// [OUTPUT] Sparkle build meta + dist freshness evaluation (install-only gate SSOT)
// [POS] Agent upgrade — block same-semver stale dist installs without touching proxy logic.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SPARKLE_BUILD_META_FILENAME = '.sparkle-build-meta.json' as const

export interface SparkleBuildMeta {
  semver: string
  buildStamp: string
  gitCommit: string
  sourceTreeHash: string
}

export interface DistFreshnessEvaluation {
  fresh: boolean
  reason: string
}

export function formatSourceTreeHash(gitCommit: string, workingTreeDigest: string): string {
  return `${gitCommit}:${workingTreeDigest}`
}

export function digestWorkingTreeDiff(diffText: string): string {
  return createHash('sha256').update(diffText).digest('hex')
}

export function evaluateDistFreshness(input: {
  distMeta: SparkleBuildMeta | null
  current: SparkleBuildMeta
}): DistFreshnessEvaluation {
  const { distMeta, current } = input
  if (!distMeta) {
    return { fresh: false, reason: 'missing_dist_meta' }
  }
  if (distMeta.semver !== current.semver) {
    return { fresh: false, reason: 'semver_mismatch' }
  }
  if (distMeta.gitCommit !== current.gitCommit) {
    return { fresh: false, reason: 'git_commit_drift' }
  }
  if (distMeta.sourceTreeHash !== current.sourceTreeHash) {
    return { fresh: false, reason: 'source_tree_drift' }
  }
  return { fresh: true, reason: 'ok' }
}

function readSemverFromPackageJson(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version?: string
    }
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : null
  } catch {
    return null
  }
}

function readBuildStampFromSource(root: string): string | null {
  const stampPath = join(root, 'src/shared/buildStamp.ts')
  if (!existsSync(stampPath)) {
    return null
  }
  const text = readFileSync(stampPath, 'utf8')
  const match = text.match(/SPARKLE_BUILD_STAMP = '([^']+)'/)
  return match?.[1] ?? null
}

/**
 * `git diff HEAD --` on this repo is multi-MB; the execFileSync default
 * maxBuffer (1MB) threw ENOBUFS, which was silently swallowed into an empty
 * diff — making the tree fingerprint the empty-string hash and letting every
 * build look "fresh" (install-only stale bundles). Raise the cap and never let
 * a failed diff masquerade as a clean tree.
 */
export const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024

type GitResult = { ok: true; text: string } | { ok: false }

function runGit(root: string, args: string[]): GitResult {
  try {
    const output = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: GIT_MAX_BUFFER_BYTES,
    })
    return { ok: true, text: output }
  } catch {
    return { ok: false }
  }
}

/** Fail-safe: an unavailable diff must NOT look like a clean tree. */
export function resolveWorkingTreeDiffText(input: {
  ok: boolean
  text?: string
  gitCommit: string
}): string {
  return input.ok ? (input.text ?? '') : `git_diff_failed@${input.gitCommit}`
}

export function collectCurrentBuildMeta(root: string): SparkleBuildMeta | null {
  const semver = readSemverFromPackageJson(root)
  const buildStamp = readBuildStampFromSource(root)
  if (!semver || !buildStamp) {
    return null
  }

  const commitResult = runGit(root, ['rev-parse', 'HEAD'])
  const gitCommit = commitResult.ok && commitResult.text.trim().length > 0
    ? commitResult.text.trim()
    : 'unknown'
  const diffResult = runGit(root, ['diff', 'HEAD', '--'])
  const diffText = resolveWorkingTreeDiffText({
    ok: diffResult.ok,
    text: diffResult.ok ? diffResult.text : undefined,
    gitCommit,
  })
  const sourceTreeHash = formatSourceTreeHash(gitCommit, digestWorkingTreeDiff(diffText))

  return { semver, buildStamp, gitCommit, sourceTreeHash }
}

export function resolveDistBuildMetaPath(appPath: string): string {
  return join(appPath, 'Contents/Resources', SPARKLE_BUILD_META_FILENAME)
}

export function readDistBuildMeta(appPath: string): SparkleBuildMeta | null {
  const metaPath = resolveDistBuildMetaPath(appPath)
  if (!existsSync(metaPath)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<SparkleBuildMeta>
    if (
      typeof parsed.semver !== 'string' ||
      typeof parsed.buildStamp !== 'string' ||
      typeof parsed.gitCommit !== 'string' ||
      typeof parsed.sourceTreeHash !== 'string'
    ) {
      return null
    }
    return {
      semver: parsed.semver,
      buildStamp: parsed.buildStamp,
      gitCommit: parsed.gitCommit,
      sourceTreeHash: parsed.sourceTreeHash,
    }
  } catch {
    return null
  }
}

export function serializeBuildMeta(meta: SparkleBuildMeta): string {
  return `${JSON.stringify(meta, null, 2)}\n`
}
