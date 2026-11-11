// [INPUT] app/profile 配置 · 工作目录路径 · execWithElevation（权限修复）
// [OUTPUT] getFileStr · getFilePreviewStr · setFileStr · saveFileStrWithElevation: 订阅/工作目录内可编辑文件的读写
// [POS] 可编辑文件访问层：路径解析限定在工作目录，写入遇权限错误时按需提权修复，规则集(mrs)预览转文本。

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileToStr } from '@uruhalushia/sparkle-native'
import { mihomoProfileWorkDir, mihomoWorkDir } from '../utils/dirs'
import { execWithElevation } from '../utils/elevation'
import { getAppConfig } from './app'
import { getProfileConfig } from './profile'

const FILE_PERMISSION_ELEVATION_REQUIRED = 'FILE_PERMISSION_ELEVATION_REQUIRED'

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\\/.test(path)
}

function resolveEditableFilePath(
  path: string,
  current: string | undefined,
  diffWorkDir: boolean
): string {
  if (isAbsolutePath(path)) {
    return path
  }
  return join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), path)
}

function isSubPath(base: string, target: string): boolean {
  const relativePath = relative(resolve(base), resolve(target))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = 'code' in error ? error.code : undefined
  return code === 'EACCES' || code === 'EPERM'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function isManagedEditableFile(target: string, current: string | undefined): boolean {
  return [mihomoWorkDir(), mihomoProfileWorkDir(current)].some((root) => isSubPath(root, target))
}

function buildPermissionRepairCommand(
  target: string,
  uid: number,
  gid: number,
  repairParent: boolean
): string {
  const parts = [`t=${shellQuote(target)}`]

  if (repairParent) {
    parts.push(`p=${shellQuote(dirname(target))}`)
    parts.push(`mkdir -p "$p"`)
    parts.push(`chown ${uid}:${gid} "$p"`)
    parts.push(`chmod u+rwx "$p"`)
  }

  parts.push(`[ ! -e "$t" ] || { chown ${uid}:${gid} "$t" && chmod u+rw "$t"; }`)
  return parts.join('; ')
}

async function repairEditableFilePermissions(
  target: string,
  current: string | undefined
): Promise<void> {
  const repairParent = process.platform !== 'win32' && isManagedEditableFile(target, current)
  if (!repairParent) {
    return
  }

  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (uid == null || gid == null) {
    return
  }

  await execWithElevation('sh', [
    '-c',
    buildPermissionRepairCommand(target, uid, gid, repairParent)
  ])
}

async function attemptWriteFile(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf-8')
}

async function writeEditableFile(
  target: string,
  content: string,
  current: string | undefined,
  elevate = false
): Promise<void> {
  try {
    await attemptWriteFile(target, content)
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error
    }

    if (!elevate) {
      if (process.platform !== 'win32' && isManagedEditableFile(target, current)) {
        throw new Error(FILE_PERMISSION_ELEVATION_REQUIRED)
      }
      throw error
    }

    await repairEditableFilePermissions(target, current)
    await attemptWriteFile(target, content)
  }
}

export async function getFileStr(path: string): Promise<string> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  return await readFile(resolveEditableFilePath(path, current, diffWorkDir), 'utf-8')
}

export async function getFilePreviewStr(path: string, format?: string): Promise<string> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  const target = resolveEditableFilePath(path, current, diffWorkDir)
  if (format !== 'MrsRule') {
    return await readFile(target, 'utf-8')
  }

  return await convertMrsRuleToText(target)
}

async function convertMrsRuleToText(path: string): Promise<string> {
  const result = fileToStr(path, {
    outputTarget: 'mihomo',
    outputFormat: 'text',
    outputBehavior: 'auto'
  })
  let text = ''
  for (const output of Object.values(result.outputs)) {
    text += text ? `\n${output}` : output
  }
  if (!text) {
    return ''
  }
  return text
}

export async function setFileStr(path: string, content: string): Promise<void> {
  return await saveFileStr(path, content, false)
}

export async function saveFileStrWithElevation(path: string, content: string): Promise<void> {
  return await saveFileStr(path, content, true)
}

async function saveFileStr(path: string, content: string, elevate: boolean): Promise<void> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  const target = resolveEditableFilePath(path, current, diffWorkDir)
  await writeEditableFile(target, content, current, elevate)
}
