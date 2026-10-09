// [INPUT] service 鉴权 axios · 直连 mihomo unix socket
// [OUTPUT] probeMihomoControllerVersion
// [POS] 控制器就绪探针；禁止从 postCoreBootstrap 动态 import mihomoApi/index（rolldown 会错绑到 index.js）。
// 纯 HTTP 探针，不依赖 mihomoApi（mihomoApi 反向 import 主进程 index，会形成环）。

import axios from 'axios'
import { getAppConfig } from '../config'
import { createSignedServiceAxios } from '../service/api'
import { mihomoIpcPath } from '../utils/dirs'

/** 控制器 /version 可达即视为 API 就绪。 */
export async function probeMihomoControllerVersion(): Promise<void> {
  const { corePermissionMode = 'elevated' } = await getAppConfig()
  if (corePermissionMode === 'service') {
    const instance = createSignedServiceAxios('http://localhost/core/controller')
    await instance.get('/version')
    return
  }

  await axios.get('http://localhost/version', {
    baseURL: 'http://localhost',
    socketPath: mihomoIpcPath(),
    timeout: 15_000
  })
}
