import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { WarfarinWikiAnchor, WarfarinWikiContextResult, WarfarinWikiSearchResult } from './warfarin-wiki'
import { bundledStorySeedLanguage, loadBundledStorySeed } from './warfarin-story-seed'

export interface WarfarinStorySearchOptions {
  baseDir: string
  dataDirectory: string
  language: string
  timeoutMs: number
  bundleManifestUrl?: string
  fetch?: (url: string, init?: Record<string, any>) => Promise<any>
}

export interface WarfarinStoryUpdateReport {
  success: number
  failed: number
  skipped: number
  pending: number
  refreshed: number
  updatedAt: string
}

interface StoryAnchor extends WarfarinWikiAnchor {
  full_text: WarfarinWikiContextResult['full_text']
  source_ref: string
}

export class WarfarinStorySearchService {
  private readonly root: string
  private readonly language: string
  private readonly timeoutMs: number
  private readonly bundleManifestUrl: string
  private readonly fetchImpl: (url: string, init?: Record<string, any>) => Promise<any>
  private anchors: StoryAnchor[] = []
  private loaded = false

  constructor(options: WarfarinStorySearchOptions) {
    this.root = isAbsolute(options.dataDirectory) ? options.dataDirectory : resolve(options.baseDir, options.dataDirectory)
    this.language = normalizeLanguage(options.language)
    this.timeoutMs = Math.max(1000, options.timeoutMs || 10000)
    this.bundleManifestUrl = String(options.bundleManifestUrl || '').trim()
    this.fetchImpl = options.fetch || defaultFetch
  }

  async load() {
    const dir = this.anchorsDir()
    const files = await readdir(dir).catch(() => [])
    const anchors: StoryAnchor[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const payload = await readFile(join(dir, file), 'utf8').then(JSON.parse).catch(() => null)
      if (Array.isArray(payload)) anchors.push(...payload.filter(isStoryAnchor))
      else if (isStoryAnchor(payload)) anchors.push(payload)
    }
    if (!anchors.length) anchors.push(...await this.installBundledSeed())
    this.anchors = anchors
    this.loaded = true
  }

  async search(input: { keyword: string }): Promise<WarfarinWikiSearchResult> {
    await this.ensureLoaded()
    const keyword = normalizeKeyword(input.keyword)
    if (!keyword) return { results: [], total: 0, took_ms: 0 }
    const started = Date.now()
    const needle = keyword.toLowerCase()
    const results = this.anchors
      .map((anchor) => ({ anchor, score: scoreStoryAnchor(anchor, needle) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ anchor, score }) => ({
        anchor_id: anchor.anchor_id,
        content: excerptAroundKeyword(anchor.content, keyword, 160),
        source: anchor.source,
        scope: anchor.scope,
        relevance: score,
      }))
    return { results, total: results.length, took_ms: Date.now() - started }
  }

  async context(input: { anchorId: string }): Promise<WarfarinWikiContextResult> {
    await this.ensureLoaded()
    const anchor = this.anchors.find((item) => item.anchor_id === input.anchorId)
    if (!anchor) throw new Error(`anchor_id '${input.anchorId}' not found`)
    return {
      anchor,
      full_text: anchor.full_text,
      summary: null,
      source_ref: anchor.source_ref || anchor.source,
    }
  }

  async update(): Promise<WarfarinStoryUpdateReport> {
    if (this.bundleManifestUrl) {
      const report = await this.updateFromBundle().catch(() => undefined)
      if (report) return report
    }
    const updatedAt = new Date().toISOString()
    await this.load()
    return { success: this.anchors.length, failed: 0, skipped: this.anchors.length, pending: 0, refreshed: 0, updatedAt }
  }

  get size() {
    return this.anchors.length
  }

  private async ensureLoaded() {
    if (!this.loaded) await this.load()
  }

  private async installBundledSeed() {
    if (this.language !== bundledStorySeedLanguage) return []
    const anchors = loadBundledStorySeed().filter(isStoryAnchor)
    if (!anchors.length) return []
    await mkdir(this.anchorsDir(), { recursive: true })
    for (const anchor of anchors) {
      const slug = anchor.anchor_id.split('_')[0]
      if (!slug) continue
      await writeFile(join(this.anchorsDir(), `${slug}.json`), JSON.stringify(anchor, null, 2))
    }
    const updatedAt = new Date().toISOString()
    await mkdir(join(this.root, this.language), { recursive: true })
    await writeFile(join(this.root, this.language, 'manifest.json'), JSON.stringify({ language: this.language, updatedAt, seeded: anchors.length }, null, 2))
    return anchors
  }

  private async updateFromBundle(): Promise<WarfarinStoryUpdateReport | undefined> {
    const manifest = await readJson<any>(await this.fetchWithTimeout(this.bundleManifestUrl))
    if (normalizeLanguage(manifest?.language || this.language) !== this.language) return undefined
    const bundleUrl = String(manifest?.url || deriveBundleUrl(this.bundleManifestUrl)).trim()
    if (!bundleUrl) return undefined
    const localManifest = await this.readLocalManifest()
    if (manifest?.sha256 && localManifest?.storyBundleSha256 === manifest.sha256) {
      await this.load()
      const updatedAt = new Date().toISOString()
      return { success: this.anchors.length, failed: 0, skipped: this.anchors.length, pending: 0, refreshed: 0, updatedAt }
    }
    const compressed = await readBuffer(await this.fetchWithTimeout(bundleUrl))
    const sha256 = createHash('sha256').update(compressed).digest('hex')
    if (manifest?.sha256 && sha256 !== manifest.sha256) throw new Error('story bundle sha256 mismatch')
    const payload = JSON.parse(gunzipSync(compressed).toString('utf8'))
    const anchors = (Array.isArray(payload) ? payload : payload?.anchors || []).filter(isStoryAnchor)
    if (!anchors.length) throw new Error('story bundle has no usable anchors')
    await mkdir(this.anchorsDir(), { recursive: true })
    for (const anchor of anchors) {
      const slug = anchor.anchor_id.split('_')[0]
      if (!slug) continue
      await writeFile(join(this.anchorsDir(), `${slug}.json`), JSON.stringify(anchor, null, 2))
    }
    this.anchors = anchors
    this.loaded = true
    const updatedAt = new Date().toISOString()
    await mkdir(join(this.root, this.language), { recursive: true })
    await writeFile(join(this.root, this.language, 'manifest.json'), JSON.stringify({ language: this.language, updatedAt, success: anchors.length, failed: 0, skipped: 0, pending: 0, refreshed: anchors.length, storyBundleSha256: sha256, storyBundleUpdatedAt: manifest?.updatedAt || '' }, null, 2))
    return { success: anchors.length, failed: 0, skipped: 0, pending: 0, refreshed: anchors.length, updatedAt }
  }

  private async readLocalManifest() {
    return readFile(join(this.root, this.language, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null)
  }

  private async fetchWithTimeout(url: string) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined
    try {
      return await this.fetchImpl(url, { method: 'GET', signal: controller?.signal })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private anchorsDir() {
    return join(this.root, this.language, 'anchors')
  }
}

export function createStoryAnchorFromMission(slug: string, data: any): StoryAnchor {
  const texts: string[] = []
  const fullText: WarfarinWikiContextResult['full_text'] = []
  const mission = data?.mission || {}
  for (const value of [mission.name, mission.description]) {
    const text = stripTags(value || '')
    if (text) texts.push(text)
  }
  for (const entry of Array.isArray(data?.dialog) ? data.dialog : []) {
    const text = stripTags(entry?.dialogText || entry?.optionText || '')
    if (!text) continue
    const speaker = entry?.optionText ? '选项' : stripTags(entry?.actorName || '') || '旁白'
    texts.push(`${speaker}：${text}`)
    fullText.push({ speaker, text })
  }
  for (const radio of Array.isArray(data?.radios) ? data.radios : []) {
    for (const message of Array.isArray(radio?.messages) ? radio.messages : []) {
      const text = stripTags(message?.radioText || '')
      if (!text) continue
      const speaker = stripTags(message?.actorName || '') || '通讯'
      texts.push(`通讯中 / ${speaker}：${text}`)
      fullText.push({ scene: '通讯中', speaker, text })
    }
  }
  const name = stripTags(mission.name || '') || slug
  const source = `任务剧情：${name}`
  return {
    anchor_id: `${slug}_0`,
    content: texts.join('\n'),
    source,
    source_ref: source,
    scope: 'missions',
    relevance: 1,
    full_text: fullText,
  }
}

function scoreStoryAnchor(anchor: StoryAnchor, needle: string) {
  const source = anchor.source.toLowerCase()
  const content = anchor.content.toLowerCase()
  if (source.includes(needle)) return 100
  if (content.includes(needle)) return 50
  return 0
}

function isStoryAnchor(value: any): value is StoryAnchor {
  return value && typeof value.anchor_id === 'string' && typeof value.content === 'string' && typeof value.source === 'string'
}

function stripTags(text: string) {
  return String(text || '').replace(/<image>[^<]*<\/image>/gi, '').replace(/<[^>]*>/g, '').trim()
}

function normalizeLanguage(language: unknown) {
  const normalized = String(language || 'cn').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  return normalized || 'cn'
}

function normalizeKeyword(keyword: string) {
  return String(keyword || '').trim().replace(/\s+/g, ' ')
}

function excerptAroundKeyword(text: string, keyword: string, maxLength: number) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  const index = normalized.toLowerCase().indexOf(keyword.toLowerCase())
  if (index < 0) return `${normalized.slice(0, maxLength - 1)}...`
  const half = Math.floor((maxLength - keyword.length) / 2)
  const start = Math.max(0, index - half)
  const end = Math.min(normalized.length, start + maxLength)
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${end < normalized.length ? '...' : ''}`
}

async function readJson<T>(response: any): Promise<T> {
  if (response && typeof response.json === 'function') return response.json()
  return response as T
}

async function readBuffer(response: any): Promise<Buffer> {
  if (response && typeof response.arrayBuffer === 'function') return Buffer.from(await response.arrayBuffer())
  if (Buffer.isBuffer(response)) return response
  if (response instanceof Uint8Array) return Buffer.from(response)
  return Buffer.from(String(response || ''))
}

function deriveBundleUrl(manifestUrl: string) {
  return manifestUrl.endsWith('.manifest.json') ? manifestUrl.slice(0, -'.manifest.json'.length) + '.json.gz' : ''
}

async function defaultFetch(url: string, init?: Record<string, any>) {
  if (typeof fetch !== 'function') throw new Error('global fetch is not available')
  return fetch(url, init as RequestInit)
}
