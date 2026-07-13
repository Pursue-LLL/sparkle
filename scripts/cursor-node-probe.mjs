#!/usr/bin/env node
/**
 * One-shot Cursor node probe: VPS + commercial, detailed metrics.
 * Usage: node scripts/cursor-node-probe.mjs [--rounds=10] [--out=reports/cursor-node-benchmark-snapshot.md]
 */
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOCK = '/tmp/sparkle-mihomo-api.sock'
const URL = 'https://api2.cursor.sh'
const REGION_PAT = /JP-VPS|KR-VPS|新加坡|台湾|日本|韩国/

const args = process.argv.slice(2)
const rounds = Number(args.find((a) => a.startsWith('--rounds='))?.split('=')[1] ?? 10)
const outRel =
  args.find((a) => a.startsWith('--out='))?.split('=')[1] ??
  'reports/cursor-node-benchmark-snapshot.md'
const outPath = path.isAbsolute(outRel) ? outRel : path.join(__dirname, '..', outRel)

function curlJson(urlPath) {
  const raw = execSync(
    `curl -s --unix-socket ${SOCK} 'http://localhost${urlPath}'`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )
  return JSON.parse(raw)
}

function quoteProxy(name) {
  return encodeURIComponent(name)
}

function probeOnce(name) {
  try {
    const o = curlJson(`/proxies/${quoteProxy(name)}/delay?url=${URL}&timeout=8000`)
    const d = o.delay ?? 0
    return d > 0 ? d : -1
  } catch {
    return -1
  }
}

function percentile(values, p) {
  if (!values.length) return -1
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

function derive(delays, samples, successes) {
  const ok = delays.filter((d) => d > 0)
  if (!ok.length) return null
  const avg = ok.reduce((a, b) => a + b, 0) / ok.length
  const p50 = percentile(ok, 50)
  const p90 = percentile(ok, 90)
  const p95 = percentile(ok, 95)
  const min = Math.min(...ok)
  const max = Math.max(...ok)
  const stdev =
    ok.length > 1
      ? Math.sqrt(ok.reduce((s, v) => s + (v - avg) ** 2, 0) / ok.length)
      : 0
  const successRate = samples > 0 ? successes / samples : 0
  const jitter = p95 >= 0 && p50 >= 0 ? p95 - p50 : -1
  const cv = avg > 0 ? (stdev / avg) * 100 : -1
  const slow500Rate = ok.filter((v) => v > 500).length / ok.length
  const probeScore = successRate * 100 - avg / 100 - slow500Rate * 30 - (jitter >= 0 ? jitter * 0.05 : 0)
  return {
    avg,
    p50,
    p90,
    p95,
    min,
    max,
    stdev,
    jitter,
    cv,
    successRate,
    slow500Rate,
    probeScore,
    stabilityScore: probeScore
  }
}

function kindOf(name) {
  return /VPS/i.test(name) ? 'vps' : 'commercial'
}

function regionOf(name) {
  if (/KR-VPS|韩国/u.test(name)) return 'KR'
  if (/JP-VPS|日本/u.test(name)) return 'JP'
  if (/台湾/u.test(name)) return 'TW'
  if (/新加坡/u.test(name)) return 'SG'
  return 'other'
}

const proxies = curlJson('/proxies').proxies
const nodes = Object.keys(proxies)
  .filter((n) => !proxies[n].all && !['DIRECT', 'REJECT', 'GLOBAL', 'REJECT-DROP', 'PASS', 'DNS', 'NOOP'].includes(n))
  .filter((n) => REGION_PAT.test(n))
  .sort((a, b) => {
    const ka = kindOf(a) === 'vps' ? 0 : 1
    const kb = kindOf(b) === 'vps' ? 0 : 1
    return ka - kb || a.localeCompare(b)
  })

console.error(`Probing ${nodes.length} nodes × ${rounds} rounds → ${outPath}`)

const results = []
for (const name of nodes) {
  const delays = []
  let successes = 0
  for (let i = 0; i < rounds; i++) {
    const d = probeOnce(name)
    delays.push(d)
    if (d > 0) successes++
  }
  const d = derive(delays, rounds, successes)
  results.push({
    name,
    kind: kindOf(name),
    region: regionOf(name),
    delays,
    samples: rounds,
    successes,
    ...d
  })
  process.stderr.write(`${kindOf(name) === 'vps' ? 'VPS' : 'COM'} ${name}: P50=${d ? Math.round(d.p50) : '-'}ms\n`)
}

const ranked = results.filter((r) => r.p50 != null).sort((a, b) => b.probeScore - a.probeScore)
const byP50 = results.filter((r) => r.p50 != null).sort((a, b) => a.p50 - b.p50)
const vps = ranked.filter((r) => r.kind === 'vps')
const comm = ranked.filter((r) => r.kind === 'commercial')
const gen = new Date().toISOString()

const lines = [
  '# Cursor Node Benchmark Snapshot — VPS + Commercial',
  '',
  `Generated: ${gen}`,
  `Probe target: ${URL}`,
  `Method: mihomo \`/proxies/{name}/delay\` | Rounds per node: ${rounds} | Nodes: ${nodes.length}`,
  '',
  '## Executive Summary',
  ''
]

if (vps.length) {
  const fv = [...vps].sort((a, b) => a.p50 - b.p50)[0]
  lines.push(
    `- **自建最快 P50**: ${fv.name} — ${Math.round(fv.p50)}ms (σ ${fv.stdev.toFixed(1)}ms, jitter ${Math.round(fv.jitter)}ms)`
  )
}
if (comm.length) {
  const fc = [...comm].sort((a, b) => a.p50 - b.p50)[0]
  lines.push(
    `- **商业最快 P50**: ${fc.name} — ${Math.round(fc.p50)}ms (σ ${fc.stdev.toFixed(1)}ms)`
  )
}
if (vps.length && comm.length) {
  const vp = Math.min(...vps.map((r) => r.p50))
  const cp = Math.min(...comm.map((r) => r.p50))
  lines.push(
    `- **推荐**: ${vp <= cp ? `Cursor 组默认 **${[...vps].sort((a, b) => a.p50 - b.p50)[0].name}**（自建 P50 领先 ${Math.round(cp - vp)}ms）` : '商业 P50 暂领先，建议继续 24h rolling 验证'}`
  )
}

lines.push('', '## Rankings (probe score)', '')
for (const [i, r] of ranked.slice(0, 15).entries()) {
  lines.push(
    `${i + 1}. **[${r.kind === 'vps' ? '自建' : '商业'}] ${r.name}** — probe ${r.probeScore.toFixed(1)}, slow>500 ${(r.slow500Rate * 100).toFixed(0)}%, P50 ${Math.round(r.p50)}ms, P95 ${Math.round(r.p95)}ms, success ${(r.successRate * 100).toFixed(0)}%`
  )
}

lines.push('', '## Full Comparison (sorted by P50)', '', '| Kind | Region | Node | N | OK% | Min | P50 | Avg | P90 | P95 | Max | σ | Jitter | CV% |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const r of byP50) {
  lines.push(
    `| ${r.kind === 'vps' ? '自建' : '商业'} | ${r.region} | ${r.name} | ${r.samples} | ${(r.successRate * 100).toFixed(0)}% | ${Math.round(r.min)} | ${Math.round(r.p50)} | ${Math.round(r.avg)} | ${Math.round(r.p90)} | ${Math.round(r.p95)} | ${Math.round(r.max)} | ${r.stdev.toFixed(1)} | ${Math.round(r.jitter)} | ${r.cv.toFixed(1)} |`
  )
}

lines.push('', '_Rolling 24h auto report: enable Sparkle commercialNodeBenchmark + rebuild for hourly updates._', '')

mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, lines.join('\n'))
console.error(`Wrote ${outPath}`)
