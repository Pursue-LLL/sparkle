// [INPUT] shared/types/app.d.ts::DedicatedGroupSwitches（POS: 专用组开关形状，全局类型）
// [OUTPUT] DedicatedGroupId · DedicatedGroupGate · DEDICATED_GROUPS · DEDICATED_GROUP_IDS · dedicatedGroupIdOf · resolveDedicatedGroupSwitches · withPendingTargets · newlyEnabledGroupIds · runWhenEnabled
// [POS] 可由用户开关的专用分组唯一注册表：组名、默认开关与面向用户的说明；无副作用，主进程与渲染进程共用。
//       Cursor 专用与 Sparkle-香港 承载核心路由，不在此列、不可关闭。

export type DedicatedGroupId = keyof DedicatedGroupSwitches

/** 开关的实时读取方：探测循环每轮询问一次，关闭即整轮跳过（不发任何请求）。 */
export type DedicatedGroupGate = () => Promise<boolean>

interface DedicatedGroupSpec {
  readonly name: string
  readonly defaultEnabled: boolean
  /** 开关提示文案（面向用户，不含实现细节）。 */
  readonly summary: string
}

export const DEDICATED_GROUPS = {
  grok: {
    name: 'grok 专用',
    defaultEnabled: false,
    summary: 'grok.com 走经真实访问验证的出口。关闭后不再检测，相关流量按订阅规则走。'
  },
  gemini: {
    name: 'gemini专用',
    defaultEnabled: true,
    summary:
      'Gemini 走经地区检测可用的出口。关闭后不再定期检测，相关流量按订阅规则走；自动选择仍会避开不支持 Gemini 的地区。'
  },
  mail: {
    name: '📧 邮件专用',
    defaultEnabled: true,
    summary: '收发邮件走经检测可用的出口。关闭后不再检测，相关流量按订阅规则走。'
  },
  agy: {
    name: '🎯 agy 专用',
    defaultEnabled: true,
    summary: 'Antigravity 走经真实请求验证的出口。关闭后不再检测，相关流量改走自动选择。'
  }
} as const satisfies Record<DedicatedGroupId, DedicatedGroupSpec>

export const DEDICATED_GROUP_IDS = Object.keys(DEDICATED_GROUPS) as DedicatedGroupId[]

/** 组名 → 专用组 id；不是可开关的专用组（如 Cursor 专用、订阅自带组）返回 undefined。 */
export function dedicatedGroupIdOf(groupName: string): DedicatedGroupId | undefined {
  return DEDICATED_GROUP_IDS.find((id) => DEDICATED_GROUPS[id].name === groupName)
}

/** 把（可能缺省 / 不完整的）持久化开关补全为确定值；旧配置没有该字段时落到各组默认值。 */
export function resolveDedicatedGroupSwitches(
  persisted: Partial<DedicatedGroupSwitches> | undefined
): DedicatedGroupSwitches {
  return {
    grok: persisted?.grok ?? DEDICATED_GROUPS.grok.defaultEnabled,
    gemini: persisted?.gemini ?? DEDICATED_GROUPS.gemini.defaultEnabled,
    mail: persisted?.mail ?? DEDICATED_GROUPS.mail.defaultEnabled,
    agy: persisted?.agy ?? DEDICATED_GROUPS.agy.defaultEnabled
  }
}

/** 界面展示用的开关：切换进行中的组立即显示用户要的目标值，其余沿用已保存的值。 */
export function withPendingTargets(
  switches: DedicatedGroupSwitches,
  pendingTargets: ReadonlyMap<DedicatedGroupId, boolean>
): DedicatedGroupSwitches {
  return {
    grok: pendingTargets.get('grok') ?? switches.grok,
    gemini: pendingTargets.get('gemini') ?? switches.gemini,
    mail: pendingTargets.get('mail') ?? switches.mail,
    agy: pendingTargets.get('agy') ?? switches.agy
  }
}

/** 本次变更中由关到开的专用组：只有它们需要立即补一轮探测。 */
export function newlyEnabledGroupIds(
  previous: DedicatedGroupSwitches,
  next: DedicatedGroupSwitches
): DedicatedGroupId[] {
  return DEDICATED_GROUP_IDS.filter((id) => !previous[id] && next[id])
}

/** 仅在开关开启时执行；读取开关失败会向上抛出，由调用方按「本轮跳过」处理。 */
export async function runWhenEnabled(
  gate: DedicatedGroupGate,
  run: () => Promise<void>
): Promise<void> {
  if (await gate()) {
    await run()
  }
}
