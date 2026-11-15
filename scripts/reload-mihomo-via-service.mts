/**
 * 经 sparkle-service 强制让内核重新加载当前配置（PUT /core/controller/configs?force=true）。
 * 会重建所有连接，仅用于手动恢复；升级流程不调用。
 */
import { callService } from './lib/serviceSignedRequest'

const RELOAD_PATH = '/core/controller/configs?force=true'

async function main(): Promise<void> {
  const response = await callService({
    method: 'PUT',
    pathWithQuery: RELOAD_PATH,
    body: Buffer.from(JSON.stringify({ path: '', payload: '' })),
    timeoutMs: 30_000
  })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`PUT ${RELOAD_PATH} status=${response.statusCode}`)
  }
  console.log('reload_ok')
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
