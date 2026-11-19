// [INPUT] mihomoApi::mihomoChangeProxy (POS: mihomo 控制器访问层) ·
//         cursorProxyGroup::MAIL_PROBE_HIDDEN_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         sparkleMailProviderCore::MAIL_PROBE_LISTENER_HOST/MAIL_PROBE_LISTENER_PORT (POS: 邮件 provider 与分组配置)
// [OUTPUT] withLocalProbeChannelLock · LOCAL_PROBE_PROXY_URL
// [POS] 本地隐藏探测监听器 `127.0.0.1:17899`（`__sparkle_mail_probe__`）的串行化入口：
// 进程级互斥锁，持锁期间该隐藏组固定在指定节点。邮件端口、Gemini 地区、吞吐、agy 真实请求探测共用；
// 隧道本身见 localProbeTunnel。

import { MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import { mihomoChangeProxy } from './mihomoApi'
import { MAIL_PROBE_LISTENER_HOST, MAIL_PROBE_LISTENER_PORT } from './sparkleMailProviderCore'

/** 监听器的代理地址：自带 HTTP 客户端的外部进程（官方 agy CLI）用环境变量代理经它出站。 */
export const LOCAL_PROBE_PROXY_URL = `http://${MAIL_PROBE_LISTENER_HOST}:${MAIL_PROBE_LISTENER_PORT}`

let probeChannelTail: Promise<void> = Promise.resolve()

/**
 * 进程级互斥锁：本地隐藏探测监听器为单通道，所有探测共享它时必须串行切换节点，防止并发串台。
 * 切换节点或任务本身抛出的异常原样传给调用方，锁一定会释放。
 */
export async function withLocalProbeChannelLock<T>(
  nodeName: string,
  task: () => Promise<T>
): Promise<T> {
  const prev = probeChannelTail
  let release!: () => void
  probeChannelTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    await mihomoChangeProxy(MAIL_PROBE_HIDDEN_GROUP_NAME, nodeName)
    return await task()
  } finally {
    release()
  }
}
