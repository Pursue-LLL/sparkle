import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'
import type * as Factory from './factory'

/**
 * [INPUT] factory.ts 的 I/O 依赖（配置库、目录、日志、通知、DNS/网卡探测、mihomo REST）
 * [OUTPUT] 把依赖换成内存桩 + 临时目录，真实流水线（规则注入/分组生成/清洗）照常运行
 * [POS] factory.test.ts / factoryPipeline.test.ts / factoryRepair.test.ts 的共用夹具；全部为虚构数据
 */

export type Json = Record<string, unknown>

export const GROUP = '🚀 节点选择'
export const WALL_CLOCK_MS = 60_000

export const proxy = (name: string, extra: Json = {}): Json => ({
  name,
  type: 'vless',
  server: `${name}.example.com`,
  port: 443,
  uuid: '00000000-0000-0000-0000-000000000000',
  ...extra
})

export const subscription = (extra: Json = {}): Json => ({
  proxies: [proxy('台湾 01'), proxy('日本 01')],
  'proxy-groups': [{ name: GROUP, type: 'select', proxies: ['台湾 01', '日本 01', 'DIRECT'] }],
  rules: [`DOMAIN-SUFFIX,example.com,${GROUP}`, `MATCH,${GROUP}`],
  ...extra
})

export const groupNames = (config: Json): string[] =>
  (config['proxy-groups'] as Array<{ name: string }>).map(({ name }) => name)

export const rulesOf = (config: Json): string[] => config.rules as string[]

export const groupOf = (config: Json, name: string): Json | undefined =>
  (config['proxy-groups'] as Array<Json & { name: string }>).find((group) => group.name === name)

export const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

const neverSettles = (): Promise<never> =>
  new Promise<never>(() => {
    // 故意不落定：模拟卡死的依赖
  })

export interface RigState {
  current: string | undefined
  appConfig: Json
  controlled: Json
  profile: Json
  profileReads: number
  hangProfile: boolean
  hangLog: boolean
  profileError: unknown
  gate: Promise<void> | undefined
  logs: string[]
  notifications: Json[]
  providerFileWrites: unknown[][]
  buildDriftCalls: number
  vpsBypassCalls: unknown[][]
}

export interface FactoryRig {
  /** 每次 reset() 都会换成一份全新加载的模块，运行时配置等模块级状态不会在用例之间残留 */
  factory: typeof Factory
  state: RigState
  profilesDir: string
  profileWorkRoot: string
  workDir: string
  configFile: (id: string) => string
  runtime: () => Promise<Json>
  /** 跑一次 generateProfile 并返回生成的运行时配置 */
  generate: () => Promise<Json>
  steps: () => string[]
  waitForLog: (needle: string) => Promise<void>
  reset: () => Promise<void>
  dispose: () => void
}

const loadFreshFactory = (): typeof Factory => {
  delete require.cache[require.resolve('./factory')]
  return require('./factory') as typeof Factory
}

const initialState = (): RigState => ({
  current: 'p1',
  appConfig: {},
  controlled: { 'mixed-port': 7890, mode: 'rule', hosts: { 'a.example': '1.1.1.1' } },
  profile: subscription(),
  profileReads: 0,
  hangProfile: false,
  hangLog: false,
  profileError: undefined,
  gate: undefined,
  logs: [],
  notifications: [],
  providerFileWrites: [],
  buildDriftCalls: 0,
  vpsBypassCalls: []
})

export async function loadFactoryRig(): Promise<FactoryRig> {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkle-factory-'))
  const workDir = path.join(root, 'work')
  const profilesDir = path.join(root, 'profiles')
  const profileWorkRoot = path.join(root, 'profile-work')
  const configFile = (id: string): string => path.join(workDir, `${id}-config.yaml`)
  const state = initialState()

  mock.module('../config', {
    exports: {
      getProfileConfig: async (): Promise<{ current?: string }> => ({ current: state.current }),
      getAppConfig: async (): Promise<Json> => state.appConfig,
      getControledMihomoConfig: async (): Promise<Json> => structuredClone(state.controlled),
      getProfile: async (): Promise<Json> => {
        state.profileReads += 1
        if (state.profileError !== undefined) throw state.profileError
        if (state.hangProfile) await neverSettles()
        await state.gate
        return structuredClone(state.profile)
      },
      getProfileStr: async (): Promise<string> => 'raw: profile',
      getOverrideConfig: async (): Promise<Json> => ({ items: [] }),
      getProfileItem: async (): Promise<undefined> => undefined,
      getOverrideItem: async (): Promise<undefined> => undefined,
      getOverride: async (): Promise<string> => ''
    }
  })
  mock.module('../utils/dirs', {
    exports: {
      mihomoWorkDir: (): string => workDir,
      profilesDir: (): string => profilesDir,
      mihomoProfileWorkDir: (id?: string): string => path.join(profileWorkRoot, String(id)),
      mihomoWorkConfigPath: configFile,
      overridePath: (id: string, ext: string): string => path.join(root, `${id}.${ext}`)
    }
  })
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string): Promise<void> => {
        if (state.hangLog) await neverSettles()
        state.logs.push(line)
      }
    }
  })
  mock.module('../utils/notification', {
    exports: {
      showNotification: async (notification: Json): Promise<void> => {
        state.notifications.push(notification)
      }
    }
  })
  mock.module('./buildDriftCore', {
    exports: {
      logBuildDriftAtStartup: async (): Promise<void> => {
        state.buildDriftCalls += 1
      }
    }
  })
  mock.module('./mihomoApi', { exports: { mihomoUpdateProxyProviders: async () => undefined } })
  mock.module('./sparkleProviderFiles', {
    exports: {
      writeSparkleProviderFiles: async (...args: unknown[]): Promise<void> => {
        state.providerFileWrites.push(args)
      }
    }
  })
  mock.module('./vpsDirectBypass', {
    exports: {
      ensureVpsDirectBypass: async (...args: unknown[]): Promise<void> => {
        state.vpsBypassCalls.push(args)
      }
    }
  })
  mock.module('./corporateDefaultInterface', {
    exports: { readDefaultInterface: async (): Promise<undefined> => undefined }
  })

  const rig: FactoryRig = {
    factory: loadFreshFactory(),
    state,
    profilesDir,
    profileWorkRoot,
    workDir,
    configFile,
    runtime: async () => (await rig.factory.getRuntimeConfig()) as unknown as Json,
    generate: async () => {
      await rig.factory.generateProfile()
      return rig.runtime()
    },
    steps: () =>
      state.logs.flatMap((line) => /generateProfile step=(.+) elapsed_ms=/.exec(line)?.[1] ?? []),
    waitForLog: async (needle) => {
      for (let attempts = 0; attempts < 500; attempts += 1) {
        if (state.logs.some((line) => line.includes(needle))) return
        await flush()
      }
      assert.fail(`log never written: ${needle}`)
    },
    reset: async () => {
      for (const dir of [workDir, profilesDir, profileWorkRoot]) {
        rmSync(dir, { recursive: true, force: true })
      }
      mkdirSync(workDir, { recursive: true })
      mkdirSync(profilesDir, { recursive: true })
      Object.assign(state, initialState())
      rig.factory = loadFreshFactory()
    },
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
  return rig
}
