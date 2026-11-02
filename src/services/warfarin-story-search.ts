import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { gunzipSync } from 'node:zlib'
import { WarfarinWikiAnchor, WarfarinWikiContextResult, WarfarinWikiSearchResult, clampInteger, foldVariantDuplicates } from './warfarin-wiki'
import { bundledStorySeedCount, bundledStorySeedLanguage, bundledStorySeedVersion } from './warfarin-story-seed-meta'
import { stripZeroWidth } from '../wiki/obfuscate'

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

const STORE_FILE = 'store.ndjson'
const SEARCH_RESULT_LIMIT = 200
const SEARCH_EXCERPT_CHARS = 160

// 常驻内存用 Structure-of-Arrays：检索只需 anchor_id/source/scope/url/content，
// full_text 留在 store.ndjson 里按行偏移回读，省掉约 6 MB 的对象与全文常驻。
export class WarfarinStorySearchService {
  private readonly root: string
  private readonly language: string
  private readonly timeoutMs: number
  private readonly bundleManifestUrl: string
  private readonly fetchImpl: (url: string, init?: Record<string, any>) => Promise<any>
  private ids: string[] = []
  private sources: string[] = []
  private sourcesLower: Array<string | null> = []
  private scopes: string[] = []
  private urls: string[] = []
  private contents: string[] = []
  private contentsLower: Array<string | null> = []
  private offsets = new Float64Array(0)
  private lengths = new Uint32Array(0)
  private idIndex = new Map<string, number | number[]>()
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
    const files = await readdir(dir).catch(() => [] as string[])
    const manifest = await this.readLocalManifest()
    let count = -1
    if (files.includes(STORE_FILE)) {
      await this.loadStore()
      count = this.ids.length
    } else if (files.some((file) => file.endsWith('.json'))) {
      const anchors = await this.readLegacyAnchors(dir, files)
      if (anchors.length && !this.shouldReplaceWithBundledSeed(files, anchors.length, manifest)) {
        // 旧格式就地迁移：合并成 store.ndjson，清单打上格式标记，清掉旧文件
        await this.writeStore(anchors)
        await this.patchManifest({ storeFormat: 'ndjson' })
        await this.loadStore()
        this.loaded = true
        return
      }
      count = anchors.length ? anchors.length : -1
    }
    if (count < 0 || this.shouldReplaceWithBundledSeed(files, count, manifest)) {
      if (await this.installBundledSeed()) await this.loadStore()
    }
    this.loaded = true
  }

  /** 旧版 anchors/*.json：数组或单对象，一次性读完即弃（迁移专用路径） */
  private async readLegacyAnchors(dir: string, files: string[]) {
    const anchors: StoryAnchor[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const payload = await readFile(join(dir, file), 'utf8').then(JSON.parse).catch(() => null)
      if (Array.isArray(payload)) anchors.push(...payload.filter(isStoryAnchor))
      else if (isStoryAnchor(payload)) anchors.push(payload)
    }
    return anchors
  }

  /** 流式读 store.ndjson：逐行解析、记录字节偏移，不产生整份字符串 */
  private async loadStore() {
    const ids: string[] = []
    const sources: string[] = []
    const sourcesLower: Array<string | null> = []
    const scopes: string[] = []
    const urls: string[] = []
    const contents: string[] = []
    const contentsLower: Array<string | null> = []
    const offsets: number[] = []
    const lengths: number[] = []
    const idIndex = new Map<string, number | number[]>()
    const lines = createInterface({ input: createReadStream(this.storePath()), crlfDelay: Infinity })
    let offset = 0
    for await (const line of lines) {
      const length = Buffer.byteLength(line)
      const anchor = parseStoreLine(line)
      if (anchor) {
        const index = ids.length
        ids.push(anchor.anchor_id)
        sources.push(anchor.source)
        sourcesLower.push(lowerOrNull(anchor.source))
        scopes.push(anchor.scope)
        urls.push(anchor.url || '')
        contents.push(anchor.content)
        contentsLower.push(lowerOrNull(anchor.content))
        offsets.push(offset)
        lengths.push(length)
        const rows = idIndex.get(anchor.anchor_id)
        if (rows === undefined) idIndex.set(anchor.anchor_id, index)
        else if (typeof rows === 'number') idIndex.set(anchor.anchor_id, [rows, index])
        else rows.push(index)
      }
      offset += length + 1
    }
    this.ids = ids
    this.sources = sources
    this.sourcesLower = sourcesLower
    this.scopes = scopes
    this.urls = urls
    this.contents = contents
    this.contentsLower = contentsLower
    this.offsets = Float64Array.from(offsets)
    this.lengths = Uint32Array.from(lengths)
    this.idIndex = idIndex
  }

  /** 先写临时文件再 rename：中途崩溃时旧 store 仍然完好 */
  private async writeStore(anchors: StoryAnchor[]) {
    const dir = this.anchorsDir()
    await mkdir(dir, { recursive: true })
    const storePath = this.storePath()
    const temporaryPath = `${storePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, anchors.map((anchor) => JSON.stringify(anchor)).join('\n') + '\n')
    await rename(temporaryPath, storePath)
    for (const file of await readdir(dir)) {
      if (file === STORE_FILE) continue
      await rm(join(dir, file), { force: true })
    }
  }

  async search(input: { keyword: string; limit?: number }): Promise<WarfarinWikiSearchResult> {
    await this.ensureLoaded()
    const keyword = normalizeKeyword(input.keyword)
    if (!keyword) return { results: [], total: 0, took_ms: 0 }
    const started = Date.now()
    const needle = keyword.toLowerCase()
    const { ids, sources, sourcesLower, contents, contentsLower } = this
    const hits: Array<{ index: number; score: number }> = []
    for (let index = 0; index < ids.length; index++) {
      const score = (sourcesLower[index] ?? sources[index]).includes(needle) ? 100
        : (contentsLower[index] ?? contents[index]).includes(needle) ? 50
        : 0
      if (!score) continue
      hits.push({ index, score })
    }
    // sort 在 ES2019 起稳定：分数降序、同分按行序
    hits.sort((a, b) => b.score - a.score)
    const total = hits.length
    const limit = clampInteger(input.limit, SEARCH_RESULT_LIMIT, 1, 10000)
    // 与官方搜索共用折叠规则：同"来源标签+正文"的变体折叠为一条并提示数量，不静默丢弃。
    const folded = foldVariantDuplicates(hits.slice(0, limit).map(({ index, score }) => ({
      anchor_id: ids[index],
      content: contents[index],
      source: this.displaySource(index),
      scope: this.scopes[index],
      url: this.urls[index] || undefined,
      relevance: score,
    })))
    const results = folded.map((item) => ({
      anchor_id: item.anchor_id,
      content: excerptAroundKeyword(item.content, keyword, SEARCH_EXCERPT_CHARS),
      source: item.source,
      scope: item.scope,
      relevance: item.relevance,
    }))
    return { results, total, took_ms: Date.now() - started }
  }

  async context(input: { anchorId: string; scope?: string }): Promise<WarfarinWikiContextResult> {
    await this.ensureLoaded()
    const rows = this.idIndex.get(input.anchorId)
    if (rows === undefined) throw new Error(`anchor_id '${input.anchorId}' not found`)
    // anchor_id 不唯一（items/gear 同物两行）：优先按调用方给的 scope 取对应行
    const list = typeof rows === 'number' ? [rows] : rows
    const index = (input.scope ? list.find((row) => this.scopes[row] === input.scope) : undefined) ?? list[0]
    const anchor = await this.readAnchorAt(index)
    const { full_text, ...rest } = anchor
    const source = displayStorySource(anchor)
    return {
      anchor: { ...rest, source },
      full_text,
      summary: null,
      source_ref: source || anchor.source_ref,
    }
  }

  private async readAnchorAt(index: number): Promise<StoryAnchor> {
    const handle = await open(this.storePath(), 'r')
    try {
      const buffer = Buffer.alloc(this.lengths[index])
      await handle.read(buffer, 0, buffer.length, this.offsets[index])
      return JSON.parse(buffer.toString('utf8'))
    } finally {
      await handle.close()
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
    return { success: this.size, failed: warning ? 1 : 0, skipped: this.size, pending: 0, refreshed: 0, updatedAt, warning: warning || undefined }
  }

  get size() {
    return this.ids.length
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
    if (this.language !== bundledStorySeedLanguage) return false
    // base64 种子模块只在安装时加载，用完即移出 require.cache，不常驻内存
    const seedPath = require.resolve('./warfarin-story-seed')
    try {
      const seed = require(seedPath) as typeof import('./warfarin-story-seed')
      const anchors = seed.loadBundledStorySeed().filter(isStoryAnchor)
      if (!anchors.length) return false
      await this.writeStore(anchors)
      const updatedAt = new Date().toISOString()
      await mkdir(join(this.root, this.language), { recursive: true })
      await writeFile(join(this.root, this.language, 'manifest.json'), JSON.stringify({ language: this.language, updatedAt, seeded: anchors.length, bundledStorySeedVersion, bundledStorySeedCount, storeFormat: 'ndjson' }, null, 2))
      return true
    } finally {
      delete require.cache[seedPath]
    }
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
      return { success: this.size, failed: 0, skipped: this.size, pending: 0, refreshed: 0, updatedAt }
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
    await this.writeStore(anchors)
    await this.loadStore()
    this.loaded = true
    const updatedAt = new Date().toISOString()
    await mkdir(join(this.root, this.language), { recursive: true })
    await writeFile(join(this.root, this.language, 'manifest.json'), JSON.stringify({ language: this.language, updatedAt, success: anchors.length, failed: 0, skipped: 0, pending: 0, refreshed: anchors.length, storyBundleSha256: sha256, storyBundleUpdatedAt: manifest?.updatedAt || '', storyBundleSourceUpdatedAt: manifest?.sourceUpdatedAt || '', storeFormat: 'ndjson' }, null, 2))
    return { success: anchors.length, failed: 0, skipped: 0, pending: 0, refreshed: anchors.length, updatedAt }
  }

  private async readLocalManifest() {
    return readFile(join(this.root, this.language, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null)
  }

  private async patchManifest(patch: Record<string, unknown>) {
    const dir = join(this.root, this.language)
    await mkdir(dir, { recursive: true })
    const manifest = await this.readLocalManifest()
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...(manifest || {}), ...patch }, null, 2))
  }

  private shouldReplaceWithBundledSeed(files: string[], count: number, manifest: any) {
    if (this.language !== bundledStorySeedLanguage) return false
    if (files.includes('bundle.json')) return false
    // 清单里留着远端合集 sha256 = 数据来自每日更新的 bundle，绝不用随包种子回盖
    if (manifest?.storyBundleSha256) return false
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

  private storePath() {
    return join(this.anchorsDir(), STORE_FILE)
  }

  private displaySource(index: number) {
    return displayStorySource({ scope: this.scopes[index], content: this.contents[index], source: this.sources[index] })
  }
}

type StorySourceParts = Pick<StoryAnchor, 'scope' | 'content' | 'source'>

// 蓝图条目（"放置此蓝图后，输入…自动生产…"）与物品本体同名同标签，展示层区分为"生产蓝图"。
function displayStorySource(anchor: StorySourceParts) {
  if (anchor.scope === 'items' && /放置此蓝图后/.test(anchor.content || '')) {
    return anchor.source.replace(/^物品信息：/, '生产蓝图：')
  }
  return anchor.source
}

function lowerOrNull(value: string) {
  const lowered = value.toLowerCase()
  return lowered === value ? null : lowered
}

function parseStoreLine(line: string): StoryAnchor | null {
  try {
    const anchor = JSON.parse(line)
    return isStoryAnchor(anchor) ? anchor : null
  } catch {
    return null
  }
}

function isStoryAnchor(value: any): value is StoryAnchor {
  return value && typeof value.anchor_id === 'string' && typeof value.content === 'string' && typeof value.source === 'string'
}

function normalizeLanguage(language: unknown) {
  const normalized = String(language || 'cn').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  return normalized || 'cn'
}

function normalizeKeyword(keyword: string) {
  return stripZeroWidth(String(keyword || '')).trim().replace(/\s+/g, ' ')
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
