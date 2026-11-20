// [INPUT] node:http（本机的假服务）
// [OUTPUT] withLocalServer: 在 127.0.0.1 的空闲端口起一个 HTTP 服务，跑完回调后不管成败都关掉（连同还挂着的连接）· LocalHandler
// [POS] 需要假 HTTP 服务的脚本测试共用：端口由系统分配，关闭是回调之后的必经路径，测试不会留下还在监听的服务。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type LocalHandler = (request: IncomingMessage, response: ServerResponse) => void

export async function withLocalServer(
  handler: LocalHandler,
  body: (origin: string) => Promise<void>
): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }
}
