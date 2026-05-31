export interface WarfarinWikiAnchor {
  anchor_id: string
  content: string
  source: string
  scope: string
  relevance: number
  url?: string
}

export interface WarfarinWikiSearchResult {
  results: WarfarinWikiAnchor[]
  total: number
  took_ms: number
}

export interface WarfarinWikiContextResult {
  anchor: WarfarinWikiAnchor
  full_text: Array<{ scene?: string; speaker: string; text: string }>
  summary: string | null
  source_ref: string
}

export interface WarfarinWikiClientOptions {
  baseUrl: string
  mode?: WarfarinWikiMode
  language?: string
  scopes?: string[]
  pageBaseUrl?: string
  userAgent?: string
  timeoutMs: number
  fetch?: (url: string, init: Record<string, any>) => Promise<any>
}

export type WarfarinWikiMode = 'official' | 'anchor' | 'story'

export interface WarfarinWikiSearchInput {
  keyword: string
}

export interface WarfarinWikiContextInput {
  anchorId: string
  needSummary?: boolean
  contextRange?: number
}

export interface ChatLunaToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  execute: (input: Record<string, any>) => Promise<any>
}

interface ApiEnvelope<T> {
  code: number
  message: string
  data: T | null
}

interface OfficialSearchResponse {
  query: string
  results: Array<{
    slug: string
    name: string
    type: string
    category: string
    snippet: string
    score: number
  }>
}

export class WarfarinWikiApiError extends Error {
  constructor(public code: number, message: string, cause?: unknown) {
    super(message)
    this.name = 'WarfarinWikiApiError'
    if (cause) (this as Error & { cause?: unknown }).cause = cause
  }
}

export class WarfarinWikiClient {
  private readonly baseUrl: string
  private readonly mode: WarfarinWikiMode
  private readonly language: string
  private readonly scopes: string[]
  private readonly pageBaseUrl: string
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly fetchImpl: (url: string, init: Record<string, any>) => Promise<any>

  constructor(options: WarfarinWikiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.mode = options.mode || 'anchor'
    this.language = normalizeLanguage(options.language)
    this.scopes = (options.scopes || []).map(scope => String(scope || '').trim()).filter(Boolean)
    this.pageBaseUrl = options.pageBaseUrl === undefined ? 'https://warfarin.wiki' : String(options.pageBaseUrl || '').replace(/\/+$/g, '')
    this.userAgent = options.userAgent || defaultUserAgent
    this.timeoutMs = Math.max(1000, options.timeoutMs || 10000)
    this.fetchImpl = options.fetch || defaultFetch
  }

  async search(input: WarfarinWikiSearchInput): Promise<WarfarinWikiSearchResult> {
    const keyword = normalizeKeyword(input.keyword)
    if (!keyword) throw new WarfarinWikiApiError(400, 'keyword is required')
    if (keyword.length > 100) throw new WarfarinWikiApiError(400, 'keyword must be 1-100 characters')

    return this.mode === 'official' || this.mode === 'story' ? this.searchOfficial(keyword) : this.searchAnchor(keyword)
  }

  private async searchOfficial(keyword: string): Promise<WarfarinWikiSearchResult> {
    const started = Date.now()
    const params = new URLSearchParams({ q: keyword })
    if (this.scopes.length) {
      params.set('scope', this.scopes.join(','))
    }
    const response = await this.requestJson<OfficialSearchResponse>(`${officialApiBaseUrl(this.baseUrl, this.language)}/search?${params.toString()}`, { method: 'GET', headers: this.requestHeaders() })
    const results = (response.results || []).map((item) => ({
      anchor_id: item.slug,
      content: item.snippet || item.name || '',
      source: `${item.category || item.type || '资料'}：${item.name || item.slug}`,
      scope: item.type || 'wiki',
      relevance: Number(item.score || 0),
      url: officialPageUrl(this.pageBaseUrl, this.language, item.type, item.slug),
    }))
    return { results, total: results.length, took_ms: Date.now() - started }
  }

  private async searchAnchor(keyword: string): Promise<WarfarinWikiSearchResult> {
    return this.requestJson<WarfarinWikiSearchResult>(`${this.baseUrl}/api/v1/search/anchor`, {
      method: 'POST',
      headers: this.requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ keyword }),
    }, true)
  }

  async context(input: WarfarinWikiContextInput): Promise<WarfarinWikiContextResult> {
    const anchorId = String(input.anchorId || '').trim()
    if (!anchorId) throw new WarfarinWikiApiError(400, 'anchor_id is required')
    const contextUrl = this.mode === 'story'
      ? `${officialApiRootUrl(this.baseUrl)}/search/context`
      : `${this.baseUrl}/api/v1/search/context`
    return this.requestJson<WarfarinWikiContextResult>(contextUrl, {
      method: 'POST',
      headers: this.requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        anchor_id: anchorId,
        need_summary: input.needSummary === true,
        context_range: clampInteger(input.contextRange, 3, 0, 10),
      }),
    }, true)
  }

  private async requestJson<T>(url: string, init: Record<string, any>, envelope = false): Promise<T> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller?.signal })
      if (!envelope) return readJson<T>(response)
      const payload = await readJson<ApiEnvelope<T>>(response)
      if (payload.code !== 0 || !payload.data) throw new WarfarinWikiApiError(payload.code, payload.message || 'warfarin wiki api error')
      return payload.data
    } catch (error) {
      if (error instanceof WarfarinWikiApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new WarfarinWikiApiError(500, 'warfarin wiki request timed out', error)
      throw new WarfarinWikiApiError(500, error instanceof Error ? error.message : String(error), error)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private requestHeaders(extra: Record<string, string> = {}) {
    return {
      'User-Agent': this.userAgent,
      Accept: 'application/json,text/plain,*/*',
      ...extra,
    }
  }
}

export const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36 miyako-intel'

export function formatWikiSearchResults(result: WarfarinWikiSearchResult & { keyword: string; offset?: number; pageSize?: number; commandName?: string; sourceLabel?: string; showSourceLabel?: boolean }) {
  const keyword = normalizeKeyword(result.keyword)
  const commandName = result.commandName || 'w'
  const sourceLabel = result.sourceLabel || 'Warfarin Wiki 官方搜索'
  const showSourceLabel = result.showSourceLabel !== false
  if (!result.results.length) return [`Warfarin Wiki 检索：${keyword}`, showSourceLabel ? `信息源：${sourceLabel}` : '', '没有找到相关资料。'].filter(Boolean).join('\n')
  const offset = clampInteger(result.offset, 0, 0, Math.max(0, result.results.length - 1))
  const pageSize = clampInteger(result.pageSize, 5, 1, 20)
  const visible = result.results.slice(offset, offset + pageSize)
  const total = Math.max(result.total || 0, result.results.length)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const lines = [
    `Warfarin Wiki 检索：${keyword} | 共 ${total} 条，可用页码 [1-${totalPages}] | 输入 ${commandName} 序号 查看，${commandName}+ 下一页，${commandName}- 上一页，${commandName}+页码 跳页。`,
    showSourceLabel ? `信息源：${sourceLabel}` : '',
    '',
  ].filter((line, index) => line || index === 2)

  visible.forEach((item, index) => {
    lines.push(`${offset + index + 1}. ${formatWikiSourceTitle(item)}`)
    lines.push(`   ${excerptAroundKeyword(item.content, keyword, 110)}`)
  })
  return lines.join('\n')
}

export function formatWikiContext(result: WarfarinWikiContextResult) {
  const source = result.source_ref || result.anchor.source
  const sourceParts = splitWikiSource(source)
  const missionMeta = getMissionMeta(result.anchor)
  const metadata = [`名称：${sourceParts.title}`, `类型：${sourceParts.category}`]
  if (missionMeta) metadata.push(`任务编号：${missionMeta.code}`)
  metadata.push('来源：Warfarin Wiki')
  const lines = [metadata.join(' | ')]
  if (result.summary) lines.push(`摘要：${result.summary}`)
  lines.push('', '正文：')
  for (const row of result.full_text || []) {
    const speaker = String(row.speaker || '').replace(/\{[^{}]*\}/g, '').trim() || '旁白'
    const scene = String(row.scene || '').trim()
    const text = String(row.text || '').trim()
    if (!text) continue
    if (scene && speaker !== '通讯') lines.push(`${scene} / ${speaker}：${text}`)
    else if (scene) lines.push(`${scene}：${text}`)
    else lines.push(`${speaker}：${text}`)
  }
  if (lines.at(-1) === '正文：') lines.push(result.anchor.content || '暂无正文。')
  if (result.anchor.url) lines.push('', `详情：${result.anchor.url}`)
  return lines.join('\n')
}

export function formatWikiSourceTitle(anchor: Pick<WarfarinWikiAnchor, 'anchor_id' | 'source' | 'scope'>) {
  return anchor.source
}

export function createWarfarinWikiTools(client: Pick<WarfarinWikiClient, 'search' | 'context'>): ChatLunaToolDefinition[] {
  return [
    {
      name: 'warfarin_wiki_search',
      description: 'Search Warfarin Wiki official index by keyword.',
      parameters: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
      execute: (input) => client.search({ keyword: String(input.keyword || '') }),
    },
    {
      name: 'warfarin_wiki_context',
      description: 'Fetch best-effort source context for a Warfarin Wiki slug or anchor id.',
      parameters: {
        type: 'object',
        properties: {
          anchor_id: { type: 'string' },
          need_summary: { type: 'boolean' },
          context_range: { type: 'number', minimum: 0, maximum: 10 },
        },
        required: ['anchor_id'],
      },
      execute: (input) => client.context({
        anchorId: String(input.anchor_id || ''),
        needSummary: input.need_summary === true,
        contextRange: input.context_range === undefined ? undefined : Number(input.context_range),
      }),
    },
  ]
}

export function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

function normalizeKeyword(keyword: string) {
  return String(keyword || '').trim().replace(/\s+/g, ' ')
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = String(baseUrl || '').trim() || 'https://api.warfarin.wiki/v1'
  const withProtocol = /^[a-z]+:\/\//i.test(normalized) ? normalized : `http://${normalized}`
  return withProtocol.replace(/\/+$/g, '')
}

function normalizeLanguage(language: unknown) {
  const normalized = String(language || 'cn').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  return normalized || 'cn'
}

function officialApiBaseUrl(baseUrl: string, language: string) {
  return `${officialApiRootUrl(baseUrl)}/${language}`
}

function officialApiRootUrl(baseUrl: string) {
  const segments = baseUrl.split('/')
  if (looksLikeLanguageCode(segments.at(-1))) segments.pop()
  return segments.join('/')
}

function officialPageUrl(baseUrl: string, language: string, type: string, slug: string) {
  if (!baseUrl) return undefined
  const cleanType = encodeURIComponent(String(type || 'wiki').trim())
  const cleanSlug = encodeURIComponent(String(slug || '').trim())
  return cleanSlug ? `${baseUrl}/${language}/${cleanType}/${cleanSlug}` : undefined
}

function looksLikeLanguageCode(value: unknown) {
  return /^[a-z]{2}(?:-[a-z0-9]+)?$/i.test(String(value || ''))
}

function compactText(text: string, maxLength: number) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized
}

function splitWikiSource(source: string) {
  const text = String(source || '').trim() || '资料'
  const index = text.indexOf('：')
  if (index < 0) return { category: '资料', title: text }
  return {
    category: text.slice(0, index).trim() || '资料',
    title: text.slice(index + 1).trim() || text,
  }
}

function getMissionMeta(anchor: Pick<WarfarinWikiAnchor, 'anchor_id' | 'scope'>) {
  if (anchor.scope !== 'missions') return undefined
  const code = String(anchor.anchor_id || '').split('_')[0].trim()
  if (!code) return undefined
  const match = code.match(/m(\d+)$/i)
  if (!match) return undefined
  return { code, index: Number(match[1]) }
}

function excerptAroundKeyword(text: string, keyword: string, maxLength: number) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  const index = normalized.toLowerCase().indexOf(keyword.toLowerCase())
  if (index < 0) return compactText(normalized, maxLength)
  const half = Math.floor((maxLength - keyword.length) / 2)
  const start = Math.max(0, index - half)
  const end = Math.min(normalized.length, start + maxLength)
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${end < normalized.length ? '...' : ''}`
}

async function readJson<T>(response: any): Promise<T> {
  if (response && typeof response.json === 'function') {
    const payload = await response.json().catch(() => null)
    if (payload) return payload
    if (response.ok === false) throw new WarfarinWikiApiError(response.status || 500, `HTTP ${response.status || 500}`)
    throw new WarfarinWikiApiError(500, 'invalid warfarin wiki response')
  }
  return response as T
}

async function defaultFetch(url: string, init: Record<string, any>) {
  if (typeof fetch !== 'function') throw new Error('global fetch is not available')
  return fetch(url, init as RequestInit)
}
