// [INPUT] serviceSignedRequest（签名调用）· 服务 socket 与鉴权文件
// [OUTPUT] StopCoreOutcome · StopCoreOptions · stopServiceCore
// [POS] 升级安装前经签名 API 让 sparkle-service 停掉它托管的内核（POST /core/stop，幂等）。
// 为什么必须停：service 模式下内核是 root 服务的子进程，GUI 退出不一定带走它；
// 不停的话新 App 只会「接管」升级前遗留的旧内核，新包里的内核二进制从未被真正拉起验证过。

import { existsSync } from 'node:fs'
import { callService, serviceAuthPath, serviceSocketPath } from './serviceSignedRequest'

export type StopCoreOutcome =
  | { kind: 'stopped'; statusCode: number }
  | { kind: 'service-absent'; reason: string }
  | { kind: 'failed'; reason: string }

export interface StopCoreOptions {
  timeoutMs?: number
  socketPath?: string
  authPath?: string
}

const STOP_CORE_PATH = '/core/stop'
const DEFAULT_TIMEOUT_MS = 10_000
/** 连接层「没有服务在监听」的错误码：此时不存在需要停止的服务托管内核。 */
const SERVICE_ABSENT_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ENOTSOCK'])

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return String(error.code)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function stopServiceCore(options: StopCoreOptions = {}): Promise<StopCoreOutcome> {
  const socketPath = options.socketPath ?? serviceSocketPath()
  const authPath = options.authPath ?? serviceAuthPath()

  if (!existsSync(socketPath)) {
    return { kind: 'service-absent', reason: 'service socket not found' }
  }
  // 服务在运行却读不到密钥，说明运行环境（如 HOME）不对：不能当作「无服务」放行。
  if (!existsSync(authPath)) {
    return { kind: 'failed', reason: 'service is running but its auth key file is missing' }
  }

  try {
    const response = await callService({
      method: 'POST',
      pathWithQuery: STOP_CORE_PATH,
      socketPath,
      authPath,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    })
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return { kind: 'stopped', statusCode: response.statusCode }
    }
    return { kind: 'failed', reason: `service answered HTTP ${response.statusCode}` }
  } catch (error) {
    const code = errorCode(error)
    if (code !== undefined && SERVICE_ABSENT_CODES.has(code)) {
      return { kind: 'service-absent', reason: `service not reachable (${code})` }
    }
    return { kind: 'failed', reason: errorMessage(error) }
  }
}
