// [INPUT] groupFailoverCore (POS: 故障转移纯决策层) · autoSwitchPolicy::resolveGroupPolicy (POS: 分组策略表)
// [OUTPUT] createGroupFailoverEngine · GroupFailoverDeps · GroupFailoverEngine
// [POS] 故障转移引擎的状态与编排：告警去重计数 → 读分组快照 → 决策 → 改选并固定 → 隔离失败节点 → 到期释放固定。
//       所有读写内核的动作经 deps 注入，引擎本身不依赖 Electron 与控制器，可脱离内核单测。
//       任务经同一队列串行执行：同一时刻只有一个改选 / 释放在读写分组。

import { describeError } from '../utils/errorMessage'
import { resolveGroupPolicy } from './autoSwitchPolicy'
import {
  FAILOVER_HOLD_MS,
  parseDialFailureGroup,
  planFailover,
  recordDialFailure,
  type DialFailureState,
  type FailoverGroupSnapshot
} from './groupFailoverCore'

export interface GroupFailoverDeps {
  /** 订阅内核 warning 级日志，返回取消订阅函数。 */
  subscribeAlerts: (listener: (log: ControllerLog) => void) => () => void
  loadGroup: (name: string) => Promise<FailoverGroupSnapshot | undefined>
  /** 把组固定到指定节点；被守卫拒绝时返回 false。 */
  pinNode: (group: string, node: string) => Promise<boolean>
  unpinNode: (group: string) => Promise<void>
  log: (line: string) => Promise<void>
  now: () => number
  /** 延时执行并返回取消函数。 */
  schedule: (task: () => void, delayMs: number) => () => void
}

export interface GroupFailoverEngine {
  /** 处理一条内核告警；完成改选（若触发）后 resolve。 */
  handleAlert: (log: ControllerLog) => Promise<void>
  /** 开始订阅内核告警，重复调用无副作用。 */
  start: () => void
}

interface OwnPin {
  node: string
  cancelRelease: () => void
}

export function createGroupFailoverEngine(deps: GroupFailoverDeps): GroupFailoverEngine {
  const failureStates = new Map<string, DialFailureState>()
  const quarantinedUntil = new Map<string, number>()
  const ownPins = new Map<string, OwnPin>()
  let queue: Promise<void> = Promise.resolve()
  let started = false

  /** 任务各自记录失败；队列吞掉残余异常，避免一次失败阻塞后续任务或产生未处理的 rejection。 */
  function enqueue(task: () => Promise<void>): Promise<void> {
    queue = queue.then(task).catch(() => undefined)
    return queue
  }

  function activeQuarantine(nowMs: number): Set<string> {
    for (const [node, until] of quarantinedUntil) {
      if (until <= nowMs) {
        quarantinedUntil.delete(node)
      }
    }
    return new Set(quarantinedUntil.keys())
  }

  function holdPin(group: string, node: string): void {
    ownPins.get(group)?.cancelRelease()
    const cancelRelease = deps.schedule(() => {
      void enqueue(() => releasePin(group, node))
    }, FAILOVER_HOLD_MS)
    ownPins.set(group, { node, cancelRelease })
  }

  /** 保留期满后把组交还给内核；固定已被用户或其它流程改动时不覆盖。 */
  async function releasePin(group: string, node: string): Promise<void> {
    if (ownPins.get(group)?.node !== node) {
      return
    }
    ownPins.delete(group)
    try {
      if ((await deps.loadGroup(group))?.fixed !== node) {
        return
      }
      await deps.unpinNode(group)
      await deps.log(`[GroupFailover]: released group=${group} node=${node}\n`)
    } catch (error) {
      await deps.log(`[GroupFailover]: release failed group=${group} err=${describeError(error)}\n`)
    }
  }

  async function failover(group: string): Promise<void> {
    try {
      const snapshot = await deps.loadGroup(group)
      if (!snapshot) {
        return
      }
      const nowMs = deps.now()
      const decision = planFailover(snapshot, {
        ownPin: ownPins.get(group)?.node,
        quarantined: activeQuarantine(nowMs),
        nowMs
      })
      if (decision.kind === 'skip') {
        const node = decision.badLeaf ? ` node=${decision.badLeaf}` : ''
        await deps.log(`[GroupFailover]: skipped group=${group} reason=${decision.reason}${node}\n`)
        return
      }
      if (!(await deps.pinNode(group, decision.target))) {
        return
      }
      quarantinedUntil.set(decision.badLeaf, nowMs + FAILOVER_HOLD_MS)
      holdPin(group, decision.target)
      await deps.log(
        `[GroupFailover]: switched group=${group} from=${decision.badLeaf} to=${decision.target} delay=${decision.targetDelay}ms\n`
      )
    } catch (error) {
      await deps.log(
        `[GroupFailover]: failover failed group=${group} err=${describeError(error)}\n`
      )
    }
  }

  function handleAlert(log: ControllerLog): Promise<void> {
    const group = parseDialFailureGroup(log)
    if (!group || !resolveGroupPolicy({ name: group }).failover) {
      return Promise.resolve()
    }
    const { next, fire } = recordDialFailure(failureStates.get(group), deps.now())
    failureStates.set(group, next)
    return fire ? enqueue(() => failover(group)) : Promise.resolve()
  }

  return {
    handleAlert,
    start: () => {
      if (started) {
        return
      }
      started = true
      deps.subscribeAlerts((log) => {
        void handleAlert(log)
      })
    }
  }
}
