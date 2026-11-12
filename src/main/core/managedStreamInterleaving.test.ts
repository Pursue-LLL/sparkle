import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import WebSocket from 'ws'
import { RETRY_DELAY_MS, createRig, elapse, flush, type FakeSocket } from './managedStreamRig'
import { forSeedsAsync, type Random } from './seededProperty'

const RUNS = 300
const STEPS = 40

const isLive = (socket: FakeSocket): boolean =>
  socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN
/** 数据流仍在管理的连接：监听还挂着；被丢弃的连接已摘掉监听。 */
const isManaged = (socket: FakeSocket): boolean => socket.onclose !== null

describe('managed stream under random interleavings', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  afterEach(() => {
    mock.timers.reset()
  })

  async function runRandomSession(random: Random): Promise<void> {
    const rig = createRig({ maxRetries: random.int(1, 4) })
    const settled: Promise<void>[] = []
    const expectedMessages: string[] = []
    const gateReleases: (() => void)[] = []

    /** 之后发起的连接都卡在门口，直到 closeGate；重复开门不能丢掉先前的放行函数。 */
    const openGate = (): void => {
      rig.behavior.openGate = new Promise<void>((resolve) => {
        gateReleases.push(resolve)
      })
    }
    const closeGate = (): void => {
      for (const release of gateReleases.splice(0)) release()
      rig.behavior.openGate = undefined
    }
    const track = (promise: Promise<void>): void => {
      settled.push(promise.catch(() => undefined))
    }

    const steps: (() => Promise<void> | void)[] = [
      () => track(rig.stream.start()),
      () => track(rig.stream.start()),
      () => track(rig.stream.restart()),
      () => rig.stream.stop(),
      openGate,
      closeGate,
      () => {
        rig.behavior.openError = rig.behavior.openError ? undefined : new Error('refused')
      },
      () => {
        rig.sockets.filter(isManaged)[0]?.drop()
      },
      () => {
        const socket = random.pick(rig.sockets.length ? rig.sockets : [undefined])
        if (!socket) return
        if (isManaged(socket)) expectedMessages.push(`m${expectedMessages.length}`)
        socket.receive(`m${expectedMessages.length - 1}`)
      },
      () => {
        random.pick(rig.sockets.length ? rig.sockets : [undefined])?.onerror?.()
      },
      () => elapse(random.int(1, 3) * RETRY_DELAY_MS)
    ]

    for (let step = 0; step < STEPS; step++) {
      await random.pick(steps)()
      await flush()

      const live = rig.sockets.filter((socket) => isManaged(socket) && isLive(socket))
      assert.ok(live.length <= 1, `${live.length} connections are managed at once`)
      const zombies = rig.sockets.filter((socket) => !isManaged(socket) && isLive(socket))
      assert.equal(zombies.length, 0, 'a connection nobody manages is still open')
    }

    closeGate()
    rig.behavior.openError = undefined
    await flush()

    // 重连链不能因先前的任何经历而中断：停掉后重新开始，即使第一次连接失败，故障消失后也要自行恢复。
    rig.stream.stop()
    rig.behavior.openError = new Error('core restarting')
    track(rig.stream.start())
    await flush()
    rig.behavior.openError = undefined
    await elapse(RETRY_DELAY_MS)
    assert.equal(rig.sockets.filter((s) => isManaged(s) && isLive(s)).length, 1, 'no recovery')

    rig.stream.stop()
    await flush()
    await Promise.all(settled)
    const socketsAfterStop = rig.sockets.length
    await elapse(30 * RETRY_DELAY_MS)

    assert.equal(rig.sockets.length, socketsAfterStop, 'a stopped stream must not reconnect')
    assert.equal(rig.sockets.filter(isLive).length, 0, 'a stopped stream leaves no open connection')
    assert.deepEqual(rig.messages, expectedMessages, 'only managed connections deliver messages')
  }

  it('never keeps two connections, never leaks one, and stays stopped after stop', async () => {
    await forSeedsAsync(RUNS, (random) => runRandomSession(random))
  })
})
