// [INPUT] 无
// [OUTPUT] previewConfigPatch
// [POS] 受控配置补丁的界面预览：按主进程 deepMerge 的口径（对象递归合并、数组与标量整体替换）把补丁折进当前配置，
//       返回新对象且不改入参，让开关在 IPC 返回前就翻转。预览只用于显示，真实结果以随后的重新读取为准，
//       所以与主进程的差异（nameserver-policy / hosts 等特殊处理）至多短暂显示、不会落盘。

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function previewConfigPatch<T extends object>(current: T | undefined, patch: Partial<T>): T {
  const base: PlainObject = isPlainObject(current) ? current : {}
  const next: PlainObject = { ...base }
  for (const [key, value] of Object.entries(patch as PlainObject)) {
    const existing = base[key]
    next[key] = isPlainObject(value)
      ? previewConfigPatch(isPlainObject(existing) ? existing : undefined, value)
      : value
  }
  return next as T
}
