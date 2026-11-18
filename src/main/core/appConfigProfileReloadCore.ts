// [INPUT] 无本地依赖
// [OUTPUT] profileReloadKeys · shouldReloadProfileForAppConfigPatch: 应用配置补丁里哪些键要求重新生成 runtime 配置
// [POS] 会改变 runtime 配置内容的应用配置键：Cursor 应用路径前缀（改变路径限定规则）、专用分组开关（增减分组 / 规则 / provider）；
//       补丁含任一键必须重新生成并重载，其余补丁不触发。

const PROFILE_RELOAD_KEYS = [
  'cursorProxyAppPathPrefixes',
  'dedicatedGroups'
] as const satisfies readonly (keyof AppConfig)[]

export function profileReloadKeys(patch: Partial<AppConfig>): string[] {
  return PROFILE_RELOAD_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(patch, key))
}

export function shouldReloadProfileForAppConfigPatch(patch: Partial<AppConfig>): boolean {
  return profileReloadKeys(patch).length > 0
}
