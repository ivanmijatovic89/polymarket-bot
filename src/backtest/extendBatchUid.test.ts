import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateExtensionBatchUid } from './extendBatchUid.js'

test('generateExtensionBatchUid: first extension appends -ext1', () => {
  assert.equal(generateExtensionBatchUid('v5-500'), 'v5-500-ext1')
})

test('generateExtensionBatchUid: increments existing -extN suffix', () => {
  assert.equal(generateExtensionBatchUid('v5-500-ext1'), 'v5-500-ext2')
  assert.equal(generateExtensionBatchUid('v5-500-ext2'), 'v5-500-ext3')
})

test('generateExtensionBatchUid: only the trailing -extN counts as the counter', () => {
  // "v5-ext3-ext1" is treated as base="v5-ext3" + counter=1 → "v5-ext3-ext2".
  // Replace mode (rather than append) keeps the batchUid bounded over many extends.
  assert.equal(generateExtensionBatchUid('v5-ext3-ext1'), 'v5-ext3-ext2')
})

test('generateExtensionBatchUid: works on uuid-style parents', () => {
  assert.equal(
    generateExtensionBatchUid('a1b2c3d4-e5f6-7890-1234-567890abcdef'),
    'a1b2c3d4-e5f6-7890-1234-567890abcdef-ext1',
  )
})

test('generateExtensionBatchUid: rejects empty / non-string parents', () => {
  assert.throws(() => generateExtensionBatchUid(''), /non-empty string/)
  assert.throws(() => generateExtensionBatchUid('   '), /non-empty string/)
  // @ts-expect-error testing runtime behaviour
  assert.throws(() => generateExtensionBatchUid(null), /non-empty string/)
})
