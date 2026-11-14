// [INPUT] sparkleMailProviderCore::MAIL_PROBE_LISTENER_PORT (POS: 邮件 provider 与分组配置)
// [OUTPUT] openLocalProbeTunnel · LocalProbeTunnel · LocalProbeTunnelOptions · LocalProbeFailure
// [POS] 本地隐藏探测监听器 `127.0.0.1:17899` 的传输层：HTTP CONNECT 隧道 + TLS 握手（严格校验证书）。
// 邮件端口、Gemini 地区、吞吐探测共用，各自只负责隧道建立后的应用层读写与超时。
// 只依赖 net / tls，不碰 mihomo 控制器；节点切换与串行化见 localProbeChannel。

import net from 'node:net'
import tls from 'node:tls'
import { MAIL_PROBE_LISTENER_PORT } from './sparkleMailProviderCore'

const LISTENER_HOST = '127.0.0.1'

/** CONNECT 应答头的字符上限：超过仍没有空行，说明对端不是 HTTP 代理。 */
const CONNECT_REPLY_MAX_CHARS = 2048

/**
 * - `listener`：隧道没建起来（连不上监听器、CONNECT 被拒、应答异常），是本机探测设施的问题，与节点无关；
 * - `node`：隧道被接受之后失败（mihomo 拨出失败、TLS 握手出错、连接被重置），是节点到目标这一段的问题。
 * mihomo 对 CONNECT 先回 200 再拨出，所以节点故障只会表现为后一类。
 */
export type LocalProbeFailure = 'listener' | 'node'

export interface LocalProbeTunnelOptions {
  host: string
  port: number
  /** 不传则不协商 ALPN（服务端先发 Banner 的邮件协议不需要）。 */
  alpnProtocols?: readonly string[]
  /** TLS 握手完成；此后读写、'end' 监听与超时都归调用方。 */
  onSecure: (socket: tls.TLSSocket) => void
  /** 握手前后的任何失败；同一条隧道可能重复触发，调用方必须幂等。 */
  onFailure: (reason: LocalProbeFailure) => void
}

export interface LocalProbeTunnel {
  /** 先关 TLS 再关底层连接；清理阶段的异常不外抛，可重复调用。 */
  destroy: () => void
}

/**
 * 经本地监听器向 `host:port` 建立 CONNECT 隧道并完成 TLS 握手。
 * 错误监听用 `on` 而非 `once`：销毁前后可能再收到错误，缺监听器的 error 事件会让主进程抛未捕获异常。
 */
export function openLocalProbeTunnel(options: LocalProbeTunnelOptions): LocalProbeTunnel {
  const { host, port, alpnProtocols, onSecure, onFailure } = options
  const rawSocket = net.connect(MAIL_PROBE_LISTENER_PORT, LISTENER_HOST)
  let tlsSocket: tls.TLSSocket | undefined
  let accepted = false
  const fail = (): void => onFailure(accepted ? 'node' : 'listener')

  rawSocket.on('error', fail)
  // 监听器不报错地直接挂断（正在重启、端口被别的服务占着）同样是隧道没建起来；
  // 建好之后的收尾归调用方，数据读完与 TLS 层出错各有各的信号。
  rawSocket.once('close', () => {
    if (!accepted) {
      fail()
    }
  })
  rawSocket.once('connect', () => {
    rawSocket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
    let reply = ''
    const onReplyData = (chunk: Buffer): void => {
      reply += chunk.toString('utf8')
      if (!reply.includes('\r\n\r\n')) {
        if (reply.length > CONNECT_REPLY_MAX_CHARS) {
          fail()
        }
        return
      }
      rawSocket.removeListener('data', onReplyData)
      if (!reply.slice(0, reply.indexOf('\r\n')).includes(' 200 ')) {
        fail()
        return
      }
      accepted = true
      const secure = tls.connect({
        socket: rawSocket,
        servername: host,
        rejectUnauthorized: true,
        ...(alpnProtocols ? { ALPNProtocols: [...alpnProtocols] } : {})
      })
      tlsSocket = secure
      secure.on('error', fail)
      secure.once('secureConnect', () => onSecure(secure))
    }
    rawSocket.on('data', onReplyData)
  })

  return {
    destroy: () => {
      for (const socket of [tlsSocket, rawSocket]) {
        try {
          socket?.destroy()
        } catch {
          // 清理阶段的关闭异常无需处理
        }
      }
    }
  }
}
