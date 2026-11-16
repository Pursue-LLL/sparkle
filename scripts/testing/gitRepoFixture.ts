// [INPUT] scripts/writeBuildStampCore.ts::BUILD_STAMP_REL_PATH (POS: 构建标识格式与 git 事实 SSOT) ·
//         scripts/testing/tempDirs.ts::makeTempDir (POS: 临时目录登记与清理) · 本机 git
// [OUTPUT] createCommittedRepo: 已提交源码、package.json 与构建标记的临时 git 仓库 · writeRepoFile
// [POS] 构建标识相关测试共用的真实 git 夹具；提交不受本机全局 git 配置（签名、钩子）影响。
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BUILD_STAMP_REL_PATH } from '../writeBuildStampCore'
import { makeTempDir } from './tempDirs'

export function writeRepoFile(dir: string, relPath: string, content: string): void {
  const abs = path.join(dir, relPath)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

export function createCommittedRepo(): { dir: string; head: string } {
  const dir = makeTempDir('sparkle-build-stamp-')
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args
      ],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
  git('init', '-q')
  writeRepoFile(dir, 'package.json', '{ "version": "9.9.9" }\n')
  writeRepoFile(dir, 'src/app.ts', 'export const a = 1\n')
  writeRepoFile(dir, BUILD_STAMP_REL_PATH, "export const SPARKLE_GIT_COMMIT = 'old'\n")
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'first')
  return { dir, head: git('rev-parse', 'HEAD') }
}
