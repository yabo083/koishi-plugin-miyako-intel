const test = require('node:test')
const assert = require('node:assert/strict')

const { buildOneBotForwardNodes, batchOneBotForwardNodes, FORWARD_BATCH_CHARS } = require('../lib/wiki/onebot-forward.js')
const { createWikiReplySender } = require('../lib/wiki/reply.js')

const config = { groupForwardEnabled: true, groupForwardNodeLineLimit: 20, groupForwardSenderName: 'Warfarin Wiki', groupForwardSenderUin: '2854196310' }
const logger = { info() {}, warn() {}, error() {}, debug() {} }

function operatorDetail() {
  return ['名称：汤汤 | 类型：干员资料 | 来源：Warfarin Wiki', '', '正文：', '资料：汤汤', ...Array.from({ length: 105 }, (_, index) => `第 ${index} 行：${'语气'.repeat(30)}`)].join('\n')
}

test('forward batching keeps every card under the QQ total-text limit', () => {
  const nodes = buildOneBotForwardNodes([operatorDetail()], config)
  const batches = batchOneBotForwardNodes(nodes)

  assert.ok(nodes.length > 3)
  assert.ok(batches.length > 1)
  assert.equal(batches.flat().length, nodes.length)
  for (const batch of batches) {
    const total = batch.reduce((sum, node) => sum + node.data.content.length, 0)
    assert.ok(total <= FORWARD_BATCH_CHARS, `batch of ${total} chars exceeds ${FORWARD_BATCH_CHARS}`)
  }
})

test('short replies stay in a single forward card', () => {
  const batches = batchOneBotForwardNodes(buildOneBotForwardNodes(['只有一段'], config))
  assert.equal(batches.length, 1)
  assert.equal(batches[0][0].data.content, '只有一段')
})

test('long details are sent as several forward cards, never as plain spam', async () => {
  const forwarded = []
  const plain = []
  const session = {
    platform: 'onebot',
    userId: '2657455842',
    onebot: { async send_private_forward_msg(payload) { forwarded.push(payload) } },
    async send(message) { plain.push(message) },
  }
  const sender = createWikiReplySender(config, logger)
  const reply = await sender.send(session, operatorDetail())

  assert.equal(reply, undefined)
  assert.equal(plain.length, 0)
  assert.ok(forwarded.length > 1)
  assert.ok(forwarded.every(payload => payload.messages.reduce((sum, node) => sum + node.data.content.length, 0) <= FORWARD_BATCH_CHARS))
})

test('forward failures fall back to plain chunks without duplicating sent cards', async () => {
  const forwarded = []
  const plain = []
  let call = 0
  const session = {
    platform: 'onebot',
    userId: '2657455842',
    onebot: {
      async send_private_forward_msg(payload) {
        call++
        if (call >= 2) throw new Error('forward rejected')
        forwarded.push(payload)
      },
    },
    async send(message) { plain.push(message) },
  }
  const sender = createWikiReplySender(config, logger)
  const reply = await sender.send(session, operatorDetail())

  assert.equal(reply, undefined)
  assert.equal(forwarded.length, 1)
  assert.ok(plain.length > 0)
  assert.ok(plain.every(chunk => chunk.length <= 1200))
  assert.ok(!plain.some(chunk => chunk.includes(forwarded[0].messages[0].data.content)))
})
