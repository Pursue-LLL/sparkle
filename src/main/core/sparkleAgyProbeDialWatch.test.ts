// [INPUT] sparkleAgyProbeCore 的 parseTcpDialFailureGroup / createAgyDialFailureWatch 与阈值常量 · sparkleAgyProbeWorld 的真实形状告警夹具
// [OUTPUT] 内核逐连接拨号失败告警的解析契约，以及风暴判定（窗口 / 阈值 / 冷却 / 整网故障保护 / 内存有界）的纯函数断言
// [POS] 被动触发的纯判定层：不碰定时器、不碰网络。入口行为与订阅接线见 sparkleAgyProbePassive.test.ts；
// 告警行格式一旦变化，这里的解析用例与 `pnpm run verify:failover` 会先于线上失效。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGY_DIAL_OUTAGE_THRESHOLD,
  AGY_DIAL_STORM_COOLDOWN_MS,
  AGY_DIAL_STORM_THRESHOLD,
  AGY_DIAL_STORM_WINDOW_MS,
  createAgyDialFailureWatch,
  parseTcpDialFailureGroup,
  type AgyDialFailureWatch
} from './sparkleAgyProbeCore'
import { AGY_GROUP, dialFailureLine } from './sparkleAgyProbeWorld'

describe('parseTcpDialFailureGroup', () => {
  const groupOf = (payload: string | undefined): string | undefined =>
    parseTcpDialFailureGroup({ payload })

  it('extracts the egress group from the warning mihomo logs for a failed TCP dial', () => {
    assert.equal(groupOf(dialFailureLine(AGY_GROUP)), AGY_GROUP)
  })

  it('keeps spaces and CJK in group names and survives parentheses in the source process name', () => {
    const line = (group: string, source: string): string =>
      `[TCP] dial ${group} (match DomainSuffix/gemini.google.com) ${source} --> gemini.google.com:443 error: i/o timeout`

    assert.equal(groupOf(line('Sparkle-台湾', '198.18.0.1:59188')), 'Sparkle-台湾')
    assert.equal(groupOf(line('grok 专用', '127.0.0.1:63819(Sparkle)')), 'grok 专用')
    assert.equal(
      groupOf(line('gemini专用', '198.18.0.1:59188(Google Chrome Helper (Aperitif))')),
      'gemini专用'
    )
  })

  it('ignores everything that is not a failed TCP dial', () => {
    const unrelated = [
      'because 自动选择 failed multiple times, activate health check',
      dialFailureLine(AGY_GROUP).replace('[TCP]', '[UDP]'),
      dialFailureLine(AGY_GROUP).replace('[TCP] ', ''),
      '',
      undefined
    ]

    for (const payload of unrelated) {
      assert.equal(groupOf(payload), undefined, String(payload))
    }
  })
})

describe('createAgyDialFailureWatch', () => {
  const SECOND = 1000
  const agyFailure = { payload: dialFailureLine(AGY_GROUP) }
  const grokFailure = { payload: dialFailureLine('grok 专用', '127.0.0.1:63819(Sparkle)') }

  /** 每隔 stepMs 喂一条同样的告警，返回触发的时刻。 */
  function feed(
    watch: AgyDialFailureWatch,
    log: { payload: string },
    count: number,
    stepMs: number,
    startMs = 0
  ): number[] {
    const fired: number[] = []
    for (let index = 0; index < count; index++) {
      const at = startMs + index * stepMs
      if (watch.observe(log, at)) {
        fired.push(at)
      }
    }
    return fired
  }

  it('keeps the thresholds calibrated on real core logs and quoted in ARCHITECTURE.md', () => {
    // 其余用例都按符号引用这些常量，改值时它们仍会通过：数值本身必须由这里钉住，改动要连同文档一起改。
    assert.deepEqual(
      {
        storm: AGY_DIAL_STORM_THRESHOLD,
        windowMs: AGY_DIAL_STORM_WINDOW_MS,
        outage: AGY_DIAL_OUTAGE_THRESHOLD,
        cooldownMs: AGY_DIAL_STORM_COOLDOWN_MS
      },
      { storm: 30, windowMs: 120_000, outage: 15, cooldownMs: 600_000 }
    )
  })

  it('fires once, on the failure that reaches the threshold inside the window', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)

    assert.deepEqual(feed(watch, agyFailure, 60, SECOND), [(AGY_DIAL_STORM_THRESHOLD - 1) * SECOND])
  })

  it('stays quiet just below the threshold', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)

    assert.deepEqual(feed(watch, agyFailure, AGY_DIAL_STORM_THRESHOLD - 1, SECOND), [])
  })

  it('never accumulates a slow drip, however long it lasts', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)

    // 每 5 秒一条：任何 120 秒窗口里至多 25 条，永远攒不到阈值。
    assert.deepEqual(feed(watch, agyFailure, 400, 5 * SECOND), [])
  })

  it('counts the window edge as inside and one millisecond more as outside', () => {
    const thirtiethAfter = (spanMs: number): boolean => {
      const watch = createAgyDialFailureWatch(AGY_GROUP)
      feed(watch, agyFailure, AGY_DIAL_STORM_THRESHOLD - 1, 1)
      return watch.observe(agyFailure, spanMs)
    }

    assert.equal(thirtiethAfter(AGY_DIAL_STORM_WINDOW_MS), true)
    assert.equal(thirtiethAfter(AGY_DIAL_STORM_WINDOW_MS + 1), false)
  })

  it('stays silent for the cooldown after firing, then fires again if the storm goes on', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)
    const firstFiredAt = (AGY_DIAL_STORM_THRESHOLD - 1) * SECOND

    assert.deepEqual(feed(watch, agyFailure, 700, SECOND), [
      firstFiredAt,
      firstFiredAt + AGY_DIAL_STORM_COOLDOWN_MS
    ])
  })

  it('does not fire while other groups fail alongside: that is the network, not the agy exit', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)

    feed(watch, grokFailure, AGY_DIAL_OUTAGE_THRESHOLD, SECOND)

    assert.deepEqual(feed(watch, agyFailure, 60, SECOND, AGY_DIAL_OUTAGE_THRESHOLD * SECOND), [])
  })

  it('treats a few failures of other groups as ordinary noise', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)

    feed(watch, grokFailure, AGY_DIAL_OUTAGE_THRESHOLD - 1, SECOND)

    assert.equal(feed(watch, agyFailure, 60, SECOND, AGY_DIAL_OUTAGE_THRESHOLD * SECOND).length, 1)
  })

  it('fires once the other groups have been quiet for longer than the window', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)
    feed(watch, grokFailure, AGY_DIAL_OUTAGE_THRESHOLD, SECOND)
    const stormStart = 200 * SECOND

    assert.deepEqual(feed(watch, agyFailure, 40, SECOND, stormStart), [
      stormStart + (AGY_DIAL_STORM_THRESHOLD - 1) * SECOND
    ])
  })

  it('never fires on the failures of other groups alone', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)

    assert.deepEqual(feed(watch, grokFailure, 500, 100), [])
  })

  it('does not count logs that are not TCP dial failures', () => {
    const watch = createAgyDialFailureWatch(AGY_GROUP)
    const healthCheckAlert = {
      payload: `because ${AGY_GROUP} failed multiple times, activate health check`
    }

    assert.deepEqual(feed(watch, healthCheckAlert, 100, 1), [])
    assert.equal(watch.observe({}, 0), false)
    assert.deepEqual(feed(watch, agyFailure, AGY_DIAL_STORM_THRESHOLD - 1, SECOND), [])
  })

  it('watches only the group it was created for', () => {
    assert.deepEqual(feed(createAgyDialFailureWatch('grok 专用'), agyFailure, 60, SECOND), [])
    assert.equal(feed(createAgyDialFailureWatch('grok 专用'), grokFailure, 60, SECOND).length, 1)
  })
})
