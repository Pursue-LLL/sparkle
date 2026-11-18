// [INPUT] axios::isAxiosError (POS: HTTP 客户端)
// [OUTPUT] redactUrl · toDownloadError
// [POS] 订阅与覆写远程下载失败时的错误文本：把 axios 的错误码翻成可读中文，且不把下载地址原样带进去——
// 订阅地址里的令牌可能在查询串、路径片段或 `用户:密码@` 里，而错误信息会写进 App 日志（落盘）并显示在界面上。

import axios from 'axios'

const UNPARSEABLE_URL = '（地址无法解析）'

/** 错误信息里的下载地址只留协议、主机与端口：路径、查询串、片段与账号密码都可能是令牌。 */
export function redactUrl(url: string): string {
  try {
    const { protocol, host } = new URL(url)
    return `${protocol}//${host}`
  } catch {
    return UNPARSEABLE_URL
  }
}

/**
 * 把 axios 下载失败翻成可读错误，供调用方 `throw`；其它错误（证书指纹不匹配、代理失败等）原样返回。
 * 错误码先于消息文本判断，顺序即优先级。
 */
export function toDownloadError(error: unknown, url: string): unknown {
  if (!axios.isAxiosError(error)) {
    return error
  }

  const target = redactUrl(url)
  if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
    return new Error(`网络连接被重置或超时：${target}`)
  }
  if (error.code === 'CERT_HAS_EXPIRED') {
    return new Error(`服务器证书已过期：${target}`)
  }
  if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return new Error(`无法验证服务器证书：${target}`)
  }
  if (error.message.includes('Certificate verification failed')) {
    return new Error(`证书验证失败：${target}`)
  }
  return new Error(`请求失败：${error.message}`)
}
