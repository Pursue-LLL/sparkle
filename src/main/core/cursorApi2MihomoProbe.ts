// [INPUT] axios · cursorTransportHealthCore · config/dirs · service api
// [OUTPUT] probeApi2ViaMihomoNode — recovery-safe (no index.js circular require)
// [POS] BUG-2026-09-04-014 — emergency recovery api2 anchor probe.

import axios, { type AxiosInstance } from 'axios'
import { getAppConfigSync } from '../config/app'
import { createSignedServiceAxios } from '../service/api'
import { mihomoIpcPath } from '../utils/dirs'
import { API2_PROBE_TARGET } from './cursorTransportHealthCore'

export const RECOVERY_API2_PROBE_DEFAULT_TIMEOUT_MS = 8000

async function createRecoveryMihomoAxios(): Promise<AxiosInstance> {
  const { corePermissionMode = 'elevated' } = getAppConfigSync()
  if (corePermissionMode === 'service') {
    return createSignedServiceAxios('http://localhost/core/controller')
  }
  const instance = axios.create({
    baseURL: 'http://localhost',
    socketPath: mihomoIpcPath(),
    timeout: 15_000,
  })
  instance.interceptors.response.use(
    (response) => response.data,
    (error: { response?: { data?: unknown } }) => {
      if (error.response?.data) {
        return Promise.reject(error.response.data)
      }
      return Promise.reject(error)
    },
  )
  return instance
}

export async function probeApi2ViaMihomoNode(
  proxyNode: string,
  timeoutMs: number = RECOVERY_API2_PROBE_DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; latencyMs: number; errorDetail?: string }> {
  const startedAt = Date.now()
  try {
    const instance = await createRecoveryMihomoAxios()
    const result = (await instance.get(`/proxies/${encodeURIComponent(proxyNode)}/delay`, {
      params: {
        url: API2_PROBE_TARGET,
        timeout: timeoutMs,
      },
    })) as { delay?: number; message?: string }
    const latencyMs = Date.now() - startedAt
    if (typeof result.delay === 'number' && result.delay > 0) {
      return { ok: true, latencyMs: result.delay }
    }
    return {
      ok: false,
      latencyMs,
      errorDetail: result.message,
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      errorDetail: error instanceof Error ? error.message : String(error),
    }
  }
}
