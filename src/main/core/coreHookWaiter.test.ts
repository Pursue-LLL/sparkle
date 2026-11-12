import assert from 'node:assert/strict'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { tmpdir } from 'os'
import path from 'path'
import { describe, it } from 'node:test'
import { createCoreHookWaiter, type CoreHookWaitTarget } from './coreHookWaiter'

async function createTestHook(upFileExists: boolean): Promise<CoreHookWaitTarget> {
  const hookDir = await mkdtemp(path.join(tmpdir(), 'sparkle-hook-'))
  const upFileName = 'run.up'
  const upFile = path.join(hookDir, upFileName)
  if (upFileExists) {
    await writeFile(upFile, '')
  }
  return {
    hookDir,
    upFile,
    upFileName
  }
}

/**
 * macOS 的 FSEvents 会丢掉 watch 刚建立时发生的事件。等待器收到任何目录事件都会重新检查文件，
 * 所以文件就位后补发事件，直到它完成。
 */
async function settleByPoking(promise: Promise<void>, hookDir: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await writeFile(path.join(hookDir, `poke-${attempt}`), '')
    const outcome = await Promise.race([
      promise.then(() => 'settled'),
      sleep(100).then(() => 'waiting')
    ])
    if (outcome === 'settled') return
  }
  await promise
}

function fakeCore(): ChildProcess {
  return new EventEmitter() as ChildProcess
}

describe('createCoreHookWaiter', () => {
  it('resolves immediately when post-up file already exists', async () => {
    const hook = await createTestHook(true)
    try {
      const waiter = createCoreHookWaiter(hook)
      await waiter.promise
      assert.ok(true)
    } finally {
      await rm(hook.hookDir, { recursive: true, force: true })
    }
  })

  it('resolves when post-up file is created after watcher starts', async () => {
    const hook = await createTestHook(false)
    try {
      const waiter = createCoreHookWaiter(hook)
      await writeFile(hook.upFile, '')

      await settleByPoking(waiter.promise, hook.hookDir)
    } finally {
      await rm(hook.hookDir, { recursive: true, force: true })
    }
  })

  it('rejects when the core exits before the post-up file appears', async () => {
    const hook = await createTestHook(false)
    try {
      const waiter = createCoreHookWaiter(hook)
      const core = fakeCore()
      waiter.attachProcess(core)

      const rejected = assert.rejects(waiter.promise, /内核启动失败.*code: 1, signal: null/)
      core.emit('close', 1, null)

      await rejected
      assert.equal(core.listenerCount('close'), 0)
    } finally {
      await rm(hook.hookDir, { recursive: true, force: true })
    }
  })

  it('stays settled after the first outcome', async () => {
    const hook = await createTestHook(true)
    try {
      const waiter = createCoreHookWaiter(hook)
      const core = fakeCore()
      await waiter.promise

      waiter.attachProcess(core)
      core.emit('close', 1, null)

      await waiter.promise
    } finally {
      await rm(hook.hookDir, { recursive: true, force: true })
    }
  })

  it('gives up after 30 seconds without the post-up file', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const hook = await createTestHook(false)
    try {
      const waiter = createCoreHookWaiter(hook)
      const rejected = assert.rejects(waiter.promise, /等待内核 post-up 超时：30000ms/)

      t.mock.timers.tick(29_999)
      t.mock.timers.tick(1)

      await rejected
    } finally {
      await rm(hook.hookDir, { recursive: true, force: true })
    }
  })
})
