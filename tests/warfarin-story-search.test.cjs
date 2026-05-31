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

test('built-in story search update without bundle keeps local story text and never crawls source', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-local-update-'))
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    timeoutMs: 1000,
    fetch: async (url) => {
      throw new Error(`runtime update must not crawl source: ${url}`)
    },
  })

  const report = await service.update()
  const search = await service.search({ keyword: '共饮一江水' })

  assert.ok(report.success >= 200)
  assert.equal(report.failed, 0)
  assert.equal(report.pending, 0)
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

test('built-in story search reports bundle update warning while keeping local text', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-bundle-warning-'))
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    timeoutMs: 1000,
    bundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json',
    fetch: async (url) => {
      throw new Error(`network down: ${url}`)
    },
  })

  const report = await service.update()
  const search = await service.search({ keyword: '共饮一江水' })

  assert.equal(report.failed, 1)
  assert.match(report.warning, /network down/)
  assert.ok(report.success >= 200)
  assert.equal(search.total, 1)
})

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
