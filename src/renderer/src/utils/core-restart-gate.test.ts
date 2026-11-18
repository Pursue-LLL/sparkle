import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCoalescingGate } from './core-restart-gate'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 让已排队的微任务（闸门交接）跑完。 */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/** 永不结束的任务，用来模拟卡死的重启。 */
function neverSettles(): Promise<void> {
  return new Promise<void>(() => {
    // 故意不 resolve / reject
  })
}

function recordingTask(
  started: string[],
  name: string,
  gateOpen: Deferred = deferred()
): () => Promise<void> {
  return () => {
    started.push(name)
    return gateOpen.promise
  }
}

describe('createCoalescingGate', () => {
  it('runs immediately when idle and reports busy only while running', async () => {
    const gate = createCoalescingGate(10_000)
    const started: string[] = []
    const open = deferred()

    assert.equal(gate.isBusy(), false)
    const first = gate.run(recordingTask(started, 'a', open))
    assert.deepEqual(started, ['a'])
    assert.equal(gate.isBusy(), true)

    open.resolve()
    await first
    await flush()
    assert.equal(gate.isBusy(), false)
  })

  it('does not start a second task while one is running', async () => {
    const gate = createCoalescingGate(10_000)
    const started: string[] = []
    const openA = deferred()
    const openB = deferred()

    const first = gate.run(recordingTask(started, 'a', openA))
    const second = gate.run(recordingTask(started, 'b', openB))
    await flush()
    assert.deepEqual(started, ['a'])

    openA.resolve()
    await first
    await flush()
    assert.deepEqual(started, ['a', 'b'])

    openB.resolve()
    await second
  })

  it('collapses any number of requests during a run into exactly one follow-up run', async () => {
    const gate = createCoalescingGate(10_000)
    const started: string[] = []
    const openA = deferred()
    const openB = deferred()

    const first = gate.run(recordingTask(started, 'a', openA))
    const followUps = [
      gate.run(recordingTask(started, 'b', openB)),
      gate.run(recordingTask(started, 'c')),
      gate.run(recordingTask(started, 'd'))
    ]

    openA.resolve()
    await first
    await flush()
    openB.resolve()
    await Promise.all(followUps)
    await flush()

    assert.deepEqual(started, ['a', 'b'])
    assert.equal(gate.isBusy(), false)
  })

  it('opens a new follow-up slot once the follow-up run has started', async () => {
    const gate = createCoalescingGate(10_000)
    const started: string[] = []
    const openA = deferred()
    const openB = deferred()
    const openC = deferred()

    const first = gate.run(recordingTask(started, 'a', openA))
    const second = gate.run(recordingTask(started, 'b', openB))
    openA.resolve()
    await first
    await flush()
    assert.deepEqual(started, ['a', 'b'])

    // b 已经在跑，此后到达的请求不能被 b 覆盖（b 已读过当时的配置），必须再排一次。
    const third = gate.run(recordingTask(started, 'c', openC))
    openB.resolve()
    await second
    await flush()
    assert.deepEqual(started, ['a', 'b', 'c'])

    openC.resolve()
    await third
  })

  it('rejects the caller of a failed run but still runs the queued one', async () => {
    const gate = createCoalescingGate(10_000)
    const started: string[] = []
    const openA = deferred()
    const openB = deferred()

    const first = gate.run(recordingTask(started, 'a', openA))
    const firstOutcome = assert.rejects(first, /boom/)
    const second = gate.run(recordingTask(started, 'b', openB))

    openA.reject(new Error('boom'))
    await firstOutcome
    await flush()
    assert.deepEqual(started, ['a', 'b'])

    openB.resolve()
    await second
    await flush()
    assert.equal(gate.isBusy(), false)
  })

  it('rejects every joiner of a failed follow-up run and recovers afterwards', async () => {
    const gate = createCoalescingGate(10_000)
    const started: string[] = []
    const openA = deferred()
    const openB = deferred()

    const first = gate.run(recordingTask(started, 'a', openA))
    const second = gate.run(recordingTask(started, 'b', openB))
    const third = gate.run(recordingTask(started, 'c'))
    const outcomes = Promise.all([assert.rejects(second, /late/), assert.rejects(third, /late/)])

    openA.resolve()
    await first
    await flush()
    openB.reject(new Error('late'))
    await outcomes
    await flush()
    assert.equal(gate.isBusy(), false)

    const open = deferred()
    const again = gate.run(recordingTask(started, 'd', open))
    open.resolve()
    await again
    assert.deepEqual(started, ['a', 'b', 'd'])
  })

  it('turns a synchronous task error into a rejection without sticking busy', async () => {
    const gate = createCoalescingGate(10_000)

    await assert.rejects(
      gate.run(() => {
        throw new Error('sync')
      }),
      /sync/
    )
    await flush()
    assert.equal(gate.isBusy(), false)
  })

  it('releases the gate and rejects the caller when a run exceeds the busy limit', async () => {
    const gate = createCoalescingGate(20)
    const started: string[] = []

    await assert.rejects(
      gate.run(() => {
        started.push('stuck')
        return neverSettles()
      }),
      /仍未完成/
    )
    await flush()
    assert.equal(gate.isBusy(), false)

    const open = deferred()
    const next = gate.run(recordingTask(started, 'next', open))
    open.resolve()
    await next
    assert.deepEqual(started, ['stuck', 'next'])
  })

  it('starts the queued run when the running one hits the busy limit', async () => {
    const gate = createCoalescingGate(20)
    const started: string[] = []
    const open = deferred()

    const stuck = gate.run(() => {
      started.push('stuck')
      return neverSettles()
    })
    const stuckOutcome = assert.rejects(stuck, /仍未完成/)
    const queued = gate.run(recordingTask(started, 'queued', open))

    await stuckOutcome
    await flush()
    assert.deepEqual(started, ['stuck', 'queued'])

    open.resolve()
    await queued
  })

  it('notifies subscribers on busy transitions and never flashes idle between handed-over runs', async () => {
    const gate = createCoalescingGate(10_000)
    const snapshots: boolean[] = []
    const unsubscribe = gate.subscribe(() => snapshots.push(gate.isBusy()))
    const started: string[] = []
    const openA = deferred()
    const openB = deferred()

    const first = gate.run(recordingTask(started, 'a', openA))
    const second = gate.run(recordingTask(started, 'b', openB))
    openA.resolve()
    await first
    await flush()
    openB.resolve()
    await second
    await flush()

    assert.deepEqual(snapshots, [true, true, false])

    unsubscribe()
    const open = deferred()
    const third = gate.run(recordingTask(started, 'c', open))
    open.resolve()
    await third
    await flush()
    assert.deepEqual(snapshots, [true, true, false])
  })
})
