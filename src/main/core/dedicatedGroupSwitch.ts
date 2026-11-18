// [INPUT] config::getAppConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         dedicatedGroups::resolveDedicatedGroupSwitches (POS: 可开关专用组注册表与开关解析)
// [OUTPUT] loadDedicatedGroupSwitches · dedicatedGroupGate
// [POS] 专用分组开关的运行时读取：每次都读最新应用配置，用户切换后下一轮探测立即生效，无需重启或重新订阅。

import { getAppConfig } from '../config'
import {
  resolveDedicatedGroupSwitches,
  type DedicatedGroupGate,
  type DedicatedGroupId
} from './dedicatedGroups'

export async function loadDedicatedGroupSwitches(): Promise<DedicatedGroupSwitches> {
  const { dedicatedGroups } = await getAppConfig()
  return resolveDedicatedGroupSwitches(dedicatedGroups)
}

export function dedicatedGroupGate(id: DedicatedGroupId): DedicatedGroupGate {
  return async () => (await loadDedicatedGroupSwitches())[id]
}
