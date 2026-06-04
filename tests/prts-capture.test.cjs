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
  const middlewares = []
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
    middleware(callback) {
      middlewares.push(callback)
      return () => undefined
    },
    http: options.http,
    on() { return () => undefined },
  }

  function createSession() {
    return {
      userId: 'user-1',
      channelId: 'channel-1',
      sent,
      async send(message) {
        sent.push(message)
      },
    }
  }

  return { ctx, registeredCommands, commandHandlers, intervals, middlewares, sent, loggerLines, broadcastCalls, createSession }
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
  wiki: {
    mode: 'official',
    baseUrl: 'https://api.warfarin.wiki/v1',
    language: 'cn',
    storyBaseUrl: 'http://story.example/api/v1',
    storyLanguage: 'cn',
    timeoutMs: 5000,
    userAgent: 'TestAgent/1.0',
    searchCacheTtlMs: 600000,
    searchCacheMaxEntries: 100,
    pageSize: 5,
    selectionTtlMs: 300000,
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
  assert.doesNotMatch(json, /storyScopes/)
  assert.doesNotMatch(json, /searchLimit/)
  assert.doesNotMatch(json, /enableSummary/)
  assert.doesNotMatch(json, /defaultContextRange/)
  assert.doesNotMatch(json, /Warfarin Wiki 数据源模式/)
  assert.doesNotMatch(json, /Warfarin Wiki API 根地址/)
  assert.doesNotMatch(json, /剧情\/任务全文搜索后端根地址/)
  assert.doesNotMatch(json, /User-Agent/)
  assert.match(json, /Warfarin 资料检索/)
  assert.match(json, /基础设置/)
  assert.match(json, /PRTS 今日情报/)
})

test('registers only the daily Koishi dot command', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, registeredCommands, commandHandlers, createSession, sent } = createMockContext({ puppeteer })

  apply(ctx, defaultConfig)

  assert.deepEqual(registeredCommands, ['prts', 'w <input:text>', 'wn <input:text>', 'w+', 'w+<page:number>', 'w-'])

  const handler = commandHandlers.get('prts.d')
  assert.equal(typeof handler, 'function')
  assert.equal(commandHandlers.has('prts.e'), false)
  assert.equal(commandHandlers.has('w <input:text>'), true)
  assert.equal(commandHandlers.has('wn <input:text>'), true)
  assert.equal(commandHandlers.has('w+'), true)
  assert.equal(commandHandlers.has('w+<page:number>'), true)
  assert.equal(commandHandlers.has('w-'), true)
  assert.equal(commandHandlers.has('wq <input:text>'), false)
  assert.equal(commandHandlers.has('wq+'), false)
  assert.equal(commandHandlers.has('wq-'), false)

  const text = await handler({ session: createSession() })

  assert.deepEqual(calls.filter((item) => item === 'captureDaily'), ['captureDaily'])
  assert.equal(sent.filter((item) => String(item).includes('base64')).length, 1)
  assert.match(text, /已发送/)
})

test('warfarin wiki w command searches official source, pages, and fetches context', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession, sent } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      if (url.includes('story.example')) {
        return { query: '息壤', total: 0, results: [] }
      }
      if (url.includes('/search?q=')) {
        return {
          query: '息壤',
          results: Array.from({ length: 7 }, (_, index) => ({
            slug: `text_${index + 1}`,
            name: `息壤资料${index + 1}`,
            type: 'lore',
            category: '见闻辑录',
            snippet: `第 ${index + 1} 条息壤相关资料。`,
            score: 10 - index,
          })),
        }
      }
      return {
        code: 0,
        message: 'ok',
        data: {
          anchor: { anchor_id: 'text_6_0', content: '第 6 条息壤相关资料。', source: '见闻辑录：息壤资料6', scope: 'lore', relevance: 5 },
          full_text: [
            { speaker: '佩丽卡', text: '那是什么？' },
            { speaker: '', text: '第 6 条息壤相关资料。' },
          ],
          summary: null,
          source_ref: '见闻辑录：息壤资料6',
        },
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const next = commandHandlers.get('w+')
  const jump = commandHandlers.get('w+<page:number>')
  const previous = commandHandlers.get('w-')
  assert.equal(typeof search, 'function')
  assert.equal(typeof next, 'function')
  assert.equal(typeof jump, 'function')
  assert.equal(typeof previous, 'function')

  const session = createSession()
  const searchText = await search({ session, options: {} }, ' 息壤 ')
  const pageText = await next({ session })
  const repeatedNextText = await next({ session })
  const previousText = await previous({ session })
  const jumpedText = await jump({ session }, 2)
  const contextText = await search({ session, options: {} }, '6')

  assert.match(searchText, /Warfarin Wiki 检索：息壤/)
  assert.match(searchText, /Warfarin Wiki 检索：息壤 \| 共 7 条，可用页码 \[1-2\] \| 输入 w 序号 查看，w\+ 下一页，w- 上一页，w\+页码 跳页。/)
  assert.doesNotMatch(searchText, /息壤资料6/)
  assert.match(pageText, /Warfarin Wiki 检索：息壤 \| 共 7 条，可用页码 \[1-2\]/)
  assert.match(repeatedNextText, /Warfarin Wiki 检索：息壤 \| 共 7 条，可用页码 \[1-2\]/)
  assert.match(previousText, /Warfarin Wiki 检索：息壤 \| 共 7 条，可用页码 \[1-2\]/)
  assert.match(jumpedText, /Warfarin Wiki 检索：息壤 \| 共 7 条，可用页码 \[1-2\]/)
  assert.match(contextText, /名称：息壤资料6 \| 类型：见闻辑录 \| 来源：Warfarin Wiki/)
  assert.match(contextText, /第 6 条息壤相关资料。/)
  assert.equal(sent.length, 0)
  assert.equal(requests[0].url, 'https://api.warfarin.wiki/v1/cn/search?q=%E6%81%AF%E5%A3%A4')
  assert.equal(requests.length, 2)
})

test('warfarin wiki supports compact w+page jump input', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession, middlewares, sent } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      if (url.includes('story.example')) return { query: '息壤', total: 0, results: [] }
      return {
        query: '息壤',
        results: Array.from({ length: 12 }, (_, index) => ({
          slug: `text_${index + 1}`,
          name: `息壤资料${index + 1}`,
          type: 'lore',
          category: '见闻辑录',
          snippet: `第 ${index + 1} 条息壤相关资料。`,
          score: 20 - index,
        })),
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()
  await search({ session, options: {} }, '息壤')
  session.content = 'w+3'
  session.stripped = { content: 'w+3' }

  assert.equal(middlewares.length, 1)
  const result = await middlewares[0](session, () => 'next')

  assert.equal(result, undefined)
  assert.equal(sent.length, 1)
  assert.match(String(sent[0]), /Warfarin Wiki 检索：息壤 \| 共 12 条，可用页码 \[1-3\]/)
  assert.match(String(sent[0]), /11\. 见闻辑录：息壤资料11/)
  assert.equal(requests.length, 2)
})

test('warfarin wiki empty search clears previous numbered anchors', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url, init) => {
      const body = init.data
      requests.push({ url, body })
      if (url.includes('/search?q=%E6%81%AF%E5%A3%A4')) {
        return {
          query: '息壤',
          results: [
            { slug: 'plot_001', name: '息壤', type: 'lore', category: '剧情-序章', snippet: '息壤来自塔卫二。', score: 9 },
          ],
        }
      }
      return { query: '不存在的词条', results: [] }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()

  await search({ session, options: {} }, '息壤')
  await search({ session, options: {} }, '不存在的词条')
  const text = await search({ session, options: {} }, '1')

  assert.match(text, /请先使用 w 关键词/)
  assert.equal(requests.some((item) => item.url.endsWith('/api/v1/search/context')), false)
})

test('warfarin wiki wn command force-searches numeric keywords without changing w number detail', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url) => {
      requests.push(url)
      if (url.includes('story.example')) return { query: '', total: 0, results: [] }
      if (url.includes('q=%E6%81%AF%E5%A3%A4')) {
        return {
          query: '息壤',
          results: Array.from({ length: 7 }, (_, index) => ({
            slug: `text_${index + 1}`,
            name: `息壤资料${index + 1}`,
            type: 'lore',
            category: '见闻辑录',
            snippet: `第 ${index + 1} 条息壤相关资料。`,
            score: 10 - index,
          })),
        }
      }
      return {
        query: '321',
        results: [
          { slug: 'num_321', name: '321号记录', type: 'lore', category: '中枢档案', snippet: '编号 321 的测试记录。', score: 10 },
        ],
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const forceSearch = commandHandlers.get('wn <input:text>')
  const session = createSession()
  await search({ session, options: {} }, '息壤')
  const oldNumberBehavior = await search({ session, options: {} }, '1')
  const numericSearch = await forceSearch({ session, options: {} }, '321')

  assert.match(oldNumberBehavior, /名称：息壤资料1 \| 类型：见闻辑录 \| 来源：Warfarin Wiki/)
  assert.match(numericSearch, /Warfarin Wiki 检索：321/)
  assert.match(numericSearch, /中枢档案：321号记录/)
  assert.equal(requests.some((url) => String(url).includes('q=321')), true)
})

test('warfarin wiki official detail uses local snippet without context request', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      return {
        query: '息壤',
        results: [
          { slug: 'text_v0d8_24', name: '息壤', type: 'lore', category: '中枢档案', snippet: '息壤是一种用于遏制侵蚀的新材料。', score: 56 },
        ],
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      mode: 'official',
      baseUrl: 'https://api.warfarin.wiki/v1',
      pageSize: undefined,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()
  await search({ session, options: {} }, '息壤')
  const detail = await search({ session, options: {} }, '1')

  assert.equal(requests[0].url, 'https://api.warfarin.wiki/v1/cn/search?q=%E6%81%AF%E5%A3%A4')
  assert.equal(requests[0].body, undefined)
  assert.equal(requests.length, 1)
  assert.equal(requests.some((item) => item.url.endsWith('/search/context')), false)
  assert.match(detail, /名称：息壤 \| 类型：中枢档案 \| 来源：Warfarin Wiki/)
  assert.match(detail, /https:\/\/warfarin\.wiki\/cn\/lore\/text_v0d8_24/)
})

test('warfarin wiki caches repeated keyword searches and supports keyword number shortcut', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      return {
        query: '息壤',
        results: [
          { slug: 'text_v0d8_24', name: '息壤', type: 'lore', category: '中枢档案', snippet: '息壤是一种用于遏制侵蚀的新材料。', score: 56 },
          { slug: 'item_xiranite_powder', name: '息壤', type: 'items', category: '材料', snippet: '将源石与巨兽力量结合于一处后诞生出的新型源石材料。', score: 39 },
        ],
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const sessionA = createSession()
  const sessionB = createSession()
  sessionB.userId = 'user-2'

  await search({ session: sessionA, options: {} }, '息壤')
  await search({ session: sessionB, options: {} }, '息壤')
  const shortcut = await search({ session: sessionB, options: {} }, '息壤 2')

  assert.equal(requests.length, 2)
  assert.match(shortcut, /名称：息壤 \| 类型：材料 \| 来源：Warfarin Wiki/)
  assert.match(shortcut, /新型源石材料/)
  assert.match(shortcut, /https:\/\/warfarin\.wiki\/cn\/items\/item_xiranite_powder/)
})

test('warfarin wiki official link follows configured language', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      return {
        query: 'xiran',
        results: [
          { slug: 'item_xiranite_powder', name: 'Xiran', type: 'items', category: 'Material', snippet: 'A material.', score: 39 },
        ],
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      baseUrl: 'https://api.warfarin.wiki/v1/cn',
      language: 'en',
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()
  await search({ session, options: {} }, 'xiran')
  const detail = await search({ session, options: {} }, '1')

  assert.equal(requests[0].url, 'https://api.warfarin.wiki/v1/en/search?q=xiran')
  assert.match(detail, /https:\/\/warfarin\.wiki\/en\/items\/item_xiranite_powder/)
})

test('warfarin wiki command falls back to story backend without new user command', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      if (url.includes('api.warfarin.wiki')) {
        return { query: '再引春来', results: [] }
      }
      if (url.includes('/search?q=')) {
        return {
          query: '再引春来',
          total: 3,
          results: [
            { slug: 'sm2l5m2_0', name: '再引春来·其二', type: 'missions', category: '任务剧情', snippet: '再引春来·其二 丙型天师桩出现了异状。', score: 100 },
          ],
        }
      }
      return {
        code: 0,
        message: 'ok',
        data: {
          anchor: { anchor_id: 'sm2l5m2_0', content: '再引春来·其二\n丙型天师桩出现了异状。管理员一行人决定前往测试区。', source: '任务剧情：再引春来·其二', scope: 'missions', relevance: 1 },
          full_text: [],
          summary: null,
          source_ref: '任务剧情：再引春来·其二',
          page: 1,
          page_size: 1800,
          total_pages: 1,
        },
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()
  const searchText = await search({ session, options: {} }, '再引春来')
  const detail = await search({ session, options: {} }, '1')

  assert.match(searchText, /Warfarin Wiki 检索：再引春来/)
  assert.doesNotMatch(searchText, /信息源：/)
  assert.match(searchText, /任务剧情：再引春来·其二/)
  assert.doesNotMatch(searchText, /sm2l5m2，第 2 个任务/)
  assert.match(searchText, /输入 w 序号 查看，w\+ 下一页/)
  assert.match(detail, /名称：再引春来·其二 \| 类型：任务剧情 \| 任务编号：sm2l5m2 \| 来源：Warfarin Wiki/)
  assert.match(detail, /丙型天师桩出现了异状/)
  assert.equal(requests[0].url, 'https://api.warfarin.wiki/v1/cn/search?q=%E5%86%8D%E5%BC%95%E6%98%A5%E6%9D%A5')
  assert.equal(requests[1].url, 'http://story.example/api/v1/cn/search?q=%E5%86%8D%E5%BC%95%E6%98%A5%E6%9D%A5&scope=missions')
  assert.equal(requests[2].url, 'http://story.example/api/v1/search/context')
  assert.equal(requests[2].body.anchor_id, 'sm2l5m2_0')
  assert.equal(requests[2].body.need_summary, false)
  assert.equal(requests[2].body.context_range, 3)
})

test('warfarin wiki command merges official and story results for one search experience', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      if (url.includes('api.warfarin.wiki')) {
        return {
          query: '火锅',
          results: [
            { slug: 'text_hotpot', name: '清点者的日记', type: 'lore', category: '纸质记录', snippet: '这一次抢到的东西如下：火锅底料四十。', score: 20 },
          ],
        }
      }
      if (url.includes('/search?q=')) {
        return {
          query: '火锅',
          total: 1,
          results: [
            { slug: 'e10m4_0', name: '志同道合', type: 'missions', category: '任务剧情', snippet: '回忆中的师姐：有没有火锅炸串冒菜汉堡冰激凌啊？', score: 50 },
          ],
        }
      }
      return {
        code: 0,
        message: 'ok',
        data: {
          anchor: { anchor_id: 'e10m4_0', content: '火锅剧情。', source: '任务剧情：志同道合', scope: 'missions', relevance: 50 },
          full_text: [
            { speaker: '回忆中的师姐{e10m4-回忆中的师姐}', text: '对了，你这城里......有没有火锅炸串冒菜汉堡冰激凌啊？' },
          ],
          summary: null,
          source_ref: '任务剧情：志同道合',
        },
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()
  const searchText = await search({ session, options: {} }, '火锅')
  const detail = await search({ session, options: {} }, '2')

  assert.match(searchText, /1\. 纸质记录：清点者的日记/)
  assert.match(searchText, /2\. 任务剧情：志同道合/)
  assert.doesNotMatch(searchText, /e10m4，第 4 个任务/)
  assert.doesNotMatch(searchText, /信息源：/)
  assert.match(detail, /名称：志同道合 \| 类型：任务剧情 \| 任务编号：e10m4 \| 来源：Warfarin Wiki/)
  assert.match(detail, /回忆中的师姐：对了，你这城里/)
  assert.equal(requests[0].url, 'https://api.warfarin.wiki/v1/cn/search?q=%E7%81%AB%E9%94%85')
  assert.equal(requests[1].url, 'http://story.example/api/v1/cn/search?q=%E7%81%AB%E9%94%85&scope=missions')
  assert.equal(requests[2].url, 'http://story.example/api/v1/search/context')
  assert.equal(requests[2].body.anchor_id, 'e10m4_0')
})

test('warfarin wiki command uses built-in local story index before remote story service', async () => {
  const { apply } = loadPlugin()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-local-story-'))
  const anchorsDir = path.join(baseDir, 'data', 'miyako-intel', 'warfarin-story', 'cn', 'anchors')
  fs.mkdirSync(anchorsDir, { recursive: true })
  fs.writeFileSync(path.join(anchorsDir, 'c27m5.json'), JSON.stringify({
    anchor_id: 'c27m5_0',
    content: '管理员：火锅会让大家暖和起来。',
    source: '任务剧情：共饮一江水',
    source_ref: '任务剧情：共饮一江水',
    scope: 'missions',
    relevance: 1,
    full_text: [{ speaker: '管理员', text: '火锅会让大家暖和起来。' }],
  }))
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    baseDir,
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      if (url.includes('api.warfarin.wiki')) return { query: '独行之路', results: [] }
      throw new Error(`remote story should not be called: ${url}`)
    },
  })

  apply(ctx, defaultConfig)

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()
  const searchText = await search({ session, options: {} }, '独行之路')
  const detail = await search({ session, options: {} }, '1')

  assert.match(searchText, /Baker对话：独行之路/)
  assert.match(detail, /名称：独行之路 \| 类型：Baker对话 \| 来源：Warfarin Wiki/)
  assert.match(detail, /不择手段/)
  assert.equal(requests.length, 1)
})

test('warfarin wiki keyword number shortcut works after story fallback', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url, init) => {
      requests.push({ url, body: init.data })
      if (url.includes('api.warfarin.wiki')) return { query: '陆令香', results: [] }
      if (url.includes('/search?q=')) {
        return {
          query: '陆令香',
          total: 5,
          results: Array.from({ length: 5 }, (_, index) => ({
            slug: `story_${index + 1}`,
            name: `再引春来·其${index + 1}`,
            type: 'missions',
            category: '任务剧情',
            snippet: `陆令香相关剧情 ${index + 1}`,
            score: 100 - index,
          })),
        }
      }
      return {
        code: 0,
        message: 'ok',
        data: {
          anchor: { anchor_id: 'story_5', content: '不应优先展示纯文本 fallback', source: '任务剧情：再引春来·其五', scope: 'missions', relevance: 1 },
          full_text: [
            { speaker: '陆令香', text: '我、我无论如何都不能置身事外。' },
          ],
          summary: null,
          source_ref: '任务剧情：再引春来·其五',
        },
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const detail = await search({ session: createSession(), options: {} }, '陆令香 5')

  assert.match(detail, /名称：再引春来·其五 \| 类型：任务剧情 \| 来源：Warfarin Wiki/)
  assert.match(detail, /陆令香：我、我无论如何都不能置身事外。/)
  assert.equal(requests[0].url, 'https://api.warfarin.wiki/v1/cn/search?q=%E9%99%86%E4%BB%A4%E9%A6%99')
  assert.equal(requests[1].url, 'http://story.example/api/v1/cn/search?q=%E9%99%86%E4%BB%A4%E9%A6%99&scope=missions')
  assert.equal(requests[2].body.anchor_id, 'story_5')
})

test('warfarin wiki group replies can be sent as OneBot forward messages', async () => {
  const { apply } = loadPlugin()
  const forwardCalls = []
  const { ctx, commandHandlers, createSession, sent } = createMockContext({
    http: async (url) => {
      if (url.includes('story.example')) return { query: '息壤', total: 0, results: [] }
      return {
        query: '息壤',
        results: [
          { slug: 'text_v0d8_24', name: '息壤', type: 'lore', category: '中枢档案', snippet: '息壤是一种用于遏制侵蚀的新材料。', score: 56 },
        ],
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
      groupForwardEnabled: true,
    },
  })

  const session = createSession()
  session.platform = 'onebot'
  session.guildId = '10001'
  session.channelId = '10001'
  session.onebot = {
    async sendGroupForwardMsg(groupId, messages) {
      forwardCalls.push({ groupId, messages })
    },
  }

  const search = commandHandlers.get('w <input:text>')
  const result = await search({ session, options: {} }, '息壤')

  assert.equal(result, undefined)
  assert.equal(sent.length, 0)
  assert.equal(forwardCalls.length, 1)
  assert.equal(forwardCalls[0].groupId, '10001')
  assert.match(forwardCalls[0].messages[0].data.content, /Warfarin Wiki 检索：息壤/)
  assert.match(forwardCalls[0].messages[0].data.content, /中枢档案：息壤/)
})

test('warfarin wiki group forward falls back to plain text when adapter send fails', async () => {
  const { apply } = loadPlugin()
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url) => {
      if (url.includes('story.example')) return { query: '息壤', total: 0, results: [] }
      return {
        query: '息壤',
        results: [
          { slug: 'text_v0d8_24', name: '息壤', type: 'lore', category: '中枢档案', snippet: '息壤是一种用于遏制侵蚀的新材料。', score: 56 },
        ],
      }
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: false,
      groupForwardEnabled: true,
    },
  })

  const session = createSession()
  session.platform = 'onebot'
  session.guildId = '10001'
  session.channelId = '10001'
  session.onebot = {
    async sendGroupForwardMsg() {
      throw new Error('forward unavailable')
    },
  }

  const search = commandHandlers.get('w <input:text>')
  const result = await search({ session, options: {} }, '息壤')

  assert.match(result, /Warfarin Wiki 检索：息壤/)
  assert.match(result, /中枢档案：息壤/)
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
  await new Promise((resolve) => setTimeout(resolve, 800))

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
  await new Promise((resolve) => setTimeout(resolve, 800))

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
  await new Promise((resolve) => setTimeout(resolve, 800))

  assert.equal(loggerLines.length, 0)
})

test('story bundle update failures are logged by log level', async () => {
  const { apply } = loadPlugin()
  const { ctx, loggerLines } = createMockContext({
    http: async (url) => {
      throw new Error(`github unreachable: ${url}`)
    },
  })

  apply(ctx, {
    ...defaultConfig,
    logLevel: 'warn',
    wiki: {
      ...defaultConfig.wiki,
      storyUpdateOnStart: true,
      storyBundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json',
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 800))

  assert.equal(loggerLines.some(([level, message]) => level === 'warn' && /GitHub 全文合集/.test(message) && /github unreachable/.test(message)), true)
})

test('silent log level suppresses story bundle update warnings', async () => {
  const { apply } = loadPlugin()
  const { ctx, loggerLines } = createMockContext({
    http: async (url) => {
      throw new Error(`github unreachable: ${url}`)
    },
  })

  apply(ctx, {
    ...defaultConfig,
    logLevel: 'silent',
    wiki: {
      ...defaultConfig.wiki,
      storyUpdateOnStart: true,
      storyBundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json',
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(loggerLines.length, 0)
})

test('registers console client entry and status listener when console service is available', async () => {
  const { apply } = loadPlugin()
  const entries = []
  const listeners = new Map()
  const { ctx, commandHandlers, createSession } = createMockContext({
    http: async (url) => {
      if (String(url).includes('/search?q=')) {
        return {
          query: '息壤',
          results: [
            { slug: 'text_1', name: '息壤', type: 'lore', category: '中枢档案', snippet: '息壤资料。', score: 1 },
          ],
        }
      }
      return { ok: true }
    },
  })
  ctx.console = {
    addEntry(entry) {
      entries.push(entry)
    },
    addListener(name, listener) {
      listeners.set(name, listener)
    },
  }

  apply(ctx, defaultConfig)
  const search = commandHandlers.get('w <input:text>')
  await search({ session: createSession(), options: {} }, '息壤')
  await search({ session: createSession(), options: {} }, '画卷通道')
  const status = await listeners.get('miyako-intel/status')()

  assert.equal(entries.length, 1)
  assert.match(entries[0].dev, /client[\\/]index\.ts$/)
  assert.match(entries[0].prod, /dist$/)
  assert.equal(status.push.enabled, false)
  assert.equal(status.sites.prts, '可用')
  assert.equal(status.sites.warfarin, '可用')
  assert.equal(status.sites.story, '本地 2233 条')
  assert.equal(status.cache.refreshCron, '5 4 * * *')
  assert.equal(status.cache.searchLabel, '4/100，10 分钟')
  assert.equal(status.cache.maintenanceCron, '30 4 * * *')
  assert.equal(status.cache.searchMaxEntries, 100)
  assert.equal(listeners.has('miyako-intel/update-story'), true)
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
