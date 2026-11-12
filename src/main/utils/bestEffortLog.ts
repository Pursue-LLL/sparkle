// [INPUT] 无
// [OUTPUT] bestEffortLog: 把日志写入函数包装成永不 reject 的版本
// [POS] 日志只用于诊断，写入失败（磁盘满 / 权限）不得改变调用方的控制流与状态；各编排层统一用它包装注入的 log。

export function bestEffortLog(
  log: (line: string) => Promise<void>
): (line: string) => Promise<void> {
  return (line) => log(line).catch(() => undefined)
}
