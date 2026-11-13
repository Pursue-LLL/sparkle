// [INPUT] runtimeConfigSanitize::cleanProfile (POS: 配置清洗层)
// [OUTPUT] clean: 对配置副本做清理并返回结果
// [POS] `runtimeConfigSanitize` 的测试夹具：对副本清理，便于逐字段断言。仅供测试使用。

import { cleanProfile } from './runtimeConfigSanitize'

export type Fields = Record<string, unknown>

/** 对副本做清理并返回结果，调用方的原始对象保持不变，便于逐字段断言。 */
export async function clean(
  fields: Fields,
  controlDns = true,
  controlSniff = true
): Promise<Fields> {
  const profile = structuredClone(fields) as unknown as MihomoConfig
  await cleanProfile(profile, controlDns, controlSniff)
  return profile as unknown as Fields
}
