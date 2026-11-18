// [INPUT] react
// [OUTPUT] useProxyColumns: 代理节点网格列数
// [POS] 代理页列数：固定列数直接取配置值，`auto` 时按视口宽度断点计算并随窗口缩放更新。

import { useEffect, useState } from 'react'

function calcAutoColumns(): number {
  if (window.matchMedia('(min-width: 1536px)').matches) {
    return 5
  } else if (window.matchMedia('(min-width: 1280px)').matches) {
    return 4
  } else if (window.matchMedia('(min-width: 1024px)').matches) {
    return 3
  } else {
    return 2
  }
}

export function useProxyColumns(proxyCols: string): number {
  const [cols, setCols] = useState(1)

  useEffect(() => {
    if (proxyCols !== 'auto') {
      setCols(parseInt(proxyCols))
      return
    }
    setCols(calcAutoColumns())
    const handleResize = (): void => {
      setCols(calcAutoColumns())
    }
    window.addEventListener('resize', handleResize)
    return (): void => {
      window.removeEventListener('resize', handleResize)
    }
  }, [proxyCols])

  return cols
}
