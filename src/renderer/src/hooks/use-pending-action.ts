// [INPUT] 无
// [OUTPUT] PendingAction · usePendingAction
// [POS] 开关点击的「进行中」状态：点击后展示值立即翻到目标值，执行期间的重复点击被忽略，结束（成功或失败）后展示值回到已保存的值；
//       动作自己负责失败提示。
import { useRef, useState } from 'react'

export interface PendingAction<T> {
  /** 进行中的目标值；空闲时为 undefined，此时应展示已保存的值。 */
  pendingTarget: T | undefined
  run: (target: T) => Promise<void>
}

export function usePendingAction<T>(action: (target: T) => Promise<void>): PendingAction<T> {
  const [pendingTarget, setPendingTarget] = useState<T | undefined>(undefined)
  // 防重入用 ref：连点时第二次点击读到的 state 可能还没更新。
  const busyRef = useRef(false)

  const run = async (target: T): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setPendingTarget(target)
    try {
      await action(target)
    } finally {
      busyRef.current = false
      setPendingTarget(undefined)
    }
  }

  return { pendingTarget, run }
}
