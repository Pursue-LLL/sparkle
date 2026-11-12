// [INPUT] 无
// [OUTPUT] createListenerHub · ListenerHub · ListenerHubLifecycle
// [POS] 订阅者集合：向全部订阅者广播（单个订阅者抛错不影响其余），并在首个订阅者出现 / 最后一个离开时通知生命周期，
//       供按需启停的数据流使用。不含任何 IO。

export interface ListenerHubLifecycle {
  onFirstSubscribed: () => void
  onLastUnsubscribed: () => void
}

export interface ListenerHub<T> {
  /** 同一函数重复订阅视为一次；返回取消订阅函数，重复取消无副作用。 */
  subscribe: (listener: (value: T) => void) => () => void
  publish: (value: T) => void
}

export function createListenerHub<T>(lifecycle?: ListenerHubLifecycle): ListenerHub<T> {
  const listeners = new Set<(value: T) => void>()

  return {
    subscribe: (listener) => {
      const wasEmpty = listeners.size === 0
      listeners.add(listener)
      if (wasEmpty) {
        lifecycle?.onFirstSubscribed()
      }
      return () => {
        if (listeners.delete(listener) && listeners.size === 0) {
          lifecycle?.onLastUnsubscribed()
        }
      }
    },
    publish: (value) => {
      for (const listener of listeners) {
        try {
          listener(value)
        } catch {
          // 单个订阅者异常不影响其余订阅者
        }
      }
    }
  }
}
