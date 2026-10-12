import {
  buildMergedProfileStr,
  createMergeRebuilder,
  ReadMergeSource
} from '../core/mergeProfileCore'
import { appendAppLog } from '../utils/log'
import { showNotification } from '../utils/notification'
import {
  applyProfileStr,
  getProfileConfig,
  getProfileItem,
  getProfileStr,
  setProfileConfig
} from './profile'

const readMergeSource: ReadMergeSource = async (id) => {
  const item = await getProfileItem(id)
  if (!item) {
    throw new Error(`订阅不存在：${id}`)
  }
  return { label: item.name, yaml: await getProfileStr(id), derived: item.merge !== undefined }
}

export function buildMergeProfileYaml(spec: MergeProfileSpec): Promise<string> {
  return buildMergedProfileStr(spec, readMergeSource)
}

/** 合并订阅自身的更新时间：界面据此展示新鲜度，到期判断据此发现「来源比它新」。 */
async function markProfileUpdated(id: string): Promise<void> {
  const config = await getProfileConfig()
  const item = config.items.find((candidate) => candidate.id === id)
  if (!item) {
    return
  }
  item.updated = Date.now()
  await setProfileConfig(config)
}

export const rebuildDependentMergeProfiles = createMergeRebuilder({
  listItems: async () => (await getProfileConfig()).items,
  build: buildMergeProfileYaml,
  apply: async (id, content) => {
    await applyProfileStr(id, content)
    await markProfileUpdated(id)
  },
  onError: async (item, error) => {
    const reason = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[MergeProfile]: rebuild failed id=${item?.id ?? '-'} error=${reason}\n`)
    if (item) {
      await showNotification({
        title: '合并订阅更新失败',
        body: `「${item.name}」继续使用上一份节点：${reason}`,
        variant: 'warning'
      })
    }
  }
})
