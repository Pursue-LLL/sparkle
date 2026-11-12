// [INPUT] node:path
// [OUTPUT] FILE_PERMISSION_ELEVATION_REQUIRED · resolveEditablePath · isManagedPath · isPermissionError ·
//          buildPermissionRepairCommand · writeWithPermissionRecovery
// [POS] 可编辑文件访问的纯决策层：路径解析与归属判定、提权修复命令的转义、写入遇权限错误时的恢复流程。不含任何 IO。

import { dirname, isAbsolute, join, relative, resolve } from 'path'

/** 渲染进程按该字符串识别「需要提权后重试」，两端必须一致。 */
export const FILE_PERMISSION_ELEVATION_REQUIRED = 'FILE_PERMISSION_ELEVATION_REQUIRED'

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\\/.test(path)
}

/** 绝对路径原样使用，相对路径落在 baseDir 内。 */
export function resolveEditablePath(path: string, baseDir: string): string {
  return isAbsolutePath(path) ? path : join(baseDir, path)
}

function isSubPath(base: string, target: string): boolean {
  const relativePath = relative(resolve(base), resolve(target))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

/** target 是否位于任一受管目录内；只有受管文件才允许提权修复属主与权限。 */
export function isManagedPath(target: string, roots: string[]): boolean {
  return roots.some((root) => isSubPath(root, target))
}

export function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const { code } = error as { code?: unknown }
  return code === 'EACCES' || code === 'EPERM'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 把受管文件及其所在目录的属主与权限还给当前用户；路径经单引号转义，文件名里的引号 / 空格 / `$()` 不会被 shell 解释。 */
export function buildPermissionRepairCommand(target: string, uid: number, gid: number): string {
  return [
    `t=${shellQuote(target)}`,
    `p=${shellQuote(dirname(target))}`,
    `mkdir -p "$p"`,
    `chown ${uid}:${gid} "$p"`,
    `chmod u+rwx "$p"`,
    `[ ! -e "$t" ] || { chown ${uid}:${gid} "$t" && chmod u+rw "$t"; }`
  ].join('; ')
}

export interface PermissionRecoveryDeps {
  write: () => Promise<void>
  /** 提权修复属主与权限；调用方保证只在 canElevate 时有实际动作。 */
  repair: () => Promise<void>
  /** 受管文件且平台支持提权修复。 */
  canElevate: boolean
}

/**
 * 写入遇权限错误时：未授权提权则按能否提权抛出「需要提权」标记或原错误；已授权则修复后重试一次。
 * 非权限错误原样抛出。
 */
export async function writeWithPermissionRecovery(
  { write, repair, canElevate }: PermissionRecoveryDeps,
  elevate: boolean
): Promise<void> {
  try {
    await write()
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error
    }
    if (!elevate) {
      if (canElevate) {
        throw new Error(FILE_PERMISSION_ELEVATION_REQUIRED)
      }
      throw error
    }
    await repair()
    await write()
  }
}
