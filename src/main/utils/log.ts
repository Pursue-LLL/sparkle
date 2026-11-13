// [INPUT] config/app::getAppConfig (POS: 应用配置读写) ·
//         utils/dirs::appLogPath/coreLogPath/substoreLogPath/ensureLogDir (POS: 应用目录与路径常量) ·
//         utils/logFileSizeCore::nextLogFileSizeAfterAppend/resolveCachedLogFileSize/shouldTrimLogFile/trimLogContent… (POS: 日志文件大小记账与裁剪) ·
//         utils/logLineParseCore::createControllerLogFromOutLine (POS: 内核输出行解析)
// [OUTPUT] appendAppLog · publishMihomoLog · getCachedMihomoLogs · clearCachedMihomoLogs · setMihomoLogSource · createLogWritable
// [POS] 应用日志与内核日志：`appendAppLog` 是尽力而为的旁路（写失败只丢这一段、永不 reject）；写入流出错时摘掉坏流、下次写入重开；内核日志缓存并推送给渲染进程；文件大小按记账控制、超限裁剪。

import { BrowserWindow } from 'electron'
import { createWriteStream, readFileSync, statSync, type WriteStream, writeFileSync } from 'fs'
import { Writable } from 'stream'
import { getAppConfig } from '../config/app'
import { appLogPath, coreLogPath, substoreLogPath, ensureLogDir } from './dirs'
import {
  nextLogFileSizeAfterAppend,
  resolveCachedLogFileSize,
  shouldTrimLogFile,
  trimLogContent,
  trimTargetBytes
} from './logFileSizeCore'
import { createControllerLogFromOutLine } from './logLineParseCore'

type LogTarget = 'app' | 'core' | 'substore'
type MihomoLogSource = 'out' | 'ws'
type LogContent = string | Buffer
interface CachedControllerLog extends ControllerLog {
  seq: number
}

const streamMap = new Map<LogTarget, { path: string; stream: WriteStream }>()
const consumerCount = new Map<LogTarget, number>()
const writeQueue: Record<LogTarget, Promise<void>> = {
  app: Promise.resolve(),
  core: Promise.resolve(),
  substore: Promise.resolve()
}
const cachedLogs: CachedControllerLog[] = []
const cachedLogLimit = 2000
const logFileSizeMap = new Map<LogTarget, { path: string; size: number | null }>()
let nextLogSeq = 0
let mihomoLogSource: MihomoLogSource = 'out'
const logStreamHighWaterMark = 256 * 1024
const logTrimLowWatermarkRatio = 0.7

function resolveLogPath(target: LogTarget): string {
  switch (target) {
    case 'app':
      return appLogPath()
    case 'core':
      return coreLogPath()
    case 'substore':
      return substoreLogPath()
    default: {
      const exhaustiveTarget: never = target
      throw new Error(`Unsupported log target: ${exhaustiveTarget}`)
    }
  }
}

async function shouldSaveLogs(): Promise<boolean> {
  const { saveLogs = true } = await getAppConfig()
  return saveLogs
}

async function getMaxLogFileSizeBytes(): Promise<number> {
  const { maxLogFileSizeMB = 20 } = await getAppConfig()
  return Math.max(1, Math.floor(maxLogFileSizeMB) || 1) * 1024 * 1024
}

function getWriteStream(target: LogTarget): WriteStream {
  ensureLogDir()
  const nextPath = resolveLogPath(target)
  const current = streamMap.get(target)

  if (current?.path === nextPath) {
    return current.stream
  }
  current?.stream.end()

  const stream = createWriteStream(nextPath, { flags: 'a', highWaterMark: logStreamHighWaterMark })
  // 写入失败已通过 write 回调交给 appendLog 处理；没有 'error' 监听时同一个错误还会升级成
  // 主进程未捕获异常。出错的流已销毁，摘掉后下一次写入会重新打开文件。
  stream.on('error', () => {
    if (streamMap.get(target)?.stream === stream) {
      streamMap.delete(target)
    }
  })
  streamMap.set(target, { path: nextPath, stream })
  return stream
}

async function closeWriteStream(target: LogTarget): Promise<void> {
  const current = streamMap.get(target)
  if (!current) return

  streamMap.delete(target)
  const { stream } = current

  // 已销毁的流不会再发 close，等它会永远挂住写入队列
  if (stream.destroyed) return

  await new Promise<void>((resolve) => {
    stream.once('close', () => resolve())
    stream.end()
  })
}

function retainTarget(target: LogTarget): void {
  consumerCount.set(target, (consumerCount.get(target) || 0) + 1)
}

function releaseTarget(target: LogTarget): void {
  const nextCount = (consumerCount.get(target) || 1) - 1
  if (nextCount > 0) {
    consumerCount.set(target, nextCount)
    return
  }

  consumerCount.delete(target)
  void closeWriteStream(target)
}

function trimCachedLogs(): void {
  if (cachedLogs.length <= cachedLogLimit) return
  cachedLogs.splice(0, cachedLogs.length - cachedLogLimit)
}

function normalizeLogContent(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
}

function getLogFileSize(target: LogTarget, path: string): number {
  const cached = resolveCachedLogFileSize(logFileSizeMap.get(target), path)
  if (cached !== null) {
    return cached
  }

  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

async function trimLogFileToSize(
  target: LogTarget,
  path: string,
  targetBytes: number
): Promise<void> {
  await closeWriteStream(target)
  const result = trimLogContent(readFileSync(path, 'utf-8'), targetBytes)
  if (result.trimmed) {
    writeFileSync(path, result.content, 'utf-8')
  }
  logFileSizeMap.set(target, { path, size: result.size })
}

async function enforceLogFileSizeLimit(
  target: LogTarget,
  path: string,
  nextSize: number,
  maxBytes: number
): Promise<void> {
  logFileSizeMap.set(target, { path, size: nextSize })

  if (!shouldTrimLogFile(nextSize, maxBytes)) return

  await trimLogFileToSize(target, path, trimTargetBytes(maxBytes, logTrimLowWatermarkRatio))
}

function pushCachedLog(log: ControllerLog): CachedControllerLog {
  const entry: CachedControllerLog = {
    ...log,
    time: log.time || new Date().toLocaleString(),
    seq: ++nextLogSeq
  }
  cachedLogs.push(entry)
  trimCachedLogs()
  return entry
}

function broadcastLog(log: CachedControllerLog): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('mihomoLogs', log)
    }
  })
}

function cacheAndBroadcastLog(log: ControllerLog): void {
  broadcastLog(pushCachedLog(log))
}

function publishTargetLogLines(content: string, type: LogLevel): void {
  normalizeLogContent(content).forEach((line) => {
    cacheAndBroadcastLog(createControllerLogFromOutLine(line, type))
  })
}

function flushCoreLogLines(lineBuffer: string, content: string, type: LogLevel): string {
  const normalized = `${lineBuffer}${content}`.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const nextLineBuffer = lines.pop() || ''
  publishTargetLogLines(lines.join('\n'), type)
  return nextLineBuffer
}

function writeToStream(target: LogTarget, content: LogContent): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    getWriteStream(target).write(content, (error) => (error ? reject(error) : resolve()))
  })
}

const isMissingFileError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'

async function appendToLogFile(
  target: LogTarget,
  path: string,
  content: LogContent,
  maxBytes: number
): Promise<void> {
  // 写入前读取：缓存缺失时回退到 stat，写入后再读会把本次内容算两遍
  const sizeBeforeAppend = getLogFileSize(target, path)
  try {
    await writeToStream(target, content)
  } catch (error) {
    await closeWriteStream(target)
    if (!isMissingFileError(error)) throw error
    // 日志目录被删（什么都没写进去）：getWriteStream 会重建目录，换新流重试一次
    await writeToStream(target, content)
  }
  await enforceLogFileSizeLimit(
    target,
    path,
    nextLogFileSizeAfterAppend(sizeBeforeAppend, Buffer.byteLength(content)),
    maxBytes
  )
}

/**
 * 日志只是尽力而为：磁盘满、权限错误、配置读取失败时丢掉这一段日志即可，
 * 不能让调用方（上百处 `await appendAppLog`）的业务流程跟着失败。
 */
async function appendLog(target: LogTarget, content: LogContent): Promise<void> {
  try {
    if (content.length === 0 || !(await shouldSaveLogs())) return

    const path = resolveLogPath(target)
    const maxBytes = await getMaxLogFileSizeBytes()
    const queued = writeQueue[target].then(() => appendToLogFile(target, path, content, maxBytes))
    // 队列自身不能 reject，否则一次失败会挡住此后所有写入
    writeQueue[target] = queued.catch(() => undefined)
    await queued
  } catch {
    // 丢弃本段日志，原因见函数注释
  }
}

export function setMihomoLogSource(source: MihomoLogSource): void {
  mihomoLogSource = source
}

/** 不会 reject：落盘失败只丢这一段日志。 */
export async function appendAppLog(content: string): Promise<void> {
  const ts = new Date().toISOString()
  const stamped = content
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => `${ts} ${l}\n`)
    .join('')
  await appendLog('app', stamped || content)
}

export function publishMihomoLog(log: ControllerLog): void {
  if (mihomoLogSource !== 'ws') return
  cacheAndBroadcastLog(log)
}

export function getCachedMihomoLogs(): CachedControllerLog[] {
  return [...cachedLogs]
}

export function clearCachedMihomoLogs(): void {
  cachedLogs.length = 0
}

export function createLogWritable(target: LogTarget, type: LogLevel = 'info'): Writable {
  retainTarget(target)

  let lineBuffer = ''
  // 落盘失败（磁盘满、权限等）只丢这一段日志（appendLog 不会 reject）。若把错误交给 pipe 的目标流，
  // 整条子进程输出管道会出错并升级成主进程未捕获异常。
  const consume = (content: Buffer, callback: () => void): void => {
    if (target === 'core' && mihomoLogSource === 'out') {
      lineBuffer = flushCoreLogLines(lineBuffer, content.toString('utf-8'), type)
    }
    void appendLog(target, content).then(callback)
  }

  return new Writable({
    write(content: Buffer, _encoding, callback) {
      consume(content, callback)
    },
    writev(chunks, callback) {
      consume(Buffer.concat(chunks.map(({ chunk }) => chunk as Buffer)), callback)
    },
    // 正常结束（autoDestroy）与中途销毁都会走到这里，各只一次：发布最后半行，释放共用的写入流。
    // ws 模式下日志由 websocket 提供，残留的半行不再发布。
    destroy(error, callback) {
      if (mihomoLogSource === 'out') {
        publishTargetLogLines(lineBuffer.trim(), type)
      }
      releaseTarget(target)
      callback(error)
    }
  })
}
