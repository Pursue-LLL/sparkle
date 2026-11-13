/**
 * [INPUT] MihomoConfig profile（分组全部构建完成、写盘之前） ·
 *         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME/AUTO_SELECT_GROUP_NAME/CURSOR_DEDICATED_GROUP_NAME/GROK_DEDICATED_GROUP_NAME… (POS: Sparkle 分组名常量与判定谓词)
 * [OUTPUT] orderProxyGroups: 统一 proxy-groups 的展示顺序
 * [POS] 只调整分组顺序（自动选择 → 三个专用组 → Sparkle 地区组 → 其余），不改组内容与成员顺序。
 */
import {
  AGY_DEDICATED_GROUP_NAME,
  AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'

/** 专用组的展示顺序；隐藏探测组紧跟邮件专用组，不进 UI 但顺序保持确定。 */
const DEDICATED_GROUP_ORDER: readonly string[] = [
  CURSOR_DEDICATED_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME,
  AGY_DEDICATED_GROUP_NAME
]

const AUTO_SELECT_RANK = 0
const DEDICATED_RANK_BASE = 10
const REGION_RANK = 20
const OTHER_RANK = 30

/** 地区组由订阅注入，命名统一为 `Sparkle-<地区>`；新增地区无需改这里。 */
const REGION_GROUP_PREFIX = 'Sparkle-'

function rankOf(name: string): number {
  if (name === AUTO_SELECT_GROUP_NAME) {
    return AUTO_SELECT_RANK
  }
  const dedicatedIndex = DEDICATED_GROUP_ORDER.indexOf(name)
  if (dedicatedIndex >= 0) {
    return DEDICATED_RANK_BASE + dedicatedIndex
  }
  return name.startsWith(REGION_GROUP_PREFIX) ? REGION_RANK : OTHER_RANK
}

/**
 * 依赖 Array.prototype.sort 的稳定性（ES2019）：同档位内保持原有相对顺序（订阅组顺序即订阅给出的顺序）。
 * 顺序是 mihomo `/proxies` 与自研界面的展示依据，因此必须在写盘前定稿。
 */
export function orderProxyGroups(profile: MihomoConfig): void {
  const groups = profile['proxy-groups'] as { name?: string }[] | undefined
  if (!groups || groups.length < 2) {
    return
  }
  const ordered = groups
    .map((group) => ({ group, rank: rankOf(String(group?.name ?? '')) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ group }) => group)
  profile['proxy-groups'] = ordered as MihomoConfig['proxy-groups']
}
