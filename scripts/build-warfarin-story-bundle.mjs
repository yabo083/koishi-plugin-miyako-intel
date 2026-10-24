#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { createWarfarinAnchorsFromDetail } from '../lib/services/warfarin-story-parsers.js'
import { bundledStorySeedCount, bundledStorySeedVersion, loadBundledStorySeed } from '../lib/services/warfarin-story-seed.js'

const language = process.env.STORY_LANGUAGE || 'cn'
const repository = process.env.GITHUB_REPOSITORY || 'yabo083/koishi-plugin-miyako-intel'
const releaseTag = process.env.STORY_RELEASE_TAG || 'warfarin-story-latest'
const parserVersion = 7
const rateLimitMs = Number(process.env.STORY_UPDATE_RATE_LIMIT_MS || 150)
const concurrency = Math.max(1, Number(process.env.STORY_UPDATE_CONCURRENCY || 4))
const timeoutMs = Number(process.env.STORY_UPDATE_TIMEOUT_MS || 30000)
const progressEvery = Math.max(1, Number(process.env.STORY_PROGRESS_EVERY || 25))
const progressIntervalMs = Math.max(1000, Number(process.env.STORY_PROGRESS_INTERVAL_MS || 15000))
const sourceUpdateDelayHours = Math.max(0, Number(process.env.STORY_SOURCE_UPDATE_DELAY_HOURS || 0))
const nowMs = process.env.STORY_NOW ? Date.parse(process.env.STORY_NOW) : Date.now()
const outDir = resolve(process.argv[2] || 'artifacts/warfarin-story')
const filename = `warfarin-story-${language}.json.gz`
const manifestName = `warfarin-story-${language}.manifest.json`
const bundleUrl = `https://github.com/${repository}/releases/download/${releaseTag}/${filename}`
const manifestUrl = `https://github.com/${repository}/releases/download/${releaseTag}/${manifestName}`
const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const categories = parseCategories(process.env.STORY_CATEGORIES)
// 只有不指定分类（每日定时任务）时列表才是完整真相来源；手动指定分类时不能据此判定下架。
const categoryOverride = String(process.env.STORY_CATEGORIES || '').trim()
const isCompleteCategoryRun = !categoryOverride
const forcedFullUpdate = process.env.STORY_FORCE_UPDATE === '1' || process.env.STORY_FORCE_DEEP_CHECK === '1'
const startedAt = Date.now()

log(`Warfarin story bundle start: language=${language} categories=${categories.join(',')} concurrency=${concurrency} rateLimitMs=${rateLimitMs} timeoutMs=${timeoutMs}`)
const sourceUpdatedAt = await fetchSourceUpdatedAt(language)
log(`Warfarin story bundle source date: ${sourceUpdatedAt}`)
const previousManifest = await fetchJson(manifestUrl).catch((error) => {
  log(`Warfarin story bundle previous manifest unavailable: ${error instanceof Error ? error.message : String(error)}`)
  return null
})
if (shouldDelaySourceUpdate(previousManifest)) {
  await mkdir(outDir, { recursive: true })
  await discardPublishedArtifacts()
  await writeFile(joinPath(outDir, 'skipped.json'), JSON.stringify({ skipped: true, delayed: true, sourceUpdatedAt, previousSourceUpdatedAt: previousManifest?.sourceUpdatedAt || '', delayHours: sourceUpdateDelayHours }, null, 2))
  log(`Warfarin story bundle delayed: sourceUpdatedAt=${sourceUpdatedAt} previous=${previousManifest?.sourceUpdatedAt || 'none'} delayHours=${sourceUpdateDelayHours} elapsed=${elapsed()}`)
  console.log(JSON.stringify({ skipped: true, delayed: true, sourceUpdatedAt }, null, 2))
  process.exit(0)
}
const previousBundle = shouldReusePreviousBundle(previousManifest) ? await fetchPreviousBundle(previousManifest).catch(() => []) : []
const previousByKey = groupPreviousAnchors(previousBundle)
// 增量模式：上一版包可用、解析器版本不落后、首页日期没变，且没有被强制全量。
// 详情接口没有 ETag/Last-Modified，所以「逐条变更」只能靠列表集合差来逼近：
// 已有条目直接复用上一版锚点，只给新 slug 拉详情。
const incremental = !forcedFullUpdate
  && Boolean(previousManifest)
  && Number(previousManifest?.parserVersion || 0) >= parserVersion
  && previousManifest?.sourceUpdatedAt === sourceUpdatedAt
  && previousBundle.length > 0
log(`Warfarin story bundle previous: manifest=${previousManifest?.sha256 ? 'yes' : 'no'} anchors=${previousBundle.length} reusableEntries=${previousByKey.size} mode=${incremental ? 'incremental' : 'full'}`)
if (shouldPublishBundledSeed(previousManifest)) {
  const seedAnchors = loadBundledStorySeed().filter(isBundleAnchor)
  if (!seedAnchors.length) throw new Error('bundled story seed has no usable anchors')
  log(`Warfarin story bundle bundled seed publish: previousCount=${Number(previousManifest?.count || 0)} seedCount=${seedAnchors.length} elapsed=${elapsed()}`)
  await writeBundle(seedAnchors, { success: seedAnchors.length, failed: 0, skipped: 0, pending: 0, refreshed: seedAnchors.length, reused: 0, deleted: 0 })
  process.exit(0)
}
// 增量模式绝不能在这里提前退出：源站日期没变不代表没有新增/删除条目，
// 必须先取到 12 个分类列表做完集合差才能判定（见下面的 refreshed/deleted 判断）。
if (!incremental && shouldSkipUnchanged(previousManifest)) {
  await mkdir(outDir, { recursive: true })
  await discardPublishedArtifacts()
  await writeFile(joinPath(outDir, 'skipped.json'), JSON.stringify({ skipped: true, sourceUpdatedAt, success: Number(previousManifest.count || 0) }, null, 2))
  log(`Warfarin story bundle unchanged: count=${Number(previousManifest.count || 0)} sourceUpdatedAt=${sourceUpdatedAt} elapsed=${elapsed()}`)
  console.log(JSON.stringify({ skipped: true, sourceUpdatedAt, success: Number(previousManifest.count || 0) }, null, 2))
  process.exit(0)
}
const anchors = []
let failed = 0
let skipped = 0
let refreshed = 0
let reused = 0
let deleted = 0
const failures = []
const currentKeys = new Set()
const emptyCategories = []

for (const category of categories) {
  let slugs
  try {
    slugs = await fetchSlugs(language, category)
  } catch (error) {
    // 列表是整个分类的唯一真相来源：拿不到就整体失败退出，
    // 绝不能在 key 集合不完整的情况下继续走「删除下架条目」的分支。
    log(`Warfarin story bundle category list failed: ${category} reason=${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
  const scope = normalizeScope(category)
  for (const slug of slugs) currentKeys.add(`${scope}/${slug}`)
  if (!slugs.length) emptyCategories.push(category)
  log(`Warfarin story bundle category start: ${category} slugs=${slugs.length} mode=${incremental ? 'incremental' : 'full'}`)
  const categoryStats = { done: 0, failed: 0, skipped: 0, refreshed: 0, reused: 0, reusedEntries: 0, newEntries: 0, lastLogAt: Date.now() }
  const results = await mapWithConcurrency(slugs, concurrency, async (slug) => {
    const sourceKey = `${scope}/${slug}`
    const previous = reusePreviousEntry(incremental, sourceKey, previousByKey)
    if (previous) return { reused: true, skipped: true, anchors: previous.anchors }
    try {
      const data = await fetchDetail(language, category, slug)
      const rawSha256 = hashJson(data)
      const previousDetail = previousByKey.get(sourceKey)
      if (!incremental && previousDetail?.raw_sha256 === rawSha256) return { skipped: true, anchors: previousDetail.anchors }
      const nextAnchors = createWarfarinAnchorsFromDetail(category, slug, data).map(anchor => ({ ...anchor, source_key: sourceKey, raw_sha256: rawSha256 }))
      return { skipped: false, anchors: nextAnchors }
    } catch (error) {
      // 单条详情抓取失败时沿用上一版锚点，避免一次源站抖动就让已发布的数据包静默缩水。
      return { error: `${category}/${slug}: ${error instanceof Error ? error.message : String(error)}`, anchors: previousByKey.get(sourceKey)?.anchors || [] }
    }
  }, rateLimitMs, (result) => {
    categoryStats.done++
    if (result?.reused) {
      categoryStats.reused += result.anchors?.length || 0
      categoryStats.reusedEntries++
    }
    if (result?.error) categoryStats.failed++
    else if (result?.skipped) categoryStats.skipped += result.anchors?.length || 0
    else {
      categoryStats.newEntries++
      categoryStats.refreshed += result?.anchors?.length || 0
    }
    const now = Date.now()
    if (categoryStats.done === slugs.length || categoryStats.done % progressEvery === 0 || now - categoryStats.lastLogAt >= progressIntervalMs) {
      categoryStats.lastLogAt = now
      log(`Warfarin story bundle progress: category=${category} ${categoryStats.done}/${slugs.length} reusedEntries=${categoryStats.reusedEntries} newEntries=${categoryStats.newEntries} reused=${categoryStats.reused} refreshed=${categoryStats.refreshed} skipped=${categoryStats.skipped} failed=${categoryStats.failed} elapsed=${elapsed()}`)
    }
  })
  for (const result of results) {
    if (result?.error) {
      failed++
      if (failures.length < 5) failures.push(result.error)
      if (result?.anchors?.length) {
        anchors.push(...result.anchors)
        skipped += result.anchors.length
      }
      continue
    }
    anchors.push(...(result?.anchors || []))
    if (result?.reused) reused += result.anchors?.length || 0
    if (result?.skipped) skipped += result.anchors?.length || 0
    else refreshed += result?.anchors?.length || 0
  }
  log(`Warfarin story bundle category done: ${category} slugs=${slugs.length} anchors=${anchors.length} reused=${reused} new=${refreshed} skipped=${skipped} failed=${failed} elapsed=${elapsed()}`)
}

if (incremental) {
  // 集合差：上一版有、这次列表里没有的条目。只有「完整分类运行」且每个分类都拿到了非空列表时才能判定下架，
  // 否则（手动指定分类、或某个分类返回空列表）一律原样带回旧锚点，宁可少删也不能把包删残。
  const canDeleteMissing = isCompleteCategoryRun && emptyCategories.length === 0
  let retainedMissing = 0
  for (const [sourceKey, entry] of previousByKey) {
    if (currentKeys.has(sourceKey) || !entry.anchors.length) continue
    if (canDeleteMissing) {
      deleted += entry.anchors.length
      continue
    }
    anchors.push(...entry.anchors)
    skipped += entry.anchors.length
    retainedMissing += entry.anchors.length
  }
  log(`Warfarin story bundle set diff: previousEntries=${previousByKey.size} currentKeys=${currentKeys.size} completeRun=${isCompleteCategoryRun} emptyCategories=${emptyCategories.join(',') || 'none'} deleted=${deleted} retainedMissing=${retainedMissing}`)
}

if (!anchors.length) throw new Error(`No Warfarin story text anchors were generated. ${failures.join(' | ')}`)

if (incremental) {
  // 列表集合差里既没有新条目也没有下架条目 → 内容与上一版一致，不发布资产。
  if (refreshed === 0 && deleted === 0) {
    await mkdir(outDir, { recursive: true })
    await discardPublishedArtifacts()
    await writeFile(joinPath(outDir, 'skipped.json'), JSON.stringify({ skipped: true, mode: 'incremental', sourceUpdatedAt, success: anchors.length, reused, deleted }, null, 2))
    log(`Warfarin story bundle unchanged: mode=incremental count=${anchors.length} reused=${reused} new=0 deleted=0 sourceUpdatedAt=${sourceUpdatedAt} elapsed=${elapsed()}`)
    console.log(JSON.stringify({ skipped: true, mode: 'incremental', sourceUpdatedAt, success: anchors.length, reused, deleted }, null, 2))
    process.exit(0)
  }
} else if (process.env.STORY_FORCE_UPDATE !== '1' && previousManifest?.sha256 && refreshed === 0 && failed === 0) {
  await mkdir(outDir, { recursive: true })
  await discardPublishedArtifacts()
  await writeFile(joinPath(outDir, 'skipped.json'), JSON.stringify({ skipped: true, mode: 'full', sourceUpdatedAt, success: anchors.length }, null, 2))
  log(`Warfarin story bundle unchanged: count=${anchors.length} sourceUpdatedAt=${sourceUpdatedAt} elapsed=${elapsed()}`)
  console.log(JSON.stringify({ skipped: true, sourceUpdatedAt, success: anchors.length }, null, 2))
  process.exit(0)
}

const { sha256 } = await writeBundle(anchors, { success: anchors.length, failed, skipped, pending: 0, refreshed, reused, deleted })
log(`Warfarin story bundle done: mode=${incremental ? 'incremental' : 'full'} count=${anchors.length} reused=${reused} new=${refreshed} skipped=${skipped} deleted=${deleted} failed=${failed} elapsed=${elapsed()}`)
console.log(JSON.stringify({ outDir, filename, manifestName, count: anchors.length, sourceUpdatedAt, sha256, mode: incremental ? 'incremental' : 'full', reused, refreshed, skipped, deleted, failed }, null, 2))

async function fetchSourceUpdatedAt(lang) {
  const html = await fetchText(`https://warfarin.wiki/${lang}`)
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const match = text.match(/最后更新\s*[:：]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/)
    || text.match(/Last updated\s*[:：]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i)
  if (!match) throw new Error('Could not find Warfarin source update date on homepage.')
  return match[1]
}

async function fetchSlugs(lang, category) {
  const payload = await fetchJson(`https://api.warfarin.wiki/v1/${lang}/${apiCategory(category)}`)
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []
  const slugs = new Set(list.map(item => String(item?.slug || item?.id || '').trim()).filter(Boolean))
  return Array.from(slugs).sort()
}

async function fetchDetail(lang, category, slug) {
  const payload = await fetchJson(`https://api.warfarin.wiki/v1/${lang}/${apiCategory(category)}/${encodeURIComponent(slug)}`)
  return payload?.data || payload
}

async function fetchPreviousBundle(manifest) {
  const url = String(manifest?.url || '').trim()
  if (!url) return []
  const compressed = await readBuffer(await fetchWithTimeout(url))
  if (manifest?.sha256 && createHash('sha256').update(compressed).digest('hex') !== manifest.sha256) return []
  const payload = JSON.parse(gunzipSync(compressed).toString('utf8'))
  return Array.isArray(payload) ? payload : Array.isArray(payload?.anchors) ? payload.anchors : []
}

function groupPreviousAnchors(anchors) {
  const map = new Map()
  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const key = String(anchor?.source_key || '').trim()
    const rawSha256 = String(anchor?.raw_sha256 || '').trim()
    if (!key || !rawSha256) continue
    const entry = map.get(key) || { raw_sha256: rawSha256, anchors: [] }
    entry.anchors.push(anchor)
    map.set(key, entry)
  }
  return map
}

function parseCategories(value) {
  const list = String(value || '').split(',').map(item => item.trim()).filter(Boolean)
  return list.length ? list : [
    'documents', 'missions', 'baker', 'tutorials',
    'operators', 'weapons', 'enemies', 'facilities',
    'items', 'gear', 'medals', 'lorev2',
  ]
}

function apiCategory(category) {
  return String(category || '').trim()
}

function normalizeScope(category) {
  const scope = String(category || '').trim().toLowerCase()
  return scope === 'lorev2' ? 'lore' : scope
}

function normalizeLanguage(value) {
  return String(value || 'cn').trim().toLowerCase() || 'cn'
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function shouldPublishBundledSeed(manifest) {
  if (process.env.STORY_FORCE_UPDATE === '1' || process.env.STORY_FORCE_DEEP_CHECK === '1') return false
  if (process.env.STORY_USE_BUNDLED_SEED === '1') return true
  if (!manifest) return false
  if (normalizeLanguage(manifest.language || language) !== language) return false
  // 上一版包明显不完整（少于随包种子）时，发布种子是恢复手段；否则解析器升级必须真爬一遍，
  // 避免把缺少新字段（如武器 weaponDesc）的旧种子当成新包推上去。
  if (Number(manifest.parserVersion || 0) < parserVersion) {
    const previousCount = Number(manifest.count || 0)
    if (previousCount > 0 && previousCount < bundledStorySeedCount) return true
    return bundledStorySeedVersion >= parserVersion
  }
  return Number(manifest.count || 0) > 0 && Number(manifest.count || 0) < bundledStorySeedCount
}

function shouldSkipUnchanged(manifest) {
  if (process.env.STORY_FORCE_UPDATE === '1' || process.env.STORY_FORCE_DEEP_CHECK === '1') return false
  if (Number(manifest?.parserVersion || 0) < parserVersion) return false
  if (!manifest?.sourceUpdatedAt || manifest.sourceUpdatedAt !== sourceUpdatedAt) return false
  return Number(manifest.count || 0) >= bundledStorySeedCount
}

function shouldDelaySourceUpdate(manifest) {
  if (process.env.STORY_FORCE_UPDATE === '1' || process.env.STORY_FORCE_DEEP_CHECK === '1') return false
  if (!sourceUpdateDelayHours || !manifest?.sourceUpdatedAt || manifest.sourceUpdatedAt === sourceUpdatedAt) return false
  if (String(sourceUpdatedAt) <= String(manifest.sourceUpdatedAt)) return false
  const sourceMs = Date.parse(`${sourceUpdatedAt}T00:00:00.000Z`)
  if (!Number.isFinite(sourceMs) || !Number.isFinite(nowMs)) return false
  return nowMs - sourceMs < sourceUpdateDelayHours * 60 * 60 * 1000
}

function shouldReusePreviousBundle(manifest) {
  return Number(manifest?.parserVersion || 0) >= parserVersion
}

// 增量模式下命中上一版同 key 条目时直接复用其锚点，不为它发详情请求。
function reusePreviousEntry(incremental, sourceKey, previousByKey) {
  if (!incremental) return null
  const entry = previousByKey.get(sourceKey)
  return entry?.anchors?.length ? entry : null
}

// 自托管 runner 的 artifacts/ 跨次留存：写 skipped.json 时上一轮的包可能还在，
// workflow 的「没有 gz 就不上传」判断就会把旧包当新资产发出去。跳过发布前必须清掉。
async function discardPublishedArtifacts() {
  await Promise.all([
    rm(joinPath(outDir, filename), { force: true }),
    rm(joinPath(outDir, manifestName), { force: true }),
  ])
}

async function writeBundle(anchors, sourceReport) {
  const compressed = gzipSync(JSON.stringify(anchors), { level: 9 })
  const sha256 = createHash('sha256').update(compressed).digest('hex')
  const manifest = {
    schemaVersion: 1,
    parserVersion,
    language,
    count: anchors.length,
    updatedAt: new Date().toISOString(),
    sourceUpdatedAt,
    sha256,
    filename,
    url: bundleUrl,
    source: 'warfarin.wiki',
    sourceReport,
    entries: anchors.map(anchor => ({ key: anchor.source_key, rawSha256: anchor.raw_sha256 })).filter(entry => entry.key && entry.rawSha256),
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(joinPath(outDir, filename), compressed)
  await writeFile(joinPath(outDir, manifestName), JSON.stringify(manifest, null, 2))
  return { sha256, manifest }
}

function isBundleAnchor(anchor) {
  return anchor && typeof anchor.anchor_id === 'string' && typeof anchor.content === 'string' && typeof anchor.source === 'string'
}

async function mapWithConcurrency(items, limit, worker, spacingMs, onResult) {
  const results = new Array(items.length)
  let next = 0
  let lastStart = 0
  async function run() {
    while (next < items.length) {
      const index = next++
      if (spacingMs && lastStart) {
        const wait = Math.max(0, spacingMs - (Date.now() - lastStart))
        if (wait) await sleep(wait)
      }
      lastStart = Date.now()
      results[index] = await worker(items[index], index)
      onResult?.(results[index], index, items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

async function readBuffer(response) {
  if (response && typeof response.arrayBuffer === 'function') return Buffer.from(await response.arrayBuffer())
  return Buffer.from(await response.text(), 'binary')
}

async function fetchJson(url) {
  const isWarfarinApi = String(url).startsWith('https://api.warfarin.wiki/')
  if (process.env.STORY_API_FETCHER === 'chrome' && isWarfarinApi) {
    return fetchJsonWithChrome(url)
  }
  try {
    const response = await fetchWithTimeout(url)
    return response.json()
  } catch (error) {
    if (process.env.STORY_API_FETCHER !== 'fetch' && isWarfarinApi) {
      log(`Warfarin story bundle chrome fallback: ${url} reason=${error instanceof Error ? error.message : String(error)}`)
      return fetchJsonWithChrome(url)
    }
    throw error
  }
}

async function fetchJsonWithChrome(url) {
  const html = await fetchTextWithChrome(url)
  return JSON.parse(extractJsonFromDocument(html))
}

async function fetchText(url) {
  if (process.env.STORY_HTML_FETCHER !== 'fetch' && String(url).startsWith('https://warfarin.wiki/')) {
    return fetchTextWithChrome(url)
  }
  const response = await fetchWithTimeout(url)
  return response.text()
}

async function fetchTextWithChrome(url) {
  const candidates = process.env.STORY_CHROME_BIN
    ? [process.env.STORY_CHROME_BIN]
    : ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']
  const errors = []
  for (const bin of candidates) {
    try {
      return await runChromeDump(bin, url)
    } catch (error) {
      errors.push(`${bin}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Could not fetch ${url} with headless Chrome. ${errors.join(' | ')}`)
}

function runChromeDump(bin, url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      // Keep Chrome off the session-bus SecretService: where gnome-keyring-daemon owns
      // org.freedesktop.secrets without answering, the default password store blocks each
      // launch for the 25s D-Bus default timeout. Puppeteer passes both flags for this reason.
      '--password-store=basic',
      '--use-mock-keychain',
      '--lang=zh-CN',
      `--user-agent=${browserUserAgent}`,
      '--dump-dom',
      url,
    ]
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0 && stdout.trim()) return resolve(stdout)
      reject(new Error(`exited ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}`))
    })
  })
}

function extractJsonFromDocument(input) {
  const text = String(input || '').trim()
  if (text.startsWith('{') || text.startsWith('[')) return text
  const pre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  const body = pre ? pre[1] : text.replace(/<[^>]*>/g, ' ')
  return decodeHtml(body).trim()
}

function decodeHtml(input) {
  return String(input || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

async function fetchWithTimeout(url) {
  if (process.env.STORY_GITHUB_FETCHER === 'curl' && isGitHubReleaseDownload(url)) {
    return fetchWithCurl(url)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: requestHeaders(url) })
    if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`)
    return response
  } finally {
    clearTimeout(timer)
  }
}

function fetchWithCurl(url) {
  return new Promise((resolve, reject) => {
    const args = ['-fsSL', '--retry', '2', '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))), url]
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    let stderr = ''
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) return resolve(bufferResponse(Buffer.concat(stdout)))
      reject(new Error(`curl ${url} exited ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}`))
    })
  })
}

function bufferResponse(buffer) {
  return {
    ok: true,
    status: 200,
    async text() { return buffer.toString('utf8') },
    async json() { return JSON.parse(buffer.toString('utf8')) },
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) },
  }
}

function isGitHubReleaseDownload(url) {
  return String(url || '').startsWith(`https://github.com/${repository}/releases/download/`)
}

function requestHeaders(url) {
  const isPage = String(url).startsWith('https://warfarin.wiki/')
  if (!isPage) {
    return {
      'User-Agent': browserUserAgent,
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
  }
  return {
    'User-Agent': browserUserAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: 'https://warfarin.wiki/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
  }
}

function joinPath(...parts) {
  return parts.join('/').replace(/\/+/g, '/')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function elapsed() {
  return `${Math.round((Date.now() - startedAt) / 1000)}s`
}
