// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置，真实临时文件）· sparkleAgyProbeCore 的节拍与周期常量
// [OUTPUT] 常驻巡检拍、pin 复测到期判断、pin 上任时间追踪的行为断言
// [POS] 巡检与 GUI 是否常驻无关：每一拍只在「复测到期」或「生产证据要求修复」时才碰订阅与内核，
// 其余拍只读状态与日志；pin 的上任时间是生产证据的计时起点，必须随真实选择走。
// 生产证据驱动的修复见 sparkleAgyProbeEvidence.test.ts。

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { GATE_OPEN } from './dedicatedGroupsRig'
import { AGY_DUTY_TICK_MS, AGY_PIN_CHECK_INTERVAL_MS } from './sparkleAgyProbeCore'
import {
  HOUR_MS,
  LOCATION,
  MINUTE_MS,
  NOW,
  readState,
  runBootstrap,
  runDialFailureRepair,
  runDueDuty,
  settle,
  useAgyRig,
  world,
  writeState
} from './sparkleAgyProbeRig'
import { spyOnTimer } from './timerSpyHarness'

const agy = useAgyRig()

/** 推进 `ticks` 拍常驻节拍，每拍等它做完。 */
async function tickLoop(ticks: number): Promise<void> {
  for (let tick = 0; tick < ticks; tick++) {
    mock.timers.tick(AGY_DUTY_TICK_MS)
    await settle()
  }
}

describe('startSparkleAgyProbeLoop', () => {
  const TICKS_PER_CHECK = AGY_PIN_CHECK_INTERVAL_MS / AGY_DUTY_TICK_MS

  it('registers one timer per minute that does not keep the process alive', () => {
    const timers = spyOnTimer('setInterval')
    try {
      agy().startSparkleAgyProbeLoop(GATE_OPEN)
      agy().startSparkleAgyProbeLoop(GATE_OPEN)

      assert.deepEqual(timers.delays, [AGY_DUTY_TICK_MS])
      assert.equal(timers.unrefs(), 1)
    } finally {
      timers.restore()
    }
  })

  it('leaves the subscription and the controller alone on every tick before the check is due', async () => {
    writeState({ lastPinCheckMs: NOW })
    agy().startSparkleAgyProbeLoop(GATE_OPEN)

    await tickLoop(TICKS_PER_CHECK - 1)

    assert.equal(world.profileReads, 0)
    assert.equal(world.spawns.length, 0)
    assert.deepEqual(world.calls, [])
  })

  it('checks the pin on the tick where its interval is up, then waits a full interval again', async () => {
    writeState({ lastPinCheckMs: NOW })
    agy().startSparkleAgyProbeLoop(GATE_OPEN)

    await tickLoop(TICKS_PER_CHECK)
    assert.equal(world.spawns.length, 1)

    await tickLoop(TICKS_PER_CHECK - 1)
    assert.equal(world.spawns.length, 1)

    await tickLoop(1)
    assert.equal(world.spawns.length, 2)
  })

  it('skips every tick while the agy group is off and resumes once it is back on', async () => {
    let open = false
    agy().startSparkleAgyProbeLoop(async () => open)

    await tickLoop(3)
    assert.equal(world.profileReads, 0)
    assert.equal(world.spawns.length, 0)

    open = true
    await tickLoop(1)
    assert.equal(world.spawns.length, 1)
  })

  it('survives a tick that cannot even write its log', async () => {
    world.profileFailure = { reason: new Error('profile config unreadable') }
    world.logFailure = true
    agy().startSparkleAgyProbeLoop(GATE_OPEN)
    await tickLoop(1)

    world.profileFailure = undefined
    world.logFailure = false
    await tickLoop(1)

    assert.equal(world.spawns.length, 1, 'the next tick still runs')
  })
})

describe('runSparkleAgyDueDuty: when the pin is checked', () => {
  it('checks a pin that was never checked and remembers when', async () => {
    await runDueDuty(agy())

    assert.equal(world.spawns.length, 1)
    assert.equal(readState()?.lastPinCheckMs, NOW)
  })

  it('stays out of the subscription and the controller until the interval has passed', async () => {
    writeState({ lastPinCheckMs: NOW - AGY_PIN_CHECK_INTERVAL_MS + 1 })

    await runDueDuty(agy())

    assert.equal(world.profileReads, 0)
    assert.deepEqual(world.calls, [])
    assert.equal(world.spawns.length, 0)
  })

  it('checks once exactly one interval has passed since the last check', async () => {
    writeState({ lastPinCheckMs: NOW - AGY_PIN_CHECK_INTERVAL_MS })

    await runDueDuty(agy())

    assert.equal(world.spawns.length, 1)
  })

  it('treats a clock that went backwards as due instead of never checking again', async () => {
    writeState({ lastPinCheckMs: NOW + HOUR_MS })

    await runDueDuty(agy())

    assert.equal(world.spawns.length, 1)
    assert.equal(readState()?.lastPinCheckMs, NOW)
  })

  it('does not retry an unusable agy CLI before the next interval', async () => {
    world.defaultOutcome = { kind: 'error' }
    await runDueDuty(agy())
    const spawned = world.spawns.length
    assert.equal(spawned, 1)
    assert.equal(readState()?.lastPinCheckMs, NOW)

    await runDueDuty(agy())

    assert.equal(world.spawns.length, spawned)
  })

  it('does not repeat the probe on the next tick when what followed the check failed', async () => {
    world.updateFailure = { reason: new Error('controller is down') }
    await runDueDuty(agy())
    assert.equal(world.spawns.length, 1)

    await runDueDuty(agy())

    assert.equal(world.spawns.length, 1)
  })

  it('checks at bootstrap whether or not the interval is up', async () => {
    writeState({ lastPinCheckMs: NOW })

    await runBootstrap(agy())

    assert.equal(world.spawns.length, 1)
  })

  it('counts a repair triggered by dial failures as a check', async () => {
    await runDialFailureRepair(agy())

    assert.equal(readState()?.lastPinCheckMs, NOW)
  })

  it('records no check when there was no time left to make one', async () => {
    await runDueDuty(agy(), NOW + 10_000)

    assert.equal(world.spawns.length, 0)
    assert.equal(readState()?.lastPinCheckMs, 0, 'still due at the next opportunity')
  })
})

describe('runSparkleAgyDueDuty: pin tenure', () => {
  it('starts the tenure when the pin is first seen and keeps it while the pin stays', async () => {
    await runBootstrap(agy())
    assert.deepEqual(readState()?.pin, { name: '台湾-1', sinceMs: NOW })

    mock.timers.tick(HOUR_MS)
    await runBootstrap(agy())

    assert.deepEqual(readState()?.pin, { name: '台湾-1', sinceMs: NOW })
  })

  it('starts a new tenure when someone else moved the pin', async () => {
    await runBootstrap(agy())
    world.selection = '日本-1'
    mock.timers.tick(HOUR_MS)

    await runBootstrap(agy())

    assert.deepEqual(readState()?.pin, { name: '日本-1', sinceMs: NOW + HOUR_MS })
  })

  it('records where its own switch landed, at the moment of the switch', async () => {
    // pin 两次确认都被拒；第一个候选超时（时钟推进 60s）；第二个候选可用。
    world.outcomes = [LOCATION, LOCATION, { kind: 'hang' }]

    await runBootstrap(agy())

    assert.equal(world.selection, '台湾-AnyTLS')
    assert.deepEqual(readState()?.pin, { name: '台湾-AnyTLS', sinceMs: NOW + MINUTE_MS })
  })
})
