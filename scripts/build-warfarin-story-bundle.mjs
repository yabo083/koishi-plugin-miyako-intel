#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createStoryAnchorFromMission } from '../lib/services/warfarin-story-search.js'

const language = process.env.STORY_LANGUAGE || 'cn'
const repository = process.env.GITHUB_REPOSITORY || 'yabo083/koishi-plugin-miyako-intel'
const releaseTag = process.env.STORY_RELEASE_TAG || 'warfarin-story-latest'
const rateLimitMs = Number(process.env.STORY_UPDATE_RATE_LIMIT_MS || 500)
const timeoutMs = Number(process.env.STORY_UPDATE_TIMEOUT_MS || 30000)
const outDir = resolve(process.argv[2] || 'artifacts/warfarin-story')
const filename = `warfarin-story-${language}.json.gz`
const manifestName = `warfarin-story-${language}.manifest.json`
const bundleUrl = `https://github.com/${repository}/releases/download/${releaseTag}/${filename}`
const manifestUrl = `https://github.com/${repository}/releases/download/${releaseTag}/${manifestName}`

const sourceUpdatedAt = await fetchSourceUpdatedAt(language)
const previousManifest = await fetchJson(manifestUrl).catch(() => null)
if (process.env.STORY_FORCE_UPDATE !== '1' && previousManifest?.sourceUpdatedAt === sourceUpdatedAt) {
  await mkdir(outDir, { recursive: true })
  await writeFile(joinPath(outDir, 'skipped.json'), JSON.stringify({ skipped: true, sourceUpdatedAt }, null, 2))
  console.log(JSON.stringify({ skipped: true, sourceUpdatedAt }, null, 2))
  process.exit(0)
}

const slugs = await fetchMissionSlugs(language)
const anchors = []
let failed = 0
for (const slug of slugs) {
  try {
    const data = await fetchMission(language, slug)
    anchors.push(createStoryAnchorFromMission(slug, data))
  } catch {
    failed++
  }
  if (rateLimitMs) await sleep(rateLimitMs)
}

if (!anchors.length) throw new Error('No Warfarin story text anchors were generated.')

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
  sourceReport: { success: anchors.length, failed, skipped: 0, pending: 0, refreshed: 0 },
}

await mkdir(outDir, { recursive: true })
await writeFile(joinPath(outDir, filename), compressed)
await writeFile(joinPath(outDir, manifestName), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ outDir, filename, manifestName, count: anchors.length, sourceUpdatedAt, sha256 }, null, 2))

async function fetchSourceUpdatedAt(lang) {
  const html = await fetchText(`https://warfarin.wiki/${lang}`)
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const match = text.match(/最后更新\s*[:：]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/)
    || text.match(/Last updated\s*[:：]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i)
  if (!match) throw new Error('Could not find Warfarin source update date on homepage.')
  return match[1]
}

async function fetchMissionSlugs(lang) {
  const html = await fetchText(`https://warfarin.wiki/${lang}/missions/`)
  const slugs = new Set()
  const regex = new RegExp(`href="/${lang}/missions/([^"<>]+)"`, 'g')
  let match
  while ((match = regex.exec(html))) slugs.add(decodeURIComponent(match[1]))
  return Array.from(slugs).sort()
}

async function fetchMission(lang, slug) {
  const payload = await fetchJson(`https://api.warfarin.wiki/v1/${lang}/missions/${encodeURIComponent(slug)}`)
  return payload?.data || payload
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url)
  return response.json()
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url)
  return response.text()
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
      'User-Agent': 'miyako-intel-story-bundle',
      Accept: 'application/json,text/plain,*/*',
    }
  }
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
