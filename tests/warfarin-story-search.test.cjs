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
  assert.equal(fs.existsSync(path.join(baseDir, 'story-cache', 'cn', 'anchors', 'seed.json')), true)
})

test('built-in story search replaces stale legacy local cache with bundled full-text seed', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-stale-local-'))
  const anchorsDir = path.join(baseDir, 'story-cache', 'cn', 'anchors')
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

  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    timeoutMs: 1000,
    fetch: async (url) => {
      throw new Error(`seed load should not fetch: ${url}`)
    },
  })

  await service.load()
  const search = await service.search({ keyword: '不择手段' })

  assert.ok(service.size >= 2200)
  assert.equal(search.results.some((result) => result.source === 'Baker对话：独行之路'), true)
  assert.equal(fs.existsSync(path.join(anchorsDir, 'seed.json')), true)
  assert.equal(fs.existsSync(path.join(anchorsDir, 'c27m5.json')), false)
})

test('built-in story search replaces old expanded seed with current bundled seed version', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const { bundledStorySeedCount, bundledStorySeedVersion } = require(path.join(rootDir, 'lib', 'services', 'warfarin-story-seed.js'))
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-old-seed-'))
  const root = path.join(baseDir, 'story-cache', 'cn')
  const anchorsDir = path.join(root, 'anchors')
  fs.mkdirSync(anchorsDir, { recursive: true })
  const oldAnchors = Array.from({ length: bundledStorySeedCount }, (_, index) => ({
    anchor_id: index === 0 ? 'the-path-walked-alone_0' : `dummy_${index}`,
    content: index === 0 ? '荒野有自己的法则，很多人习惯了为活下去不择手段。' : `dummy ${index}`,
    source: index === 0 ? 'Baker对话：独行之路' : `资料：dummy ${index}`,
    source_ref: index === 0 ? 'Baker对话：独行之路' : `资料：dummy ${index}`,
    scope: index === 0 ? 'baker' : 'dummy',
    relevance: 1,
    full_text: [{ speaker: '资料', text: index === 0 ? '荒野有自己的法则，很多人习惯了为活下去不择手段。' : `dummy ${index}` }],
  }))
  fs.writeFileSync(path.join(anchorsDir, 'seed.json'), JSON.stringify(oldAnchors))
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ language: 'cn', seeded: bundledStorySeedCount }))

  const service = new WarfarinStorySearchService({ baseDir, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch: async (url) => { throw new Error(`seed load should not fetch: ${url}`) } })
  await service.load()
  const baker = await service.context({ anchorId: 'the-path-walked-alone_0' })
  const medal = await service.context({ anchorId: 'the-final-lord-i-served_0' })
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))

  assert.equal(baker.full_text[0].speaker, '选项')
  assert.match(baker.full_text[0].text, / \| /)
  assert.match(baker.anchor.content, /管理员：狼卫，你该去休息一下了。/)
  assert.doesNotMatch(medal.anchor.content, /探索任务奖章/)
  assert.equal(manifest.bundledStorySeedVersion, bundledStorySeedVersion)
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
  assert.equal(fs.existsSync(path.join(baseDir, 'story-cache', 'cn', 'anchors', 'bundle.json')), true)
})

test('built-in story search exposes remote bundle data update date', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-bundle-date-'))
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
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    timeoutMs: 1000,
    bundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json',
    fetch: async (url) => {
      if (String(url).endsWith('.manifest.json')) return jsonResponse({ language: 'cn', count: 1, updatedAt: '2026-05-31T18:22:33.000Z', sourceUpdatedAt: '2026-05-14', sha256, url: 'https://example.test/warfarin-story-cn.json.gz' })
      if (String(url).endsWith('.json.gz')) return bufferResponse(bundle)
      throw new Error(`source update should not be called: ${url}`)
    },
  })

  await service.update()

  assert.equal(await service.getDataUpdatedLabel(), '2026年05月14日')
})

test('built-in story search reports bundled seed when remote bundle date is unavailable', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-seed-date-'))
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    timeoutMs: 1000,
    fetch: async (url) => {
      throw new Error(`seed load should not fetch: ${url}`)
    },
  })

  await service.load()

  assert.equal(await service.getDataUpdatedLabel(), '随包种子，未拉取远端合集')
})

test('built-in story search stores full-text bundle anchors without underscore collisions', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-full-bundle-'))
  const anchors = [
    { anchor_id: 'eny_0007_mimicw_0', content: '潜地虬兽 腐蚀金属', source: '敌人资料：潜地虬兽', source_ref: '敌人资料：潜地虬兽', source_key: 'enemies/eny_0007_mimicw', scope: 'enemies', relevance: 1, full_text: [{ speaker: '资料', text: '潜地虬兽 腐蚀金属' }] },
    { anchor_id: 'eny_0100_slimerg2_0', content: '酸液源石虫 强酸', source: '敌人资料：酸液源石虫', source_ref: '敌人资料：酸液源石虫', source_key: 'enemies/eny_0100_slimerg2', scope: 'enemies', relevance: 1, full_text: [{ speaker: '资料', text: '酸液源石虫 强酸' }] },
  ]
  const bundle = zlib.gzipSync(JSON.stringify(anchors))
  const sha256 = crypto.createHash('sha256').update(bundle).digest('hex')
  const fetch = async (url) => {
    if (String(url).endsWith('.manifest.json')) return jsonResponse({ language: 'cn', count: anchors.length, updatedAt: '2026-05-31T00:00:00.000Z', sha256, url: 'https://example.test/warfarin-story-cn.json.gz' })
    if (String(url).endsWith('.json.gz')) return bufferResponse(bundle)
    throw new Error(`unexpected fetch: ${url}`)
  }
  const service = new WarfarinStorySearchService({ baseDir, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, bundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json', fetch })
  await service.update()

  const reloaded = new WarfarinStorySearchService({ baseDir, dataDirectory: 'story-cache', language: 'cn', timeoutMs: 1000, fetch })
  await reloaded.load()

  assert.equal((await reloaded.search({ keyword: '腐蚀金属' })).total, 1)
  assert.equal((await reloaded.search({ keyword: '强酸' })).total, 1)
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

test('built-in story search does not downgrade bundled full-text seed to stale official bundle', async () => {
  const { WarfarinStorySearchService } = loadStorySearch()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-stale-bundle-'))
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
  const service = new WarfarinStorySearchService({
    baseDir,
    dataDirectory: 'story-cache',
    language: 'cn',
    timeoutMs: 1000,
    bundleManifestUrl: 'https://example.test/warfarin-story-cn.manifest.json',
    fetch: async (url) => {
      if (String(url).endsWith('.manifest.json')) return jsonResponse({ language: 'cn', source: 'warfarin.wiki', count: anchors.length, updatedAt: '2026-05-31T00:00:00.000Z', sha256, url: 'https://example.test/warfarin-story-cn.json.gz' })
      if (String(url).endsWith('.json.gz')) return bufferResponse(bundle)
      throw new Error(`unexpected fetch: ${url}`)
    },
  })

  const report = await service.update()
  const search = await service.search({ keyword: '不择手段' })

  assert.equal(report.failed, 1)
  assert.match(report.warning, /older than bundled seed/)
  assert.ok(service.size >= 2200)
  assert.equal(search.results.some((result) => result.source === 'Baker对话：独行之路'), true)
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
      if (String(url) === 'https://api.warfarin.wiki/v1/cn/missions') return jsonResponse({ data: [{ slug: 'c27m5' }] })
      if (String(url) === 'https://api.warfarin.wiki/v1/cn/missions/c27m5') return jsonResponse({ data: { mission: { id: 'c27m5', name: '共饮一江水' }, dialog: [{ actorName: '管理员', dialogText: '火锅会让大家暖和起来。' }] } })
      throw new Error('unexpected fetch: ' + url)
    }
  `)

  const result = childProcess.spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, path.join(rootDir, 'scripts', 'build-warfarin-story-bundle.mjs'), outDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, MOCK_FETCH_CALLS: callsFile, STORY_API_FETCHER: 'fetch', STORY_CATEGORIES: 'missions', STORY_HTML_FETCHER: 'fetch', STORY_UPDATE_RATE_LIMIT_MS: '0' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const calls = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  const homepageCall = calls.find(call => call.url === 'https://warfarin.wiki/cn')

  assert.match(homepageCall.headers['User-Agent'], /Mozilla\/5\.0/)
  assert.match(homepageCall.headers.Accept, /text\/html/)
  assert.equal(homepageCall.headers['Accept-Language'], 'zh-CN,zh;q=0.9,en;q=0.8')
  assert.ok(fs.existsSync(path.join(outDir, 'warfarin-story-cn.json.gz')))
  assert.ok(fs.existsSync(path.join(outDir, 'warfarin-story-cn.manifest.json')))
})

test('story bundle builder logs progress and uses friendly default pacing', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-builder-progress-'))
  const outDir = path.join(baseDir, 'out')
  const mockFile = path.join(baseDir, 'mock-fetch.mjs')
  fs.writeFileSync(mockFile, `
    function response(payload, ok = true) {
      return { ok, status: ok ? 200 : 404, async json() { return payload }, async text() { return String(payload) }, async arrayBuffer() { return Buffer.from(String(payload)) } }
    }
    globalThis.fetch = async (url) => {
      const value = String(url)
      if (value.endsWith('.manifest.json')) return response({ message: 'missing' }, false)
      if (value === 'https://warfarin.wiki/cn') return response('<html><body>最后更新：2026-05-14</body></html>')
      if (value === 'https://api.warfarin.wiki/v1/cn/missions') return response({ data: [{ slug: 'c27m5' }, { slug: 'c27m6' }] })
      if (value.endsWith('/missions/c27m5')) return response({ data: { mission: { id: 'c27m5', name: '共饮一江水' }, dialog: [{ actorName: '管理员', dialogText: '火锅。' }] } })
      if (value.endsWith('/missions/c27m6')) return response({ data: { mission: { id: 'c27m6', name: '再饮一江水' }, dialog: [{ actorName: '管理员', dialogText: '热汤。' }] } })
      throw new Error('unexpected fetch: ' + value)
    }
  `)

  const result = childProcess.spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, path.join(rootDir, 'scripts', 'build-warfarin-story-bundle.mjs'), outDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, STORY_API_FETCHER: 'fetch', STORY_CATEGORIES: 'missions', STORY_HTML_FETCHER: 'fetch', STORY_PROGRESS_EVERY: '1' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Warfarin story bundle start: language=cn categories=missions concurrency=4 rateLimitMs=150/)
  assert.match(result.stdout, /Warfarin story bundle category start: missions slugs=2/)
  assert.match(result.stdout, /Warfarin story bundle progress: category=missions 1\/2/)
  assert.match(result.stdout, /Warfarin story bundle category done: missions/) 
})

test('story bundle builder publishes bundled seed when remote bundle is stale', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-builder-seed-publish-'))
  const outDir = path.join(baseDir, 'out')
  const mockFile = path.join(baseDir, 'mock-fetch.mjs')
  fs.writeFileSync(mockFile, `
    function response(payload, ok = true) {
      return { ok, status: ok ? 200 : 404, async json() { return payload }, async text() { return String(payload) } }
    }
    globalThis.fetch = async (url) => {
      const value = String(url)
      if (value === 'https://warfarin.wiki/cn') return response('<html><body>最后更新：2026-05-14</body></html>')
      if (value.endsWith('.manifest.json')) return response({ language: 'cn', sourceUpdatedAt: '2026-05-14', count: 221 })
      if (value.startsWith('https://api.warfarin.wiki/')) throw new Error('stale remote should publish bundled seed without crawling source: ' + value)
      throw new Error('unexpected fetch: ' + value)
    }
  `)

  const result = childProcess.spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, path.join(rootDir, 'scripts', 'build-warfarin-story-bundle.mjs'), outDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, STORY_API_FETCHER: 'fetch', STORY_CATEGORIES: 'missions', STORY_HTML_FETCHER: 'fetch' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Warfarin story bundle bundled seed publish:/)
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'warfarin-story-cn.manifest.json'), 'utf8'))
  const anchors = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(outDir, 'warfarin-story-cn.json.gz'))).toString('utf8'))
  assert.equal(manifest.parserVersion, 3)
  assert.ok(manifest.count >= 2200)
  assert.equal(manifest.sourceReport.refreshed, anchors.length)
  assert.equal(anchors.some(anchor => anchor.source === 'Baker对话：独行之路'), true)
})

test('story bundle builder delays fresh source updates before deep crawling', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-builder-delay-'))
  const outDir = path.join(baseDir, 'out')
  const mockFile = path.join(baseDir, 'mock-fetch.mjs')
  fs.writeFileSync(mockFile, `
    function response(payload, ok = true) {
      return { ok, status: ok ? 200 : 404, async json() { return payload }, async text() { return String(payload) } }
    }
    globalThis.fetch = async (url) => {
      const value = String(url)
      if (value === 'https://warfarin.wiki/cn') return response('<html><body>最后更新：2026-05-14</body></html>')
      if (value.endsWith('.manifest.json')) return response({ language: 'cn', parserVersion: 3, sourceUpdatedAt: '2026-05-13', count: 4047, sha256: 'previous' })
      if (value.startsWith('https://api.warfarin.wiki/')) throw new Error('delayed update should not crawl source: ' + value)
      throw new Error('unexpected fetch: ' + value)
    }
  `)

  const result = childProcess.spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, path.join(rootDir, 'scripts', 'build-warfarin-story-bundle.mjs'), outDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, STORY_API_FETCHER: 'fetch', STORY_CATEGORIES: 'missions', STORY_HTML_FETCHER: 'fetch', STORY_NOW: '2026-05-14T12:00:00.000Z', STORY_SOURCE_UPDATE_DELAY_HOURS: '24' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Warfarin story bundle delayed:/)
  const skipped = JSON.parse(fs.readFileSync(path.join(outDir, 'skipped.json'), 'utf8'))
  assert.equal(skipped.delayed, true)
  assert.equal(skipped.sourceUpdatedAt, '2026-05-14')
  assert.equal(fs.existsSync(path.join(outDir, 'warfarin-story-cn.json.gz')), false)
})

test('story bundle workflow sets friendly pacing defaults', () => {
  const workflow = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'warfarin-story-bundle.yml'), 'utf8')

  assert.match(workflow, /STORY_UPDATE_RATE_LIMIT_MS:\s*"300"/)
  assert.match(workflow, /STORY_UPDATE_CONCURRENCY:\s*"3"/)
  assert.match(workflow, /runs-on:\s*\[self-hosted, linux, warfarin-story\]/)
  assert.match(workflow, /cache:\s*npm/)
  assert.match(workflow, /cache-dependency-path:\s*package\.json/)
  assert.match(workflow, /STORY_SOURCE_UPDATE_DELAY_HOURS:\s*"24"/)
  assert.match(workflow, /NODE_USE_ENV_PROXY:\s*"1"/)
  assert.match(workflow, /STORY_GITHUB_FETCHER:\s*"curl"/)
  assert.match(workflow, /force_deep_check:/)
  assert.match(workflow, /STORY_FORCE_DEEP_CHECK:/)
  assert.match(workflow, /STORY_CATEGORIES:/)
})

test('story bundle builder can build a full-text category bundle from Warfarin API lists', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-full-builder-'))
  const outDir = path.join(baseDir, 'out')
  const mockFile = path.join(baseDir, 'mock-fetch.mjs')
  fs.writeFileSync(mockFile, `
    function response(payload, ok = true) {
      return { ok, status: ok ? 200 : 404, async json() { return payload }, async text() { return String(payload) } }
    }
    globalThis.fetch = async (url) => {
      const value = String(url)
      if (value.endsWith('.manifest.json')) return response({ message: 'missing' }, false)
      if (value === 'https://warfarin.wiki/cn') return response('<html><body>最后更新：2026-05-14</body></html>')
      if (value === 'https://api.warfarin.wiki/v1/cn/baker') return response([{ slug: 'a-culinary-invitation' }])
      if (value === 'https://api.warfarin.wiki/v1/cn/enemies') return response({ data: [{ slug: 'eny_0007_mimicw' }] })
      if (value === 'https://api.warfarin.wiki/v1/cn/medals') return response({ data: [{ slug: 'advanced-progression' }] })
      if (value === 'https://api.warfarin.wiki/v1/cn/tutorials') return response({ data: [{ slug: 'wiki_tut_adv_ap' }] })
      if (value.endsWith('/baker/a-culinary-invitation')) return response({ summary: { name: '美食邀请' }, SNSDialogTable: { topic: { dialogContentData: { 1: { speaker: 'endmin', content: '创意食谱？' } } } } })
      if (value.endsWith('/enemies/eny_0007_mimicw')) return response({ data: { enemyTemplateDisplayInfoTable: { name: '潜地虬兽', description: '腐蚀金属。' } } })
      if (value.endsWith('/medals/advanced-progression')) return response({ data: { achievementTable: { name: '高阶培养奖章', levelInfos: { 2: { conditions: [{ desc: '通关所有协议空间' }] } } } } })
      if (value.endsWith('/tutorials/wiki_tut_adv_ap')) return response({ data: { wikiTutorialPageTable: { page: { title: '理智', content: '消耗理智。' } } } })
      throw new Error('unexpected fetch: ' + value)
    }
  `)

  const result = childProcess.spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, path.join(rootDir, 'scripts', 'build-warfarin-story-bundle.mjs'), outDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, STORY_API_FETCHER: 'fetch', STORY_CATEGORIES: 'baker,enemies,medals,tutorials', STORY_HTML_FETCHER: 'fetch', STORY_UPDATE_RATE_LIMIT_MS: '0' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'warfarin-story-cn.manifest.json'), 'utf8'))
  const anchors = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(outDir, 'warfarin-story-cn.json.gz'))).toString('utf8'))
  assert.equal(manifest.sourceReport.success, 4)
  assert.deepEqual(new Set(anchors.map(anchor => anchor.scope)), new Set(['baker', 'enemies', 'medals', 'tutorials']))
  assert.match(anchors.find(anchor => anchor.scope === 'baker').content, /创意食谱/)
})

test('bundled seed regeneration stays aligned with runtime parser metadata', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-seed-regenerate-'))
  const rawRoot = path.join(baseDir, 'raw')
  const outFile = path.join(baseDir, 'warfarin-story-seed.ts')
  fs.mkdirSync(path.join(rawRoot, 'missions'), { recursive: true })
  fs.mkdirSync(path.join(rawRoot, 'lorev2'), { recursive: true })
  fs.writeFileSync(path.join(rawRoot, 'missions', 'c27m5.json'), JSON.stringify({
    mission: { id: 'c27m5', name: '共饮一江水' },
    dialog: [{ actorName: '管理员', dialogText: '火锅。' }],
  }))
  fs.writeFileSync(path.join(rawRoot, 'lorev2', 'wuling.json'), JSON.stringify({
    richContentTable: { title: '武陵记事', contentList: [{ content: '武陵的协议网络。' }] },
  }))

  const result = childProcess.spawnSync(process.execPath, [path.join(rootDir, 'scripts', 'regenerate-warfarin-story-seed.mjs'), rawRoot, outFile], {
    cwd: rootDir,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.deepEqual(JSON.parse(result.stdout).count, 2)
  const generated = fs.readFileSync(outFile, 'utf8')
  assert.match(generated, /export const bundledStorySeedVersion = 3/)
  assert.match(generated, /export const bundledStorySeedCount = 2/)
})

test('story bundle builder does not reuse anchors from older parser versions', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-story-parser-version-'))
  const outDir = path.join(baseDir, 'out')
  const mockFile = path.join(baseDir, 'mock-fetch.mjs')
  fs.writeFileSync(mockFile, `
    function response(payload, ok = true) {
      return { ok, status: ok ? 200 : 404, async json() { return payload }, async text() { return String(payload) } }
    }
    globalThis.fetch = async (url) => {
      const value = String(url)
      if (value === 'https://warfarin.wiki/cn') return response('<html><body>最后更新：2026-05-14</body></html>')
      if (value.endsWith('.manifest.json')) return response({ language: 'cn', sourceUpdatedAt: '2026-05-14', parserVersion: 2, count: 1, sha256: 'stale', url: 'https://example.test/stale.json.gz' })
      if (value.endsWith('.json.gz')) throw new Error('older parser bundle should not be downloaded')
      if (value === 'https://api.warfarin.wiki/v1/cn/baker') return response({ data: [{ slug: 'the-path-walked-alone' }] })
      if (value.endsWith('/baker/the-path-walked-alone')) return response({ data: { summary: { name: '独行之路' }, SNSDialogTable: { topic: { dialogContentData: { 1: { speaker: 'endmin', content: '', dialogOptionIds: ['option_1', 'option_2'] } } } }, SNSDialogOptionTable: { option_1: { optionDesc: '你该去休息了。' }, option_2: { optionDesc: '别再熬夜巡逻了。' } } } })
      throw new Error('unexpected fetch: ' + value)
    }
  `)

  const result = childProcess.spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, path.join(rootDir, 'scripts', 'build-warfarin-story-bundle.mjs'), outDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, STORY_API_FETCHER: 'fetch', STORY_CATEGORIES: 'baker', STORY_FORCE_DEEP_CHECK: '1', STORY_HTML_FETCHER: 'fetch', STORY_UPDATE_RATE_LIMIT_MS: '0' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const anchors = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(outDir, 'warfarin-story-cn.json.gz'))).toString('utf8'))
  assert.match(anchors[0].content, /选项：你该去休息了。 \| 别再熬夜巡逻了。/)
})

test('Warfarin detail parser builds searchable anchors for non-mission text', () => {
  const { createWarfarinAnchorsFromDetail } = loadStorySearch()

  const baker = createWarfarinAnchorsFromDetail('baker', 'a-culinary-invitation', {
    summary: { name: '美食邀请' },
    SNSChatTable: { sns_chr_0004_pelica: { name: '佩丽卡' } },
    SNSDialogOptionTable: { option_1: { optionDesc: '某种创意食谱？' }, option_2: { optionDesc: '另一种料理？' } },
    SNSDialogTable: {
      topic: {
        dialogContentData: {
          1: { speaker: 'sns_chr_0004_pelica', content: '发现了些有趣的东西。' },
          2: { speaker: 'endmin', content: '就像是某种裂地者的创意食谱？' },
          3: { speaker: 'endmin', content: '', dialogOptionIds: ['option_1', 'option_2'] },
        },
      },
    },
  })
  const enemy = createWarfarinAnchorsFromDetail('enemies', 'eny_0007_mimicw', {
    enemyTemplateDisplayInfoTable: { name: '潜地虬兽', description: '能够喷吐强腐蚀性液体的野兽。' },
    enemyAbilityDescTable: { acid: { name: '酸液', description: '腐蚀金属。' } },
  })
  const medal = createWarfarinAnchorsFromDetail('medals', 'advanced-progression', {
    achievementTable: { name: '高阶培养奖章', groupId: 'achv_group_quest_main', levelInfos: { 2: { completeDesc: '找到最顶尖的材料。', conditions: [{ desc: '通关所有“协议空间·高阶培养”' }] } } },
    achievementTypeTable: { categoryName: '技艺奖章', achievementGroupData: [{ groupId: 'achv_group_quest_main', groupName: '主线任务奖章' }, { groupId: 'achv_group_quest_side', groupName: '探索任务奖章' }] },
  })
  const tutorial = createWarfarinAnchorsFromDetail('tutorials', 'wiki_tut_adv_ap', {
    wikiTutorialPageTable: { page: { title: '理智', content: '探索协议空间时，会消耗理智。' } },
  })

  assert.equal(baker[0].source, 'Baker对话：美食邀请')
  assert.equal(baker[0].scope, 'baker')
  assert.match(baker[0].content, /佩丽卡：发现了些有趣的东西。/)
  assert.match(baker[0].content, /选项：某种创意食谱？ \| 另一种料理？/)
  assert.deepEqual(baker[0].full_text[0], { speaker: '佩丽卡', text: '发现了些有趣的东西。' })
  assert.deepEqual(baker[0].full_text.at(-1), { speaker: '选项', text: '某种创意食谱？ | 另一种料理？' })

  assert.equal(enemy[0].source, '敌人资料：潜地虬兽')
  assert.match(enemy[0].content, /腐蚀金属/)
  assert.equal(medal[0].source, '奖章信息：高阶培养奖章')
  assert.match(medal[0].content, /协议空间·高阶培养/)
  assert.match(medal[0].content, /主线任务奖章/)
  assert.doesNotMatch(medal[0].content, /探索任务奖章/)
  assert.equal(tutorial[0].source, '教程：理智')
  assert.match(tutorial[0].content, /消耗理智/)
})

test('Warfarin Baker parser groups API option branches and keeps character metadata searchable', () => {
  const { createWarfarinAnchorsFromDetail } = loadStorySearch()

  const baker = createWarfarinAnchorsFromDetail('baker', 'the-path-walked-alone', {
    summary: { name: '独行之路' },
    SNSChatTable: { sns_chr_0006_wolfgd: { name: '狼卫', desc: '正在解决问题或前往问题的路上。' } },
    SNSDialogOptionTable: {
      option_1: { optionDesc: '你该去休息了。', optionNextContentId: 2 },
      option_2: { optionDesc: '别再熬夜巡逻了。', optionNextContentId: 3 },
    },
    SNSDialogTable: {
      topic: {
        dialogContentData: {
          1: { speaker: 'endmin', content: '', contentId: 1, optionType: 1, dialogOptionIds: ['option_1', 'option_2'] },
          2: { speaker: 'endmin', content: '狼卫，你该去休息一下了。', contentId: 2, preContentId: 1 },
          3: { speaker: 'endmin', content: '狼卫，以后别再一个人熬夜巡逻了。', contentId: 3, preContentId: 1 },
          4: { speaker: 'sns_chr_0006_wolfgd', content: '我知道了。', contentId: 4, preContentId: 3 },
        },
      },
    },
  })

  assert.match(baker[0].content, /角色：狼卫/)
  assert.match(baker[0].content, /简介：正在解决问题或前往问题的路上。/)
  assert.match(baker[0].content, /选项：你该去休息了。 \| 别再熬夜巡逻了。/)
  assert.equal((baker[0].content.match(/选项：/g) || []).length, 1)
})

test('Warfarin item parser skips achievement item shells in favor of medal anchors', () => {
  const { createWarfarinAnchorsFromDetail } = loadStorySearch()

  const anchors = createWarfarinAnchorsFromDetail('items', 'achv_adv_wuling_campfire_1_1', {
    itemTable: { id: 'achv_adv_wuling_campfire_1_1', name: '锚定武陵奖章·Ⅰ', desc: '锚定武陵奖章·Ⅰ', decoDesc: '您已初步唤醒了武陵的协议网络。' },
  })

  assert.deepEqual(anchors, [])
})

test('Warfarin medal parser includes category and matched group labels', () => {
  const { createWarfarinAnchorsFromDetail } = loadStorySearch()

  const medal = createWarfarinAnchorsFromDetail('medals', 'anchored-to-wuling', {
    achievementTable: {
      name: '锚定武陵奖章·Ⅰ',
      groupId: 'achv_group_adv_wuling',
      levelInfos: { 1: { completeDesc: '您已初步唤醒了武陵的协议网络。', conditions: [{ desc: '于景玉谷和武陵城解锁19个协议传送点' }] } },
    },
    achievementTypeTable: {
      categoryName: '地区奖章',
      achievementGroupData: [
        { groupId: 'achv_group_adv_tundra', groupName: '谷地地区奖章' },
        { groupId: 'achv_group_adv_wuling', groupName: '武陵地区奖章' },
      ],
    },
  })

  assert.equal(medal[0].source, '奖章信息：锚定武陵奖章·Ⅰ')
  assert.match(medal[0].content, /地区奖章/)
  assert.match(medal[0].content, /武陵地区奖章/)
  assert.doesNotMatch(medal[0].content, /谷地地区奖章/)
})

test('Warfarin mission parser sorts radio blocks by natural radio id order', () => {
  const { createStoryAnchorFromMission } = loadStorySearch()

  const anchor = createStoryAnchorFromMission('a1m9', {
    mission: { name: '武陵特厨' },
    dialog: [{ actorName: '主持人', dialogText: '你好，管理员，你做的美食真让人印象深刻啊。' }],
    radios: [
      { radioId: 'radio_a1m9_2', messages: [{ index: 1, actorName: '管理员', radioText: '快到提交决赛作品的时间了……但还是没什么头绪。' }] },
      { radioId: 'radio_a1m9_1', messages: [{ index: 1, actorName: '管理员', radioText: '那是……维尔莫林？他似乎在叫我过去。' }] },
    ],
  })

  assert.ok(anchor.content.indexOf('那是……维尔莫林') < anchor.content.indexOf('快到提交决赛作品'))
  assert.deepEqual(anchor.full_text.slice(1), [
    { scene: '通讯中', speaker: '管理员', text: '那是……维尔莫林？他似乎在叫我过去。' },
    { scene: '通讯中', speaker: '管理员', text: '快到提交决赛作品的时间了……但还是没什么头绪。' },
  ])
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
