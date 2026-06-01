const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const builtFile = path.join(rootDir, 'lib', 'services', 'warfarin-wiki.js')

function loadWiki() {
  delete require.cache[builtFile]
  return require(builtFile)
}

test('warfarin wiki client uses official search for accurate totals', async () => {
  const { WarfarinWikiClient } = loadWiki()
  const calls = []
  const client = new WarfarinWikiClient({
    baseUrl: 'https://api.example/v1/cn',
    mode: 'official',
    userAgent: 'TestAgent/1.0',
    timeoutMs: 1000,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({
        query: '息壤',
        results: [
          { slug: 'text_v0d8_24', name: '息壤', type: 'lore', category: '中枢档案', snippet: '息壤是一种用于遏制侵蚀的新材料。', score: 56 },
          { slug: 'item_xiranite_powder', name: '息壤', type: 'items', category: '材料', snippet: '将源石与巨兽力量结合于一处后诞生出的新型源石材料。', score: 39 },
        ],
      })
    },
  })

  const result = await client.search({ keyword: ' 息壤 ' })

  assert.equal(calls[0].url, 'https://api.example/v1/cn/search?q=%E6%81%AF%E5%A3%A4')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers['User-Agent'], 'TestAgent/1.0')
  assert.equal(calls[0].init.headers.Accept, 'application/json,text/plain,*/*')
  assert.equal(result.total, 2)
  assert.equal(result.results[0].anchor_id, 'text_v0d8_24')
  assert.equal(result.results[0].source, '中枢档案：息壤')
  assert.equal(result.results[0].url, 'https://warfarin.wiki/cn/lore/text_v0d8_24')
})

test('warfarin wiki client uses configured official language for api and page links', async () => {
  const { WarfarinWikiClient } = loadWiki()
  const calls = []
  const client = new WarfarinWikiClient({
    baseUrl: 'https://api.example/v1/cn',
    mode: 'official',
    language: 'en',
    timeoutMs: 1000,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({
        query: 'xiran',
        results: [
          { slug: 'item_xiranite_powder', name: 'Xiran', type: 'items', category: 'Material', snippet: 'A material.', score: 39 },
        ],
      })
    },
  })

  const result = await client.search({ keyword: 'xiran' })

  assert.equal(calls[0].url, 'https://api.example/v1/en/search?q=xiran')
  assert.equal(result.results[0].url, 'https://warfarin.wiki/en/items/item_xiranite_powder')
})

test('warfarin wiki client uses anchor deployment when configured', async () => {
  const { WarfarinWikiClient } = loadWiki()
  const calls = []
  const client = new WarfarinWikiClient({
    baseUrl: 'http://wiki.example',
    mode: 'anchor',
    timeoutMs: 1000,
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) })
      return jsonResponse({
        code: 0,
        message: 'ok',
        data: {
          results: [
            { anchor_id: 'item_xiranite_powder_0', content: '息壤材料。', source: '物品信息：息壤', scope: 'items', relevance: 1 },
          ],
          total: 1,
          took_ms: 4,
        },
      })
    },
  })

  const result = await client.search({ keyword: '息壤' })

  assert.equal(calls[0].url, 'http://wiki.example/api/v1/search/anchor')
  assert.deepEqual(calls[0].body, { keyword: '息壤' })
  assert.equal(result.results[0].anchor_id, 'item_xiranite_powder_0')
  assert.equal(result.total, 1)
})

test('warfarin wiki client returns readable API errors', async () => {
  const { WarfarinWikiClient, WarfarinWikiApiError } = loadWiki()
  const client = new WarfarinWikiClient({
    baseUrl: 'http://wiki.example',
    mode: 'anchor',
    timeoutMs: 1000,
    fetch: async () => jsonResponse({ code: 404, message: "anchor_id 'missing' not found", data: null }),
  })

  await assert.rejects(
    () => client.context({ anchorId: 'missing', needSummary: true, contextRange: 5 }),
    (error) => error instanceof WarfarinWikiApiError && error.code === 404 && /missing/.test(error.message),
  )
})

test('warfarin wiki client preserves fetch failure cause for logs', async () => {
  const { WarfarinWikiClient, WarfarinWikiApiError } = loadWiki()
  const cause = Object.assign(new Error('connect failed'), { code: 'ECONNRESET' })
  const client = new WarfarinWikiClient({
    baseUrl: 'https://api.example/v1/cn',
    mode: 'official',
    timeoutMs: 1000,
    fetch: async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause })
    },
  })

  await assert.rejects(
    () => client.search({ keyword: '息壤' }),
    (error) => error instanceof WarfarinWikiApiError && error.cause?.cause?.code === 'ECONNRESET',
  )
})

test('formats search results and context for chat reading', () => {
  const { formatWikiSearchResults, formatWikiContext } = loadWiki()
  const searchText = formatWikiSearchResults({
    keyword: '息壤',
    offset: 0,
    pageSize: 5,
    results: [
      { anchor_id: 'plot_001', content: '很长的前文。息壤来自塔卫二，常见于开拓剧情。很长的后文。', source: '剧情-序章', scope: 'plot', relevance: 0.91 },
      { anchor_id: 'archive_002', content: '息壤被归入特殊物质。', source: '档案-特殊物质篇', scope: 'archive', relevance: 0.82 },
      { anchor_id: 'item_003', content: '息壤材料。', source: '物品信息：息壤', scope: 'items', relevance: 0.7 },
      { anchor_id: 'lore_004', content: '息壤技术。', source: '见闻辑录：息壤技术', scope: 'lore', relevance: 0.6 },
      { anchor_id: 'weapon_005', content: '息壤相关武器记录。', source: '武器：古渠', scope: 'weapons', relevance: 0.5 },
      { anchor_id: 'operator_006', content: '庄方宜负责息壤新材项目。', source: '干员：庄方宜', scope: 'operators', relevance: 0.4 },
    ],
    total: 33,
    took_ms: 8,
  })

  assert.match(searchText, /Warfarin Wiki 检索：息壤 \| 共 33 条，可用页码 \[1-7\] \| 输入 w 序号 查看，w\+ 下一页，w- 上一页，w\+页码 跳页。/)
  assert.match(searchText, /1\. 剧情-序章/)
  assert.doesNotMatch(searchText, /显示 1-5 条/)
  assert.doesNotMatch(searchText, /w 1 查看/)
  assert.doesNotMatch(searchText, /庄方宜/)

  const storyText = formatWikiSearchResults({
    keyword: '画卷通道',
    sourceLabel: '剧情/任务全文搜索',
    offset: 0,
    pageSize: 5,
    results: [
      { anchor_id: 'e10m4_0', content: '庄方宜：事到如今，我们只能借助这些画卷通道了。', source: '任务剧情：志同道合', scope: 'missions', relevance: 50 },
    ],
    total: 1,
    took_ms: 8,
  })

  assert.match(storyText, /信息源：剧情\/任务全文搜索/)
  assert.match(storyText, /1\. 任务剧情：志同道合\n/)
  assert.doesNotMatch(storyText, /e10m4，第 4 个任务/)
  assert.doesNotMatch(storyText, /信息源：Warfarin Wiki 官方搜索/)

  const contextText = formatWikiContext({
    anchor: { anchor_id: 'plot_001', content: '息壤来自塔卫二。', source: '剧情-序章', scope: 'plot', relevance: 0.91 },
    full_text: [
      { speaker: '佩丽卡', text: '那是什么？' },
      { speaker: '回忆中的庄方宜{e10m4-回忆中的庄方宜}', text: '有，有广场。' },
      { scene: '通讯中', speaker: '陆令香', text: '这里的充能板全都失效了……麻烦各位！' },
      { scene: '通讯中', speaker: '通讯', text: '信号受干扰。' },
      { speaker: '', text: '息壤来自塔卫二。' },
    ],
    summary: null,
    source_ref: '序章 · 剧情',
  })

  assert.match(contextText, /序章 · 剧情/)
  assert.match(contextText, /佩丽卡：那是什么？/)
  assert.match(contextText, /回忆中的庄方宜：有，有广场。/)
  assert.match(contextText, /通讯中 \/ 陆令香：这里的充能板全都失效了/)
  assert.match(contextText, /通讯中：信号受干扰。/)
  assert.doesNotMatch(contextText, /e10m4/)
  assert.match(contextText, /旁白：息壤来自塔卫二。/)
})

test('formats story details without repeated source and includes mission code', () => {
  const { formatWikiContext } = loadWiki()

  const text = formatWikiContext({
    anchor: { anchor_id: 'e10m4_0', content: '火锅剧情。', source: '任务剧情：志同道合', scope: 'missions', relevance: 1 },
    full_text: [
      { speaker: '回忆中的师姐{e10m4-回忆中的师姐}', text: '对了，你这城里......有没有火锅炸串冒菜汉堡冰激凌啊？' },
    ],
    summary: null,
    source_ref: '任务剧情：志同道合',
  })

  assert.match(text, /名称：志同道合 \| 类型：任务剧情 \| 任务编号：e10m4 \| 来源：Warfarin Wiki/)
  assert.doesNotMatch(text, /第 4 个任务/)
  assert.doesNotMatch(text, /信息源：Warfarin Wiki \/ 任务剧情：志同道合/)
  assert.match(text, /回忆中的师姐：对了，你这城里/)
})

test('formats non-dialog details with source page link', () => {
  const { formatWikiContext } = loadWiki()

  const text = formatWikiContext({
    anchor: { anchor_id: 'eny_0007_mimicw_0', content: '潜地虬兽。腐蚀金属。', source: '敌人资料：潜地虬兽', scope: 'enemies', relevance: 1, url: 'https://warfarin.wiki/cn/enemies/eny_0007_mimicw' },
    full_text: [{ speaker: '资料', text: '潜地虬兽。腐蚀金属。' }],
    summary: null,
    source_ref: '敌人资料：潜地虬兽',
  })

  assert.match(text, /名称：潜地虬兽 \\| 类型：敌人资料 \\| 来源：Warfarin Wiki/)
  assert.match(text, /详情：https:\/\/warfarin\.wiki\/cn\/enemies\/eny_0007_mimicw/)
})

test('chatluna tool adapter exposes search and context tools', async () => {
  const { createWarfarinWikiTools } = loadWiki()
  const calls = []
  const client = {
    async search(input) {
      calls.push(['search', input])
      return { results: [], total: 0, took_ms: 1 }
    },
    async context(input) {
      calls.push(['context', input])
      return { anchor: { anchor_id: 'a', content: 'c', source: 's', scope: 'plot', relevance: 1 }, full_text: [], summary: null, source_ref: 's' }
    },
  }

  const tools = createWarfarinWikiTools(client)
  assert.deepEqual(tools.map((tool) => tool.name), ['warfarin_wiki_search', 'warfarin_wiki_context'])

  await tools[0].execute({ keyword: '息壤', scope: ['plot'], limit: 3 })
  await tools[1].execute({ anchor_id: 'plot_001', need_summary: false, context_range: 0 })

  assert.deepEqual(calls, [
    ['search', { keyword: '息壤' }],
    ['context', { anchorId: 'plot_001', needSummary: false, contextRange: 0 }],
  ])
})

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload
    },
  }
}
