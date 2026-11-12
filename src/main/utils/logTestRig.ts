// 日志模块的测试脚手架：假 electron 窗口、假应用配置、假目录，文件写入走真实临时目录。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'
import { finished } from 'node:stream/promises'

export interface FakeWindow {
  destroyed: boolean
  sent: Array<{ channel: string; payload: unknown }>
}

export const world: {
  root: string
  logDir: string
  config: { saveLogs?: boolean; maxLogFileSizeMB?: number }
  windows: FakeWindow[]
  /** 为 true 时 ensureLogDir 不建目录（只生效一次），用来触发 ENOENT 重试路径。 */
  skipEnsureOnce: boolean
  /** 设置后 ensureLogDir 抛出该错误，模拟磁盘满 / 权限不足等落盘失败。 */
  ensureFailure: Error | undefined
  /** 设置后读取应用配置抛出该错误（配置文件损坏等）。 */
  configFailure: Error | undefined
  /** 日志模块打开过的写入流（按创建顺序），用来观察流的复用与关闭。 */
  streams: WriteStream[]
} = {
  root: '',
  logDir: '',
  config: {},
  windows: [],
  skipEnsureOnce: false,
  ensureFailure: undefined,
  configFailure: undefined,
  streams: []
}

let moduleMocked = false

export function loadLog(): typeof import('./log') {
  if (!moduleMocked) {
    const realFs = require('fs') as typeof import('fs')
    mock.module('fs', {
      exports: {
        ...realFs,
        createWriteStream: (...args: Parameters<typeof realFs.createWriteStream>) => {
          const stream = realFs.createWriteStream(...args)
          world.streams.push(stream)
          return stream
        }
      }
    })
    mock.module('electron', {
      exports: {
        BrowserWindow: {
          getAllWindows: () =>
            world.windows.map((window) => ({
              isDestroyed: () => window.destroyed,
              webContents: {
                send: (channel: string, payload: unknown) => {
                  window.sent.push({ channel, payload })
                }
              }
            }))
        }
      }
    })
    mock.module('../config/app', {
      exports: {
        getAppConfig: async () => {
          if (world.configFailure) {
            throw world.configFailure
          }
          return world.config
        }
      }
    })
    mock.module('./dirs', {
      exports: {
        appLogPath: () => path.join(world.logDir, 'app.log'),
        coreLogPath: () => path.join(world.logDir, 'core.log'),
        substoreLogPath: () => path.join(world.logDir, 'substore.log'),
        ensureLogDir: () => {
          if (world.ensureFailure) {
            throw world.ensureFailure
          }
          if (world.skipEnsureOnce) {
            world.skipEnsureOnce = false
            return
          }
          mkdirSync(world.logDir, { recursive: true })
        }
      }
    })
    moduleMocked = true
  }
  delete require.cache[require.resolve('./log')]
  return require('./log')
}

export const logFile = (name: string): string => path.join(world.logDir, name)
export const readLog = (name: string): string => readFileSync(logFile(name), 'utf-8')

export type LogWritable = ReturnType<ReturnType<typeof loadLog>['createLogWritable']>

/** 写入一段内容并等到它处理完（含落盘与缓存发布）。 */
export function writeAndWait(writable: LogWritable, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    writable.write(chunk, (error) => (error ? reject(error) : resolve()))
  })
}

/** 写入全部内容并等到 final 回调（含落盘与缓存发布）完成。 */
export async function pipeThrough(writable: LogWritable, ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    writable.write(chunk)
  }
  writable.end()
  await finished(writable)
}

export function resetWorld(): void {
  world.root = mkdtempSync(path.join(tmpdir(), 'sparkle-log-test-'))
  world.logDir = path.join(world.root, 'logs')
  world.config = {}
  world.windows = []
  world.skipEnsureOnce = false
  world.ensureFailure = undefined
  world.configFailure = undefined
  world.streams = []
}

export function cleanupWorld(): void {
  mock.timers.reset()
  rmSync(world.root, { recursive: true, force: true })
}
