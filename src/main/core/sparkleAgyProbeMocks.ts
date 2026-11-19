// [INPUT] node:test 模块替身 · sparkleAgyProbeWorld · sparkleAgyProbeDirs · 假的 agy CLI 进程 ·
//         cursorProxyGroup::MAIL_PROBE_HIDDEN_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         syncFsPromisesRig::mockFsPromisesSync (POS: fs/promises 同步化夹具)
// [OUTPUT] installMocks
// [POS] sparkleAgy 行为测试的模块替身：配置、mihomo 控制器与日志用 world 驱动的替身，agy CLI 用可编排结局的假子进程。
// 隐藏探测通道与线上 `🎯 agy 专用` 组是两个不同的组：通道固定的节点记在 world.channelNode，线上选择记在 world.selection。
// 仅供测试使用。

import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mock } from 'node:test'
import { MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import { dataDirPath, profilesDirPath, readProviderMembers } from './sparkleAgyProbeDirs'
import { world, type CliOutcome, type Proxy } from './sparkleAgyProbeWorld'
import { mockFsPromisesSync } from './syncFsPromisesRig'

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()

  kill(signal: string): boolean {
    world.killed.push(signal)
    if (world.killFailure) {
      throw new Error('process already exited')
    }
    return true
  }
}

/** 假 CLI 像真的一样按 `--log-file` 把日志写到磁盘，在进程退出之前写完；没有这个参数就不写。 */
function writeCliLog(args: string[], log: string | undefined): void {
  const flagAt = args.indexOf('--log-file')
  if (log === undefined || flagAt < 0) {
    return
  }
  const file = args[flagAt + 1]
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, log, 'utf8')
}

function emitOutcome(child: FakeChild, outcome: CliOutcome, args: string[]): void {
  queueMicrotask(() => {
    writeCliLog(args, outcome.log)
    if (outcome.kind !== 'hang') {
      world.perfNowMs += outcome.rttMs ?? 1
    }
    switch (outcome.kind) {
      case 'ok':
        child.stdout.emit('data', Buffer.from('OK\n'))
        child.emit('close', 0)
        break
      case 'location':
        child.stderr.emit(
          'data',
          Buffer.from('Error 400: User location is not supported for the API use.')
        )
        child.emit('close', 1)
        break
      case 'error':
        child.emit('error', new Error('spawn agy ENOENT'))
        break
      case 'chunks':
        for (const chunk of outcome.chunks) {
          ;(chunk.stream === 'stdout' ? child.stdout : child.stderr).emit(
            'data',
            Buffer.from(chunk.text)
          )
        }
        child.emit('close', outcome.code)
        break
      case 'hang': {
        const printTimeoutSec = Number.parseInt(args[args.indexOf('--print-timeout') + 1], 10)
        world.hangingTimeoutMs = (printTimeoutSec + 5) * 1000
        break
      }
      case 'throw':
        break
    }
  })
}

function nextOutcome(selected: string): CliOutcome {
  return world.outcomes.shift() ?? world.outcomeByNode[selected] ?? world.defaultOutcome
}

/** 隐藏探测通道的成员是整份订阅：订阅里没有的节点、控制器不可用时 mihomo 都会让切换报错。 */
function switchProbeChannel(node: string): boolean {
  world.calls.push(`channel:${node}`)
  const inSubscription = world.profileProxies.some((proxy) => String(proxy.name) === node)
  if (world.channelFailure || world.channelRefused.has(node) || !inSubscription) {
    throw new Error('probe channel switch failed')
  }
  world.channelNode = node
  return true
}

let mocksInstalled = false

/** node:test 对同一个模块只允许替换一次，所以多处调用 useAgyRig 时只装一次。 */
export function installMocks(): void {
  if (mocksInstalled) {
    return
  }
  mocksInstalled = true
  mockFsPromisesSync()
  mock.module('node:child_process', {
    exports: {
      spawn: (bin: string, args: string[], options: { env: NodeJS.ProcessEnv }): FakeChild => {
        world.spawns.push({ bin, args, env: options.env })
        world.probedVia.push(world.channelNode ?? '')
        world.onSpawn?.(world.spawns.length)
        const outcome = nextOutcome(world.channelNode ?? '')
        if (outcome.kind === 'throw') {
          throw new Error('spawn failed')
        }
        const child = new FakeChild()
        emitOutcome(child, outcome, args)
        return child
      }
    }
  })
  mock.module('node:perf_hooks', { exports: { performance: { now: () => world.perfNowMs } } })
  mock.module('../utils/dirs', {
    exports: { dataDir: dataDirPath, profilesDir: profilesDirPath }
  })
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string): Promise<void> => {
        if (world.logFailure) {
          throw new Error('log file is not writable')
        }
        world.logs.push(line)
      }
    }
  })
  mock.module('../config', {
    exports: {
      getAppConfig: async () => world.appConfig,
      getProfileConfig: async () => {
        world.profileReads += 1
        if (world.profileFailure) {
          throw world.profileFailure.reason
        }
        return world.profile
      },
      getProfile: async () => ({ proxies: world.profileProxies })
    }
  })
  mock.module('./provider', {
    exports: { extractProxies: (profile: { proxies: Proxy[] }): Proxy[] => profile.proxies }
  })
  mock.module('./mihomoApi', {
    exports: {
      mihomoGroupDetail: async (group: string): Promise<{ now?: string; all: string[] }> => {
        world.calls.push(`detail:${group}`)
        if (world.groupMissing) {
          throw new Error('Resource not found')
        }
        return { now: world.selection, all: [...world.members] }
      },
      mihomoChangeProxy: async (group: string, node: string): Promise<boolean> => {
        if (group === MAIL_PROBE_HIDDEN_GROUP_NAME) {
          return switchProbeChannel(node)
        }
        world.calls.push(`change:${node}`)
        if (world.changeFailure) {
          throw new Error('mihomo is down')
        }
        if (world.changeRefused.has(node) || !world.members.includes(node)) {
          return false
        }
        world.selection = node
        return true
      },
      mihomoCloseConnections: async (group: string): Promise<void> => {
        world.calls.push(`close:${group}`)
        if (world.closeFailure) {
          throw new Error('close failed')
        }
      },
      subscribeMihomoAlerts: (listener: (log: ControllerLog) => void): (() => void) => {
        world.alertListeners.push(listener)
        return () => {
          world.alertListeners = world.alertListeners.filter((item) => item !== listener)
        }
      },
      mihomoUpdateProxyProviders: async (id: string): Promise<void> => {
        world.calls.push(`update:${id}`)
        if (world.updateFailure) {
          throw world.updateFailure.reason
        }
        // mihomo 重读 provider 文件后，组成员随之改变；选中的节点没了就落到第一个成员。
        world.members = readProviderMembers() ?? []
        if (world.selection && !world.members.includes(world.selection)) {
          world.selection = world.members[0]
        }
        if (world.afterUpdateSelection !== undefined) {
          world.selection = world.afterUpdateSelection
        }
      }
    }
  })
}
