import { mkdir, rm } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { dataDir } from '../utils/dirs'
export type { CoreHookWaiter } from './coreHookWaiter'
export { createCoreHookWaiter } from './coreHookWaiter'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function hookTouchCommand(file: string): string {
  return process.platform === 'win32' ? `type nul > ${file}` : `: > ${shellQuote(file)}`
}

function coreHookDir(): string {
  if (process.platform === 'win32' && process.env.ProgramData) {
    return path.join(process.env.ProgramData, 'sparkle', 'core-hooks')
  }
  return path.join(dataDir(), 'core-hooks')
}

export interface CoreStartupHook {
  hookDir: string
  upFile: string
  upFileName: string
  postUpCommand: string
  postDownCommand: string
}

export async function createCoreStartupHook(): Promise<CoreStartupHook> {
  const runId = randomUUID()
  const hookDir = coreHookDir()

  await rm(hookDir, { recursive: true, force: true })
  await mkdir(hookDir, { recursive: true })

  const upFileName = `${runId}.up`
  const downFileName = `${runId}.down`
  const upFile = path.join(hookDir, upFileName)
  const downFile = path.join(hookDir, downFileName)

  return {
    hookDir,
    upFile,
    upFileName,
    postUpCommand: hookTouchCommand(upFile),
    postDownCommand: hookTouchCommand(downFile)
  }
}
