// [INPUT] node:vm · utils/yaml::parseYaml/stringifyYaml (POS: yaml 解析与序列化)
// [OUTPUT] runOverrideScript · OverrideLogSink
// [POS] 覆写脚本执行器：在 vm 上下文内运行脚本的 main(profile)，只暴露 console / fetch / yaml / b64 / Buffer。
//       失败（抛错或返回值不是对象）时写日志并保留原配置；日志如何落盘由调用方注入，本层不依赖 Electron，可脱离应用单测。

import vm from 'vm'
import { parseYaml, stringifyYaml } from '../utils/yaml'

/** flag 'w' 覆盖写（一次执行的开头），'a' 追加写。 */
export type OverrideLogSink = (text: string, flag: 'w' | 'a') => void

/** vm 上下文里创建的 Error 与宿主不是同一个 Error 构造，instanceof 判断不到，需按内部类型标签识别。 */
function isError(data: unknown): data is Error {
  return Object.prototype.toString.call(data) === '[object Error]'
}

function format(data: unknown): string {
  if (isError(data)) {
    return `${data.name}: ${data.message}\n${data.stack}`
  }
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export async function runOverrideScript(
  profile: MihomoConfig,
  script: string,
  writeLog: OverrideLogSink
): Promise<MihomoConfig> {
  // 日志只用于排查脚本：写入失败不得改变覆写结果。
  const log = (type: string, data: string, flag: 'w' | 'a' = 'a'): void => {
    try {
      writeLog(`[${type}] ${data}\n`, flag)
    } catch {
      // 日志写入失败不影响覆写
    }
  }
  try {
    const b64d = (str: string): string => Buffer.from(str, 'base64').toString('utf-8')
    const b64e = (data: Buffer | string): string =>
      (Buffer.isBuffer(data) ? data : Buffer.from(String(data))).toString('base64')
    const ctx = {
      console: Object.freeze({
        log: (...args: unknown[]) => log('log', args.map(format).join(' ')),
        info: (...args: unknown[]) => log('info', args.map(format).join(' ')),
        error: (...args: unknown[]) => log('error', args.map(format).join(' ')),
        debug: (...args: unknown[]) => log('debug', args.map(format).join(' '))
      }),
      fetch,
      yaml: { parse: parseYaml, stringify: stringifyYaml },
      b64d,
      b64e,
      Buffer
    }
    vm.createContext(ctx)
    log('info', '开始执行脚本', 'w')
    vm.runInContext(script, ctx)
    const promise = vm.runInContext(
      `(async () => {
        const result = main(${JSON.stringify(profile)})
        if (result instanceof Promise) return await result
        return result
      })()`,
      ctx
    )
    const newProfile = await promise
    if (typeof newProfile !== 'object' || newProfile === null || Array.isArray(newProfile)) {
      throw new Error('脚本返回值必须是对象')
    }
    log('info', '脚本执行成功')
    return newProfile
  } catch (e) {
    log('exception', `脚本执行失败：${e}`)
    return profile
  }
}
