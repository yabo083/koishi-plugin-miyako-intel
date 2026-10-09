const assert = require('node:assert/strict')
const fs = require('node:fs')
const { Argv, Context } = require('koishi')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')

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
      broadcastCalls.push({ channels: [...channels], content, forced })
      channels.splice(0)
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
    initialPageCount: 5,
    selectionTtlMs: 300000,
  },
  now: '2026-04-29T02:00:00.000+08:00',
}

test('calculates PRTS cache day by 04:00 Asia/Shanghai boundary', () => {
  const { getPrtsDayKey } = loadPlugin()

  assert.equal(getPrtsDayKey(new Date('2026-04-28T19:59:00.000Z'), 'Asia/Shanghai', 4), '2026-04-28')
  assert.equal(getPrtsDayKey(new Date('2026-04-28T20:00:00.000Z'), 'Asia/Shanghai', 4), '2026-04-29')
})

test('cron matcher supports annual schedules by matching current minute only', () => {
  const { matchesCronExpression } = require(path.join(rootDir, 'lib', 'core', 'cron.js'))

  assert.equal(matchesCronExpression('0 0 1 1 *', { minute: 0, hour: 0, day: 1, month: 1, weekday: 4 }), true)
  assert.equal(matchesCronExpression('0 0 1 1 *', { minute: 1, hour: 0, day: 1, month: 1, weekday: 4 }), false)
  assert.equal(matchesCronExpression('0 0 1 1 *', { minute: 0, hour: 0, day: 1, month: 2, weekday: 0 }), false)
})

test('background cron jobs are polled with a fixed one-minute interval', () => {
  const { apply } = loadPlugin()
  const mock = createMockContext({ http: async () => ({ data: [] }) })

  apply(mock.ctx, {
    ...defaultConfig,
    refreshCron: '0 0 1 1 *',
    cacheMaintenance: { ...defaultConfig.cacheMaintenance, archiveCron: '0 0 1 1 *' },
    scheduledPush: { ...defaultConfig.scheduledPush, enabled: true, channels: ['onebot:100'], cron: '0 0 1 1 *' },
    wiki: { ...defaultConfig.wiki, storySearchEnabled: true, storyUpdateCron: '0 0 1 1 *' },
  })

  assert.deepEqual(mock.intervals.map((item) => item.ms), [60 * 1000])
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
      initialPageCount: 1,
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

test('warfarin wiki search sends default 25-result batch windows', async () => {
  const { apply } = loadPlugin()
  const { ctx, commandHandlers, createSession, sent } = createMockContext({
    http: async (url) => {
      if (String(url).includes('story.example')) return { query: '息壤', total: 0, results: [] }
      return {
        query: '息壤',
        results: Array.from({ length: 52 }, (_, index) => ({
          slug: `text_${index + 1}`,
          name: `息壤资料${index + 1}`,
          type: 'lore',
          category: '见闻辑录',
          snippet: `第 ${index + 1} 条息壤相关资料。`,
          score: 100 - index,
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
  const next = commandHandlers.get('w+')
  const previous = commandHandlers.get('w-')
  const session = createSession()

  const searchResult = await search({ session, options: {} }, '息壤')
  assert.equal(searchResult, undefined)
  assert.equal(sent.length, 5)
  assert.match(String(sent[0]), /1\. 见闻辑录：息壤资料1/)
  assert.match(String(sent[4]), /25\. 见闻辑录：息壤资料25/)

  sent.length = 0
  const nextResult = await next({ session })
  assert.equal(nextResult, undefined)
  assert.equal(sent.length, 5)
  assert.match(String(sent[0]), /26\. 见闻辑录：息壤资料26/)
  assert.match(String(sent[4]), /50\. 见闻辑录：息壤资料50/)

  sent.length = 0
  const previousResult = await previous({ session })
  assert.equal(previousResult, undefined)
  assert.equal(sent.length, 5)
  assert.match(String(sent[0]), /1\. 见闻辑录：息壤资料1/)
  assert.match(String(sent[4]), /25\. 见闻辑录：息壤资料25/)
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
      initialPageCount: 1,
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

test('warfarin wiki search displays local story bundle data update date across pages', async () => {
  const { apply } = loadPlugin()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-wiki-data-updated-'))
  const storyRoot = path.join(baseDir, 'data', 'miyako-intel', 'warfarin-story', 'cn')
  fs.mkdirSync(path.join(storyRoot, 'anchors'), { recursive: true })
  fs.writeFileSync(path.join(storyRoot, 'manifest.json'), JSON.stringify({ language: 'cn', storyBundleUpdatedAt: '2026-05-14T18:22:33.000Z' }))
  fs.writeFileSync(path.join(storyRoot, 'anchors', 'bundle.json'), JSON.stringify(Array.from({ length: 7 }, (_, index) => ({
    anchor_id: `story_${index + 1}_0`,
    content: `第 ${index + 1} 条火锅剧情。`,
    source: `任务剧情：火锅资料${index + 1}`,
    source_ref: `任务剧情：火锅资料${index + 1}`,
    scope: 'missions',
    relevance: 1,
    full_text: [{ speaker: '管理员', text: `第 ${index + 1} 条火锅剧情。` }],
  }))))
  const { ctx, commandHandlers, createSession } = createMockContext({
    baseDir,
    http: async (url) => {
      if (String(url).includes('api.warfarin.wiki')) return { query: '火锅', results: [] }
      throw new Error(`local story search should not call remote story backend: ${url}`)
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storySearchEnabled: true,
      pageSize: 5,
      initialPageCount: 1,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const next = commandHandlers.get('w+')
  const session = createSession()
  const searchText = await search({ session, options: {} }, '火锅')
  const pageText = await next({ session })

  assert.match(searchText, /数据更新时间：2026年05月14日/)
  assert.match(pageText, /数据更新时间：2026年05月14日/)
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
      storySearchEnabled: false,
      pageSize: undefined,
    },
  })

  const search = commandHandlers.get('w <input:text>')
  const session = createSession()
  await search({ session, options: {} }, '息壤')
  const detail = await search({ session, options: {} }, '1')

  assert.equal(requests[0].url, 'https://api.warfarin.wiki/v1/cn/search?q=%E6%81%AF%E5%A3%A4')
  assert.equal(requests[0].body, undefined)
  assert.equal(requests.filter((item) => item.url.startsWith('https://api.warfarin.wiki/v1')).length, 1)
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

test('warfarin wiki private replies can be sent as OneBot forward messages', async () => {
  const { apply } = loadPlugin()
  const forwardCalls = []
  const { ctx, commandHandlers, createSession, sent } = createMockContext({
    http: async (url) => {
      if (String(url).includes('story.example')) return { query: '息壤', total: 0, results: [] }
      return {
        query: '息壤',
        results: Array.from({ length: 6 }, (_, index) => ({
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
      groupForwardEnabled: true,
    },
  })

  const session = createSession()
  session.platform = 'onebot'
  session.guildId = ''
  session.channelId = 'user-1'
  session.onebot = {
    async sendPrivateForwardMsg(userId, messages) {
      forwardCalls.push({ userId, messages })
    },
  }

  const search = commandHandlers.get('w <input:text>')
  const result = await search({ session, options: {} }, '息壤')

  assert.equal(result, undefined)
  assert.equal(sent.length, 0)
  assert.equal(forwardCalls.length, 1)
  assert.equal(forwardCalls[0].userId, 'user-1')
  assert.equal(forwardCalls[0].messages.length, 2)
  assert.match(forwardCalls[0].messages[0].data.content, /1\. 见闻辑录：息壤资料1/)
  assert.match(forwardCalls[0].messages[1].data.content, /6\. 见闻辑录：息壤资料6/)
})

test('warfarin wiki private forward does not treat onebot private cid as group id', async () => {
  const { apply } = loadPlugin()
  const forwardCalls = []
  const { ctx, commandHandlers, createSession, sent } = createMockContext({
    http: async (url) => {
      if (String(url).includes('story.example')) return { query: '息壤', total: 0, results: [] }
      return {
        query: '息壤',
        results: Array.from({ length: 6 }, (_, index) => ({
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
      groupForwardEnabled: true,
    },
  })

  const session = createSession()
  session.platform = 'onebot'
  session.guildId = ''
  session.channelId = 'onebot:private:2657455842'
  session.cid = 'onebot:private:2657455842'
  session.userId = '2657455842'
  session.onebot = {
    async send_group_forward_msg() {
      throw new Error('private cid must not be sent as group_id')
    },
    async send_private_forward_msg(payload) {
      forwardCalls.push(payload)
    },
  }

  const search = commandHandlers.get('w <input:text>')
  const result = await search({ session, options: {} }, '息壤')

  assert.equal(result, undefined)
  assert.equal(sent.length, 0)
  assert.equal(forwardCalls.length, 1)
  assert.equal(forwardCalls[0].user_id, 2657455842)
  assert.equal(forwardCalls[0].messages.length, 2)
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

test('scheduled push only broadcasts to allowed channels when enabled', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, intervals, broadcastCalls, loggerLines } = createMockContext({ puppeteer })

  const config = {
    ...defaultConfig,
    now: '2026-04-29T05:12:00.000+08:00',
    dailyCardEnabled: true,
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

test('plugin declares database as optional service for scheduled context broadcast', () => {
  const { inject } = loadPlugin()

  assert.equal(inject.optional.includes('database'), true)
})

test('scheduled push logs configured channel count when context broadcast consumes targets', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, intervals, broadcastCalls, loggerLines } = createMockContext({ puppeteer })

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

  assert.equal(broadcastCalls.length, 1)
  assert.deepEqual(broadcastCalls[0].channels, ['sandbox:group-1', 'sandbox:group-2'])
  assert.equal(broadcastCalls[0].forced, true)
  assert.equal(loggerLines.some(([level, message]) => level === 'info' && /推送开始：2026-04-29，频道 2 个/.test(message)), true)
  assert.equal(loggerLines.some(([level, message]) => level === 'info' && /推送完成：2026-04-29，频道 2 个/.test(message)), true)
})

test('scheduled push waits for cron expression minute', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, intervals, broadcastCalls, loggerLines } = createMockContext({ puppeteer })

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

test('story bundle download requests binary response from Koishi http', async () => {
  const { apply } = loadPlugin()
  const requests = []
  const bundle = zlib.gzipSync(JSON.stringify([{
    anchor_id: 'c27m5_0',
    content: '管理员：火锅会让大家暖和起来。',
    source: '任务剧情：共饮一江水',
    source_ref: '任务剧情：共饮一江水',
    scope: 'missions',
    relevance: 1,
    full_text: [{ speaker: '管理员', text: '火锅会让大家暖和起来。' }],
  }]))
  const { ctx } = createMockContext({
    http: async (url, options) => {
      requests.push({ url: String(url), options })
      if (String(url).endsWith('.manifest.json')) return { data: { language: 'cn', count: 1, updatedAt: '2026-05-14T00:00:00.000Z', url: 'https://example.test/warfarin-story-cn.json.gz' }, status: 200 }
      if (String(url).endsWith('.json.gz')) return { data: bundle, status: 200 }
      throw new Error(`unexpected request: ${url}`)
    },
  })

  apply(ctx, {
    ...defaultConfig,
    wiki: {
      ...defaultConfig.wiki,
      storyUpdateOnStart: true,
      storyBundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json',
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 800))

  const bundleRequest = requests.find((item) => item.url.endsWith('.json.gz'))
  assert.equal(bundleRequest?.options?.responseType, 'arraybuffer')
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
  assert.equal(status.daily.enabled, true)
  assert.equal(status.daily.refreshCron, '5 4 * * *')
  assert.equal(status.cache.searchLabel, '4/100，10 分钟')
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

const FAKE_RAW_DAILY = {
  groups: [
    { title: '今天生日', entries: [{ name: '火龙S黑角', avatar: 'https://media.prts.wiki/avatar1.png', rarity: 5 }] },
    { title: '近期新增', entries: [{ name: '珊比', avatar: '', rarity: 6 }] },
  ],
  todayParagraphs: ['今日资源收集物资筹备分区：作战记录 / 龙门币芯片搜索分区：技巧概要'],
  coreItems: [
    { text: '剿灭作战 & 周常任务（含特勤任务）将于后刷新。', epoch: Math.floor(Date.now() / 1000) + 7 * 3600 },
  ],
  stageBlocks: [
    { title: '新增关卡', intro: ['SideStory 「直到大地变成一颗酸橙」', '踏上归家长途'], codes: ['TO-EX-1 电影防沉迷', 'TO-EX-2 邮包流水线'] },
  ],
}

// 「特别开放」窗口：首页不列分区，只剩一行「资源收集所有关卡全天开放中，N后结束」
const FAKE_RAW_ALL_OPEN = {
  ...FAKE_RAW_DAILY,
  todayParagraphs: ['资源收集所有关卡全天开放中，10天19小时后结束。'],
  coreItems: [
    { text: '资源收集所有关卡全天开放中，10天19小时后结束。', epoch: Math.floor(Date.now() / 1000) + (10 * 24 + 19) * 3600 },
  ],
}

function createFakePuppeteer({ calls, raw }) {
  return {
    async page() {
      return createFakePage(calls, raw)
    },
  }
}

function createFakePage(calls, raw) {
  const page = {
    isRender: false,
    async setUserAgent() {},
    async setViewport(viewport) {
      calls.push({ kind: 'viewport', ...viewport })
    },
    async goto(url) {
      calls.push({ kind: 'goto', url: String(url) })
      page.isRender = String(url).startsWith('file://')
    },
    async waitForSelector(selector) {
      if (selector === '.mp-today') calls.push('captureDaily')
    },
    async waitForFunction() {},
    async waitForTimeout() {},
    async evaluate() {
      return page.isRender ? undefined : (raw || FAKE_RAW_DAILY)
    },
    async $(selector) {
      if (selector === '#letter') {
        return {
          async screenshot() {
            calls.push({ kind: 'screenshot' })
            return Buffer.from('fake-card-image-bytes')
          },
        }
      }
      return null
    },
    async close() {},
  }
  return page
}

function fakeElement(text, calls) {
  return {
    async screenshot(options) {
      calls.push({ kind: 'screenshot', ...options })
      return Buffer.from(text)
    },
  }
}

test('registers the prts debug command family', async () => {
  const { apply } = loadPlugin()
  const { ctx, registeredCommands, commandHandlers } = createMockContext({})
  apply(ctx, defaultConfig)

  assert.equal(registeredCommands[0], 'prts')
  assert.equal(registeredCommands.includes('w <input:text>'), true)
  for (const name of ['prts.d', 'prts.r', 'prts.cache', 'prts.h']) {
    assert.equal(commandHandlers.has(name), true, `missing ${name}`)
  }
})

test('prts d sends the rendered letter card image', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession } = createMockContext({ puppeteer })
  apply(ctx, { ...defaultConfig, dailyCardEnabled: true })

  const session = createSession()
  const daily = commandHandlers.get('prts.d')
  const reply = await daily({ session, options: {} })

  assert.equal(calls.filter((item) => item === 'captureDaily').length, 1)
  // 成功路径只发图，不再附带说明文字
  assert.equal(reply, undefined)
  assert.equal(session.sent.length, 1)
  assert.equal(String(session.sent[0]).includes('base64'), true)
})

test('prts d still renders the card during the 特别开放 window', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls, raw: FAKE_RAW_ALL_OPEN })
  const { ctx, commandHandlers, createSession } = createMockContext({ puppeteer })
  apply(ctx, { ...defaultConfig, dailyCardEnabled: true })

  const session = createSession()
  const reply = await commandHandlers.get('prts.d')({ session, options: {} })

  // 分区为空但「特别开放」这一行仍在，卡片照出而不是回退缓存
  assert.equal(reply, undefined)
  assert.equal(calls.filter((item) => item === 'captureDaily').length, 1)
  assert.equal(session.sent.length, 1)
  assert.equal(String(session.sent[0]).includes('base64'), true)
})

const FAKE_RAW_EMPTY = { groups: [], todayParagraphs: [], coreItems: [], stageBlocks: [] }

test('failed capture ships the apology card and leaves today uncached', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls, raw: FAKE_RAW_EMPTY })
  const { ctx, commandHandlers, createSession } = createMockContext({ puppeteer })
  apply(ctx, { ...defaultConfig, dailyCardEnabled: true, fallbackReason: 'courier' })

  const session = createSession()
  const reply = await commandHandlers.get('prts.d')({ session, options: {} })

  assert.equal(reply, undefined)
  assert.equal(session.sent.length, 1)
  assert.equal(String(session.sent[0]).includes('base64'), true)
  // 配置的回退理由写在牌子上
  const renderDir = path.join(ctx.baseDir, 'data', 'miyako-intel', 'cache', 'render')
  assert.match(fs.readFileSync(path.join(renderDir, 'fallback.html'), 'utf8'), /很抱歉博士！今日的「今日信笺」被见习信使弄丢了。/)
  // 回退卡片不写进缓存：今天仍然没有可用日报图，明天照常重试
  const cacheRoot = path.join(ctx.baseDir, 'data', 'miyako-intel', 'cache')
  const cached = fs.existsSync(cacheRoot)
    ? fs.readdirSync(cacheRoot).filter((entry) => fs.existsSync(path.join(cacheRoot, entry, 'daily.png')))
    : []
  assert.deepEqual(cached, [])
})

test('browser-less fallback ships the bare artwork with the configured reason', async () => {
  const { apply } = loadPlugin()
  const { ctx, commandHandlers, createSession } = createMockContext({ puppeteer: createFailingPuppeteer() })
  apply(ctx, { ...defaultConfig, dailyCardEnabled: true, fallbackReason: 'packet' })

  const session = createSession()
  const reply = await commandHandlers.get('prts.d')({ session, options: {} })

  assert.equal(reply, undefined)
  assert.equal(session.sent.length, 1)
  const artwork = fs.readFileSync(path.join(rootDir, 'assets', 'fallback', 'lost-card.png')).toString('base64')
  assert.equal(String(session.sent[0]).includes(artwork), true)
})

test('prts r ignores cache and forces recapture', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession } = createMockContext({ puppeteer })
  apply(ctx, { ...defaultConfig, dailyCardEnabled: true })

  const session = createSession()
  const refresh = commandHandlers.get('prts.r')
  const reply = await refresh({ session, options: {} }, 'd')

  // 成功路径只发图，不再附带说明文字
  assert.equal(reply, undefined)
  assert.equal(session.sent.length, 1)
  assert.equal(String(session.sent[0]).includes('base64'), true)
  assert.equal(calls.filter((item) => item === 'captureDaily').length, 1)
  assert.equal(calls.filter((item) => item?.kind === 'screenshot').length, 1)
})

test('prts cache reports cache root and day status', async () => {
  const { apply } = loadPlugin()
  const { ctx, commandHandlers } = createMockContext({})
  apply(ctx, defaultConfig)

  const cacheCommand = commandHandlers.get('prts.cache')
  const report = await cacheCommand({ options: {} })

  assert.match(report, /今日信笺缓存诊断/)
  assert.match(report, /当前缓存日：\d{4}-\d{2}-\d{2}/)
  assert.match(report, /今日缓存：不存在/)
})

test('homepage navigation bypasses the PRTS shared cache', async () => {
  const { apply } = loadPlugin()
  const calls = []
  const puppeteer = createFakePuppeteer({ calls })
  const { ctx, commandHandlers, createSession } = createMockContext({ puppeteer })
  apply(ctx, { ...defaultConfig, dailyCardEnabled: true })

  await commandHandlers.get('prts.d')({ session: createSession(), options: {} })

  const home = calls.filter((item) => item?.kind === 'goto' && !String(item.url).startsWith('file://'))
  assert.equal(home.length, 1)
  // 明文 URL 会命中 Tengine 里最多 5 小时的旧副本（s-maxage=18000），必须带一次性参数强制 MISS
  assert.match(home[0].url, /^https:\/\/prts\.wiki\/w\//)
  assert.match(home[0].url, /[?&]cb=\d+/)
  // 本地渲染文件不做处理
  const renders = calls.filter((item) => item?.kind === 'goto' && String(item.url).startsWith('file://'))
  assert.equal(renders.length > 0, true)
  assert.equal(renders.every((item) => !item.url.includes('cb=')), true)
})
