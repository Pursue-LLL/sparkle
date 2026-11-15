// [INPUT] scripts/lib/serviceSignedRequest.ts::callService (POS: 脚本侧调用 sparkle-service 的唯一 SPARKLE-AUTH-V2 签名实现)
// [OUTPUT] 经 sparkle-service 强制让内核重新加载当前配置（PUT /core/controller/configs?force=true）· 非 2xx 时非零退出
// [POS] 手动恢复用命令行：会重建所有连接，升级流程不调用。
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
