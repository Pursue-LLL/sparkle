import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'fs/promises'
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
})
