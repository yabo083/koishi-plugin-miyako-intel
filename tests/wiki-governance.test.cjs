const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.resolve(__dirname, '..')
const storySearchFile = path.join(rootDir, 'lib', 'services', 'warfarin-story-search.js')
const formatFile = path.join(rootDir, 'lib', 'wiki', 'format.js')
const obfuscateFile = path.join(rootDir, 'lib', 'wiki', 'obfuscate.js')
const statsFile = path.join(rootDir, 'lib', 'wiki', 'query-stats.js')
const digestFile = path.join(rootDir, 'lib', 'wiki', 'digest.js')
const albumFile = path.join(rootDir, 'lib', 'wiki', 'album.js')
const forwardFile = path.join(rootDir, 'lib', 'wiki', 'onebot-forward.js')

const noFetch = async (url) => { throw new Error(`test should not fetch: ${url}`) }
const anchor = (overrides = {}) => ({
  anchor_id: 'a_0',
  content: '息壤材料。',
  source: '物品信息：息壤',
  source_ref: '物品信息：息壤',
  scope: 'items',
  relevance: 1,
  full_text: [{ speaker: '资料', text: '息壤材料。' }],
  ...overrides,
})

function loadStorySearch() {
  delete require.cache[storySearchFile]
  return require(storySearchFile)
}

function writeBundle(baseDir, anchors, manifest = {}) {
  const root = path.join(baseDir, 'story-cache', 'cn')
  const anchorsDir = path.join(root, 'anchors')
  fs.mkdirSync(anchorsDir, { recursive: true })
  fs.writeFileSync(path.join(anchorsDir, 'bundle.json'), JSON.stringify(anchors))
  if (Object.keys(manifest).length) fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  return { root, anchorsDir }
}

/* ---------- NDJSON 迁移与存储 ---------- */

test('legacy anchors/*.json migrates into store.ndjson and keeps manifest fields', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-ndjson-migrate-'))
  const { root, anchorsDir } = writeBundle(baseDir, [anchor(), anchor({ anchor_id: 'b_0', content: '其他' })], {
    language: 'cn',
    storyBundleSha256: 'abc123',
    storyBundleSourceUpdatedAt: '2026-05-14',
  })
  // 多余的旧格式文件也应该被清掉
  fs.writeFileSync(path.join(anchorsDir, 'extra.json'), JSON.stringify(anchor({ anchor_id: 'c_0' })))

  const service = new WarfarinStorySearchService({ baseDir, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch: noFetch })
  await service.load()

  assert.deepEqual(fs.readdirSync(anchorsDir), ['store.ndjson'])
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.storeFormat, 'ndjson')
  assert.equal(manifest.storyBundleSha256, 'abc123')
  assert.equal(manifest.storyBundleSourceUpdatedAt, '2026-05-14')
  assert.equal(service.size, 3)
  const hit = await service.context({ anchorId: 'b_0' })
  assert.equal(hit.anchor.content, '其他')
})

test('local manifest with remote bundle sha256 is never replaced by bundled seed', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-ndjson-remote-'))
  writeBundle(baseDir, [anchor()], { language: 'cn', storyBundleSha256: 'remote-sha' })

  const service = new WarfarinStorySearchService({ baseDir, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch: noFetch })
  await service.load()

  assert.equal(service.size, 1)
  assert.equal((await service.context({ anchorId: 'a_0' })).anchor.anchor_id, 'a_0')
})

test('warfarin-story-seed stays out of require.cache after load', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const seedPath = require.resolve(path.join(rootDir, 'lib', 'services', 'warfarin-story-seed.js'))
  const inCache = () => Boolean(require.cache[seedPath])

  // 已有本地 store：加载路径完全不需要种子模块
  const withStore = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-seed-cache-'))
  writeBundle(withStore, [anchor()], { language: 'cn', storyBundleSha256: 'remote-sha' })
  delete require.cache[seedPath]
  const svc = new WarfarinStorySearchService({ baseDir: withStore, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch: noFetch })
  await svc.load()
  assert.equal(inCache(), false)

  // 空目录：种子模块只在安装瞬间被 require，用完即释放
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-seed-release-'))
  delete require.cache[seedPath]
  const seeded = new WarfarinStorySearchService({ baseDir: fresh, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch: noFetch })
  await seeded.load()
  assert.ok(seeded.size >= 2200)
  assert.equal(inCache(), false)
})

test('duplicate anchor_id across items/gear scopes both resolve by scope', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-dup-scope-'))
  writeBundle(baseDir, [
    anchor({ anchor_id: 'dup_0', content: '简易护甲 物品描述', source: '物品信息：简易护甲', scope: 'items', full_text: [{ speaker: '资料', text: '简易护甲 物品描述' }] }),
    anchor({ anchor_id: 'dup_0', content: '简易护甲 装备词条', source: '装备信息：简易护甲', scope: 'gear', full_text: [{ speaker: '资料', text: '简易护甲 装备词条' }] }),
  ], { language: 'cn', storyBundleSha256: 'remote-sha' })

  const service = new WarfarinStorySearchService({ baseDir, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch: noFetch })
  const search = await service.search({ keyword: '简易护甲' })
  const itemCtx = await service.context({ anchorId: 'dup_0', scope: 'items' })
  const gearCtx = await service.context({ anchorId: 'dup_0', scope: 'gear' })

  assert.equal(search.results.length, 2)
  assert.equal(itemCtx.anchor.scope, 'items')
  assert.match(itemCtx.full_text[0].text, /简易护甲/)
  assert.equal(gearCtx.anchor.scope, 'gear')
  assert.equal(itemCtx.anchor.content, '简易护甲 物品描述')
  assert.equal(gearCtx.anchor.content, '简易护甲 装备词条')
  // scope 缺省退回第一行；不存在仍报同一个错
  assert.equal((await service.context({ anchorId: 'dup_0' })).anchor.scope, 'items')
  await assert.rejects(() => service.context({ anchorId: 'missing' }), /anchor_id 'missing' not found/)
})

test('obfuscated keyword still finds the same anchor (zero-width round trip)', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const { obfuscateOutgoing, normalizeQueryText } = require(obfuscateFile)
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-obf-roundtrip-'))
  writeBundle(baseDir, [anchor()], { language: 'cn', storyBundleSha256: 'remote-sha' })

  const service = new WarfarinStorySearchService({ baseDir, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch: noFetch })
  const obfuscated = obfuscateOutgoing('息壤材料', { enabled: true, zeroWidthInterval: 2, homophones: [] })
  assert.notEqual(obfuscated, '息壤材料')
  assert.equal(normalizeQueryText(obfuscated), '息壤材料')
  const result = await service.search({ keyword: obfuscated })
  assert.equal(result.total, 1)
  assert.equal(result.results[0].anchor_id, 'a_0')
})

/* ---------- 格式化：KWIC、模式、URL 上限 ---------- */

test('KWIC excerpt keeps keyword centred and respects excerptChars at start/middle/end', () => {
  const { excerptAroundKeyword } = require(formatFile)
  const pad = '字'.repeat(40)
  const start = excerptAroundKeyword(`息壤${pad}`, '息壤', 30)
  assert.match(start, /^息壤/)
  assert.ok(start.replace(/\.\.\./g, '').length <= 30)
  const middle = excerptAroundKeyword(`${pad}息壤${pad}`, '息壤', 30)
  assert.match(middle, /^\.\.\./)
  assert.match(middle, /息壤/)
  assert.match(middle, /\.\.\.$/)
  const end = excerptAroundKeyword(`${pad}息壤`, '息壤', 30)
  assert.match(end, /息壤$/)
  assert.ok(end.replace(/\.\.\./g, '').length <= 30)
})

test('formatWikiContext clipped centres the window on the keyword; link keeps a 120-char KWIC', () => {
  const { formatWikiContext } = require(formatFile)
  const head = '前文段落。'.repeat(60)
  const tail = '后文段落。'.repeat(60)
  const body = `${head}关键词息壤在此处。${tail}`
  const result = {
    anchor: { anchor_id: 'a_0', content: body, source: '物品信息：息壤', scope: 'items', relevance: 1, url: 'https://warfarin.wiki/cn/items/a_0' },
    full_text: [{ speaker: '资料', text: body }],
    summary: null,
    source_ref: '物品信息：息壤',
  }
  const full = formatWikiContext(result)
  assert.match(full, /正文：/)

  // 关键词在正文深处：节选窗应露出它而不是只截开头
  const clipped = formatWikiContext(result, { mode: 'clipped', maxChars: 100, keyword: '息壤' })
  assert.match(clipped, /息壤/)
  assert.match(clipped, /……（正文共 \d+ 字，已节选关键词附近；全文见详情链接）/)
  assert.match(clipped, /详情：https:\/\/warfarin\.wiki\/cn\/items\/a_0/)
  assert.ok(clipped.length < full.length)

  // 关键词没命中：从开头截，同样的页脚
  const missed = formatWikiContext(result, { mode: 'clipped', maxChars: 100, keyword: '不存在' })
  assert.match(missed, /已节选关键词附近/)

  // 正文不超限时整段保留
  const short = formatWikiContext(result, { mode: 'clipped', maxChars: 99999, keyword: '息壤' })
  assert.match(short, /关键词息壤在此处。/)
  assert.doesNotMatch(short, /已节选/)

  const link = formatWikiContext(result, { mode: 'link', keyword: '息壤' })
  assert.doesNotMatch(link, /正文：/)
  assert.match(link, /息壤/)
  assert.match(link, /详情：https:\/\/warfarin\.wiki\/cn\/items\/a_0/)
  assert.equal((link.match(/https?:\/\//g) || []).length, 1)
})

/* ---------- 出站混淆 ---------- */

test('obfuscation inserts zero-width in CJK runs, keeps urls/commands/ascii intact', () => {
  const { obfuscateOutgoing, normalizeQueryText, stripZeroWidth } = require(obfuscateFile)
  const opts = { enabled: true, zeroWidthInterval: 3, homophones: [{ from: '息壤', to: '息瀼' }] }
  const out = obfuscateOutgoing('息壤材料名称与详情链接 https://warfarin.wiki/cn/items/a_0?x=1 尾部', opts)
  assert.equal(out, '息瀼材​料名称​与详情​链接 https://warfarin.wiki/cn/items/a_0?x=1 尾部')
  assert.ok(out.includes('https://warfarin.wiki/cn/items/a_0?x=1'))
  assert.equal(stripZeroWidth(out).includes('息瀼'), true)
  assert.equal(normalizeQueryText('息瀼​材料', opts.homophones), '息壤材料')
  // 命令与 ASCII 逐字节不变
  assert.equal(obfuscateOutgoing('w 1', opts), 'w 1')
  assert.equal(obfuscateOutgoing('w+2', opts), 'w+2')
  assert.equal(obfuscateOutgoing('abc 123', opts), 'abc 123')
  // 关闭与 interval=0 都不插零宽
  assert.equal(obfuscateOutgoing('息壤材料', { ...opts, enabled: false }), '息壤材料')
  assert.equal(obfuscateOutgoing('息壤材料', { ...opts, zeroWidthInterval: 0 }), '息瀼材料')
})

/* ---------- 查询统计 ---------- */

test('query stats records searches and views per group, tops and resets independently', async () => {
  const { QueryStatsStore } = require(statsFile)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-stats-'))
  const file = path.join(dir, 'stats', 'queries.json')
  const store = new QueryStatsStore(file, { now: () => new Date('2026-10-28T10:00:00.000Z') })

  await store.recordSearch('10001', '息壤', 280)
  assert.equal(fs.existsSync(file), false, '未到节流阈值不落盘')

  for (let i = 0; i < 4; i++) await store.recordSearch('10001', '露露', 5)
  for (let i = 0; i < 15; i++) await store.recordSearch('10001', '火锅', 3)
  await store.recordSearch('10002', '息壤', 1)
  await store.recordView('10001', '息壤', { anchor_id: 'a_1', scope: 'items', sourceKind: 'story', source: '物品信息：息壤', url: 'https://u' })
  await store.flush()

  const written = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(written.version, 2)
  assert.equal(written.groups['10001'].terms['息壤'].count, 1)
  assert.equal(written.groups['10001'].terms['息壤'].hits, 280)
  assert.equal(written.groups['10001'].terms['火锅'].count, 15)
  assert.equal(written.groups['10001'].terms['息壤'].views['story:items:a_1'].count, 1)
  assert.equal(written.groups['10002'].terms['息壤'].count, 1)
  assert.doesNotMatch(JSON.stringify(written), /user|guild|channel|user-1/i)

  // 排行按群隔离：阈值过滤 + 次数降序
  const top = store.top('10001', 3, 5)
  assert.deepEqual(top.map((term) => term.keyword), ['火锅', '露露'])
  assert.equal(store.top('10002', 3, 5).length, 0)

  // 重置只清本群
  store.reset('10001')
  assert.equal(store.top('10001', 1, 10).length, 0)
  assert.equal(store.top('10002', 1, 10).length, 1)
  await store.flush()
  const reloaded = new QueryStatsStore(file)
  await reloaded.ready()
  assert.equal(reloaded.top('10001', 1, 10).length, 0)
  assert.equal(reloaded.top('10002', 1, 10).length, 1)
  await store.dispose()
  await reloaded.dispose()
})

/* ---------- 热点词条周报 ---------- */

test('digest group data splits 详情/索引 modes and formats the preview', async () => {
  const { buildWikiDigestGroupData, formatWikiDigestText, renderWikiDigestHtml, wikiDigestNotice } = require(digestFile)
  const { QueryStatsStore } = require(statsFile)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-digest-'))
  const store = new QueryStatsStore(path.join(dir, 'stats', 'queries.json'), { now: () => new Date('2026-10-28T10:00:00.000Z') })
  for (let i = 0; i < 3; i++) await store.recordSearch('10001', '息壤', 280)
  for (let i = 0; i < 3; i++) await store.recordSearch('10001', '宏愿', 7)
  await store.recordView('10001', '息壤', { anchor_id: 'a_1', scope: 'items', sourceKind: 'story', source: '物品信息：息壤', url: 'https://u' })

  const fetched = []
  const searched = []
  const deps = {
    wiki: { digestMinCount: 3, digestTopN: 10, excerptChars: 60 },
    stats: store,
    logger: { warn() {}, info() {}, debug() {} },
    search: {
      async fetchContext(anchor, sourceKind) {
        fetched.push([anchor.anchor_id, sourceKind])
        return { anchor: { ...anchor, relevance: 1 }, full_text: [{ speaker: '资料', text: '详情全文。' }], summary: null, source_ref: anchor.source }
      },
      async searchAllSources(keyword) {
        searched.push(keyword)
        return { results: [{ anchor_id: 's_0', source: '中枢档案：宏愿', content: '宏愿全文片段', scope: 'lore', relevance: 1 }], total: 7, took_ms: 1 }
      },
    },
  }
  const data = await buildWikiDigestGroupData(deps, '10001', '测试群（10001）', new Date('2026-10-19'), new Date('2026-10-28'))

  assert.equal(data.terms.length, 2)
  const hot = data.terms.find((term) => term.keyword === '息壤')
  const cold = data.terms.find((term) => term.keyword === '宏愿')
  assert.equal(hot.views.length, 1)
  assert.match(hot.views[0].detailText, /详情全文。/)
  assert.deepEqual(fetched, [['a_1', 'story']])
  assert.equal(cold.index.total, 7)
  assert.deepEqual(searched, ['宏愿'])

  const text = formatWikiDigestText(data, 3)
  assert.match(text, /本周群友热点检索词条为：/)
  assert.match(text, /#1「息壤」 检索 3 次 · 详情：物品信息：息壤/)
  assert.match(text, /#2「宏愿」 检索 3 次 · 索引：命中 7 条/)

  const html = renderWikiDigestHtml(data)
  assert.match(html, /本周群友热点检索词条为：/)
  assert.match(html, /测试群（10001） · 10\/19–10\/28/)
  assert.match(html, /「详情」|tag-detail|>详情</)
  assert.match(html, /词条「物品信息：息壤」 查看 1 次/)
  assert.match(html, /共命中 7 条/)

  assert.equal(wikiDigestNotice('Warfarin 资料', 2), '本周群友热点检索词条长图已存入群相册「Warfarin 资料」（2 条）')
  await store.dispose()
})

/* ---------- 群相册探测与上传 ---------- */

test('album detection only queries scheduledPush.channels groups, persists cache and feeds the schema union; upload resolves album by id', async () => {
  const { createAlbumHub, albumSchemaUnion } = require(albumFile)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-album-'))
  const calls = []
  const schemaSets = []
  const bot = {
    platform: 'onebot',
    selfId: 'bot-1',
    internal: {
      async _get(action, params) {
        calls.push({ action, params })
        if (action === 'get_group_info') return { group_name: `群${params.group_id}` }
        if (action === 'get_qun_album_list') {
          if (params.group_id === 10001) return { album_list: [{ album_id: 'alb_9', name: 'Warfarin 资料' }], has_more: false }
          if (params.group_id === 10002) return { album_list: [{ album_id: 'alb_7', name: '资料二群' }], has_more: false }
          throw new Error('not in group')
        }
        return { retcode: 0 }
      },
    },
    async sendMessage() {},
  }
  const ctx = {
    bots: [bot],
    schema: { set(key, schema) { schemaSets.push(key) } },
  }
  const wiki = { albumUploadTimeoutMs: 5000, digestAlbums: [] }
  const albumsForDelivery = [{ groupId: '10001', albumId: 'alb_9', albumName: 'Warfarin 资料' }]
  const deliveries = []
  const delivery = {
    async listAlbums(groupId) { return albumsForDelivery.filter((album) => album.groupId === String(groupId)) },
    async deliver(item) {
      if (item.target.kind !== 'album' || item.target.albumId !== 'alb_9') {
        return { ok: false, target: item.target, error: { code: 'TARGET_NOT_FOUND', message: 'no album' }, attempts: 1 }
      }
      deliveries.push(item)
      return { ok: true, target: item.target, attempts: 1 }
    },
  }
  const hub = createAlbumHub({
    ctx, wiki, logger: { warn() {}, info() {}, debug() {} }, statsDirectory: dir,
    pushChannels: () => ['onebot:10001', 'onebot:group:10002', 'discord:x'],
    delivery,
  })

  const albums = await hub.detectAlbums()
  assert.deepEqual(albums.map((a) => `${a.groupId}/${a.albumId}`), ['10001/alb_9', '10002/alb_7'])
  assert.equal(albums[0].groupName, '群10001')
  // 只问 channels 里的群；不拉全量群列表
  const albumCalls = calls.filter((call) => call.action === 'get_qun_album_list').map((call) => call.params.group_id)
  assert.deepEqual(albumCalls, [10001, 10002])
  assert.equal(calls.some((call) => call.action === 'get_group_list'), false)
  const cached = JSON.parse(fs.readFileSync(path.join(dir, 'albums.json'), 'utf8'))
  assert.equal(cached.length, 2)
  // 探测完立即刷新配置候选项，无需重启
  assert.deepEqual(schemaSets, ['miyako-intel.album'])

  hub.applySchema(albums, ['10002/alb_7', '10003/alb_x'])
  assert.deepEqual(schemaSets, ['miyako-intel.album', 'miyako-intel.album'])
  const union = albumSchemaUnion(albums, ['10003/alb_x'])
  assert.equal(typeof union, 'function')
  assert.equal(albumSchemaUnion([], []).type, 'union')

  const images = [Buffer.from('A'), Buffer.from('B')]
  assert.equal(await hub.uploadImages('10001', 'alb_9', images), true)
  assert.equal(deliveries.length, 2)
  assert.equal(deliveries[0].target.kind, 'album')
  assert.equal(deliveries[0].target.channelId, 'onebot:10001')
  assert.equal(deliveries[0].target.albumId, 'alb_9')
  assert.equal(deliveries[0].elements[0].type, 'img')
  assert.ok(Buffer.isBuffer(deliveries[0].elements[0].attrs.src))
  assert.equal(hub.albumLabel('10001', 'alb_9'), 'Warfarin 资料')

  // 相册 id 对不上：投递返回失败，warn 并返回 false，不往上抛
  assert.equal(await hub.uploadImages('10001', 'alb_missing', images), false)
})
