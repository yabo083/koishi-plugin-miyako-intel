import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { WarfarinWikiAnchor, WarfarinWikiContextResult, WarfarinWikiSearchResult } from './warfarin-wiki'
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

interface StoryAnchor extends WarfarinWikiAnchor {
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
    if (this.isOfficialBundle(manifest) && this.isOlderThanBundledSeed(anchors.length)) throw new Error(`story bundle is older than bundled seed: ${anchors.length} < ${bundledStorySeedCount}`)
    await rm(this.anchorsDir(), { recursive: true, force: true })
    await mkdir(this.anchorsDir(), { recursive: true })
    await writeFile(join(this.anchorsDir(), 'bundle.json'), JSON.stringify(anchors, null, 2))
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

export function createWarfarinAnchorsFromDetail(category: string, slug: string, data: any): StoryAnchor[] {
  const scope = normalizeScope(category)
  if (scope === 'missions') return [createStoryAnchorFromMission(slug, data)]
  if (scope === 'baker') return createBakerAnchors(slug, data)
  if (scope === 'tutorials') return createTutorialAnchors(slug, data)
  if (scope === 'enemies') return createEnemyAnchors(slug, data)
  if (scope === 'medals') return createMedalAnchors(slug, data)
  if (scope === 'documents') return createRichContentAnchors(slug, data, scope, '中枢档案')
  if (scope === 'lore') return createRichContentAnchors(slug, data, scope, '见闻辑录')
  if (scope === 'operators') return createOperatorAnchors(slug, data)
  if (scope === 'weapons') return createItemLikeAnchors(slug, data, scope, '武器资料')
  if (scope === 'facilities') return createItemLikeAnchors(slug, data, scope, '设备信息')
  if (scope === 'items') return createItemLikeAnchors(slug, data, scope, '物品信息')
  if (scope === 'gear') return createItemLikeAnchors(slug, data, scope, '装备信息')
  return createGenericAnchors(slug, data, scope)
}

function createBakerAnchors(slug: string, data: any): StoryAnchor[] {
  const rows: WarfarinWikiContextResult['full_text'] = []
  const speakerMap = new Map<string, string>([['endmin', '管理员']])
  for (const [id, chat] of Object.entries(data?.SNSChatTable || {})) {
    const name = stripTags((chat as any)?.name || '')
    if (name) speakerMap.set(id, name)
  }
  const optionTable = data?.SNSDialogOptionTable || {}
  for (const dialog of Object.values(data?.SNSDialogTable || {})) {
    const contentData = (dialog as any)?.dialogContentData
    if (!contentData || typeof contentData !== 'object') continue
    const entries = Object.values(contentData).sort((a: any, b: any) => Number(a?.contentId || 0) - Number(b?.contentId || 0))
    for (const entry of entries as any[]) {
      const speaker = speakerMap.get(String(entry?.speaker || '')) || stripTags(entry?.speaker || '') || '旁白'
      const text = stripTags(entry?.content || '')
      if (text) rows.push({ speaker, text })
      const optionTexts: string[] = []
      for (const optionId of Array.isArray(entry?.dialogOptionIds) ? entry.dialogOptionIds : []) {
        const optionText = stripTags(optionTable?.[optionId]?.optionDesc || '')
        if (optionText) optionTexts.push(optionText)
      }
      if (optionTexts.length) rows.push({ speaker: '选项', text: optionTexts.join(' | ') })
    }
  }
  const name = stripTags(data?.summary?.name || data?.SNSDialogTopicTable?.topicName || '') || slug
  return [makeStoryAnchor(slug, 0, rows.map(row => `${row.speaker}：${row.text}`).join('\n'), `Baker对话：${name}`, 'baker', rows)]
}

function createTutorialAnchors(slug: string, data: any): StoryAnchor[] {
  const texts: string[] = []
  for (const page of Object.values(data?.wikiTutorialPageTable || {})) {
    texts.push(...extractFromTable(page, 'title', 'content'))
  }
  const name = firstText(Object.values(data?.wikiTutorialPageTable || {}).map((page: any) => page?.title)) || slug
  return [makeStoryAnchor(slug, 0, texts.join('\n'), `教程：${name}`, 'tutorials')]
}

function createEnemyAnchors(slug: string, data: any): StoryAnchor[] {
  const display = data?.enemyTemplateDisplayInfoTable || {}
  const texts = [...extractFromTable(display, 'name', 'description', 'nickname')]
  for (const entry of Object.values(data?.enemyAbilityDescTable || {})) {
    texts.push(...extractFromTable(entry, 'name', 'description'))
  }
  const name = stripTags(display?.name || '') || slug
  return [makeStoryAnchor(slug, 0, texts.join('\n'), `敌人资料：${name}`, 'enemies')]
}

function createMedalAnchors(slug: string, data: any): StoryAnchor[] {
  const ach = data?.achievementTable || {}
  const texts = [...extractFromTable(ach, 'name', 'desc', 'completeDesc')]
  for (const level of Object.values(ach?.levelInfos || {})) {
    texts.push(...extractFromTable(level, 'completeDesc'))
    for (const cond of Array.isArray((level as any)?.conditions) ? (level as any).conditions : []) {
      texts.push(...extractFromTable(cond, 'desc'))
    }
  }
  texts.push(...extractFromTable(data?.achievementTypeTable, 'categoryName'))
  const group = Array.isArray(data?.achievementTypeTable?.achievementGroupData)
    ? data.achievementTypeTable.achievementGroupData.find((item: any) => item?.groupId === ach?.groupId)
    : undefined
  texts.push(...extractFromTable(group, 'groupName'))
  const name = stripTags(ach?.name || '') || slug
  return [makeStoryAnchor(slug, 0, texts.join('\n'), `奖章信息：${name}`, 'medals')]
}

function createRichContentAnchors(slug: string, data: any, scope: string, label: string): StoryAnchor[] {
  const texts: string[] = []
  for (const entry of Array.isArray(data?.richContentTable?.contentList) ? data.richContentTable.contentList : []) {
    texts.push(...extractFromTable(entry, 'content'))
  }
  texts.push(...extractFromTable(data?.prtsAllItem, 'desc'))
  const name = stripTags(data?.richContentTable?.title || data?.prtsDocument?.name || data?.prtsAllItem?.name || '') || slug
  return [makeStoryAnchor(slug, 0, texts.join('\n\n'), `${label}：${name}`, scope)]
}

function createOperatorAnchors(slug: string, data: any): StoryAnchor[] {
  const texts = [
    ...extractFromTable(data?.characterTable, 'name', 'profileVoice'),
    ...extractFromTable(data?.itemTable, 'name', 'desc', 'decoDesc'),
  ]
  const name = stripTags(data?.itemTable?.name || data?.characterTable?.name || '') || slug
  return [makeStoryAnchor(slug, 0, texts.join('\n'), `干员资料：${name}`, 'operators')]
}

function createItemLikeAnchors(slug: string, data: any, scope: string, label: string): StoryAnchor[] {
  const texts = [
    ...extractFromTable(data?.itemTable, 'name', 'desc', 'decoDesc'),
    ...extractFromTable(data?.factoryBuildingTable, 'name', 'desc'),
  ]
  const name = stripTags(data?.itemTable?.name || data?.factoryBuildingTable?.name || '') || slug
  return [makeStoryAnchor(slug, 0, texts.join('\n'), `${label}：${name}`, scope)]
}

function createGenericAnchors(slug: string, data: any, scope: string): StoryAnchor[] {
  const texts = collectTexts(data).map(stripTags).filter(Boolean)
  return [makeStoryAnchor(slug, 0, texts.join('\n'), `资料：${slug}`, scope)]
}

function makeStoryAnchor(slug: string, index: number, content: string, source: string, scope: string, fullText?: WarfarinWikiContextResult['full_text']): StoryAnchor {
  const text = String(content || '').trim()
  return {
    anchor_id: `${slug}_${index}`,
    content: text,
    source,
    source_ref: source,
    scope,
    relevance: 1,
    url: `https://warfarin.wiki/cn/${pagePathForScope(scope)}/${encodeURIComponent(slug)}`,
    full_text: fullText?.length ? fullText : (text ? [{ speaker: '资料', text }] : []),
  }
}

function extractFromTable(obj: any, ...fields: string[]) {
  const results: string[] = []
  if (!obj || typeof obj !== 'object') return results
  for (const field of fields) {
    const text = stripTags(obj[field] || '')
    if (text) results.push(text)
  }
  return results
}

function collectTexts(obj: any, depth = 0): string[] {
  if (depth > 20) return []
  if (typeof obj === 'string') return [obj]
  if (!obj || typeof obj !== 'object') return []
  return Object.values(obj).flatMap(value => collectTexts(value, depth + 1))
}

function firstText(values: any[]) {
  for (const value of values) {
    const text = stripTags(value || '')
    if (text) return text
  }
  return ''
}

function normalizeScope(category: string) {
  const scope = String(category || '').trim().toLowerCase()
  return scope === 'lorev2' ? 'lore' : scope
}

function pagePathForScope(scope: string) {
  if (scope === 'documents') return 'lore'
  return scope === 'lore' ? 'lore' : scope
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

function formatUpdateWarning(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function defaultFetch(url: string, init?: Record<string, any>) {
  if (typeof fetch !== 'function') throw new Error('global fetch is not available')
  return fetch(url, init as RequestInit)
}
