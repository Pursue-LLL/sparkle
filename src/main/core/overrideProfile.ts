// [INPUT] override 配置（yaml / js 脚本）· 当前订阅的 override 绑定 · overrideScript::runOverrideScript (POS: 覆写脚本执行器)
// [OUTPUT] overrideProfile: 依次应用全局与订阅级覆写
// [POS] runtime 配置生成流水线的覆写层：yaml 深合并，js 脚本交给沙箱执行器，失败时保留原配置。

import { writeFileSync } from 'fs'
import { getOverride, getOverrideConfig, getOverrideItem, getProfileItem } from '../config'
import { overridePath } from '../utils/dirs'
import { deepMerge } from '../utils/merge'
import { parseYaml } from '../utils/yaml'
import { runOverrideScript } from './overrideScript'

export async function overrideProfile(
  current: string | undefined,
  profile: MihomoConfig
): Promise<MihomoConfig> {
  const { items = [] } = (await getOverrideConfig()) || {}
  const globalOverride = items.filter((item) => item.global).map((item) => item.id)
  const { override = [] } = (await getProfileItem(current)) || {}
  for (const ov of new Set(globalOverride.concat(override))) {
    const item = await getOverrideItem(ov)
    const content = await getOverride(ov, item?.ext || 'js')
    switch (item?.ext) {
      case 'js':
        profile = await runOverrideScript(profile, content, (text, flag) =>
          writeFileSync(overridePath(item.id, 'log'), text, { encoding: 'utf-8', flag })
        )
        break
      case 'yaml': {
        let patch = parseYaml<Partial<MihomoConfig>>(content)
        if (typeof patch !== 'object') patch = {}
        profile = deepMerge(profile, patch, true)
        break
      }
    }
  }
  return profile
}
