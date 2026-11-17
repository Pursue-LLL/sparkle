#!/usr/bin/env tsx
// [INPUT] anytlsReuseGuardCore::ANYTLS_DISABLE_REUSE_KEY/applyAnytlsReuseGuard (POS: AnyTLS 会话复用防护) ·
//         utils/yaml::stringifyYaml (POS: YAML 解析与序列化)
// [OUTPUT] pnpm run verify:anytls-reuse [内核路径]: 退出码 0 = 内核认识 AnyTLS 的会话复用选项且按 bool 解析
// [POS] AnyTLS 会话复用防护对真实 mihomo 内核的契约校验（`mihomo -t`，不启动内核、不占端口，约 1 秒）。升级或切换内核（含 alpha）后运行；选项改名或被忽略时防护会静默失效，服务端不回 SYNACK 的节点又会在第 3 秒掐断复用会话上的长连接。

/**
 * 内核对未知键一概静默忽略（拼错的键同样能通过 `-t`），所以只验证「防护写出的节点能通过」不够：
 * 还要给同一个键一个非法值，内核真的把它当 bool 字段解析时才会报错。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

// scripts/ 是 ESM 包而 src/ 是 CJS 包：具名 import 在运行时取不到导出，故经 CJS require 加载（类型仍取自源码）。
const requireSource = createRequire(import.meta.url)
const { ANYTLS_DISABLE_REUSE_KEY, applyAnytlsReuseGuard } = requireSource(
  '../src/main/core/anytlsReuseGuardCore'
) as typeof import('../src/main/core/anytlsReuseGuardCore')
const { stringifyYaml } = requireSource(
  '../src/main/utils/yaml'
) as typeof import('../src/main/utils/yaml')

const ROOT = path.resolve(import.meta.dirname, '..')

const PROBE_NODE = {
  name: 'probe-anytls',
  type: 'anytls',
  server: '127.0.0.1',
  port: 1,
  password: 'not-a-secret',
  sni: 'probe.invalid',
  'skip-cert-verify': true
}

interface ConfigCheck {
  accepted: boolean
  output: string
}

/** 只让内核解析配置：隔离的临时目录，不监听端口、不连任何节点。 */
function checkConfig(binary: string, proxy: unknown): ConfigCheck {
  const workDir = mkdtempSync(path.join(tmpdir(), 'sparkle-anytls-reuse-'))
  try {
    const file = path.join(workDir, 'config.yaml')
    const config = { 'mixed-port': 0, proxies: [proxy], rules: ['MATCH,DIRECT'] }
    writeFileSync(file, stringifyYaml(config), 'utf8')
    const result = spawnSync(binary, ['-t', '-d', workDir, '-f', file], {
      encoding: 'utf8',
      timeout: 30_000
    })
    return { accepted: result.status === 0, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function main(): void {
  const binary = path.resolve(process.argv[2] ?? path.join(ROOT, 'extra/sidecar/mihomo'))
  if (!existsSync(binary)) {
    throw new Error(`内核不存在：${binary}（先执行 pnpm run prepare，或传入内核路径）`)
  }

  const [guarded] = applyAnytlsReuseGuard([PROBE_NODE])
  const accepted = checkConfig(binary, guarded)
  assert.ok(accepted.accepted, `内核拒绝了防护写出的 AnyTLS 节点：\n${accepted.output}`)

  const rejected = checkConfig(binary, { ...PROBE_NODE, [ANYTLS_DISABLE_REUSE_KEY]: 'not-a-bool' })
  assert.ok(
    !rejected.accepted &&
      rejected.output.includes(ANYTLS_DISABLE_REUSE_KEY) &&
      rejected.output.includes('bool'),
    `内核没有把 ${ANYTLS_DISABLE_REUSE_KEY} 当 bool 选项解析（被忽略或已改名）：\n${rejected.output}`
  )

  console.log(`[verify-anytls-reuse] OK kernel=${binary}`)
}

try {
  main()
} catch (error) {
  console.error(`[verify-anytls-reuse] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
