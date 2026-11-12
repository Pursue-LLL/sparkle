import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUnknownErrorForLog, formatUnknownErrorForUi } from './formatUnknownErrorForLog'

test('formatUnknownErrorForUi unwraps nested mihomo message objects', () => {
  assert.equal(
    formatUnknownErrorForUi({ message: 'timeout: no recent network activity' }),
    'timeout: no recent network activity'
  )
  assert.notEqual(formatUnknownErrorForUi({ message: { code: 14 } }), '[object Object]')
})

test('formatUnknownErrorForLog serializes plain mihomo response objects', () => {
  const formatted = formatUnknownErrorForLog({ message: 'timeout: no recent network activity' })
  assert.equal(formatted, '{"message":"timeout: no recent network activity"}')
})

test('formatUnknownErrorForLog prints strings as they are and null-likes by name', () => {
  assert.equal(formatUnknownErrorForLog('plain'), 'plain')
  assert.equal(formatUnknownErrorForLog(null), 'null')
  assert.equal(formatUnknownErrorForLog(undefined), 'undefined')
  assert.equal(formatUnknownErrorForLog(42), '42')
})

test('formatUnknownErrorForLog falls back to String for values JSON cannot encode', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular

  assert.equal(formatUnknownErrorForLog(circular), '[object Object]')
})

test('formatUnknownErrorForLog follows a chain of causes and ignores an empty cause', () => {
  const chained = new Error('outer', { cause: new TypeError('inner', { cause: 'root' }) })

  assert.equal(formatUnknownErrorForLog(chained), 'Error: outer cause=TypeError: inner cause=root')
  assert.equal(formatUnknownErrorForLog(new Error('alone', { cause: null })), 'Error: alone')
})

test('formatUnknownErrorForUi prefers the trimmed Error message and falls back to its name', () => {
  assert.equal(formatUnknownErrorForUi(new Error('  boom  ')), 'boom')
  assert.equal(formatUnknownErrorForUi(new TypeError('')), 'TypeError')
})

test('formatUnknownErrorForUi passes strings through and unwraps nested message objects', () => {
  assert.equal(formatUnknownErrorForUi('plain'), 'plain')
  assert.equal(formatUnknownErrorForUi({ message: { message: 'deep' } }), 'deep')
  assert.equal(formatUnknownErrorForUi({ message: 5 }), '5')
})

test('formatUnknownErrorForUi never prints [object Object]', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  circular.message = circular

  assert.equal(formatUnknownErrorForUi(circular), '未知错误')
  assert.equal(formatUnknownErrorForUi({}), '{}')
  assert.equal(formatUnknownErrorForUi(null), 'null')
})

test('formatUnknownErrorForLog formats Error with cause', () => {
  const formatted = formatUnknownErrorForLog(
    new Error('dial failed', { cause: { message: 'timeout' } })
  )
  assert.match(formatted, /^Error: dial failed cause=/)
})
