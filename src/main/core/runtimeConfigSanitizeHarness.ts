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
