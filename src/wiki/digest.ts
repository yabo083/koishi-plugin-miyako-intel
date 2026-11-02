// 热点检索词条周报：按群把高频检索词渲成「索引/详情」混合单张长图 + 纯文本预览
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'koishi'
import { pickFallbackReason, readFallbackImage, readPngSize, renderFallbackHtml } from '../services/card-fallback'
import { ensureRenderFontsCssLinks } from '../services/render-fonts'
import { ScopedLogger } from '../core/logger'
import { formatError } from '../core/errors'
import { Config as RuntimeConfig } from '../types'
import { excerptAroundKeyword, formatWikiContext, keywordWindow } from './format'
import { WikiSearchSource } from './fold'
import { WikiSearchOrchestrator } from './search'
import { QueryStatsStore } from './query-stats'
import { escapeHtml, renderPageImage } from './detail-image'

const MAX_VIEWS_PER_TERM = 3
const INDEX_LINES = 10
/** 单图正文总字数预算：词条越少每条节选越长，10 条时各约 600 字 */
export const DIGEST_TEXT_BUDGET = 6000
/** 单图允许的最大高度；超出就按比例压预算重渲 */
export const MAX_DIGEST_HEIGHT = 12000
const DIGEST_RENDER_WIDTH = 816

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** 词条数 → 词条展示的详情条目数：1-3 条时最多 3 个详情，4-6 条最多 2 个，更多只留 1 个 */
function viewsShownFor(termCount: number) {
  return termCount <= 3 ? 3 : termCount <= 6 ? 2 : 1
}

export interface WikiDigestView {
  count: number
  source: string
  url?: string
  /** 完整详情排版文本；取不到时留空，只显示索引行 */
  detailText?: string
}

export interface WikiDigestTerm {
  keyword: string
  count: number
  hits: number
  views: WikiDigestView[]
  /** 没人点进详情时重跑检索生成的索引（content 供自适应 KWIC 节选） */
  index?: { total: number; items: Array<{ source: string; content: string }> }
}

export interface WikiDigestGroupData {
  groupId: string
  groupLabel: string
  from: Date
  to: Date
  terms: WikiDigestTerm[]
}

export interface WikiDigestDeps {
  wiki: RuntimeConfig['wiki']
  search: WikiSearchOrchestrator
  stats: QueryStatsStore
  logger: ScopedLogger
}

function dateRangeLabel(from: Date, to: Date) {
  const fmt = (date: Date) => `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
  return `${fmt(from)}–${fmt(to)}`
}

/** 取一个群的热点检索词条数据：有查看记录的重抓全文详情，没看过的重跑检索补索引 */
export async function buildWikiDigestGroupData(
  deps: WikiDigestDeps,
  groupId: string,
  groupLabel: string,
  from: Date,
  to: Date,
): Promise<WikiDigestGroupData> {
  const data: WikiDigestGroupData = { groupId, groupLabel, from, to, terms: [] }
  const terms = deps.stats.top(groupId, deps.wiki.digestMinCount, deps.wiki.digestTopN)
  for (const term of terms) {
    const item: WikiDigestTerm = { keyword: term.keyword, count: term.count, hits: term.hits, views: [] }
    const views = Object.values(term.views || {})
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, MAX_VIEWS_PER_TERM)
    if (views.length) {
      for (const view of views) {
        const card: WikiDigestView = { count: view.count, source: view.source, url: view.url }
        try {
          const result = await deps.search.fetchContext({
            anchor_id: view.anchor_id,
            scope: view.scope,
            source: view.source,
            url: view.url,
            sourceKind: view.sourceKind as WikiSearchSource,
            content: '',
            relevance: 0,
          }, view.sourceKind as WikiSearchSource)
          card.detailText = formatWikiContext(result)
        } catch (error) {
          deps.logger.warn(`周报词条「${view.source}」正文获取失败，仅显示索引行：${formatError(error)}`)
        }
        item.views.push(card)
      }
    } else {
      try {
        const result = await deps.search.searchAllSources(term.keyword)
        item.index = {
          total: result.total,
          items: result.results.slice(0, INDEX_LINES).map((row) => ({
            source: row.source,
            content: row.content,
          })),
        }
      } catch (error) {
        deps.logger.warn(`周报检索词「${term.keyword}」索引重建失败：${formatError(error)}`)
      }
    }
    data.terms.push(item)
  }
  return data
}

/** w热点 / 控制台预览用：只列词条行，不带正文 */
export function formatWikiDigestText(data: WikiDigestGroupData, minCount: number): string {
  if (!data.terms.length) return wikiDigestEmptyText(minCount)
  const lines = ['本周群友热点检索词条为：', `${data.groupLabel} · ${dateRangeLabel(data.from, data.to)}`, '']
  data.terms.forEach((term, index) => {
    if (term.views.length) {
      const titles = term.views.map((view) => view.source).join('、')
      lines.push(`#${index + 1}「${term.keyword}」 检索 ${term.count} 次 · 详情：${titles}`)
    } else {
      const total = term.index?.total ?? term.hits
      lines.push(`#${index + 1}「${term.keyword}」 检索 ${term.count} 次 · 索引：命中 ${total} 条`)
    }
  })
  return lines.join('\n')
}

export function wikiDigestEmptyText(minCount: number) {
  return `本群本周没有达到 ${minCount} 次检索的热点词条。`
}

export function wikiDigestNotice(albumName: string, termCount: number) {
  return `本周群友热点检索词条长图已存入群相册「${albumName}」（${termCount} 条）`
}

/** 空周也上传：提示语写明缺席与门槛 */
export function wikiDigestAbsentNotice(albumName: string, minCount: number) {
  return `本周群友热点检索词条周报缺席（未达 ${minCount} 次门槛），404 图已存入群相册「${albumName}」`
}

/** 自适应模板：总字数预算按词条数平摊——详情卡按关键词节选，索引卡自适应行数与 KWIC 长 */
export function renderWikiDigestHtml(data: WikiDigestGroupData, budget = DIGEST_TEXT_BUDGET): string {
  const termCount = data.terms.length
  const perTerm = clamp(budget / Math.max(1, termCount), 200, 2400)
  const viewsShown = viewsShownFor(termCount)
  const cards = data.terms.map((term, index) => {
    const hasViews = term.views.length > 0
    const tag = hasViews ? '详情' : '索引'
    const body = hasViews
      ? term.views.slice(0, viewsShown).map((view) => {
        const excerptChars = Math.floor(perTerm / Math.min(term.views.length, viewsShown))
        const excerpt = view.detailText ? keywordWindow(view.detailText, term.keyword, excerptChars) : ''
        return `
        <div class="entry">
          <div class="entry-head">词条「${escapeHtml(view.source)}」 查看 ${view.count} 次</div>
          ${view.url ? `<div class="entry-url">${escapeHtml(view.url)}</div>` : ''}
          ${view.detailText ? `<div class="detail">${escapeHtml(excerpt)}<div class="detail-foot">（全文 ${view.detailText.length} 字，节选关键词附近）</div></div>` : ''}
        </div>`
      }).join('')
      : (() => {
        if (!term.index) return `<div class="hit-line">索引暂时不可用</div>`
        const lines = clamp(perTerm / 90, 3, 10)
        const excerptLen = clamp(perTerm / lines - 10, 40, 160)
        return `<div class="hit-line">共命中 ${term.index.total} 条</div>` +
          term.index.items.slice(0, lines).map((row, rowIndex) => `
        <div class="hit">
          <div class="hit-title">${rowIndex + 1}. ${escapeHtml(row.source)}</div>
          <div class="hit-excerpt">${escapeHtml(excerptAroundKeyword(row.content, term.keyword, excerptLen))}</div>
        </div>`).join('')
      })()
    return `
      <section class="card">
        <div class="card-head"><span class="rank">#${index + 1}</span><span class="kw">「${escapeHtml(term.keyword)}」</span>
          <span class="count">检索 ${term.count} 次</span><span class="tag tag-${hasViews ? 'detail' : 'index'}">${tag}</span></div>
        ${body}
      </section>`
  }).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{width:816px;margin:0;padding:28px;box-sizing:border-box;background:#f6f1e7;color:#26221c;
  font-family:"Noto Serif SC","Source Han Serif SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.7;}
h1{font-size:22px;margin:0 0 4px;}
.sub{font-size:13px;color:#8a7f6d;margin-bottom:18px;}
.card{background:#fffdf8;border:1px solid #e4dccc;border-radius:10px;padding:14px 18px;margin-bottom:14px;}
.card-head{display:flex;align-items:baseline;gap:8px;border-bottom:1px dashed #e4dccc;padding-bottom:8px;margin-bottom:8px;}
.rank{color:#b08a3e;font-weight:700;}
.kw{font-size:17px;font-weight:700;}
.count{color:#8a7f6d;font-size:13px;margin-left:auto;}
.tag{font-size:11px;border-radius:8px;padding:1px 8px;color:#fff;}
.tag-detail{background:#8c5e2a;}
.tag-index{background:#7a8a99;}
.entry{border-left:3px solid #e4dccc;padding-left:10px;margin:10px 0;}
.entry-head{font-weight:600;}
.entry-url{font-size:12px;color:#9a6a2f;word-break:break-all;}
.detail{white-space:pre-wrap;word-break:break-word;margin-top:6px;color:#3a352c;}
.hit-line{color:#8a7f6d;font-size:13px;margin-bottom:6px;}
.hit{margin-bottom:8px;}
.hit-title{font-weight:600;}
.hit-excerpt{color:#6f6657;font-size:13px;}
</style></head><body>
<h1>本周群友热点检索词条为：</h1>
<div class="sub">${escapeHtml(data.groupLabel)} · ${dateRangeLabel(data.from, data.to)}</div>
${cards}
</body></html>`
}

/** 单图渲染：超高则按比例压字数预算重渲（最多 3 次），返回 PNG/JPEG 单图 */
export async function renderWikiDigestImage(ctx: Context, data: WikiDigestGroupData) {
  let budget = DIGEST_TEXT_BUDGET
  for (let attempt = 0; attempt < 3; attempt++) {
    const rendered = await renderPageImage(ctx, renderWikiDigestHtml(data, budget), DIGEST_RENDER_WIDTH)
    if (rendered.height <= MAX_DIGEST_HEIGHT || attempt === 2) return rendered.image
    budget = Math.floor(budget * (MAX_DIGEST_HEIGHT / rendered.height) * 0.95)
  }
  return Buffer.alloc(0)
}

/** 空周 404 图：日报回退卡同款 lost-card 插画 + 牌内随机致歉（本周版），文件页加载才能吃到 file:// 字体 */
export async function renderWikiDigest404Image(ctx: Context, data: WikiDigestGroupData, minCount: number, random: () => number = Math.random) {
  const image = await readFallbackImage()
  const { width, height } = readPngSize(image)
  const html = renderFallbackHtml({
    imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
    message: pickFallbackReason(random).sentence('热点周报', '本周'),
    fontsCssLinks: await ensureRenderFontsCssLinks(),
    width,
    height,
  })
  const filePath = path.join(os.tmpdir(), `miyako-digest-404-${process.pid}-${Date.now()}.html`)
  await fs.writeFile(filePath, html, 'utf8')
  try {
    return (await renderPageImage(ctx, html, width, { filePath })).image
  } finally {
    await fs.rm(filePath, { force: true }).catch(() => undefined)
  }
}
