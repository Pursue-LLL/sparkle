import { BrowserWindow } from 'electron'
import { createWriteStream, readFileSync, statSync, type WriteStream, writeFileSync } from 'fs'
import { Writable } from 'stream'
import { getAppConfig } from '../config/app'
import { appLogPath, coreLogPath, substoreLogPath, ensureLogDir } from './dirs'
import {
  nextLogFileSizeAfterAppend,
  resolveCachedLogFileSize,
  shouldTrimLogFile,
  trimTargetBytes
} from './logFileSizeCore'

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
const logfmtFieldPattern = /([A-Za-z0-9_.-]+)=("(?:\\.|[^"\\])*"|[^\s]+)/g
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
  const sizeState = logFileSizeMap.get(target)

  if (!sizeState || sizeState.path !== nextPath) {
    logFileSizeMap.set(target, { path: nextPath, size: null })
  }

  if (current && current.path === nextPath) {
    return current.stream
  }

  if (current) {
    streamMap.delete(target)
    current.stream.end()
  }

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

  if (stream.closed || stream.destroyed) return

  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      stream.removeListener('close', onClose)
      stream.removeListener('error', onError)
      resolve()
    }

    const onClose = (): void => {
      cleanup()
    }

    const onError = (): void => {
      cleanup()
    }

    stream.once('close', onClose)
    stream.once('error', onError)
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

function isEmptyLogContent(content: LogContent): boolean {
  return typeof content === 'string' ? content.length === 0 : content.byteLength === 0
}

function getLogContentSize(content: LogContent): number {
  return typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.byteLength
}

function normalizeLogContent(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
}

function parseFileLines(content: string): { lines: string[]; hasTrailingNewline: boolean } {
  const normalized = content.replace(/\r\n/g, '\n')
  const hasTrailingNewline = normalized.endsWith('\n')
  const lines = normalized.split('\n')

  if (hasTrailingNewline) {
    lines.pop()
  }

  return {
    lines,
    hasTrailingNewline
  }
}

function getLogFileSize(target: LogTarget, path: string): number {
  const state = logFileSizeMap.get(target)
  const cached = resolveCachedLogFileSize(state, path)
  if (cached !== null) {
    return cached
  }

  try {
    const fileStat = statSync(path)
    logFileSizeMap.set(target, { path, size: fileStat.size })
    return fileStat.size
  } catch {
    logFileSizeMap.set(target, { path, size: 0 })
    return 0
  }
}

async function trimLogFileToSize(
  target: LogTarget,
  path: string,
  targetBytes: number
): Promise<void> {
  await closeWriteStream(target)
  let content: string
  try {
    content = readFileSync(path, 'utf-8')
  } catch {
    content = ''
  }
  const { lines, hasTrailingNewline } = parseFileLines(content)
  const normalizedContent = content.replace(/\r\n/g, '\n')
  let currentSize = Buffer.byteLength(normalizedContent, 'utf-8')

  if (currentSize <= targetBytes) {
    logFileSizeMap.set(target, { path, size: currentSize })
    return
  }

  let startIndex = 0
  while (startIndex < lines.length && currentSize > targetBytes) {
    currentSize -= Buffer.byteLength(lines[startIndex], 'utf-8')
    if (startIndex < lines.length - 1 || hasTrailingNewline) {
      currentSize -= 1
    }
    startIndex++
  }

  const trimmedLines = lines.slice(startIndex)
  const trimmedContent =
    trimmedLines.join('\n') + (trimmedLines.length > 0 && hasTrailingNewline ? '\n' : '')

  writeFileSync(path, trimmedContent, 'utf-8')
  logFileSizeMap.set(target, { path, size: Buffer.byteLength(trimmedContent, 'utf-8') })
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

const logfmtEscapes: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\'
}

// 单趟解码：逐个替换会把转义的反斜杠与其后的 n/r/t 误认成控制字符（C:\\new → 换行）
function unquoteLogfmtValue(value: string): string {
  if (!(value.startsWith('"') && value.endsWith('"'))) return value

  return value.slice(1, -1).replace(/\\([nrt"\\])/g, (_, escaped: string) => logfmtEscapes[escaped])
}

function parseLogfmtLine(line: string): Record<string, string> {
  const fields: Record<string, string> = {}

  for (const match of line.matchAll(logfmtFieldPattern)) {
    const [, key, rawValue] = match
    fields[key] = unquoteLogfmtValue(rawValue)
  }

  return fields
}

function normalizeOutLogTime(value?: string): string | undefined {
  if (!value) return undefined

  const normalizedValue = value.replace(/(\.\d{3})\d+([+-]\d{2}:\d{2}|Z)$/, '$1$2')
  const parsedTime = new Date(normalizedValue)

  if (Number.isNaN(parsedTime.getTime())) {
    return undefined
  }

  return parsedTime.toLocaleString()
}

function normalizeOutLogLevel(level: string | undefined, fallbackType: LogLevel): LogLevel {
  switch (level) {
    case 'error':
      return 'error'
    case 'warn':
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    case 'debug':
      return 'debug'
    default:
      return fallbackType
  }
}

function createControllerLogFromOutLine(line: string, fallbackType: LogLevel): ControllerLog {
  const fields = parseLogfmtLine(line)

  return {
    type: normalizeOutLogLevel(fields.level, fallbackType),
    payload: fields.msg?.trim() || line,
    time: normalizeOutLogTime(fields.time)
  }
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
    // 日志目录被删：重建后重试一次
    ensureLogDir()
    await writeToStream(target, content)
  }
  await enforceLogFileSizeLimit(
    target,
    path,
    nextLogFileSizeAfterAppend(sizeBeforeAppend, getLogContentSize(content)),
    maxBytes
  )
}

/**
 * 日志只是尽力而为：磁盘满、权限错误、配置读取失败时丢掉这一段日志即可，
 * 不能让调用方（上百处 `await appendAppLog`）的业务流程跟着失败。
 */
async function appendLog(target: LogTarget, content: LogContent): Promise<void> {
  try {
    if (isEmptyLogContent(content) || !(await shouldSaveLogs())) return

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
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    releaseTarget(target)
  }
  // 落盘失败（磁盘满、权限等）只丢这一段日志（appendLog 不会 reject）：把错误交给 pipe 的目标流，
  // 会让整条子进程输出管道出错并升级成主进程未捕获异常。
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
    final(callback) {
      if (target === 'core' && mihomoLogSource === 'out' && lineBuffer.trim()) {
        publishTargetLogLines(lineBuffer.trim(), type)
      }
      lineBuffer = ''
      release()
      callback()
    },
    destroy(error, callback) {
      if (target === 'core' && mihomoLogSource === 'out' && lineBuffer.trim()) {
        publishTargetLogLines(lineBuffer.trim(), type)
      }
      lineBuffer = ''
      release()
      callback(error)
    }
  })
}
