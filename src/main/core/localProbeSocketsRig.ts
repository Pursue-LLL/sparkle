// [INPUT] node:test mock.module · node:net / node:tls 的假连接
// [OUTPUT] FakeConnection · connections · resetConnections · installFakeSockets · CONNECT_OK · flush · openTunnel · assertCleanedUp
// [POS] 本地探测通道（到 127.0.0.1:17899 的 HTTP CONNECT + TLS）的测试夹具：
// 用可手动触发事件的假套接字替换 net / tls，不触网。通道、邮件端口、Gemini 地区、吞吐探测的套接字级测试共用。仅供测试使用。

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'node:test'

export class FakeConnection extends EventEmitter {
  written: string[] = []
  destroyed = false
  destroyCalls = 0
  destroyError: Error | undefined

  write(data: string | Buffer): boolean {
    this.written.push(String(data))
    return true
  }

  destroy(): this {
    this.destroyed = true
    this.destroyCalls += 1
    if (this.destroyError) {
      throw this.destroyError
    }
    return this
  }
}

export const connections = {
  raw: [] as FakeConnection[],
  tls: [] as FakeConnection[],
  rawTargets: [] as unknown[][],
  tlsOptions: [] as Record<string, unknown>[],
  destroyError: undefined as Error | undefined
}

export function resetConnections(): void {
  connections.raw.length = 0
  connections.tls.length = 0
  connections.rawTargets.length = 0
  connections.tlsOptions.length = 0
  connections.destroyError = undefined
}

function track(list: FakeConnection[]): FakeConnection {
  const connection = new FakeConnection()
  connection.destroyError = connections.destroyError
  list.push(connection)
  return connection
}

/** 替换 net / tls；被测模块必须在此之后才加载（模块在加载时绑定 net / tls）。 */
export function installFakeSockets(): void {
  const fakeNet = {
    connect: (...args: unknown[]): FakeConnection => {
      connections.rawTargets.push(args)
      return track(connections.raw)
    }
  }
  const fakeTls = {
    connect: (options: Record<string, unknown>): FakeConnection => {
      connections.tlsOptions.push(options)
      return track(connections.tls)
    }
  }
  mock.module('node:net', { exports: { default: fakeNet, ...fakeNet } })
  mock.module('node:tls', { exports: { default: fakeTls, ...fakeTls } })
}

export const CONNECT_OK = 'HTTP/1.1 200 Connection established\r\n\r\n'

export const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

/** 本地监听器接受隧道，TLS 握手完成。 */
export function openTunnel(raw: FakeConnection, index = 0): FakeConnection {
  raw.emit('data', Buffer.from(CONNECT_OK))
  const secure = connections.tls[index]
  secure.emit('secureConnect')
  return secure
}

export function assertCleanedUp(): void {
  assert.ok(connections.raw[0].destroyed, 'raw socket destroyed')
  for (const secure of connections.tls) {
    assert.ok(secure.destroyed, 'tls socket destroyed')
  }
}
