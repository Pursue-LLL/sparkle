import type { ChildProcess } from 'child_process'
import { existsSync, watch } from 'fs'
import type { FSWatcher } from 'fs'

const coreHookTimeout = 30000

export interface CoreHookWaitTarget {
  hookDir: string
  upFile: string
  upFileName: string
}

export interface CoreHookWaiter {
  promise: Promise<void>
  attachProcess: (process: ChildProcess) => void
}

export function createCoreHookWaiter(hook: CoreHookWaitTarget): CoreHookWaiter {
  let watcher: FSWatcher | undefined
  let timer: NodeJS.Timeout | undefined
  let attachedProcess: ChildProcess | undefined
  let completed = false

  let resolvePromise: () => void
  let rejectPromise: (reason?: unknown) => void

  const cleanup = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (watcher) {
      watcher.close()
      watcher = undefined
    }
    if (attachedProcess) {
      attachedProcess.off('close', handleClose)
      attachedProcess = undefined
    }
  }

  const complete = (error?: unknown): void => {
    if (completed) return
    completed = true
    cleanup()
    if (error) {
      rejectPromise(error)
    } else {
      resolvePromise()
    }
  }

  const handleClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    complete(new Error(`内核启动失败，post-up 未触发，code: ${code}, signal: ${signal}`))
  }

  const isUpHookReady = (): boolean => existsSync(hook.upFile)

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject

    if (isUpHookReady()) {
      complete()
      return
    }

    watcher = watch(hook.hookDir, (_eventType, filename) => {
      const changedFile = filename?.toString()
      if (changedFile === hook.upFileName || isUpHookReady()) {
        complete()
      }
    })

    watcher.on('error', complete)

    timer = setTimeout(() => {
      if (isUpHookReady()) {
        complete()
        return
      }
      complete(new Error(`等待内核 post-up 超时：${coreHookTimeout}ms`))
    }, coreHookTimeout)
  })

  return {
    promise,
    attachProcess: (process) => {
      attachedProcess = process
      attachedProcess.once('close', handleClose)
    }
  }
}
