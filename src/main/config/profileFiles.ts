// [INPUT] app/profile 配置 · 工作目录路径 · execWithElevation（权限修复） · profileFilesCore (POS: 路径与权限恢复决策)
// [OUTPUT] getFileStr · getFilePreviewStr · setFileStr · saveFileStrWithElevation: 订阅/工作目录内可编辑文件的读写
// [POS] 可编辑文件访问层：路径解析限定在工作目录，写入遇权限错误时按需提权修复，规则集(mrs)预览转文本。

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { fileToStr } from '@uruhalushia/sparkle-native'
import { mihomoProfileWorkDir, mihomoWorkDir } from '../utils/dirs'
import { execWithElevation } from '../utils/elevation'
import { getAppConfig } from './app'
import { getProfileConfig } from './profile'
import {
  buildPermissionRepairCommand,
  isManagedPath,
  resolveEditablePath,
  writeWithPermissionRecovery
} from './profileFilesCore'

function resolveEditableFilePath(
  path: string,
  current: string | undefined,
  diffWorkDir: boolean
): string {
  return resolveEditablePath(path, diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir())
}

async function repairEditableFilePermissions(target: string): Promise<void> {
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (uid == null || gid == null) {
    return
  }

  await execWithElevation('sh', ['-c', buildPermissionRepairCommand(target, uid, gid)])
}

async function attemptWriteFile(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf-8')
}

async function writeEditableFile(
  target: string,
  content: string,
  current: string | undefined,
  elevate: boolean
): Promise<void> {
  const canElevate =
    process.platform !== 'win32' &&
    isManagedPath(target, [mihomoWorkDir(), mihomoProfileWorkDir(current)])
  await writeWithPermissionRecovery(
    {
      write: () => attemptWriteFile(target, content),
      repair: () => (canElevate ? repairEditableFilePermissions(target) : Promise.resolve()),
      canElevate
    },
    elevate
  )
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
