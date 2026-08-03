import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { discoverGuardValidatedLedgerPaths } from './guardValidatedLedgerPathsCore'

describe('guardValidatedLedgerPathsCore', () => {
  it('discovers legacy root and profile-scoped validated ledgers', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-ledger-paths-'))
    const root = path.join(home, '.cursor-500-guard')
    fs.mkdirSync(path.join(root, 'runtime-events'), { recursive: true })
    fs.mkdirSync(path.join(root, 'profiles', '3.12.17', 'runtime-events'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runtime-events', 'validated-ledger.v1.jsonl'), '')
    fs.writeFileSync(
      path.join(root, 'profiles', '3.12.17', 'runtime-events', 'validated-ledger.v1.jsonl'),
      '',
    )
    const paths = discoverGuardValidatedLedgerPaths(home)
    assert.equal(paths.length, 2)
    assert.ok(paths.some((entry) => entry.includes('profiles/3.12.17/')))
  })
})
