// [INPUT] mihomoApi::mihomoChangeProxy (POS: mihomo 控制器访问层) ·
//         cursorProxyGroup::MAIL_PROBE_HIDDEN_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词)
// [OUTPUT] withLocalProbeChannelLock
// [POS] 本地隐藏探测监听器 `127.0.0.1:17899`（`__sparkle_mail_probe__`）的串行化入口：
// 进程级互斥锁，持锁期间该隐藏组固定在指定节点。邮件端口、Gemini 地区、吞吐探测共用；
// 隧道本身见 localProbeTunnel。

import { MAIL_PROBE_HIDDEN_GROUP_NAME } from './cursorProxyGroup'
import { mihomoChangeProxy } from './mihomoApi'

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
