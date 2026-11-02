const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.resolve(__dirname, '..')
const schedulerFile = path.join(rootDir, 'lib', 'core', 'scheduler.js')

const AT_0400 = '2026-05-14T04:00:00.000+08:00'
const AT_0359 = '2026-05-14T03:59:00.000+08:00'

function loadScheduler() {
  delete require.cache[schedulerFile]
  return require(schedulerFile)
}

/** 模拟投递服务的日切水位：同一 slot+dayKey 只放行一次 */
function createFakeDelivery() {
  const store = new Set()
  return {
    store,
    async gateDailySlot(slot, dayKey) {
      const key = `${slot}@${dayKey}`
      if (store.has(key)) return false
      store.add(key)
      return true
    },
  }
}

test('claim 对同一 slot+dayKey 只放行一次', async () => {
  const { createDailyClaim } = loadScheduler()
  const delivery = createFakeDelivery()
  const gate = createDailyClaim({ nowProvider: () => new Date(AT_0400), delivery })

  assert.equal(await gate.claim('push'), '2026-05-14')
  assert.equal(await gate.claim('push'), undefined)
  // 不同 slot 互不影响
  assert.equal(await gate.claim('maintain'), '2026-05-14')
})

test('claim 跨实例共享投递服务的日切水位', async () => {
  const { createDailyClaim } = loadScheduler()
  const delivery = createFakeDelivery()
  const first = createDailyClaim({ nowProvider: () => new Date(AT_0400), delivery })
  const second = createDailyClaim({ nowProvider: () => new Date(AT_0400), delivery })

  assert.equal(await first.claim('push'), '2026-05-14')
  assert.equal(await second.claim('push'), undefined)
})

test('dayKey 以 04:00 东八区为日界', async () => {
  const { createDailyClaim } = loadScheduler()
  const delivery = createFakeDelivery()
  const before = createDailyClaim({ nowProvider: () => new Date(AT_0359), delivery })
  const after = createDailyClaim({ nowProvider: () => new Date(AT_0400), delivery })

  assert.equal(await before.claim('push'), '2026-05-13')
  assert.equal(await after.claim('push'), '2026-05-14')
})

test('claim 不再判断 cron：表达式与触发时机由投递服务负责', async () => {
  const scheduler = loadScheduler()
  assert.equal(typeof scheduler.createDailyClaim, 'function')
  assert.equal(scheduler.matchesCronExpression, undefined)
  assert.equal(scheduler.startBackgroundLoop, undefined)
})

test('claim 被拒绝时写 debug 日志并返回 undefined', async () => {
  const { createDailyClaim } = loadScheduler()
  const delivery = createFakeDelivery()
  await delivery.gateDailySlot('push', '2026-05-14')
  const lines = []
  const gate = createDailyClaim({
    nowProvider: () => new Date(AT_0400),
    delivery,
    logger: { debug: (message) => lines.push(message) },
  })

  assert.equal(await gate.claim('push'), undefined)
  assert.match(lines[0], /已执行/)
})
