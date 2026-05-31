const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
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

test('story bundle builder sends browser headers to Warfarin HTML pages', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-builder-'))
  const outDir = path.join(baseDir, 'out')
  const callsFile = path.join(baseDir, 'calls.log')
  const mockFile = path.join(baseDir, 'mock-fetch.mjs')
  fs.writeFileSync(mockFile, `
    import { appendFileSync } from 'node:fs'
    const callsFile = process.env.MOCK_FETCH_CALLS
    function response(body, contentType = 'application/json') {
      return {
        ok: true,
        status: 200,
        async json() { return JSON.parse(body) },
        async text() { return body },
        headers: new Map([['content-type', contentType]]),
      }
    }
    function jsonResponse(payload) {
      return response(JSON.stringify(payload))
    }
    function htmlResponse(html) {
      return response(html, 'text/html')
    }
    globalThis.fetch = async (url, init = {}) => {
      appendFileSync(callsFile, JSON.stringify({ url: String(url), headers: init.headers || {} }) + '\\n')
      if (String(url).endsWith('.manifest.json')) return jsonResponse({ sourceUpdatedAt: '2026-05-13' })
      if (String(url) === 'https://warfarin.wiki/cn') return htmlResponse('<html><body>最后更新：2026-05-14</body></html>')
      if (String(url) === 'https://warfarin.wiki/cn/missions/') return htmlResponse('<a href="/cn/missions/c27m5">共饮一江水</a>')
      if (String(url) === 'https://api.warfarin.wiki/v1/cn/missions/c27m5') return jsonResponse({ data: { mission: { id: 'c27m5', name: '共饮一江水' }, dialog: [{ actorName: '管理员', dialogText: '火锅会让大家暖和起来。' }] } })
      throw new Error('unexpected fetch: ' + url)
    }
  `)

  const result = childProcess.spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, path.join(rootDir, 'scripts', 'build-warfarin-story-bundle.mjs'), outDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, MOCK_FETCH_CALLS: callsFile, STORY_HTML_FETCHER: 'fetch', STORY_UPDATE_RATE_LIMIT_MS: '0' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const calls = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  const homepageCall = calls.find(call => call.url === 'https://warfarin.wiki/cn')
  const missionListCall = calls.find(call => call.url === 'https://warfarin.wiki/cn/missions/')

  assert.match(homepageCall.headers['User-Agent'], /Mozilla\/5\.0/)
  assert.match(homepageCall.headers.Accept, /text\/html/)
  assert.equal(homepageCall.headers['Accept-Language'], 'zh-CN,zh;q=0.9,en;q=0.8')
  assert.match(missionListCall.headers['User-Agent'], /Mozilla\/5\.0/)
  assert.ok(fs.existsSync(path.join(outDir, 'warfarin-story-cn.json.gz')))
  assert.ok(fs.existsSync(path.join(outDir, 'warfarin-story-cn.manifest.json')))
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
