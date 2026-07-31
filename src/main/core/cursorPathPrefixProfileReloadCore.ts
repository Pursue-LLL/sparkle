export function shouldReloadProfileForAppConfigPatch(patch: Partial<AppConfig>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'cursorProxyAppPathPrefixes')
}
