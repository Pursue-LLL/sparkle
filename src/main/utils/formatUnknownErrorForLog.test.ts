import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUnknownErrorForLog, formatUnknownErrorForUi } from './formatUnknownErrorForLog'

test('formatUnknownErrorForUi unwraps nested mihomo message objects', () => {
  assert.equal(
    formatUnknownErrorForUi({ message: 'timeout: no recent network activity' }),
    'timeout: no recent network activity',
  )
  assert.notEqual(formatUnknownErrorForUi({ message: { code: 14 } }), '[object Object]')
})

test('formatUnknownErrorForLog serializes plain mihomo response objects', () => {
  const formatted = formatUnknownErrorForLog({ message: 'timeout: no recent network activity' })
  assert.equal(formatted, '{"message":"timeout: no recent network activity"}')
})

test('formatUnknownErrorForLog formats Error with cause', () => {
  const formatted = formatUnknownErrorForLog(
    new Error('dial failed', { cause: { message: 'timeout' } }),
  )
  assert.match(formatted, /^Error: dial failed cause=/)
})
