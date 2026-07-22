import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { agentTransportJsonlPaths } from './connectPartitionReader'

describe('connectPartitionReader paths', () => {
  it('includes sparkle, legacy root, and profile-scoped guard jsonl paths', () => {
    const home = homedir()
    const profileDir = join(home, '.cursor-500-guard', 'profiles', '3.12.17')
    const profileJsonl = join(profileDir, 'agent-transport-failures.jsonl')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(profileJsonl, '', 'utf8')
    try {
      const paths = agentTransportJsonlPaths()
      assert.ok(paths.includes(join(home, '.sparkle', 'agent-transport-failures.jsonl')))
      assert.ok(paths.includes(join(home, '.cursor-500-guard', 'agent-transport-failures.jsonl')))
      assert.ok(paths.includes(profileJsonl))
    } finally {
      rmSync(profileJsonl, { force: true })
    }
  })
})
