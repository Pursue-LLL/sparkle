// [INPUT] dedicatedGroups::DEDICATED_GROUPS/DEDICATED_GROUP_IDS (POS: 可开关专用组注册表与开关解析) ·
//         proxyGroupOrder::groupDisplayRank (POS: 分组展示顺序与档位)
// [OUTPUT] GroupsWithPlaceholders · withDisabledGroupPlaceholders
// [POS] 代理页「已关闭专用组」的占位：关闭的组在内核里不存在，页面按它原本的展示档位插回一个只读占位，
//       让用户在原位置就能重新开启；切换进行中的组保持切换前的样子（关闭中仍是真实标题，开启中仍是占位），列表长度不抖动。
//       无副作用，仅在渲染进程用于代理页，不改变分组数据源。

import { DEDICATED_GROUPS, DEDICATED_GROUP_IDS, type DedicatedGroupId } from './dedicatedGroups'
import { groupDisplayRank } from './proxyGroupOrder'

export interface GroupsWithPlaceholders {
  groups: ControllerMixedGroup[]
  /** 本次插入的占位组名；渲染层据此用关闭态标题替换常规标题。 */
  placeholderNames: ReadonlySet<string>
}

const NO_PLACEHOLDERS: ReadonlySet<string> = new Set()

/** 内核内置的 GLOBAL 组：全局模式下被挪到最前，规则模式下排在最后，不参与展示档位比较。 */
const GLOBAL_GROUP_NAME = 'GLOBAL'

function createPlaceholder(name: string): ControllerMixedGroup {
  return {
    alive: false,
    all: [],
    extra: {},
    hidden: false,
    history: [],
    icon: '',
    interface: '',
    mptcp: false,
    name,
    now: '',
    smux: false,
    tfo: false,
    type: 'Selector',
    udp: false,
    uot: false,
    xudp: false
  }
}

/** 占位的插入下标：第一个展示档位更靠后的普通组之前；没有这样的组时，接在最后一个普通组之后。 */
function insertionIndex(groups: ControllerMixedGroup[], rank: number): number {
  let lastOrdinary = -1
  for (const [index, { name }] of groups.entries()) {
    if (name === GLOBAL_GROUP_NAME) {
      continue
    }
    if (groupDisplayRank(name) > rank) {
      return index
    }
    lastOrdinary = index
  }
  return lastOrdinary + 1
}

/**
 * 为「已关闭且内核里确实没有」的专用组按展示档位插入占位。
 * - 分组列表为空（内核未运行 / 直连模式）时不插入：此时没有任何组可作参照；
 * - `pendingIds` 中的组视为仍在切换：关闭中的组先显示真实标题，内核真正移除后才换成占位，
 *   开启中的组保持占位直到真实分组出现，二者都不会让列表长度中途抖动；
 * - 没有任何占位时原样返回传入的数组，保持引用不变，避免无谓的重新计算。
 */
export function withDisabledGroupPlaceholders(
  liveGroups: ControllerMixedGroup[],
  switches: DedicatedGroupSwitches,
  pendingIds: ReadonlySet<DedicatedGroupId>
): GroupsWithPlaceholders {
  if (liveGroups.length === 0) {
    return { groups: liveGroups, placeholderNames: NO_PLACEHOLDERS }
  }
  const liveNames = new Set(liveGroups.map((group) => group.name))
  const groups = [...liveGroups]
  const placeholderNames = new Set<string>()
  for (const id of DEDICATED_GROUP_IDS) {
    const { name } = DEDICATED_GROUPS[id]
    if (liveNames.has(name) || (switches[id] && !pendingIds.has(id))) {
      continue
    }
    groups.splice(insertionIndex(groups, groupDisplayRank(name)), 0, createPlaceholder(name))
    placeholderNames.add(name)
  }
  return placeholderNames.size === 0
    ? { groups: liveGroups, placeholderNames: NO_PLACEHOLDERS }
    : { groups, placeholderNames }
}
