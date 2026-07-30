import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

describe('marathonQuiesce import guard', () => {
  it('uses static getAppConfig import (no destructured dynamic import from ../config)', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/core/marathonQuiesce.ts'), 'utf8')
    assert.match(source, /import\s*\{\s*getAppConfig\s*\}\s*from\s*['"]\.\.\/config\/app['"]/)
    assert.doesNotMatch(source, /const\s*\{\s*getAppConfig\s*\}\s*=\s*await/)
    assert.doesNotMatch(source, /getAppConfig\s*=\s*await\s*import\(['"]\.\.\/config['"]\)/)
  })
})
