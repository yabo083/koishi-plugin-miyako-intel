const assert = require('node:assert/strict')
const fs = require('node:fs')
const { Argv, Context } = require('koishi')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.resolve(__dirname, '..')
const builtFile = path.join(rootDir, 'dist', 'index.js')

function loadPlugin() {
  delete require.cache[builtFile]
  return require(builtFile)
}

function createCommandStub(name, commandHandlers) {
  return {
    option() { return this },
    alias() { return this },
    subcommand(def) {
      const subcommandName = name + (def.startsWith('.') ? '' : '/') + def
      return createCommandStub(subcommandName, commandHandlers)
    },
    action(handler) {
      commandHandlers.set(name, handler)
      return this
    },
  }
}

function createMockContext(options = {}) {
  const registeredCommands = []
  const commandHandlers = new Map()
  const intervals = []
  const sent = []
  const broadcastCalls = []
  const loggerLines = []

  const ctx = {
    baseDir: options.baseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'prts-plugin-')),
    puppeteer: options.puppeteer,
    command(name) {
      registeredCommands.push(name)
      return createCommandStub(name, commandHandlers)
    },
    inject() {
      return { constructor: { name: 'ForkScope' } }
    },
    async broadcast(channels, content, forced) {
      broadcastCalls.push({ channels, content, forced })
      return []
    },
    logger() {
      return {
        info(message) { loggerLines.push(['info', message]) },
        warn(message) { loggerLines.push(['warn', message]) },
        error(message) { loggerLines.push(['error', message]) },
      }
    },
    setInterval(callback, ms) {
      intervals.push({ callback, ms })
      return () => undefined
    },
    on() { return () => undefined },
  }

  function createSession() {
    return {
      sent,
      async send(message) {
        sent.push(message)
      },
    }
  }

  return { ctx, registeredCommands, commandHandlers, intervals, sent, loggerLines, broadcastCalls, createSession }
}

const defaultConfig = {
  baseUrl: 'https://prts.wiki',
  homepagePath: '/w/%E9%A6%96%E9%A1%B5',
  cacheDirectory: 'data/miyako-intel/cache',
  timezone: 'Asia/Shanghai',
  dailyRefreshHour: 4,
  scheduledRefreshMinute: 5,
  navigationTimeoutMs: 45000,
  renderDelayMs: 0,
  viewportWidth: 1366,
  viewportHeight: 900,
  staleFallback: true,
  scheduledPush: {
    enabled: false,
    channels: [],
    hour: 4,
    minute: 10,
  },
  now: '2026-04-29T02:00:00.000+08:00',
}

test('calculates PRTS cache day by 04:00 Asia/Shanghai boundary', () => {
  const { getPrtsDayKey } = loadPlugin()

  assert.equal(getPrtsDayKey(new Date('2026-04-28T19:59:00.000Z'), 'Asia/Shanghai', 4), '2026-04-28')
  assert.equal(getPrtsDayKey(new Date('2026-04-28T20:00:00.000Z'), 'Asia/Shanghai', 4), '2026-04-29')
})

test('registers only the daily Koishi dot command', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, registeredCommands, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, defaultConfig)

  assert.deepEqual(registeredCommands, ['prts'])

  const handler = commandHandlers.get('prts.d')
  assert.equal(typeof handler, 'function')
  assert.equal(commandHandlers.has('prts.e'), false)

  const text = await handler({ session: createSession() })

  assert.deepEqual(calls.filter((item) => item === 'captureDaily'), ['captureDaily'])
  assert.equal(sent.filter((item) => String(item).includes('base64')).length, 1)
  assert.match(text, /已发送/)
})

test('Koishi resolves prts d input to the prts.d subcommand', () => {
  const { apply } = loadPlugin()
  const ctx = new Context()
  ctx.baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prts-real-context-'))
  ctx.setInterval = () => () => undefined

  apply(ctx, defaultConfig)

  const session = {
    stripped: { content: '', prefix: '' },
    isDirect: true,
    resolve: (value) => value,
    text: (value) => value,
  }
  const argv = Argv.parse('prts d')
  argv.session = session

  const command = ctx.$commander.inferCommand(argv)

  assert.equal(command.name, 'prts.d')
})

test('refresh command defaults to refreshing daily capture only', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, defaultConfig)

  const handler = commandHandlers.get('prts.r [target:string]')
  assert.equal(typeof handler, 'function')

  const text = await handler({ session: createSession() })

  assert.deepEqual(calls.filter((item) => item === 'captureDaily'), ['captureDaily'])
  assert.equal(sent.filter((item) => String(item).includes('base64')).length, 1)
  assert.match(text, /缓存已刷新/)
})

test('uses previous cache when fresh daily capture fails', async () => {
  const { apply, getPrtsDayKey } = loadPlugin()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prts-stale-'))
  const staleDir = path.join(baseDir, 'data/miyako-intel/cache', '2026-04-28')
  fs.mkdirSync(staleDir, { recursive: true })
  fs.writeFileSync(path.join(staleDir, 'daily.png'), Buffer.from('old-image'))

  const puppeteer = createFailingPuppeteer()
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ baseDir, puppeteer })
  const config = { ...defaultConfig, now: '2026-04-29T08:00:00.000+08:00' }
  assert.equal(getPrtsDayKey(new Date(config.now), config.timezone, config.dailyRefreshHour), '2026-04-29')

  apply(ctx, config)

  const handler = commandHandlers.get('prts.d')
  await handler({ session: createSession() })

  assert.match(String(sent[0]), /当前 PRTS 获取失败，发送上一份缓存/)
  assert.match(String(sent[1]), /base64,b2xkLWltYWdl/)
})

test('scheduled push only broadcasts to allowed channels when enabled', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, intervals, broadcastCalls } = createMockContext({ puppeteer })

  const config = {
    ...defaultConfig,
    now: '2026-04-29T05:12:00.000+08:00',
    scheduledPush: {
      enabled: true,
      channels: ['sandbox:group-1', 'sandbox:group-2'],
      hour: 5,
      minute: 10,
    },
  }

  apply(ctx, config)
  await intervals[0].callback()
  await intervals[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(broadcastCalls.length, 1)
  assert.deepEqual(broadcastCalls[0].channels, ['sandbox:group-1', 'sandbox:group-2'])
  assert.equal(calls.filter((item) => item === 'captureDaily').length, 1)
})

function createFailingPuppeteer() {
  return {
    async page() {
      return {
        async setUserAgent() {},
        async setViewport() {},
        async goto() { throw new Error('network down') },
        async close() {},
      }
    },
  }
}

function createFakePuppeteer({ calls }) {
  return {
    async page() {
      return createFakePage(calls)
    },
  }
}

function createFakePage(calls) {
  return {
    currentUrl: '',
    async setUserAgent() {},
    async setViewport() {},
    async goto(url) {
      this.currentUrl = url
    },
    async waitForSelector(selector) {
      if (selector === '#今日信息_2') calls.push('captureDaily')
    },
    async waitForFunction() {},
    async waitForTimeout() {},
    async content() { return '' },
    async evaluate(fn, arg) {
      const source = String(fn)
      if (source.includes('prts-capture-daily')) return true
      return true
    },
    async $(selector) {
      if (selector === '#prts-capture-daily') return fakeElement('daily-image')
      if (selector === '#prts-capture-daily-v2') return fakeElement('daily-image')
      return null
    },
    async close() {},
  }
}

function fakeElement(text) {
  return {
    async screenshot() {
      return Buffer.from(text)
    },
  }
}
