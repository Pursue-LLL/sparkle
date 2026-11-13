// [INPUT] 无本地依赖
// [OUTPUT] shouldReloadProfileForAppConfigPatch: 应用配置补丁是否需要重新生成 runtime 配置
// [POS] Cursor 应用路径前缀变化会改变路径限定规则，补丁含该字段时必须重新生成配置；其余补丁不触发重载。

export function shouldReloadProfileForAppConfigPatch(patch: Partial<AppConfig>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'cursorProxyAppPathPrefixes')
}
