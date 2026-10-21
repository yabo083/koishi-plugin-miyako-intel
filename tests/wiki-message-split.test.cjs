const test = require('node:test')
const assert = require('node:assert/strict')

const { splitWikiMessage } = require('../lib/index.js')

test('splitWikiMessage keeps short replies in one piece', () => {
  assert.deepEqual(splitWikiMessage(''), [])
  assert.deepEqual(splitWikiMessage('   '), [])
  assert.deepEqual(splitWikiMessage('只有一段'), ['只有一段'])
})

test('splitWikiMessage packs long details on line boundaries without losing text', () => {
  const lines = Array.from({ length: 200 }, (_, index) => `第 ${index} 行：${'汤'.repeat(20)}`)
  const text = lines.join('\n')
  const chunks = splitWikiMessage(text, 300)

  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => chunk.length <= 300))
  assert.equal(chunks.join('\n'), text)
  assert.match(chunks[0], /^第 0 行/)
  assert.match(chunks.at(-1), /第 199 行/)
})

test('splitWikiMessage hard-slices a single line longer than the limit', () => {
  const line = '长'.repeat(1000)
  const chunks = splitWikiMessage(line, 300)

  assert.deepEqual(chunks.map(chunk => chunk.length), [300, 300, 300, 100])
  assert.equal(chunks.join(''), line)
})

test('splitWikiMessage keeps a real operator detail sendable under the QQ cap', () => {
  const text = ['名称：汤汤 | 类型：干员资料 | 来源：Warfarin Wiki', '', '正文：', '资料：汤汤', ...Array.from({ length: 105 }, (_, index) => `第 ${index} 行：${'语气'.repeat(30)}`)].join('\n')
  const chunks = splitWikiMessage(text)

  assert.ok(text.length > 6000)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => chunk.length <= 1200))
  assert.equal(chunks.join('\n'), text)
})
