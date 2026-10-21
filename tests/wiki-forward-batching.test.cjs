const test = require('node:test')
const assert = require('node:assert/strict')

const { buildOneBotForwardNodes, batchOneBotForwardNodes, FORWARD_BATCH_CHARS } = require('../lib/wiki/onebot-forward.js')
const { createWikiReplySender } = require('../lib/wiki/reply.js')

const config = { groupForwardEnabled: true, groupForwardNodeLineLimit: 20, groupForwardSenderName: 'Warfarin Wiki', groupForwardSenderUin: '2854196310' }
const logger = { info() {}, warn() {}, error() {}, debug() {} }
const SECTION = (title, body) => `${title}：${body}`

function operatorDetail(total = 4800) {
  const sections = []
  let remaining = total
  let index = 0
  while (remaining > 0) {
    const size = Math.min(remaining, 700)
    sections.push(SECTION(`档案资料·${++index}`, '汤'.repeat(Math.max(1, size - 8))))
    remaining -= size
  }
  return ['汤汤\n汤汤是一名使用手铳的术师干员。', ...sections].join('\n\n')
}

test('a detail that fits the card budget is one forward message with chapter-aligned nodes', () => {
  const text = operatorDetail(4800)
  const nodes = buildOneBotForwardNodes([text], config)
  const batches = batchOneBotForwardNodes(nodes)

  assert.equal(batches.length, 1)
  assert.ok(nodes.length > 1)
  for (const node of nodes) assert.match(node.data.content, /^(汤汤\n|档案资料·\d+：)/)
  assert.ok(batches[0].reduce((sum, node) => sum + node.data.content.length, 0) <= FORWARD_BATCH_CHARS)
})

test('long details split across as few cards as possible without cutting a chapter', () => {
  const text = operatorDetail(8800)
  const nodes = buildOneBotForwardNodes([text], config)
  const batches = batchOneBotForwardNodes(nodes)

  assert.equal(batches.length, 2)
  for (const batch of batches) {
    const total = batch.reduce((sum, node) => sum + node.data.content.length, 0)
    assert.ok(total <= FORWARD_BATCH_CHARS, `batch of ${total} chars exceeds ${FORWARD_BATCH_CHARS}`)
  }
  for (const node of nodes) assert.match(node.data.content, /^(汤汤\n|档案资料·\d+：)/)
})

test('long details go out as one or two forward cards, never a burst of plain messages', async () => {
  const forwarded = []
  const plain = []
  const session = {
    platform: 'onebot',
    userId: '2657455842',
    onebot: { async send_private_forward_msg(payload) { forwarded.push(payload) } },
    async send(message) { plain.push(message) },
  }
  const sender = createWikiReplySender(config, logger)
  const reply = await sender.send(session, operatorDetail(8800))

  assert.equal(reply, undefined)
  assert.equal(plain.length, 0)
  assert.equal(forwarded.length, 2)
})

test('forward failures fall back to plain chunks for the unsent cards only', async () => {
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
  const reply = await sender.send(session, operatorDetail(8800))

  assert.equal(reply, undefined)
  assert.equal(forwarded.length, 1)
  assert.ok(plain.length > 0)
  assert.ok(plain.every(chunk => chunk.length <= 1200))
})

test('a full detail is one forward card when the raw OneBot API is available', async () => {
  const calls = []
  const session = {
    platform: 'onebot',
    userId: '2657455842',
    onebot: { async _get(action, params) { calls.push({ action, params }) } },
    async send() { throw new Error('raw forward must not fall back to plain text') },
  }
  const sender = createWikiReplySender(config, logger)
  const reply = await sender.send(session, operatorDetail(8800))

  assert.equal(reply, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'send_private_forward_msg')
  assert.equal(calls[0].params.user_id, 2657455842)
  assert.ok(calls[0].params.messages.length > 5)
  assert.equal(calls[0].params.news.length, calls[0].params.messages.length)
  assert.ok(calls[0].params.news.every(item => item.text.length <= 27))
})

test('group sessions send the same single card through the group API', async () => {
  const calls = []
  const session = {
    platform: 'onebot',
    guildId: '10001',
    channelId: '10001',
    onebot: { async _get(action, params) { calls.push({ action, params }) } },
  }
  const sender = createWikiReplySender(config, logger)
  await sender.send(session, operatorDetail(8800))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'send_group_forward_msg')
  assert.equal(calls[0].params.group_id, 10001)
  assert.ok(calls[0].params.news.length > 0)
})

test('a timed-out forward is neither retried nor duplicated as plain text', async () => {
  let calls = 0
  const plain = []
  const timeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' })
  const session = {
    platform: 'onebot',
    userId: '2657455842',
    onebot: { async _get() { calls++; throw timeout } },
    async send(message) { plain.push(message) },
  }
  const sender = createWikiReplySender(config, logger)
  const reply = await sender.send(session, operatorDetail(4800))

  assert.equal(reply, undefined)
  assert.equal(calls, 1)
  assert.equal(plain.length, 0)
})
