// [INPUT] react
// [OUTPUT] useLatest: 每次渲染同步最新值的 ref
// [POS] 「稳定回调 + 读取最新状态」的通用工具（如 Virtuoso 回调），避免回调随状态变化而重建。

import { useRef, type RefObject } from 'react'

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  ref.current = value
  return ref
}
