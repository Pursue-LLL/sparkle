// [INPUT] node 进程/套接字 · ws (POS: 本机回环网络)
// [OUTPUT] RunningCore · say · waitFor · reserveFreePorts · closeServer · startHttpTarget · startSocksNode · startMihomo · openAlertStream · proxiedGet
// [POS] 隔离 mihomo 端到端校验的公共夹具：随机回环端口、模拟 HTTP 目标与 SOCKS5 节点、内核子进程与控制器客户端。
//       只接触自己创建的进程、端口与目录，不碰正在运行的内核。

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net, { type AddressInfo } from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import WebSocket from 'ws'

export interface HttpResult {
  status: number
  text: string
}

export interface RunningCore {
  request: (method: string, route: string, body?: unknown) => Promise<HttpResult>
  getJson: <T>(route: string) => Promise<T>
  outputTail: (lines: number) => string
  stop: () => Promise<void>
}

export const say = (message: string): void =>
  console.log(`[${new Date().toISOString().slice(11, 23)}] ${message}`)

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`等待超时：${what}`)
    }
    await sleep(100)
  }
}

function listen<T extends net.Server>(server: T, port: number): Promise<T> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

export function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

/** 取 count 个当前空闲的回环端口。 */
export async function reserveFreePorts(count: number): Promise<number[]> {
  const holders = await Promise.all(
    Array.from({ length: count }, () => listen(net.createServer(), 0))
  )
  const ports = holders.map((holder) => (holder.address() as AddressInfo).port)
  await Promise.all(holders.map(closeServer))
  return ports
}

export function startHttpTarget(port: number, status: number, body: string): Promise<http.Server> {
  return listen(
    http.createServer((_req, res) => {
      res.writeHead(status)
      res.end(body)
    }),
    port
  )
}

function bridgeToTarget(client: net.Socket, targetPort: number): void {
  if (client.destroyed) {
    return
  }
  const upstream = net.connect(targetPort, '127.0.0.1', () => {
    client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
    client.pipe(upstream)
    upstream.pipe(client)
  })
  upstream.on('error', () => client.destroy())
  client.on('close', () => upstream.destroy())
}

/**
 * 最小 SOCKS5 服务端（仅域名 CONNECT）：目标未知或不放行时在握手中途断开。
 * 内核的 SOCKS5 客户端不校验 CONNECT 应答的 REP 字段，回失败码不会被计为拨号失败，所以必须断开连接。
 */
export function startSocksNode(
  port: number,
  targets: ReadonlyMap<string, number>,
  allow: (host: string) => boolean,
  replyDelayMs: number
): Promise<net.Server> {
  return listen(
    net.createServer((client) => {
      client.on('error', () => undefined)
      let pending = Buffer.alloc(0)
      let greeted = false
      const onData = (chunk: Buffer): void => {
        pending = Buffer.concat([pending, chunk])
        if (!greeted) {
          if (pending.length < 2 || pending.length < 2 + pending[1]) {
            return
          }
          client.write(Buffer.from([5, 0]))
          pending = pending.subarray(2 + pending[1])
          greeted = true
        }
        if (pending.length < 5) {
          return
        }
        if (pending[3] !== 3) {
          client.destroy()
          return
        }
        const hostEnd = 5 + pending[4]
        if (pending.length < hostEnd + 2) {
          return
        }
        client.off('data', onData)
        const host = pending.subarray(5, hostEnd).toString()
        const targetPort = targets.get(host)
        if (targetPort === undefined || !allow(host)) {
          client.destroy()
          return
        }
        setTimeout(() => bridgeToTarget(client, targetPort), replyDelayMs)
      }
      client.on('data', onData)
    }),
    port
  )
}

function controllerRequest(
  port: number,
  method: string,
  route: string,
  body?: unknown
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: route,
        method,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {}
      },
      (res) => {
        let text = ''
        res.on('data', (chunk: Buffer) => {
          text += chunk.toString()
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

export interface StartMihomoOptions {
  binary: string
  workDir: string
  /** 完整的 config.yaml 文本，external-controller 必须是 127.0.0.1:controllerPort。 */
  config: string
  controllerPort: number
}

/** 启动隔离内核并等控制器就绪；启动失败时错误信息附带内核输出。 */
export async function startMihomo(options: StartMihomoOptions): Promise<RunningCore> {
  const { binary, workDir, config, controllerPort } = options
  mkdirSync(workDir, { recursive: true })
  const configPath = path.join(workDir, 'config.yaml')
  writeFileSync(configPath, config)
  const child = spawn(binary, ['-d', workDir, '-f', configPath], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  process.once('exit', () => child.kill('SIGKILL'))
  const hasExited = (): boolean => child.exitCode !== null || child.signalCode !== null
  let output = ''
  const collect = (chunk: Buffer): void => {
    output += chunk.toString()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const outputTail = (lines: number): string => output.split('\n').slice(-lines).join('\n')
  const request = (method: string, route: string, body?: unknown): Promise<HttpResult> =>
    controllerRequest(controllerPort, method, route, body)

  try {
    await waitFor(
      () => {
        if (hasExited()) {
          throw new Error('mihomo 启动后退出')
        }
        return request('GET', '/version').then(
          () => true,
          () => false
        )
      },
      15_000,
      'mihomo 控制器就绪'
    )
  } catch (error) {
    child.kill('SIGKILL')
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${outputTail(25)}`)
  }

  return {
    request,
    getJson: async <T>(route: string): Promise<T> =>
      JSON.parse((await request('GET', route)).text) as T,
    outputTail,
    stop: async () => {
      if (hasExited()) {
        return
      }
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
      })
      child.kill('SIGTERM')
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 3_000)
      await exited
      clearTimeout(forceKill)
    }
  }
}

/** 订阅内核 warning 级日志流，连接建立后返回。 */
export async function openAlertStream(controllerPort: number): Promise<WebSocket> {
  const stream = new WebSocket(`ws://127.0.0.1:${controllerPort}/logs?level=warning`)
  await new Promise<void>((resolve, reject) => {
    stream.once('open', () => resolve())
    stream.once('error', reject)
  })
  return stream
}

/** 经混合端口发一条 HTTP 代理请求，返回状态码；连接被关闭为 0，超时为 -1。 */
export function proxiedGet(mixedPort: number, host: string): Promise<number> {
  return new Promise((resolve) => {
    const socket = net.connect(mixedPort, '127.0.0.1')
    let received = ''
    let settled = false
    const finish = (status: number): void => {
      if (!settled) {
        settled = true
        socket.destroy()
        resolve(status)
      }
    }
    socket.setTimeout(8_000, () => finish(-1))
    socket.on('connect', () =>
      socket.write(`GET http://${host}/ HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
    )
    socket.on('data', (chunk) => {
      received += chunk.toString()
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(received)?.[1]
      if (status) {
        finish(Number(status))
      }
    })
    socket.on('error', () => finish(0))
    socket.on('close', () => finish(0))
  })
}
