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
      const settled = waiter.promise.then(() => 'ready')
      await writeFile(hook.upFile, '')
      assert.equal(await settled, 'ready')
    } finally {
      await rm(hook.hookDir, { recursive: true, force: true })
    }
  })

  it('ignores unrelated files in the hook directory until the post-up file shows up', async () => {
    const hook = await createTestHook(false)
    try {
      const waiter = createCoreHookWaiter(hook)
      const outcome = waiter.promise.then(() => 'ready')

      await writeFile(path.join(hook.hookDir, 'unrelated.txt'), '')
      assert.equal(await Promise.race([outcome, sleep(100).then(() => 'pending')]), 'pending')

      await writeFile(hook.upFile, '')
      assert.equal(await outcome, 'ready')
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

  it('stops listening to the core once the post-up file is ready', async () => {
    const hook = await createTestHook(false)
    try {
      const waiter = createCoreHookWaiter(hook)
      const core = fakeCore()
      waiter.attachProcess(core)
      assert.equal(core.listenerCount('close'), 1)

      await writeFile(hook.upFile, '')
      await waiter.promise

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
