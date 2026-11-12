import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'
import type { CoreHookWaitTarget } from './coreHookWaiter'

type WatchListener = (eventType: string, filename: string | null) => void

class FakeWatcher extends EventEmitter {
  closed = false

  close(): void {
    this.closed = true
  }
}

const target: CoreHookWaitTarget = {
  hookDir: '/fake/hook-dir',
  upFile: '/fake/hook-dir/run.up',
  upFileName: 'run.up'
}

const world: {
  upFileExists: boolean
  watcher: FakeWatcher | undefined
  listener: WatchListener | undefined
} = { upFileExists: false, watcher: undefined, listener: undefined }

let moduleMocked = false

/** 用假的 fs.watch / existsSync 驱动等待器：目录事件完全由测试决定，不依赖文件系统的事件投递。 */
function loadModule(): typeof import('./coreHookWaiter') {
  if (!moduleMocked) {
    const realFs = require('fs') as typeof import('fs')
    mock.module('fs', {
      exports: {
        ...realFs,
        existsSync: (path: string) =>
          path === target.upFile ? world.upFileExists : realFs.existsSync(path),
        watch: (_dir: string, listener: WatchListener) => {
          world.watcher = new FakeWatcher()
          world.listener = listener
          return world.watcher
        }
      }
    })
    moduleMocked = true
  }
  delete require.cache[require.resolve('./coreHookWaiter')]
  return require('./coreHookWaiter')
}

const isPending = async (promise: Promise<void>): Promise<boolean> =>
  Promise.race([promise.then(() => false), settle().then(() => true)])

describe('createCoreHookWaiter with a scripted directory watcher', () => {
  beforeEach(() => {
    // 等待器自带 30 秒超时；用假时钟避免失败时真的挂满 30 秒
    mock.timers.enable({ apis: ['setTimeout'] })
  })

  afterEach(() => {
    mock.timers.reset()
    world.upFileExists = false
    world.watcher = undefined
    world.listener = undefined
  })

  it('does not start watching when the post-up file is already there', async () => {
    world.upFileExists = true

    await loadModule().createCoreHookWaiter(target).promise

    assert.equal(world.watcher, undefined)
  })

  it('rejects and releases the watcher when watching fails', async () => {
    const { promise } = loadModule().createCoreHookWaiter(target)
    const rejected = assert.rejects(promise, /EMFILE/)

    world.watcher?.emit('error', new Error('EMFILE: too many open files'))

    await rejected
    assert.equal(world.watcher?.closed, true)
  })

  it('checks the file itself when an event does not name it', async () => {
    const { promise } = loadModule().createCoreHookWaiter(target)

    world.listener?.('change', 'unrelated.txt')
    assert.equal(await isPending(promise), true)
    assert.equal(world.watcher?.closed, false)

    world.upFileExists = true
    world.listener?.('rename', null)
    await promise
    assert.equal(world.watcher?.closed, true)
  })

  it('accepts a post-up file that no event reported once the timeout fires', async () => {
    const { promise } = loadModule().createCoreHookWaiter(target)

    world.upFileExists = true
    assert.equal(await isPending(promise), true, 'without an event nothing notices the file yet')

    mock.timers.tick(30_000)

    assert.equal(await isPending(promise), false)
    assert.equal(world.watcher?.closed, true)
  })

  it('completes on the event that names the post-up file', async () => {
    const { promise } = loadModule().createCoreHookWaiter(target)

    world.listener?.('rename', target.upFileName)

    assert.equal(await isPending(promise), false)
    assert.equal(world.watcher?.closed, true)
  })
})
