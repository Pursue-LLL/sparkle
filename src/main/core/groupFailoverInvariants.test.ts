import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planAutoSwitchPinRelease, type AutoSwitchGroupSnapshot } from './autoSwitchPinReleaseCore'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import {
  CANDIDATE_MAX_SAMPLE_AGE_MS,
  DIAL_FAILURE_DEDUPE_MS,
  DIAL_FAILURE_WINDOW_MS,
  planFailover,
  recordDialFailure,
  type DialFailureState,
  type FailoverContext,
  type FailoverDecision,
  type FailoverGroupSnapshot,
  type FailoverMemberSnapshot
} from './groupFailoverCore'
import { forSeeds, type Random } from './seededProperty'

const RUNS = 500
const NOW = Date.parse('2026-11-12T08:00:00.000Z')
const URL_TEST_TYPES = ['URLTest', 'url-test', 'urltest', ' URLTest ']
const OTHER_TYPES = ['Selector', 'select', 'Fallback', 'LoadBalance', 'Relay']

describe('dial failure accounting (random alert streams)', () => {
  const EDGE_GAPS_MS = [
    0,
    1,
    DIAL_FAILURE_DEDUPE_MS - 1,
    DIAL_FAILURE_DEDUPE_MS,
    DIAL_FAILURE_DEDUPE_MS + 1,
    DIAL_FAILURE_WINDOW_MS - 1,
    DIAL_FAILURE_WINDOW_MS,
    DIAL_FAILURE_WINDOW_MS + 1
  ]

  function randomAlertTimes(random: Random): number[] {
    let at = NOW
    return Array.from({ length: random.int(1, 40) }, () => {
      at += random.chance(0.5)
        ? random.pick(EDGE_GAPS_MS)
        : random.int(0, 2 * DIAL_FAILURE_WINDOW_MS)
      return at
    })
  }

  /** 与状态机写法无关：先按去重间隔挑出计数告警，再从左到右两两配对，窗口内的第二条触发。 */
  function expectedFireTimes(alerts: readonly number[]): number[] {
    const counted: number[] = []
    for (const alert of alerts) {
      const last = counted.at(-1)
      if (last === undefined || alert - last >= DIAL_FAILURE_DEDUPE_MS) {
        counted.push(alert)
      }
    }
    const fires: number[] = []
    for (let index = 0; index + 1 < counted.length; ) {
      if (counted[index + 1] - counted[index] <= DIAL_FAILURE_WINDOW_MS) {
        fires.push(counted[index + 1])
        index += 2
      } else {
        index += 1
      }
    }
    return fires
  }

  it('fires on the second counted alert of each pair inside the window, and only then', () => {
    let firedRuns = 0
    forSeeds(RUNS, (random) => {
      const alerts = randomAlertTimes(random)
      const fired: number[] = []
      let state: DialFailureState | undefined
      for (const alert of alerts) {
        const result = recordDialFailure(state, alert)
        if (result.fire) fired.push(alert)
        state = result.next
      }

      assert.deepEqual(fired, expectedFireTimes(alerts))
      if (fired.length > 0) firedRuns += 1
    })
    assert.ok(firedRuns > RUNS / 4, `the generator rarely reaches a fire (${firedRuns}/${RUNS})`)
  })

  it('treats alerts inside the dedupe interval as one burst and leaves the state untouched', () => {
    forSeeds(RUNS, (random) => {
      const state: DialFailureState = {
        lastCountedAt: NOW,
        pendingAt: random.chance(0.5) ? NOW - random.int(0, DIAL_FAILURE_WINDOW_MS) : undefined
      }

      const result = recordDialFailure(state, NOW + random.int(0, DIAL_FAILURE_DEDUPE_MS - 1))

      assert.equal(result.fire, false)
      assert.deepEqual(result.next, state)
    })
  })
})

describe('failover planning (random groups)', () => {
  interface Scenario {
    group: FailoverGroupSnapshot
    ctx: FailoverContext
  }

  const isoAgo = (ageMs: number): string => new Date(NOW - ageMs).toISOString()

  function randomLastSampleTime(random: Random): string {
    const fresh = (): string => isoAgo(random.int(0, 5 * 60_000))
    return random.pick([
      fresh,
      fresh,
      fresh,
      () => isoAgo(CANDIDATE_MAX_SAMPLE_AGE_MS),
      () => isoAgo(CANDIDATE_MAX_SAMPLE_AGE_MS + 1),
      () => isoAgo(random.int(16 * 60_000, 3_600_000)),
      () => isoAgo(-random.int(1, 5 * 60_000)),
      () => 'not-a-date'
    ])()
  }

  function randomHistory(random: Random): ControllerProxiesHistory[] {
    const length = random.int(0, 3)
    const lastTime = randomLastSampleTime(random)
    return Array.from({ length }, (_, index) => ({
      time:
        index === length - 1
          ? lastTime
          : isoAgo(CANDIDATE_MAX_SAMPLE_AGE_MS + 60_000 * (length - index)),
      delay: random.pick([0, -1, Number.NaN, random.int(1, 400), random.int(1, 3000), 250])
    }))
  }

  function randomScenario(random: Random): Scenario {
    const names = Array.from({ length: random.int(1, 8) }, (_, index) => `node-${index}`)
    const members: FailoverMemberSnapshot[] = names.map((name) => {
      const isGroup = random.chance(0.12)
      return {
        name,
        isGroup,
        alive: random.chance(0.8),
        history: isGroup ? [] : randomHistory(random),
        extra: {}
      }
    })
    const now = random.chance(0.92) ? random.pick(names) : 'ghost-node'
    return {
      group: {
        name: 'Sparkle-台湾',
        type: random.chance(0.85) ? random.pick(URL_TEST_TYPES) : random.pick(OTHER_TYPES),
        now,
        fixed: random.pick([undefined, now, random.pick(names)]),
        members
      },
      ctx: {
        ownPin: random.pick([undefined, now, random.pick(names)]),
        quarantined: new Set(random.subset(names, 0.25)),
        nowMs: NOW
      }
    }
  }

  /** 按「最近一次探测成功、足够新、未被隔离、不是当前节点的叶子」的文字约定独立判断，不复用被测实现。 */
  function candidateDelays({ group, ctx }: Scenario): { name: string; delay: number }[] {
    return group.members.flatMap((member) => {
      if (member.isGroup || member.name === group.now || ctx.quarantined.has(member.name)) {
        return []
      }
      const last = member.history?.at(-1)
      if (!last || !(last.delay > 0)) return []
      const fresh = NOW - Date.parse(last.time) <= CANDIDATE_MAX_SAMPLE_AGE_MS
      return fresh ? [{ name: member.name, delay: last.delay }] : []
    })
  }

  function assertDecisionIsSound(scenario: Scenario, decision: FailoverDecision): void {
    const { group, ctx } = scenario
    const urlTest = ['urltest'].includes(group.type.trim().toLowerCase().replace(/-/g, ''))
    const currentIsLeaf = group.members.some((m) => !m.isGroup && m.name === group.now)
    const pinnedByUser =
      Boolean(group.fixed) && group.fixed === group.now && group.fixed !== ctx.ownPin
    const candidates = candidateDelays(scenario)

    if (!urlTest) {
      assert.deepEqual(decision, { kind: 'skip', reason: 'not-url-test' })
    } else if (!currentIsLeaf) {
      assert.deepEqual(decision, { kind: 'skip', reason: 'no-current-leaf' })
    } else if (pinnedByUser) {
      assert.deepEqual(decision, { kind: 'skip', reason: 'user-pin', badLeaf: group.now })
    } else if (candidates.length === 0) {
      assert.deepEqual(decision, { kind: 'skip', reason: 'no-candidate', badLeaf: group.now })
    } else {
      const fastest = Math.min(...candidates.map((candidate) => candidate.delay))
      assert.deepEqual(decision, {
        kind: 'switch',
        badLeaf: group.now,
        // 并列最快时取组内靠前的成员。
        target: candidates.find((candidate) => candidate.delay === fastest)?.name,
        targetDelay: fastest
      })
    }
  }

  it('decides soundly and purely for any group snapshot', () => {
    const outcomes = new Map<string, number>()
    forSeeds(RUNS, (random) => {
      const scenario = randomScenario(random)
      const before = JSON.stringify(scenario.group)

      const decision = planFailover(scenario.group, scenario.ctx)

      assert.equal(JSON.stringify(scenario.group), before, 'the snapshot must not be modified')
      assert.deepEqual(planFailover(scenario.group, scenario.ctx), decision)
      assertDecisionIsSound(scenario, decision)
      const label = decision.kind === 'switch' ? 'switch' : decision.reason
      outcomes.set(label, (outcomes.get(label) ?? 0) + 1)
    })

    for (const label of ['switch', 'not-url-test', 'no-current-leaf', 'user-pin', 'no-candidate']) {
      assert.ok((outcomes.get(label) ?? 0) >= RUNS / 50, `${label} is barely exercised`)
    }
  })

  it('never picks the failing node, a quarantined node or a sub-group as the target', () => {
    forSeeds(RUNS, (random) => {
      const { group, ctx } = randomScenario(random)

      const decision = planFailover(group, ctx)

      if (decision.kind === 'switch') {
        const target = group.members.find((member) => member.name === decision.target)
        assert.ok(target && !target.isGroup)
        assert.notEqual(decision.target, group.now)
        assert.equal(ctx.quarantined.has(decision.target), false)
      }
    })
  })
})

describe('pin release planning (random groups)', () => {
  const NODES = ['a', 'b', 'c', 'd']
  const NAMES = [AUTO_SELECT_GROUP_NAME, `  ${AUTO_SELECT_GROUP_NAME} `, 'Sparkle-香港', '订阅选择']

  function randomGroups(random: Random): AutoSwitchGroupSnapshot[] {
    return Array.from({ length: random.int(0, 8) }, (_, index) => ({
      name: random.chance(0.3) ? random.pick(NAMES) : `${random.pick(NAMES)}-${index}`,
      type: random.pick([...URL_TEST_TYPES, ...OTHER_TYPES]),
      fixed: random.pick([undefined, '', '  ', ...NODES, 'ghost', ' b ']),
      all: random.subset(NODES, 0.6)
    }))
  }

  const isAutoSwitch = (group: AutoSwitchGroupSnapshot): boolean =>
    group.name.trim() === AUTO_SELECT_GROUP_NAME ||
    group.type.trim().toLowerCase().replace(/-/g, '') === 'urltest'

  it('releases every pinned auto-switch group on a restart, and only those', () => {
    forSeeds(RUNS, (random) => {
      const groups = randomGroups(random)

      const releases = planAutoSwitchPinRelease(groups, 'all')

      const expected = groups.filter((group) => isAutoSwitch(group) && (group.fixed ?? '').trim())
      assert.deepEqual(
        releases.map((release) => release.group),
        expected.map((group) => group.name)
      )
      for (const [index, release] of releases.entries()) {
        const group = expected[index]
        assert.equal(release.pinnedNode, group.fixed?.trim())
        assert.equal(
          release.reason,
          group.all.includes(release.pinnedNode) ? 'cache-restored' : 'orphan'
        )
      }
    })
  })

  it('after a subscription refresh releases exactly the pins whose node left the group', () => {
    forSeeds(RUNS, (random) => {
      const groups = randomGroups(random)

      const orphans = planAutoSwitchPinRelease(groups, 'orphans')
      const everything = planAutoSwitchPinRelease(groups, 'all')

      assert.ok(orphans.every((release) => release.reason === 'orphan'))
      assert.deepEqual(
        orphans,
        everything.filter((release) => release.reason === 'orphan')
      )
    })
  })
})
