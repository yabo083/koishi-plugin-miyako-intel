const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')

const rootDir = path.resolve(__dirname, '..')
const builtFile = path.join(rootDir, 'lib', 'services', 'warfarin-story-search.js')

function loadStorySearch() {
  delete require.cache[builtFile]
  return require(builtFile)
}

test('built-in story search updates mission data and serves search/context locally', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-'))
  const calls = []
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    rateLimitMs: 0,
    timeoutMs: 1000,
    fetch: async (url) => {
      calls.push(String(url))
      if (String(url).endsWith('/cn/missions/')) {
        return textResponse('<a href="/cn/missions/c27m5">共饮一江水</a>')
      }
      if (String(url).endsWith('/cn/missions/c27m5')) {
        return jsonResponse({
          data: {
            mission: { name: '共饮一江水', description: '一起调查水源。' },
            dialog: [
              { actorName: '管理员', dialogText: '火锅会让大家暖和起来。' },
            ],
            radios: [
              { messages: [{ actorName: '佩丽卡', radioText: '通讯里的水声很大。' }] },
            ],
          },
        })
      }
      throw new Error(`unexpected url ${url}`)
    },
  })

  const report = await service.update()
  const search = await service.search({ keyword: '火锅' })
  const context = await service.context({ anchorId: 'c27m5_0' })

  assert.equal(report.success, 1)
  assert.equal(report.failed, 0)
  assert.equal(search.total, 1)
  assert.equal(search.results[0].anchor_id, 'c27m5_0')
  assert.equal(search.results[0].source, '任务剧情：共饮一江水')
  assert.match(search.results[0].content, /火锅/)
  assert.equal(context.source_ref, '任务剧情：共饮一江水')
  assert.deepEqual(context.full_text, [
    { speaker: '管理员', text: '火锅会让大家暖和起来。' },
    { scene: '通讯中', speaker: '佩丽卡', text: '通讯里的水声很大。' },
  ])
  assert.equal(calls.length, 2)
})

test('built-in story search update reuses cached mission details', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-incremental-'))
  let detailCalls = 0
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    rateLimitMs: 0,
    timeoutMs: 1000,
    fetch: async (url) => {
      if (String(url).endsWith('/cn/missions/')) return textResponse('<a href="/cn/missions/c27m5">共饮一江水</a>')
      if (String(url).endsWith('/cn/missions/c27m5')) {
        detailCalls++
        return jsonResponse({ data: { mission: { name: '共饮一江水' }, dialog: [{ actorName: '管理员', dialogText: '火锅。' }] } })
      }
      throw new Error(`unexpected url ${url}`)
    },
  })

  const first = await service.update()
  const second = await service.update()

  assert.equal(first.success, 1)
  assert.equal(first.skipped, 0)
  assert.equal(second.success, 1)
  assert.equal(second.skipped, 1)
  assert.equal(detailCalls, 1)
})

test('built-in story search update limits new detail fetches per batch', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-batch-'))
  const details = []
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    rateLimitMs: 0,
    timeoutMs: 1000,
    batchSize: 1,
    fetch: async (url) => {
      if (String(url).endsWith('/cn/missions/')) return textResponse('<a href="/cn/missions/c27m5">一</a><a href="/cn/missions/c27m6">二</a>')
      const slug = String(url).split('/').at(-1)
      details.push(slug)
      return jsonResponse({ data: { mission: { name: slug }, dialog: [{ actorName: '管理员', dialogText: `${slug} 火锅。` }] } })
    },
  })

  const first = await service.update()
  const second = await service.update()

  assert.equal(first.success, 1)
  assert.equal(first.pending, 1)
  assert.deepEqual(details, ['c27m5', 'c27m6'])
  assert.equal(second.success, 2)
  assert.equal(second.skipped, 1)
  assert.equal(second.pending, 0)
})

test('built-in story search refreshes stale cached missions in small batches', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-stale-'))
  const rawDir = path.join(baseDir, 'story-cache', 'cn', 'raw', 'missions')
  fs.mkdirSync(rawDir, { recursive: true })
  fs.writeFileSync(path.join(rawDir, 'c27m5.json'), JSON.stringify({
    mission: { name: '旧共饮一江水' },
    dialog: [{ actorName: '管理员', dialogText: '旧文本。' }],
  }))
  const oldTime = new Date('2020-01-01T00:00:00.000Z')
  fs.utimesSync(path.join(rawDir, 'c27m5.json'), oldTime, oldTime)
  let detailCalls = 0
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    rateLimitMs: 0,
    timeoutMs: 1000,
    batchSize: 0,
    refreshExistingDays: 1,
    refreshExistingBatchSize: 1,
    fetch: async (url) => {
      if (String(url).endsWith('/cn/missions/')) return textResponse('<a href="/cn/missions/c27m5">共饮一江水</a>')
      if (String(url).endsWith('/cn/missions/c27m5')) {
        detailCalls++
        return jsonResponse({ data: { mission: { name: '共饮一江水' }, dialog: [{ actorName: '管理员', dialogText: '新文本。' }] } })
      }
      throw new Error(`unexpected url ${url}`)
    },
  })

  const report = await service.update()
  const search = await service.search({ keyword: '新文本' })

  assert.equal(report.refreshed, 1)
  assert.equal(report.skipped, 0)
  assert.equal(detailCalls, 1)
  assert.equal(search.total, 1)
  assert.equal(search.results[0].source, '任务剧情：共饮一江水')
})

test('built-in story search seeds initial local index without source requests', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-seed-'))
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    rateLimitMs: 0,
    timeoutMs: 1000,
    batchSize: 40,
    fetch: async (url) => {
      throw new Error(`seed load should not fetch: ${url}`)
    },
  })

  await service.load()
  const search = await service.search({ keyword: '共饮一江水' })

  assert.ok(service.size >= 200)
  assert.equal(search.total, 1)
  assert.equal(search.results[0].anchor_id, 'c27m5_0')
  assert.equal(fs.existsSync(path.join(baseDir, 'story-cache', 'cn', 'anchors', 'c27m5.json')), true)
})

test('built-in story search updates from remote compressed story text bundle', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-bundle-'))
  const anchors = [{
    anchor_id: 'c27m5_0',
    content: '管理员：火锅会让大家暖和起来。',
    source: '任务剧情：共饮一江水',
    source_ref: '任务剧情：共饮一江水',
    scope: 'missions',
    relevance: 1,
    full_text: [{ speaker: '管理员', text: '火锅会让大家暖和起来。' }],
  }]
  const bundle = zlib.gzipSync(JSON.stringify(anchors))
  const sha256 = crypto.createHash('sha256').update(bundle).digest('hex')
  const calls = []
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    rateLimitMs: 0,
    timeoutMs: 1000,
    bundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json',
    fetch: async (url) => {
      calls.push(String(url))
      if (String(url).endsWith('.manifest.json')) {
        return jsonResponse({ language: 'cn', count: 1, updatedAt: '2026-05-31T00:00:00.000Z', sha256, url: 'https://example.test/warfarin-story-cn.json.gz' })
      }
      if (String(url).endsWith('.json.gz')) return bufferResponse(bundle)
      throw new Error(`source update should not be called: ${url}`)
    },
  })

  const report = await service.update()
  const search = await service.search({ keyword: '火锅' })
  const context = await service.context({ anchorId: 'c27m5_0' })

  assert.deepEqual(calls, [
    'https://example.test/warfarin-story-cn.manifest.json',
    'https://example.test/warfarin-story-cn.json.gz',
  ])
  assert.equal(report.success, 1)
  assert.equal(report.skipped, 0)
  assert.equal(report.pending, 0)
  assert.equal(search.total, 1)
  assert.equal(context.source_ref, '任务剧情：共饮一江水')
  assert.equal(fs.existsSync(path.join(baseDir, 'story-cache', 'cn', 'anchors', 'c27m5.json')), true)
})

function textResponse(text) {
  return {
    ok: true,
    status: 200,
    async text() { return text },
  }
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload },
  }
}

function bufferResponse(buffer) {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) },
  }
}
