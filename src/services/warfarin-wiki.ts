import { defaultUserAgent } from '../core/constants'

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

export interface WarfarinWikiDetailInput {
  type: string
  slug: string
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
    const results = foldVariantDuplicates((response.results || []).map((item) => ({
      anchor_id: item.slug,
      content: item.snippet || item.name || '',
      source: `${item.category || item.type || '资料'}：${item.name || item.slug}`,
      scope: item.type || 'wiki',
      relevance: Number(item.score || 0),
      url: officialPageUrl(this.pageBaseUrl, this.language, item.type, item.slug),
    })))
    return { results, total: results.length, took_ms: Date.now() - started }
  }

  private async searchAnchor(keyword: string): Promise<WarfarinWikiSearchResult> {
    return this.requestJson<WarfarinWikiSearchResult>(`${this.baseUrl}/api/v1/search/anchor`, {
      method: 'POST',
      headers: this.requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ keyword }),
    }, true)
  }

  /**
   * 官方详情接口：返回页面渲染所用的原始数据表（itemTable / weaponBasicTable / characterTable…）。
   * 搜索结果的 snippet 只有约 300 字，详情页正文必须从这里取。
   */
  async detail(input: WarfarinWikiDetailInput): Promise<Record<string, unknown>> {
    const type = String(input.type || '').trim()
    const slug = String(input.slug || '').trim()
    if (!type || !slug) throw new WarfarinWikiApiError(400, 'type and slug are required')
    const payload = await this.requestJson<Record<string, unknown>>(
      `${officialApiBaseUrl(this.baseUrl, this.language)}/${encodeURIComponent(apiDetailType(type))}/${encodeURIComponent(slug)}`,
      { method: 'GET', headers: this.requestHeaders() },
      false,
      Math.max(this.timeoutMs, 20000),
    )
    const data = payload?.data
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : payload
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

  private async requestJson<T>(url: string, init: Record<string, any>, envelope = false, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller?.signal, timeout: timeoutMs })
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

export function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

// Warfarin 数据里同一个展示条目常有多个内部 ID（元素/材质/精炼度变体），名称与正文完全相同；
// 按"来源标签+正文"折叠为一条避免刷屏，标题附变体计数提示，被折叠的 anchor_id 仍可直接查询。
export function foldVariantDuplicates(results: WarfarinWikiAnchor[]): WarfarinWikiAnchor[] {
  const groups = new Map<string, { anchor: WarfarinWikiAnchor; variantIds: string[] }>()
  for (const anchor of results) {
    const key = `${anchor.source}\n${anchor.content}`
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { anchor, variantIds: [] })
      continue
    }
    group.variantIds.push(anchor.anchor_id.length < group.anchor.anchor_id.length
      ? group.anchor.anchor_id
      : anchor.anchor_id)
    if (anchor.anchor_id.length < group.anchor.anchor_id.length) {
      group.anchor = anchor
    }
  }
  return Array.from(groups.values()).map(({ anchor, variantIds }) => ({
    ...anchor,
    source: variantIds.length ? `${anchor.source}（另有 ${variantIds.length} 个变体）` : anchor.source,
  }))
}

/** 关键词归一化：文本层拼标题要跟检索口径一致，故导出 */
export function normalizeKeyword(keyword: string) {
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

/** 搜索结果的 type 与详情路径不完全一致：档案在搜索里是 lore，详情接口是 lorev2 */
function apiDetailType(type: string) {
  const normalized = String(type || '').trim().toLowerCase()
  return normalized === 'lore' ? 'lorev2' : normalized
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
