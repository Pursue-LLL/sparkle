// [INPUT] docDriftIndex::RepoSnapshot/isCodePath (POS: 文档漂移守护的数据模型与源码索引，规则层只和内存快照打交道) · node:fs · node:module · node:path · 根 package.json
// [OUTPUT] loadRepoSnapshot: 从磁盘装载仓库快照——递归遍历（跳过依赖与产物目录），收录全部文件路径、源码文本、文档与外部模块名 ·
//          SKIPPED_ROOT_DIRS: 从仓库根起算的跳过目录，必须都在 `.gitignore` 里
// [POS] 文档漂移守护的磁盘装载层，守护里唯一碰文件系统的一环。遍历磁盘而不是读 git 索引，
//       这样刚新建、还没 `git add` 的文件（正是最容易忘记登记 `_ARCH.md` 的时刻）也在扫描范围内。
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { isCodePath, type RepoSnapshot } from './docDriftIndex'

/** 任意深度都跳过：依赖与版本库。 */
const SKIPPED_ANYWHERE: ReadonlySet<string> = new Set(['node_modules', '.git'])

/**
 * 从仓库根起算的跳过目录：构建产物、构建时下载的资源与本地草稿，都是 `.gitignore` 里的目录项
 * （结尾的 `*` 表示根下的前缀匹配）。不跳过的话，本地跑过构建后这些目录里的文件会混进「代码事实」。
 */
export const SKIPPED_ROOT_DIRS: readonly string[] = [
  'dist',
  'out',
  'extra',
  'resources/files',
  'resources/sidecar',
  'temp-docs',
  '.tmp-*'
]

function isSkippedDir(rel: string): boolean {
  if (SKIPPED_ANYWHERE.has(rel.slice(rel.lastIndexOf('/') + 1))) return true
  return SKIPPED_ROOT_DIRS.some((pattern) =>
    pattern.endsWith('*')
      ? !rel.includes('/') && rel.startsWith(pattern.slice(0, -1))
      : rel === pattern
  )
}

const ROOT_DOC = 'ARCHITECTURE.md'
const MODULE_DOC = '_ARCH.md'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function externalModulesOf(root: string): Set<string> {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8')
  ) as PackageManifest
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...builtinModules
  ])
}

export function loadRepoSnapshot(root: string): RepoSnapshot {
  const paths = new Set<string>()
  const sources = new Map<string, string>()
  const docs = new Map<string, string>()

  function visit(dir: string): void {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (!isSkippedDir(rel)) visit(rel)
      } else if (entry.isFile()) {
        paths.add(rel)
        const isDoc = rel === ROOT_DOC || entry.name === MODULE_DOC
        if (isCodePath(rel) || isDoc) {
          const text = readFileSync(path.join(root, rel), 'utf8')
          if (isDoc) docs.set(rel, text)
          else sources.set(rel, text)
        }
      }
    }
  }

  visit('')
  return { paths, sources, docs, externalModules: externalModulesOf(root) }
}
