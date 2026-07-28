import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const sourcePath = join(process.cwd(), 'src/main/core/managedVpsDelayTest.ts')

describe('managedVpsDelayTest import guard', () => {
  it('imports getAppConfig alongside formatUnknownErrorForUi (regression b883c26)', () => {
    const source = readFileSync(sourcePath, 'utf8')
    assert.match(source, /import\s*\{\s*getAppConfig\s*\}\s*from\s*['"]\.\.\/config['"]/)
    assert.match(
      source,
      /import\s*\{\s*formatUnknownErrorForUi\s*\}\s*from\s*['"]\.\.\/utils\/formatUnknownErrorForLog['"]/,
    )
    assert.match(source, /await getAppConfig\(\)/)
  })
})
