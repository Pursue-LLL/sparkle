// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置，真实临时文件）
// [OUTPUT] 巡检不碰线上出口的行为断言
// [POS] 钉死「探测与线上流量隔离」：探测只走本地隐藏通道，`🎯 agy 专用` 组在整轮探测期间不被切换、不被断连、不被重载，
// 只有在拿到结论之后才会改动。旧设计在扫描窗口里把用户的生产出口来回切、来回断，生产 400 大多发生在那些窗口里。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LOCATION,
  assertLog,
  cacheFileExists,
  drive,
  outcomesByNode,
  probeChannel,
  runBootstrap,
  settle,
  useAgyRig,
  world
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const LIVE_GROUP_WRITES = ['update:', 'change:', 'close:']
const isLiveGroupWrite = (call: string): boolean =>
  LIVE_GROUP_WRITES.some((prefix) => call.startsWith(prefix))
const liveGroupWrites = (): string[] => world.calls.filter(isLiveGroupWrite)

describe('sparkleAgyProbe isolation from production traffic', () => {
  it('keeps production on its exit for the whole scan and moves it only after the verdict', async () => {
    outcomesByNode({ '台湾-1': LOCATION })
    const liveSelectionAtSpawn: Array<string | undefined> = []
    world.onSpawn = () => liveSelectionAtSpawn.push(world.selection)

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '台湾-2'])
    assert.deepEqual(liveSelectionAtSpawn, ['台湾-1', '台湾-1', '台湾-1'])
    const lastProbeSwitch = world.calls.map((call) => call.startsWith('channel:')).lastIndexOf(true)
    assert.ok(world.calls.findIndex(isLiveGroupWrite) > lastProbeSwitch)
    assert.equal(world.selection, '台湾-2')
  })

  it('never moves production while a scan finds nothing', async () => {
    world.defaultOutcome = LOCATION

    await runBootstrap(agy())

    assert.equal(world.spawns.length, 8)
    assert.deepEqual(liveGroupWrites(), [])
    assert.equal(world.selection, '台湾-1')
  })

  it('makes a pin re-test invisible to production', async () => {
    await runBootstrap(agy())
    world.calls = []

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1'])
    assert.deepEqual(liveGroupWrites(), [])
  })

  it('points every probe process at the hidden probe channel', async () => {
    world.defaultOutcome = LOCATION

    await runBootstrap(agy())

    assert.ok(world.spawns.length > 0)
    for (const { env } of world.spawns) {
      assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:17899')
    }
  })

  it('degrades to "no verdict" when the channel cannot be used, never to a wrong verdict', async () => {
    world.channelFailure = true

    await runBootstrap(agy())
    await runBootstrap(agy())

    assert.equal(world.spawns.length, 0)
    assert.equal(cacheFileExists(), false)
    assert.equal(world.selection, '台湾-1')
    assertLog('pin 台湾-1 verdict=unknown streak=2')
    assertLog('(probed=0); keep 台湾-1 empty_rounds=1')
  })

  it('waits for the channel while another prober holds it', async () => {
    let release!: () => void
    const held = probeChannel().withLocalProbeChannelLock(
      '韩国-1',
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    await settle()

    const running = agy().bootstrapSparkleAgyProvider()
    await settle()
    assert.equal(world.spawns.length, 0, 'the channel belongs to the other prober for now')

    release()
    await held
    await drive(running)

    assert.deepEqual(world.probedVia, ['台湾-1'])
  })
})
