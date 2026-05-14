const assert = require('node:assert/strict')
const fs = require('node:fs')
const { Argv, Context } = require('koishi')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.resolve(__dirname, '..')
const builtFile = path.join(rootDir, 'lib', 'index.js')

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
        debug(message) { loggerLines.push(['debug', message]) },
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
  refreshCron: '5 4 * * *',
  logLevel: 'info',
  navigationTimeoutMs: 45000,
  renderDelayMs: 0,
  viewportWidth: 1366,
  viewportHeight: 900,
  deviceScaleFactor: 1,
  imageFormat: 'png',
  jpegQuality: 85,
  staleFallback: true,
  messagePrefix: '',
  messageSuffix: '',
  summaryMaxItems: 8,
  summaryDatePreview: true,
  summaryDisplayItems: [
    { key: 'resource', enabled: true },
    { key: 'annihilation', enabled: true },
    { key: 'event', enabled: true },
    { key: 'voucher', enabled: true },
    { key: 'operator-birthday', enabled: true },
    { key: 'operator-recent', enabled: true },
    { key: 'operator-voucher', enabled: true },
    { key: 'operator-kernel-headhunting', enabled: true },
    { key: 'operator-outfit', enabled: true },
    { key: 'operator-new-module', enabled: true },
    { key: 'operator-headhunting', enabled: true },
    { key: 'operator-event', enabled: true },
    { key: 'recent-stage', enabled: false },
    { key: 'recent-furniture', enabled: true },
    { key: 'recent-other', enabled: true },
  ],
  cardTheme: {
    fontFamily: '',
    backgroundColor: '',
    primaryColor: '',
    warningColor: '',
    dangerColor: '',
    textColor: '',
  },
  cacheMaintenance: {
    enabled: true,
    keepRecentDays: 7,
    archiveEnabled: true,
    archiveDirectory: 'archives',
    archiveCron: '30 4 * * *',
    deleteAfterArchive: true,
  },
  scheduledPush: {
    enabled: false,
    channels: [],
    hour: 4,
    minute: 10,
    cron: '10 4 * * *',
  },
  now: '2026-04-29T02:00:00.000+08:00',
}

test('calculates PRTS cache day by 04:00 Asia/Shanghai boundary', () => {
  const { getPrtsDayKey } = loadPlugin()

  assert.equal(getPrtsDayKey(new Date('2026-04-28T19:59:00.000Z'), 'Asia/Shanghai', 4), '2026-04-28')
  assert.equal(getPrtsDayKey(new Date('2026-04-28T20:00:00.000Z'), 'Asia/Shanghai', 4), '2026-04-29')
})

test('config guide stays compact and shows onebot channel example', () => {
  const { Config, usage } = loadPlugin()
  const json = JSON.stringify(Config)

  assert.doesNotMatch(json, /##/)
  assert.doesNotMatch(json, /###/)
  assert.doesNotMatch(json, /<p><strong>PRTS 今日情报/)
  assert.match(usage, /<p>/)
  assert.match(usage, /<ul>/)
  assert.match(usage, /<code>scheduledPush\.channels<\/code>/)
  assert.match(usage, /onebot:11111111/)
  assert.match(usage, /prts d/)
  assert.match(usage, /分钟 小时 日期 月份 星期/)
  assert.doesNotMatch(json, /summaryFeaturedOperatorCategories/)
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

test('summary command sends reusable daily text without image capture duplication', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, defaultConfig)

  const handler = commandHandlers.get('prts.s')
  assert.equal(typeof handler, 'function')

  const text = await handler({ session: createSession() })

  assert.equal(calls.filter((item) => item === 'captureDaily').length, 1)
  assert.equal(sent.length, 1)
  assert.match(String(sent[0]), /PRTS 今日摘要/)
  assert.match(String(sent[0]), /今日开放：龙门币 \/ 作战记录/)
  assert.match(String(sent[0]), /亮点干员：维什戴尔/)
  assert.match(text, /摘要已发送/)
})

test('summary command cleans redundant text, previews dates, and filters operator display items', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({
    calls,
    summaryItems: [
      { title: '核心动态', items: ['网页活动『足迹』将于2天后结束。', '网页活动『足迹』将于2天后结束。'] },
      { title: '亮点干员', items: ['今日生日干员：艾雅法拉', '常驻标准寻访：能天使', '新增模组干员：令 - 模组任务开放'] },
    ],
  })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, {
    ...defaultConfig,
    now: '2026-05-14T08:00:00.000+08:00',
    summaryDisplayItems: [
      { key: 'resource', enabled: true },
      { key: 'annihilation', enabled: true },
      { key: 'event', enabled: true },
      { key: 'voucher', enabled: true },
      { key: 'operator-birthday', enabled: true },
      { key: 'operator-recent', enabled: true },
      { key: 'operator-voucher', enabled: true },
      { key: 'operator-kernel-headhunting', enabled: true },
      { key: 'operator-outfit', enabled: true },
      { key: 'operator-new-module', enabled: true },
      { key: 'operator-headhunting', enabled: false },
      { key: 'operator-event', enabled: false },
      { key: 'recent-stage', enabled: false },
      { key: 'recent-furniture', enabled: true },
      { key: 'recent-other', enabled: true },
    ],
  })

  const handler = commandHandlers.get('prts.s')
  await handler({ session: createSession() })

  const summary = String(sent[0])
  assert.match(summary, /1\. 网页活动『足迹』/)
  assert.match(summary, /截止日期：5月16日（周六）/)
  assert.match(summary, /剩余时间：约 2 天/)
  assert.match(summary, /今日生日干员：艾雅法拉/)
  assert.match(summary, /新增模组干员：令 - 模组任务开放/)
  assert.doesNotMatch(summary, /常驻标准寻访/)
  assert.equal(summary.match(/网页活动『足迹』/g).length, 1)
})

test('summary display table keeps birthday operator items after operator title extraction', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({
    calls,
    summaryItems: [
      { title: '亮点干员', items: ['今日生日干员：艾雅法拉、煌', '亮点干员：维什戴尔、逻各斯'] },
    ],
  })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, {
    ...defaultConfig,
    summaryDisplayItems: [
      { key: '生日干员。', enabled: true },
      { key: '近期新增干员。', enabled: false },
      { key: '凭证兑换干员。', enabled: false },
      { key: '中坚甄选干员。', enabled: false },
      { key: '新增时装干员。', enabled: false },
      { key: '新增模组干员。', enabled: false },
      { key: '寻访/卡池干员。', enabled: false },
      { key: '活动相关干员。', enabled: false },
    ],
  })

  const handler = commandHandlers.get('prts.s')
  await handler({ session: createSession() })

  const summary = String(sent[0])
  assert.match(summary, /今日生日干员：艾雅法拉、煌/)
  assert.doesNotMatch(summary, /维什戴尔/)
})

test('summary display table disables stage notices by default', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({
    calls,
    summaryItems: [
      { title: '近期新增', items: ['新增关卡 H17-1 急变预案-1 H17-2 急变预案-2', '新增家具 主题 单件'] },
    ],
  })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, {
    ...defaultConfig,
    summaryDisplayItems: undefined,
  })

  const handler = commandHandlers.get('prts.s')
  await handler({ session: createSession() })

  const summary = String(sent[0])
  assert.doesNotMatch(summary, /新增关卡/)
  assert.match(summary, /新增家具/)
})

test('summary display table can disable resource lines and enable stage notices', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({
    calls,
    summaryItems: [
      { title: '系统状态', items: ['今日资源收集物资筹备分区：作战记录 / 龙门币 芯片搜索分区：医疗&重装'] },
      { title: '近期新增', items: ['新增关卡 H17-1 急变预案-1', '新增家具 主题 单件'] },
    ],
  })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, {
    ...defaultConfig,
    summaryDisplayItems: [
      { key: 'resource', enabled: false },
      { key: 'recent-stage', enabled: true },
      { key: 'recent-furniture', enabled: true },
    ],
  })

  const handler = commandHandlers.get('prts.s')
  await handler({ session: createSession() })

  const summary = String(sent[0])
  assert.doesNotMatch(summary, /今日资源收集/)
  assert.match(summary, /新增关卡/)
  assert.match(summary, /新增家具/)
})

test('summary command removes clock-only noise and deduplicates cleaned items', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({
    calls,
    summaryItems: [
      {
        title: '系统状态',
        items: [
          '现在时间：5月14日(周四) 09:57。',
          '现在时间：5月14日(周四) 09:57。 今日资源收集物资筹备分区：作战记录 / 采购凭证',
          '今日资源收集物资筹备分区：作战记录 / 采购凭证',
        ],
      },
    ],
  })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, defaultConfig)

  const handler = commandHandlers.get('prts.s')
  await handler({ session: createSession() })

  const summary = String(sent[0])
  assert.doesNotMatch(summary, /现在时间/)
  assert.equal(summary.match(/今日资源收集/g).length, 1)
})

test('summary command uses numbered items, semantic continuation lines, and humanized dates', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({
    calls,
    summaryItems: [
      {
        title: '核心动态',
        items: [
          '全局剿灭模拟开放中，10天18小时1分钟后结束。',
          '活动「七周年庆典签到」将于18小时1分钟后结束。',
          '采购凭证区的信物库存将于51日16小时后刷新，以下信物将会被刷新：推进之王/赫拉格。',
        ],
      },
    ],
  })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, {
    ...defaultConfig,
    now: '2026-05-14T09:57:00.000+08:00',
  })

  const handler = commandHandlers.get('prts.s')
  await handler({ session: createSession() })

  const summary = String(sent[0])
  assert.match(summary, /1\. 全局剿灭模拟开放中/)
  assert.match(summary, /截止日期：5月25日（周一）/)
  assert.match(summary, /剩余时间：约 11 天（跨 2 个结算周）/)
  assert.match(summary, /2\. 活动「七周年庆典签到」/)
  assert.match(summary, /截止日期：5月15日（周五）/)
  assert.match(summary, /剩余时间：约 19 小时/)
  assert.match(summary, /3\. 采购凭证区的信物库存/)
  assert.match(summary, /刷新日期：7月5日（周日）/)
  assert.match(summary, /剩余时间：约 52 天（跨 8 个结算周）/)
  assert.doesNotMatch(summary, /^- /m)
  assert.doesNotMatch(summary, /下下周/)
  assert.doesNotMatch(summary, /明天|后天/)
})

test('summary command splits resource collection into semantic continuation lines', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({
    calls,
    summaryItems: [
      {
        title: '系统状态',
        items: [
          '今日资源收集物资筹备分区：作战记录 / 采购凭证 / 龙门币 芯片搜索分区：医疗&重装 / 先锋&辅助 职业芯片(组)',
        ],
      },
    ],
  })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, defaultConfig)

  const handler = commandHandlers.get('prts.s')
  await handler({ session: createSession() })

  const summary = String(sent[0])
  assert.match(summary, /1\. 今日资源收集：/)
  assert.match(summary, /\n   物资筹备分区：作战记录 \/ 采购凭证 \/ 龙门币/)
  assert.match(summary, /\n   芯片搜索分区：医疗&重装 \/ 先锋&辅助 职业芯片\(组\)/)
})

test('refresh summary target refreshes daily manifest and sends text only', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, defaultConfig)

  const handler = commandHandlers.get('prts.r [target:string]')
  const text = await handler({ session: createSession() }, 's')

  assert.equal(calls.filter((item) => item === 'captureDaily').length, 1)
  assert.equal(sent.length, 1)
  assert.match(String(sent[0]), /PRTS 今日摘要/)
  assert.doesNotMatch(String(sent[0]), /base64/)
  assert.match(text, /今日摘要/)
})

test('manual daily command wraps image with custom prefix and suffix', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, {
    ...defaultConfig,
    messagePrefix: '博士，今日情报已整理：',
    messageSuffix: '以上，祝作战顺利。',
  })

  const handler = commandHandlers.get('prts.d')
  await handler({ session: createSession() })

  assert.equal(sent[0], '博士，今日情报已整理：')
  assert.match(String(sent[1]), /base64/)
  assert.equal(sent[2], '以上，祝作战顺利。')
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
      cron: '12 5 * * *',
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

test('scheduled push wraps broadcast content with custom prefix and suffix', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, intervals, broadcastCalls } = createMockContext({ puppeteer })

  const config = {
    ...defaultConfig,
    now: '2026-04-29T05:12:00.000+08:00',
    messagePrefix: 'PRTS 今日情报：',
    messageSuffix: '来源：prts.wiki',
    scheduledPush: {
      enabled: true,
      channels: ['sandbox:group-1'],
      cron: '12 5 * * *',
    },
  }

  apply(ctx, config)
  await intervals[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(broadcastCalls.length, 1)
  assert.match(String(broadcastCalls[0].content), /PRTS 今日情报/)
  assert.match(String(broadcastCalls[0].content), /base64/)
  assert.match(String(broadcastCalls[0].content), /来源：prts\.wiki/)
})

test('screenshot quality config controls viewport scale and output format', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession } = createMockContext({ puppeteer })

  apply(ctx, {
    ...defaultConfig,
    deviceScaleFactor: 2,
    imageFormat: 'jpeg',
    jpegQuality: 92,
  })

  const handler = commandHandlers.get('prts.d')
  await handler({ session: createSession() })

  assert.deepEqual(calls.find((item) => item.kind === 'viewport'), {
    kind: 'viewport',
    width: 1366,
    height: 900,
    deviceScaleFactor: 2,
  })
  assert.deepEqual(calls.find((item) => item.kind === 'screenshot'), {
    kind: 'screenshot',
    type: 'jpeg',
    quality: 92,
  })
})

test('cache command reports actual cache location and current day status', async () => {
  const { apply } = loadPlugin()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prts-cache-command-'))
  const todayDir = path.join(baseDir, 'data/miyako-intel/cache', '2026-04-28')
  fs.mkdirSync(todayDir, { recursive: true })
  fs.writeFileSync(path.join(todayDir, 'daily.png'), Buffer.from('today'))
  const { ctx, commandHandlers } = createMockContext({ baseDir })

  apply(ctx, defaultConfig)

  const handler = commandHandlers.get('prts.cache')
  assert.equal(typeof handler, 'function')

  const text = await handler()

  assert.match(text, /PRTS 缓存诊断/)
  assert.match(text, /当前缓存日：2026-04-28/)
  assert.match(text, /今日缓存：存在/)
  assert.match(text, /最近缓存：2026-04-28/)
  assert.match(text, /data[\\/]miyako-intel[\\/]cache/)
})

test('scheduled push waits for cron expression minute', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, intervals, broadcastCalls } = createMockContext({ puppeteer })

  const config = {
    ...defaultConfig,
    now: '2026-04-29T05:11:00.000+08:00',
    scheduledPush: {
      enabled: true,
      channels: ['sandbox:group-1'],
      cron: '12 5 * * *',
    },
  }

  apply(ctx, config)
  await intervals[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(broadcastCalls.length, 0)
  assert.equal(calls.filter((item) => item === 'captureDaily').length, 0)
})

test('silent log level suppresses routine scheduled push logs', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, intervals, loggerLines } = createMockContext({ puppeteer })

  const config = {
    ...defaultConfig,
    logLevel: 'silent',
    now: '2026-04-29T05:12:00.000+08:00',
    scheduledPush: {
      enabled: true,
      channels: ['sandbox:group-1'],
      cron: '12 5 * * *',
    },
  }

  apply(ctx, config)
  await intervals[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(loggerLines.length, 0)
})

test('registers console client entry when console service is available', () => {
  const { apply } = loadPlugin()
  const entries = []
  const { ctx } = createMockContext()
  ctx.console = {
    addEntry(entry) {
      entries.push(entry)
    },
  }

  apply(ctx, defaultConfig)

  assert.equal(entries.length, 1)
  assert.match(entries[0].dev, /client[\\/]index\.ts$/)
  assert.match(entries[0].prod, /dist$/)
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

function createFakePuppeteer({ calls, summaryItems }) {
  return {
    async page() {
      return createFakePage(calls, summaryItems)
    },
  }
}

function createFakePage(calls, summaryItems) {
  return {
    currentUrl: '',
    async setUserAgent() {},
    async setViewport(viewport) {
      calls.push({ kind: 'viewport', ...viewport })
    },
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
      if (arg?.captureId === 'prts-capture-daily-v2') {
        return {
          missing: [],
          summaryItems: summaryItems || [
            { title: '今日信息', items: ['今日开放：龙门币 / 作战记录'] },
            { title: '亮点干员', items: ['亮点干员：维什戴尔'] },
          ],
        }
      }
      return true
    },
    async $(selector) {
      if (selector === '#prts-capture-daily') return fakeElement('daily-image', calls)
      if (selector === '#prts-capture-daily-v2') return fakeElement('daily-image', calls)
      return null
    },
    async close() {},
  }
}

function fakeElement(text, calls) {
  return {
    async screenshot(options) {
      calls.push({ kind: 'screenshot', ...options })
      return Buffer.from(text)
    },
  }
}
