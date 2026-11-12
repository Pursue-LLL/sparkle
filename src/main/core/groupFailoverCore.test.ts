import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CANDIDATE_MAX_SAMPLE_AGE_MS,
  DIAL_FAILURE_DEDUPE_MS,
  DIAL_FAILURE_WINDOW_MS,
  FAILOVER_HOLD_MS,
  parseDialFailureGroup,
  planFailover,
  recordDialFailure,
  toFailoverSnapshot,
  type DialFailureState,
  type FailoverContext,
  type FailoverGroupSnapshot,
  type FailoverMemberSnapshot
} from './groupFailoverCore'

const atShanghai = (time: string): number => Date.parse(`2026-11-11T${time}+08:00`)

const NOW = atShanghai('12:00:00.000')

function leaf(
  name: string,
  delay: number | undefined,
  sampledAgoMs = 60_000
): FailoverMemberSnapshot {
  const history =
    delay === undefined ? [] : [{ time: new Date(NOW - sampledAgoMs).toISOString(), delay }]
  return { name, isGroup: false, history }
}

function group(overrides: Partial<FailoverGroupSnapshot> = {}): FailoverGroupSnapshot {
  return {
    name: 'Sparkle-台湾',
    type: 'URLTest',
    now: 'A',
    members: [leaf('A', 120), leaf('B', 200), leaf('C', 90), leaf('D', 0), leaf('E', undefined)],
    ...overrides
  }
}

function context(overrides: Partial<FailoverContext> = {}): FailoverContext {
  return { ownPin: undefined, quarantined: new Set(), nowMs: NOW, ...overrides }
}

describe('parseDialFailureGroup', () => {
  it('extracts the group name from the kernel dial-failure alert', () => {
    assert.equal(
      parseDialFailureGroup({
        payload: 'because Sparkle-台湾 failed multiple times, activate health check'
      }),
      'Sparkle-台湾'
    )
    assert.equal(
      parseDialFailureGroup({
        payload: 'because 自动选择 failed multiple times, activate health check'
      }),
      '自动选择'
    )
  })

  it('ignores every other log line', () => {
    for (const payload of [
      undefined,
      '',
      '[TCP] dial Sparkle-台湾 (match RuleSet/ai) 127.0.0.1:1 --> x.com:443 error: i/o timeout',
      'because Sparkle-台湾 failed',
      'Sparkle-台湾 failed multiple times, activate health check'
    ]) {
      assert.equal(parseDialFailureGroup({ payload }), undefined, String(payload))
    }
  })
})

describe('failover policy values', () => {
  // 这些数值写在 _ARCH.md 与缺陷台账里，并被 verify:failover 的节奏依赖；改动必须连同文档一起改。
  it('keeps the documented timings', () => {
    assert.equal(DIAL_FAILURE_DEDUPE_MS, 30_000)
    assert.equal(DIAL_FAILURE_WINDOW_MS, 180_000)
    assert.equal(FAILOVER_HOLD_MS, 10 * 60_000)
    assert.equal(CANDIDATE_MAX_SAMPLE_AGE_MS, 15 * 60_000)
  })
})

describe('recordDialFailure', () => {
  const fold = (times: number[]): number[] => {
    let state: DialFailureState | undefined
    return times.filter((at) => {
      const result = recordDialFailure(state, at)
      state = result.next
      return result.fire
    })
  }

  it('fires on the second counted alert inside the window and then starts over', () => {
    const t0 = NOW
    assert.deepEqual(fold([t0, t0 + 40_000, t0 + 80_000]), [t0 + 40_000])
    assert.deepEqual(fold([t0, t0 + 40_000, t0 + 80_000, t0 + 120_000]), [
      t0 + 40_000,
      t0 + 120_000
    ])
  })

  it('counts a burst of simultaneous alerts as one event', () => {
    const burst = Array.from({ length: 8 }, (_, index) => NOW + index)
    assert.deepEqual(fold(burst), [])
  })

  it('does not pair alerts that are further apart than the window', () => {
    assert.deepEqual(fold([NOW, NOW + DIAL_FAILURE_WINDOW_MS + 1]), [])
    assert.deepEqual(fold([NOW, NOW + DIAL_FAILURE_WINDOW_MS]), [NOW + DIAL_FAILURE_WINDOW_MS])
  })

  it('ignores alerts closer than the dedupe interval without moving the window', () => {
    const second = NOW + DIAL_FAILURE_DEDUPE_MS - 1
    const third = NOW + DIAL_FAILURE_DEDUPE_MS
    assert.deepEqual(fold([NOW, second, third]), [third])
  })

  /** 2026-11-11 11:15–11:41 内核日志里 Sparkle-台湾 的 21 条真实告警（毫秒截断）。 */
  const REAL_TAIWAN_ALERTS = [
    '11:15:12.184',
    '11:15:52.343',
    '11:17:34.515',
    '11:18:46.861',
    '11:20:06.019',
    '11:21:15.360',
    '11:22:27.491',
    '11:22:27.491',
    '11:24:52.472',
    '11:28:43.225',
    '11:36:01.698',
    '11:37:13.367',
    '11:37:13.367',
    '11:37:13.367',
    '11:37:23.819',
    '11:38:38.714',
    '11:38:38.714',
    '11:38:50.390',
    '11:40:04.815',
    '11:40:34.465',
    '11:41:47.141'
  ].map(atShanghai)

  it('turns the real 26-minute Sparkle-台湾 alert log into six failovers', () => {
    const expected = [
      '11:15:52.343',
      '11:18:46.861',
      '11:21:15.360',
      '11:24:52.472',
      '11:37:13.367',
      '11:40:04.815'
    ].map(atShanghai)
    assert.deepEqual(fold(REAL_TAIWAN_ALERTS), expected)
  })
})

describe('planFailover', () => {
  it('switches to the fastest member whose latest probe succeeded', () => {
    assert.deepEqual(planFailover(group(), context()), {
      kind: 'switch',
      badLeaf: 'A',
      target: 'C',
      targetDelay: 90
    })
  })

  it('never targets the failing node, quarantined nodes, failed probes or untested nodes', () => {
    const decision = planFailover(group(), context({ quarantined: new Set(['C']) }))
    assert.deepEqual(decision, { kind: 'switch', badLeaf: 'A', target: 'B', targetDelay: 200 })
  })

  it('does not trust a node that failed its latest probe even if it succeeded earlier', () => {
    const flaky: FailoverMemberSnapshot = {
      name: 'C',
      isGroup: false,
      history: [
        { time: new Date(NOW - 120_000).toISOString(), delay: 30 },
        { time: new Date(NOW - 60_000).toISOString(), delay: 0 }
      ]
    }
    const members = [leaf('A', 120), leaf('B', 200), flaky]
    assert.deepEqual(planFailover(group({ members }), context()), {
      kind: 'switch',
      badLeaf: 'A',
      target: 'B',
      targetDelay: 200
    })
  })

  it('skips candidates whose latest success is older than the freshness bound', () => {
    const members = [
      leaf('A', 120),
      leaf('B', 200, CANDIDATE_MAX_SAMPLE_AGE_MS + 1_000),
      leaf('C', 90, CANDIDATE_MAX_SAMPLE_AGE_MS - 1_000)
    ]
    assert.deepEqual(planFailover(group({ members }), context()), {
      kind: 'switch',
      badLeaf: 'A',
      target: 'C',
      targetDelay: 90
    })
    assert.deepEqual(planFailover(group({ members: members.slice(0, 2) }), context()), {
      kind: 'skip',
      reason: 'no-candidate',
      badLeaf: 'A'
    })
  })

  it('accepts a sample exactly at the freshness bound and rejects one millisecond older', () => {
    const decide = (sampledAgoMs: number): string =>
      planFailover(group({ members: [leaf('A', 120), leaf('B', 200, sampledAgoMs)] }), context())
        .kind
    assert.equal(decide(15 * 60_000), 'switch')
    assert.equal(decide(15 * 60_000 + 1), 'skip')
  })

  it('keeps the first of several equally fast candidates', () => {
    const members = [leaf('A', 120), leaf('B', 90), leaf('C', 90), leaf('D', 90)]
    assert.deepEqual(planFailover(group({ members }), context()), {
      kind: 'switch',
      badLeaf: 'A',
      target: 'B',
      targetDelay: 90
    })
  })

  it('treats an unparsable sample time as stale', () => {
    const broken: FailoverMemberSnapshot = {
      name: 'B',
      isGroup: false,
      history: [{ time: 'not-a-time', delay: 50 }]
    }
    assert.equal(planFailover(group({ members: [leaf('A', 120), broken] }), context()).kind, 'skip')
  })

  it('only acts on url-test groups', () => {
    assert.deepEqual(planFailover(group({ type: 'Selector' }), context()), {
      kind: 'skip',
      reason: 'not-url-test'
    })
    assert.equal(planFailover(group({ type: 'url-test' }), context()).kind, 'switch')
  })

  it('leaves a pin the user set and the kernel is honouring', () => {
    assert.deepEqual(planFailover(group({ fixed: 'A' }), context()), {
      kind: 'skip',
      reason: 'user-pin',
      badLeaf: 'A'
    })
  })

  it('moves off the pin the engine itself set', () => {
    const decision = planFailover(group({ fixed: 'A' }), context({ ownPin: 'A' }))
    assert.equal(decision.kind, 'switch')
  })

  it('acts when a stale pin is no longer honoured by the kernel', () => {
    const decision = planFailover(group({ fixed: 'Z' }), context())
    assert.equal(decision.kind, 'switch')
  })

  it('skips when the node in use is not a leaf of the group', () => {
    assert.deepEqual(planFailover(group({ now: 'nested' }), context()), {
      kind: 'skip',
      reason: 'no-current-leaf'
    })
    const members: FailoverMemberSnapshot[] = [
      {
        name: 'nested',
        isGroup: true,
        history: [{ time: new Date(NOW).toISOString(), delay: 10 }]
      },
      leaf('B', 100)
    ]
    assert.equal(planFailover(group({ now: 'nested', members }), context()).kind, 'skip')
  })

  it('reports no candidate when every other member is unusable', () => {
    const members = [leaf('A', 120), leaf('D', 0), leaf('E', undefined)]
    assert.deepEqual(planFailover(group({ members }), context()), {
      kind: 'skip',
      reason: 'no-candidate',
      badLeaf: 'A'
    })
  })

  it('judges candidates on the probe address the group actually uses', () => {
    const wrongUrlOnly: FailoverMemberSnapshot = {
      name: 'B',
      isGroup: false,
      extra: {
        'https://chatgpt.com': {
          alive: true,
          history: [{ time: new Date(NOW - 5_000).toISOString(), delay: 80 }]
        },
        'https://x.com': {
          alive: false,
          history: [{ time: new Date(NOW - 5_000).toISOString(), delay: 0 }]
        }
      }
    }
    const decision = planFailover(
      group({ members: [leaf('A', 120), wrongUrlOnly], testUrl: 'https://x.com' }),
      context()
    )
    assert.equal(decision.kind, 'skip')
    const onChatgpt = planFailover(
      group({ members: [leaf('A', 120), wrongUrlOnly], testUrl: 'https://chatgpt.com' }),
      context()
    )
    assert.equal(onChatgpt.kind, 'switch')
  })
})

describe('toFailoverSnapshot', () => {
  it('maps a controller group and marks nested groups by their own member list', () => {
    const history = [{ time: '2026-11-11T04:00:00.000Z', delay: 80 }]
    const extra = { 'https://x.com': { alive: true, history } }
    const controllerGroup = {
      name: 'Sparkle-香港',
      type: 'URLTest',
      now: 'HK-1',
      fixed: 'HK-1',
      testUrl: 'https://x.com',
      all: [
        { name: 'HK-1', type: 'Vless', alive: true, history, extra },
        { name: 'nested', type: 'Selector', alive: true, history: [], extra: {}, all: ['HK-1'] }
      ]
    } as unknown as ControllerMixedGroup

    assert.deepEqual(toFailoverSnapshot(controllerGroup), {
      name: 'Sparkle-香港',
      type: 'URLTest',
      now: 'HK-1',
      fixed: 'HK-1',
      testUrl: 'https://x.com',
      members: [
        { name: 'HK-1', isGroup: false, alive: true, history, extra },
        { name: 'nested', isGroup: true, alive: true, history: [], extra: {} }
      ]
    })
  })
})
