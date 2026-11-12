// [INPUT] node:test mock.module
// [OUTPUT] rig · installMihomoApiMocks · apiError · callOf · streamStubs
// [POS] mihomoApi 测试夹具：用可脚本化的假 axios / 配置 / 日志替换其运行期依赖，请求按真实拦截器链路返回。

import { mock } from 'node:test'

export type HttpMethod = 'get' | 'put' | 'post' | 'patch' | 'delete'

export interface RecordedCall {
  method: HttpMethod
  url: string
  data: unknown
  config: unknown
}

/** 期望的请求记录：未带的 data / config 一律记为 undefined，与假实例的记录形状一致。 */
export function callOf(
  method: HttpMethod,
  url: string,
  data?: unknown,
  config?: unknown
): RecordedCall {
  return { method, url, data, config }
}

interface AxiosConfig {
  baseURL?: string
  socketPath?: string
  timeout?: number
}

interface GroupDefinition {
  name: string
  url?: string
}

interface RuntimeStub {
  'proxy-groups'?: GroupDefinition[]
}

type Reply = (call: RecordedCall) => unknown

/** mihomo 控制器的错误响应：直连实例的拦截器会把响应体作为拒绝原因抛出。 */
export function apiError(message: string): { response: { data: { message: string } } } {
  return { response: { data: { message } } }
}

/** `mihomoApi` 对外转出的数据流控制（实现在 mihomoStreams，此处以桩替换）。 */
export const streamStubs = {
  restartMihomoConnections: () => undefined,
  restartMihomoLogs: () => undefined,
  startMihomoConnections: () => undefined,
  startMihomoLogs: () => undefined,
  startMihomoMemory: () => undefined,
  startMihomoTraffic: () => undefined,
  stopMihomoConnections: () => undefined,
  stopMihomoLogs: () => undefined,
  stopMihomoMemory: () => undefined,
  stopMihomoTraffic: () => undefined,
  subscribeMihomoAlerts: () => undefined,
  subscribeMihomoLogs: () => undefined
}

export const rig = {
  appConfig: {} as {
    corePermissionMode?: 'elevated' | 'service'
    delayTestUrl?: string
    delayTestTimeout?: number
  },
  mode: 'rule',
  runtime: undefined as RuntimeStub | undefined,
  diskRuntime: undefined as RuntimeStub | undefined,
  hydrated: 0,
  ipcPath: '/run/mihomo.sock',
  servicePath: '/run/service.sock',
  reply: (() => undefined) as Reply,
  calls: [] as RecordedCall[],
  direct: [] as FakeAxiosInstance[],
  signed: [] as Array<{ baseURL: string; instance: FakeAxiosInstance }>,
  logs: [] as string[],
  unfixed: [] as string[],

  reset(): void {
    this.appConfig = {}
    this.mode = 'rule'
    this.runtime = undefined
    this.diskRuntime = undefined
    this.hydrated = 0
    this.ipcPath = '/run/mihomo.sock'
    this.servicePath = '/run/service.sock'
    this.reply = (call) => {
      throw new Error(`unexpected request: ${call.method} ${call.url}`)
    }
    this.calls = []
    this.direct = []
    this.signed = []
    this.logs = []
    this.unfixed = []
  }
}

/**
 * 直连实例没有内建解包：`mihomoApi` 注册的响应拦截器才负责取 `response.data` 与拒绝时取错误体，
 * 所以这里的默认行为故意保持原样，拦截器缺失时断言会失败。service 实例自带解包。
 */
class FakeAxiosInstance {
  readonly defaults: AxiosConfig
  private fulfilled: (response: { data: unknown }) => unknown
  private rejected: (error: unknown) => unknown = (error) => Promise.reject(error)

  readonly interceptors = {
    response: {
      use: (
        onFulfilled: (response: { data: unknown }) => unknown,
        onRejected: (error: unknown) => unknown
      ): void => {
        this.fulfilled = onFulfilled
        this.rejected = onRejected
      }
    }
  }

  constructor(config: AxiosConfig, unwrap: boolean) {
    this.defaults = config
    this.fulfilled = unwrap ? (response) => response.data : (response) => response
  }

  get = (url: string, config?: unknown): Promise<unknown> =>
    this.request(callOf('get', url, undefined, config))
  delete = (url: string, config?: unknown): Promise<unknown> =>
    this.request(callOf('delete', url, undefined, config))
  put = (url: string, data?: unknown, config?: unknown): Promise<unknown> =>
    this.request(callOf('put', url, data, config))
  post = (url: string, data?: unknown, config?: unknown): Promise<unknown> =>
    this.request(callOf('post', url, data, config))
  patch = (url: string, data?: unknown, config?: unknown): Promise<unknown> =>
    this.request(callOf('patch', url, data, config))

  private async request(call: RecordedCall): Promise<unknown> {
    rig.calls.push(call)
    try {
      return this.fulfilled({ data: await rig.reply(call) })
    } catch (error) {
      return this.rejected(error)
    }
  }
}

export function installMihomoApiMocks(): void {
  mock.module(require.resolve('axios'), {
    exports: {
      default: {
        create: (config: AxiosConfig): FakeAxiosInstance => {
          const instance = new FakeAxiosInstance(config, false)
          rig.direct.push(instance)
          return instance
        }
      }
    }
  })
  mock.module('../config', {
    exports: {
      getAppConfig: async (): Promise<typeof rig.appConfig> => rig.appConfig,
      getControledMihomoConfig: async (): Promise<{ mode: string }> => ({ mode: rig.mode })
    }
  })
  mock.module('./factory', {
    exports: {
      getRuntimeConfig: async (): Promise<RuntimeStub | undefined> => rig.runtime,
      loadRuntimeConfigFromDisk: async (): Promise<RuntimeStub | undefined> => rig.diskRuntime,
      hydrateRuntimeConfigFromDiskIfEmpty: async (): Promise<void> => {
        rig.hydrated += 1
      }
    }
  })
  mock.module('../utils/dirs', {
    exports: {
      mihomoIpcPath: (): string => rig.ipcPath,
      serviceIpcPath: (): string => rig.servicePath
    }
  })
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string): Promise<void> => {
        rig.logs.push(line)
      }
    }
  })
  mock.module('../service/api', {
    exports: {
      createSignedServiceAxios: (baseURL: string): FakeAxiosInstance => {
        const instance = new FakeAxiosInstance({ baseURL, socketPath: rig.servicePath }, true)
        rig.signed.push({ baseURL, instance })
        return instance
      }
    }
  })
  mock.module('./autoSelectStickyPin', {
    exports: {
      notifyAutoSelectUnfixed: (group: string): void => {
        rig.unfixed.push(group)
      }
    }
  })
  mock.module('./mihomoStreams', { exports: streamStubs })
}
