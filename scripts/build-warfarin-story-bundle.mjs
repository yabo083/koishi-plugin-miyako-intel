#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { createWarfarinAnchorsFromDetail } from '../lib/services/warfarin-story-search.js'
import { bundledStorySeedCount, loadBundledStorySeed } from '../lib/services/warfarin-story-seed.js'

const language = process.env.STORY_LANGUAGE || 'cn'
const repository = process.env.GITHUB_REPOSITORY || 'yabo083/koishi-plugin-miyako-intel'
const releaseTag = process.env.STORY_RELEASE_TAG || 'warfarin-story-latest'
const rateLimitMs = Number(process.env.STORY_UPDATE_RATE_LIMIT_MS || 150)
const concurrency = Math.max(1, Number(process.env.STORY_UPDATE_CONCURRENCY || 4))
const timeoutMs = Number(process.env.STORY_UPDATE_TIMEOUT_MS || 30000)
const progressEvery = Math.max(1, Number(process.env.STORY_PROGRESS_EVERY || 25))
const progressIntervalMs = Math.max(1000, Number(process.env.STORY_PROGRESS_INTERVAL_MS || 15000))
const outDir = resolve(process.argv[2] || 'artifacts/warfarin-story')
const filename = `warfarin-story-${language}.json.gz`
const manifestName = `warfarin-story-${language}.manifest.json`
const bundleUrl = `https://github.com/${repository}/releases/download/${releaseTag}/${filename}`
const manifestUrl = `https://github.com/${repository}/releases/download/${releaseTag}/${manifestName}`
const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const categories = parseCategories(process.env.STORY_CATEGORIES)
const startedAt = Date.now()

log(`Warfarin story bundle start: language=${language} categories=${categories.join(',')} concurrency=${concurrency} rateLimitMs=${rateLimitMs} timeoutMs=${timeoutMs}`)
const sourceUpdatedAt = await fetchSourceUpdatedAt(language)
log(`Warfarin story bundle source date: ${sourceUpdatedAt}`)
const previousManifest = await fetchJson(manifestUrl).catch(() => null)
const previousBundle = await fetchPreviousBundle(previousManifest).catch(() => [])
const previousByKey = groupPreviousAnchors(previousBundle)
log(`Warfarin story bundle previous: manifest=${previousManifest?.sha256 ? 'yes' : 'no'} anchors=${previousBundle.length} reusableEntries=${previousByKey.size}`)
if (shouldPublishBundledSeed(previousManifest)) {
  const seedAnchors = loadBundledStorySeed().filter(isBundleAnchor)
  if (!seedAnchors.length) throw new Error('bundled story seed has no usable anchors')
  log(`Warfarin story bundle bundled seed publish: previousCount=${Number(previousManifest?.count || 0)} seedCount=${seedAnchors.length} elapsed=${elapsed()}`)
  await writeBundle(seedAnchors, { success: seedAnchors.length, failed: 0, skipped: 0, pending: 0, refreshed: seedAnchors.length })
  process.exit(0)
}
if (shouldSkipUnchanged(previousManifest)) {
  await mkdir(outDir, { recursive: true })
  await writeFile(joinPath(outDir, 'skipped.json'), JSON.stringify({ skipped: true, sourceUpdatedAt, success: Number(previousManifest.count || 0) }, null, 2))
  log(`Warfarin story bundle unchanged: count=${Number(previousManifest.count || 0)} sourceUpdatedAt=${sourceUpdatedAt} elapsed=${elapsed()}`)
  console.log(JSON.stringify({ skipped: true, sourceUpdatedAt, success: Number(previousManifest.count || 0) }, null, 2))
  process.exit(0)
}
const anchors = []
let failed = 0
let skipped = 0
let refreshed = 0
const failures = []

for (const category of categories) {
  const slugs = await fetchSlugs(language, category)
  log(`Warfarin story bundle category start: ${category} slugs=${slugs.length}`)
  const categoryStats = { done: 0, failed: 0, skipped: 0, refreshed: 0, lastLogAt: Date.now() }
  const results = await mapWithConcurrency(slugs, concurrency, async (slug) => {
    try {
      const data = await fetchDetail(language, category, slug)
      const rawSha256 = hashJson(data)
      const sourceKey = `${normalizeScope(category)}/${slug}`
      const previous = previousByKey.get(sourceKey)
      if (previous?.raw_sha256 === rawSha256) return { skipped: true, anchors: previous.anchors }
      const nextAnchors = createWarfarinAnchorsFromDetail(category, slug, data).map(anchor => ({ ...anchor, source_key: sourceKey, raw_sha256: rawSha256 }))
      return { skipped: false, anchors: nextAnchors }
    } catch (error) {
      return { error: `${category}/${slug}: ${error instanceof Error ? error.message : String(error)}` }
    }
  }, rateLimitMs, (result) => {
    categoryStats.done++
    if (result?.error) categoryStats.failed++
    else if (result?.skipped) categoryStats.skipped += result.anchors?.length || 0
    else categoryStats.refreshed += result?.anchors?.length || 0
    const now = Date.now()
    if (categoryStats.done === slugs.length || categoryStats.done % progressEvery === 0 || now - categoryStats.lastLogAt >= progressIntervalMs) {
      categoryStats.lastLogAt = now
      log(`Warfarin story bundle progress: category=${category} ${categoryStats.done}/${slugs.length} refreshed=${categoryStats.refreshed} skipped=${categoryStats.skipped} failed=${categoryStats.failed} elapsed=${elapsed()}`)
    }
  })
  for (const result of results) {
    if (result?.error) {
      failed++
      if (failures.length < 5) failures.push(result.error)
      continue
    }
    anchors.push(...(result?.anchors || []))
    if (result?.skipped) skipped += result.anchors?.length || 0
    else refreshed += result?.anchors?.length || 0
  }
  log(`Warfarin story bundle category done: ${category} anchors=${anchors.length} refreshed=${refreshed} skipped=${skipped} failed=${failed} elapsed=${elapsed()}`)
}

if (!anchors.length) throw new Error(`No Warfarin story text anchors were generated. ${failures.join(' | ')}`)

if (process.env.STORY_FORCE_UPDATE !== '1' && previousManifest?.sha256 && refreshed === 0 && failed === 0) {
  await mkdir(outDir, { recursive: true })
  await writeFile(joinPath(outDir, 'skipped.json'), JSON.stringify({ skipped: true, sourceUpdatedAt, success: anchors.length }, null, 2))
  log(`Warfarin story bundle unchanged: count=${anchors.length} sourceUpdatedAt=${sourceUpdatedAt} elapsed=${elapsed()}`)
  console.log(JSON.stringify({ skipped: true, sourceUpdatedAt, success: anchors.length }, null, 2))
  process.exit(0)
}

const { sha256 } = await writeBundle(anchors, { success: anchors.length, failed, skipped, pending: 0, refreshed })
log(`Warfarin story bundle done: count=${anchors.length} refreshed=${refreshed} skipped=${skipped} failed=${failed} elapsed=${elapsed()}`)
console.log(JSON.stringify({ outDir, filename, manifestName, count: anchors.length, sourceUpdatedAt, sha256 }, null, 2))

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
  return Number(manifest.count || 0) > 0 && Number(manifest.count || 0) < bundledStorySeedCount
}

function shouldSkipUnchanged(manifest) {
  if (process.env.STORY_FORCE_UPDATE === '1' || process.env.STORY_FORCE_DEEP_CHECK === '1') return false
  if (!manifest?.sourceUpdatedAt || manifest.sourceUpdatedAt !== sourceUpdatedAt) return false
  return Number(manifest.count || 0) >= bundledStorySeedCount
}

async function writeBundle(anchors, sourceReport) {
  const compressed = gzipSync(JSON.stringify(anchors), { level: 9 })
  const sha256 = createHash('sha256').update(compressed).digest('hex')
  const manifest = {
    schemaVersion: 1,
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
