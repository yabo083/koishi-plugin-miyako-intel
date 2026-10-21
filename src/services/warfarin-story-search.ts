import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { WarfarinWikiAnchor, WarfarinWikiContextResult, WarfarinWikiSearchResult, foldVariantDuplicates } from './warfarin-wiki'
import { bundledStorySeedCount, bundledStorySeedLanguage, bundledStorySeedVersion, loadBundledStorySeed } from './warfarin-story-seed'

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
  warning?: string
}

// 锚点形状由运行时检索与构建期 ETL（warfarin-story-parsers）共用，故对外导出而非私有。
export interface StoryAnchor extends WarfarinWikiAnchor {
  full_text: WarfarinWikiContextResult['full_text']
  source_ref: string
  source_key?: string
  raw_sha256?: string
}

export class WarfarinStorySearchService {
  private readonly root: string
  private readonly language: string
  private readonly timeoutMs: number
  private readonly bundleManifestUrl: string
  private readonly fetchImpl: (url: string, init?: Record<string, any>) => Promise<any>
  private anchors: StoryAnchor[] = []
  private loaded = false
  private loading?: Promise<void>

  constructor(options: WarfarinStorySearchOptions) {
    this.root = isAbsolute(options.dataDirectory) ? options.dataDirectory : resolve(options.baseDir, options.dataDirectory)
    this.language = normalizeLanguage(options.language)
    this.timeoutMs = Math.max(1000, options.timeoutMs || 10000)
    this.bundleManifestUrl = String(options.bundleManifestUrl || '').trim()
    this.fetchImpl = options.fetch || defaultFetch
  }

  async load() {
    if (this.loading) return this.loading
    this.loading = this.loadAnchors().finally(() => {
      this.loading = undefined
    })
    return this.loading
  }

  private async loadAnchors() {
    const dir = this.anchorsDir()
    const files = await readdir(dir).catch(() => [])
    const anchors: StoryAnchor[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const payload = await readFile(join(dir, file), 'utf8').then(JSON.parse).catch(() => null)
      if (Array.isArray(payload)) anchors.push(...payload.filter(isStoryAnchor))
      else if (isStoryAnchor(payload)) anchors.push(payload)
    }
    const manifest = await this.readLocalManifest()
    if (!anchors.length || this.shouldReplaceWithBundledSeed(files, anchors.length, manifest)) {
      anchors.length = 0
      anchors.push(...await this.installBundledSeed())
    }
    this.anchors = anchors
    this.loaded = true
  }

  async search(input: { keyword: string }): Promise<WarfarinWikiSearchResult> {
    await this.ensureLoaded()
    const keyword = normalizeKeyword(input.keyword)
    if (!keyword) return { results: [], total: 0, took_ms: 0 }
    const started = Date.now()
    const needle = keyword.toLowerCase()
    const scored = this.anchors
      .map((anchor) => ({ anchor, score: scoreStoryAnchor(anchor, needle) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
    // 与官方搜索共用折叠规则：同"来源标签+正文"的变体折叠为一条并提示数量，不静默丢弃。
    const folded = foldVariantDuplicates(scored.map(({ anchor, score }) => ({
      ...anchor,
      source: displayStorySource(anchor),
      relevance: score,
    })))
    const results = folded.map((item) => ({
      anchor_id: item.anchor_id,
      content: excerptAroundKeyword(item.content, keyword, 160),
      source: item.source,
      scope: item.scope,
      relevance: item.relevance,
    }))
    return { results, total: results.length, took_ms: Date.now() - started }
  }

  async context(input: { anchorId: string }): Promise<WarfarinWikiContextResult> {
    await this.ensureLoaded()
    const anchor = this.anchors.find((item) => item.anchor_id === input.anchorId)
    if (!anchor) throw new Error(`anchor_id '${input.anchorId}' not found`)
    return {
      anchor: { ...anchor, source: displayStorySource(anchor) },
      full_text: anchor.full_text,
      summary: null,
      source_ref: displayStorySource(anchor) || anchor.source_ref,
    }
  }

  async update(): Promise<WarfarinStoryUpdateReport> {
    let warning = ''
    if (this.bundleManifestUrl) {
      const report = await this.updateFromBundle().catch((error) => {
        warning = formatUpdateWarning(error)
        return undefined
      })
      if (report) return report
    }
    const updatedAt = new Date().toISOString()
    await this.load()
    return { success: this.anchors.length, failed: warning ? 1 : 0, skipped: this.anchors.length, pending: 0, refreshed: 0, updatedAt, warning: warning || undefined }
  }

  get size() {
    return this.anchors.length
  }

  async getDataUpdatedLabel() {
    const manifest = await this.readLocalManifest()
    const value = formatStoryBundleDate(String(manifest?.storyBundleSourceUpdatedAt || manifest?.storyBundleUpdatedAt || '').trim())
    if (value) return value
    if (manifest?.bundledStorySeedVersion || manifest?.seeded) return '随包种子，未拉取远端合集'
    return ''
  }

  private async ensureLoaded() {
    if (!this.loaded) await this.load()
  }

  private async installBundledSeed() {
    if (this.language !== bundledStorySeedLanguage) return []
    const anchors = loadBundledStorySeed().filter(isStoryAnchor)
    if (!anchors.length) return []
    await rm(this.anchorsDir(), { recursive: true, force: true })
    await mkdir(this.anchorsDir(), { recursive: true })
    await writeFile(join(this.anchorsDir(), 'seed.json'), JSON.stringify(anchors, null, 2))
    const updatedAt = new Date().toISOString()
    await mkdir(join(this.root, this.language), { recursive: true })
    await writeFile(join(this.root, this.language, 'manifest.json'), JSON.stringify({ language: this.language, updatedAt, seeded: anchors.length, bundledStorySeedVersion, bundledStorySeedCount }, null, 2))
    return anchors
  }

  private async updateFromBundle(): Promise<WarfarinStoryUpdateReport | undefined> {
    const manifest = await readJson<any>(await this.fetchWithTimeout(this.bundleManifestUrl, { responseType: 'text' }))
    if (normalizeLanguage(manifest?.language || this.language) !== this.language) return undefined
    const bundleUrl = String(manifest?.url || deriveBundleUrl(this.bundleManifestUrl)).trim()
    if (!bundleUrl) return undefined
    const localManifest = await this.readLocalManifest()
    if (manifest?.sha256 && localManifest?.storyBundleSha256 === manifest.sha256) {
      await this.load()
      const updatedAt = new Date().toISOString()
      return { success: this.anchors.length, failed: 0, skipped: this.anchors.length, pending: 0, refreshed: 0, updatedAt }
    }
    const compressed = await readBuffer(await this.fetchWithTimeout(bundleUrl, { responseType: 'arraybuffer' }))
    const sha256 = createHash('sha256').update(compressed).digest('hex')
    if (manifest?.sha256 && sha256 !== manifest.sha256) throw new Error('story bundle sha256 mismatch')
    if (compressed.length < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
      const preview = compressed.slice(0, 64).toString('utf8').replace(/\s+/g, ' ').trim()
      throw new Error(`story bundle is not gzip (got ${compressed.length} bytes${preview ? `, starts with: ${preview}` : ''})`)
    }
    const payload = JSON.parse(gunzipSync(compressed).toString('utf8'))
    const anchors = (Array.isArray(payload) ? payload : payload?.anchors || []).filter(isStoryAnchor)
    if (!anchors.length) throw new Error('story bundle has no usable anchors')
    if (this.isOfficialBundle(manifest) && this.isOlderThanBundledSeed(anchors.length)) throw new Error(`story bundle is older than bundled seed: ${anchors.length} < ${bundledStorySeedCount}`)
    const anchorsDir = this.anchorsDir()
    await mkdir(anchorsDir, { recursive: true })
    // 先写临时文件再 rename：中途崩溃/写盘失败时旧的 bundle.json 仍然完好，
    // 不会出现「目录已被清空、新文件还没写完」的数据丢失窗口。
    const bundlePath = join(anchorsDir, 'bundle.json')
    const temporaryPath = `${bundlePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify(anchors, null, 2))
    await rename(temporaryPath, bundlePath)
    for (const file of await readdir(anchorsDir)) {
      if (file === 'bundle.json') continue
      await rm(join(anchorsDir, file), { force: true })
    }
    this.anchors = anchors
    this.loaded = true
    const updatedAt = new Date().toISOString()
    await mkdir(join(this.root, this.language), { recursive: true })
    await writeFile(join(this.root, this.language, 'manifest.json'), JSON.stringify({ language: this.language, updatedAt, success: anchors.length, failed: 0, skipped: 0, pending: 0, refreshed: anchors.length, storyBundleSha256: sha256, storyBundleUpdatedAt: manifest?.updatedAt || '', storyBundleSourceUpdatedAt: manifest?.sourceUpdatedAt || '' }, null, 2))
    return { success: anchors.length, failed: 0, skipped: 0, pending: 0, refreshed: anchors.length, updatedAt }
  }

  private async readLocalManifest() {
    return readFile(join(this.root, this.language, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null)
  }

  private shouldReplaceWithBundledSeed(files: string[], count: number, manifest: any) {
    if (this.language !== bundledStorySeedLanguage) return false
    if (files.includes('bundle.json')) return false
    if (manifest?.bundledStorySeedVersion !== bundledStorySeedVersion) return true
    return count < bundledStorySeedCount
  }

  private isOlderThanBundledSeed(count: number) {
    return this.language === bundledStorySeedLanguage && count < bundledStorySeedCount
  }

  private isOfficialBundle(manifest: any) {
    return String(manifest?.source || '').trim() === 'warfarin.wiki'
  }

  private async fetchWithTimeout(url: string, init: Record<string, any> = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined
    try {
      return await this.fetchImpl(url, { method: 'GET', ...init, signal: controller?.signal })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private anchorsDir() {
    return join(this.root, this.language, 'anchors')
  }
}

function scoreStoryAnchor(anchor: StoryAnchor, needle: string) {
  const source = anchor.source.toLowerCase()
  const content = anchor.content.toLowerCase()
  if (source.includes(needle)) return 100
  if (content.includes(needle)) return 50
  return 0
}

// 蓝图条目（"放置此蓝图后，输入…自动生产…"）与物品本体同名同标签，展示层区分为"生产蓝图"。
function displayStorySource(anchor: StoryAnchor) {
  if (anchor.scope === 'items' && /放置此蓝图后/.test(anchor.content || '')) {
    return anchor.source.replace(/^物品信息：/, '生产蓝图：')
  }
  return anchor.source
}

function isStoryAnchor(value: any): value is StoryAnchor {
  return value && typeof value.anchor_id === 'string' && typeof value.content === 'string' && typeof value.source === 'string'
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
  if (typeof response === 'string') return JSON.parse(response) as T
  if (Buffer.isBuffer(response)) return JSON.parse(response.toString('utf8')) as T
  if (response instanceof ArrayBuffer) return JSON.parse(Buffer.from(response).toString('utf8')) as T
  if (ArrayBuffer.isView(response)) return JSON.parse(Buffer.from(response.buffer, response.byteOffset, response.byteLength).toString('utf8')) as T
  return response as T
}

async function readBuffer(response: any): Promise<Buffer> {
  if (response && typeof response.arrayBuffer === 'function') return Buffer.from(await response.arrayBuffer())
  if (Buffer.isBuffer(response)) return response
  if (response instanceof ArrayBuffer) return Buffer.from(response)
  if (ArrayBuffer.isView(response)) return Buffer.from(response.buffer, response.byteOffset, response.byteLength)
  return Buffer.from(String(response || ''))
}

function deriveBundleUrl(manifestUrl: string) {
  return manifestUrl.endsWith('.manifest.json') ? manifestUrl.slice(0, -'.manifest.json'.length) + '.json.gz' : ''
}

function formatStoryBundleDate(value: string) {
  if (!value) return ''
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  return `${match[1]}年${match[2]}月${match[3]}日`
}

function formatUpdateWarning(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function defaultFetch(url: string, init?: Record<string, any>) {
  if (typeof fetch !== 'function') throw new Error('global fetch is not available')
  return fetch(url, init as RequestInit)
}
