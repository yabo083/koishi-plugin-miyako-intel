// 热点检索词条统计：按群分桶记搜索词，并把详情查看归因到触发它的检索词；不落用户身份
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const FLUSH_AFTER = 20
const FLUSH_INTERVAL_MS = 60 * 1000
const TERMS_CAP = 2000
const VIEWS_PER_TERM = 10

export interface QueryStatsView {
  count: number
  lastAt: string
  anchor_id: string
  scope: string
  sourceKind: string
  source: string
  url?: string
}

export interface QueryStatsTerm {
  /** 检索次数（含 "关键词 编号" 速记） */
  count: number
  hits: number
  lastAt: string
  views: Record<string, QueryStatsView>
}

export interface QueryStatsGroup {
  windowStart: string
  lastDigestAt?: string
  terms: Record<string, QueryStatsTerm>
}

interface QueryStatsFile {
  version: 2
  groups: Record<string, QueryStatsGroup>
}

export type QueryStatsEntryLike = {
  anchor_id: string
  scope?: string
  sourceKind?: string
  source: string
  url?: string
}

export class QueryStatsStore {
  private data: Record<string, QueryStatsGroup> = {}
  private pending = 0
  private timer?: ReturnType<typeof setTimeout>
  private writing?: Promise<void>
  private loadPromise: Promise<void>

  constructor(
    private readonly filePath: string,
    private readonly deps: { now?: () => Date } = {},
  ) {
    this.loadPromise = this.loadFile()
  }

  private get now() { return this.deps.now?.() || new Date() }

  /** 等启动时的落盘数据读完，再读 top/groups 才是准的 */
  async ready() {
    await this.loadPromise
  }

  async recordSearch(groupId: string, keyword: string, hits: number) {
    const kw = String(keyword || '').trim()
    if (!kw) return
    await this.loadPromise
    const term = this.term(groupId, kw)
    term.count++
    term.hits = Number.isFinite(hits) ? hits : term.hits
    term.lastAt = this.now.toISOString()
    this.capTerms(groupId)
    this.arm()
  }

  /** 详情查看归因到选择态里的检索词；该词还没被记过时也会补一条零次检索的记录 */
  async recordView(groupId: string, keyword: string | undefined, anchor: QueryStatsEntryLike) {
    const kw = String(keyword || '').trim()
    const anchorId = String(anchor?.anchor_id || '').trim()
    if (!kw || !anchorId) return
    await this.loadPromise
    const term = this.term(groupId, kw)
    term.lastAt = this.now.toISOString()
    const scope = String(anchor.scope || '')
    const sourceKind = String(anchor.sourceKind || 'wiki')
    const key = `${sourceKind}:${scope}:${anchorId}`
    const existing = term.views[key]
    term.views[key] = {
      count: (existing?.count || 0) + 1,
      lastAt: this.now.toISOString(),
      anchor_id: anchorId,
      scope,
      sourceKind,
      source: String(anchor.source || ''),
      url: anchor.url ? String(anchor.url) : undefined,
    }
    // 每个检索词最多留 10 个被看过的条目，超了先丢查看次数最少的
    const keys = Object.keys(term.views)
    if (keys.length > VIEWS_PER_TERM) {
      keys.sort((a, b) => term.views[a].count - term.views[b].count)
      for (const key of keys.slice(0, keys.length - VIEWS_PER_TERM)) delete term.views[key]
    }
    this.arm()
  }

  /** 有统计过的群号列表（未重置窗口的群） */
  groups() {
    return Object.keys(this.data)
  }

  /** 检索词排行：次数降序、同次按最近时间降序，取 topN */
  top(groupId: string, minCount: number, topN: number) {
    const group = this.data[String(groupId)] as QueryStatsGroup | undefined
    return Object.entries(group?.terms || {})
      .filter(([, item]) => item.count >= Math.max(1, minCount))
      .sort((a, b) => b[1].count - a[1].count || b[1].lastAt.localeCompare(a[1].lastAt))
      .slice(0, Math.max(1, topN))
      .map(([keyword, item]) => ({ keyword, ...item }))
  }

  /** 发送周报后清该群的统计窗口 */
  reset(groupId: string) {
    const group = this.data[String(groupId)] as QueryStatsGroup | undefined
    if (!group) return
    group.windowStart = this.now.toISOString()
    group.terms = {}
    this.pending++
    this.arm()
  }

  markDigest(groupId: string, at: Date) {
    const group = this.group(groupId)
    group.lastDigestAt = at.toISOString()
    this.pending++
    this.arm()
  }

  lastDigestAt(groupId: string): Date | undefined {
    const value = this.data[String(groupId)]?.lastDigestAt
    const ms = value ? Date.parse(value) : NaN
    return Number.isFinite(ms) ? new Date(ms) : undefined
  }

  windowStart(groupId: string): Date {
    const value = this.data[String(groupId)]?.windowStart
    const ms = value ? Date.parse(value) : NaN
    return Number.isFinite(ms) ? new Date(ms) : this.now
  }

  private group(groupId: string): QueryStatsGroup {
    const groupKey = String(groupId || '').trim()
    let group = this.data[groupKey]
    if (!group) {
      group = { windowStart: this.now.toISOString(), terms: {} }
      this.data[groupKey] = group
    }
    return group
  }

  private term(groupId: string, keyword: string): QueryStatsTerm {
    const group = this.group(groupId)
    let term = group.terms[keyword]
    if (!term) {
      term = { count: 0, hits: 0, lastAt: this.now.toISOString(), views: {} }
      group.terms[keyword] = term
    }
    return term
  }

  /** 词条过多时先丢只查过一次的，免得文件无限膨胀 */
  private capTerms(groupId: string) {
    const terms = this.data[groupId]?.terms
    if (!terms) return
    const keys = Object.keys(terms)
    if (keys.length <= TERMS_CAP) return
    for (const key of keys) {
      if (Object.keys(terms).length <= TERMS_CAP) break
      if (terms[key].count === 1) delete terms[key]
    }
  }

  private arm() {
    if (++this.pending >= FLUSH_AFTER) {
      this.pending = 0
      void this.flush()
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.flush()
      }, FLUSH_INTERVAL_MS)
      this.timer.unref?.()
    }
  }

  async flush() {
    await this.loadPromise
    if (this.writing) return this.writing
    this.pending = 0
    const payload: QueryStatsFile = { version: 2, groups: this.data }
    const tmp = `${this.filePath}.tmp`
    this.writing = mkdir(dirname(this.filePath), { recursive: true })
      .then(() => writeFile(tmp, JSON.stringify(payload), 'utf8'))
      .then(() => rename(tmp, this.filePath))
      .finally(() => { this.writing = undefined })
    return this.writing
  }

  private async loadFile() {
    const payload = await readFile(this.filePath, 'utf8')
      .then((raw) => JSON.parse(raw) as Partial<QueryStatsFile>)
      .catch(() => null)
    // v1 全表是单桶结构，与 v2 分群结构不兼容且从未上线，直接弃读
    if (payload?.version !== 2 || !payload.groups || typeof payload.groups !== 'object') return
    for (const [groupId, group] of Object.entries(payload.groups)) {
      if (!group || typeof group !== 'object') continue
      this.data[groupId] = {
        windowStart: typeof group.windowStart === 'string' ? group.windowStart : this.now.toISOString(),
        lastDigestAt: typeof group.lastDigestAt === 'string' ? group.lastDigestAt : undefined,
        terms: group.terms && typeof group.terms === 'object' ? group.terms : {},
      }
    }
  }

  async dispose() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    await this.flush().catch(() => undefined)
  }
}
