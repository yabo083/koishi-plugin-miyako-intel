// w / wn / w+ / w- 命令族：解析输入 → 调编排器 → 存选择态 → 交给发送器
import { Context } from 'koishi'
import { ScopedLogger } from '../core/logger'
import { formatError } from '../core/errors'
import { Config as RuntimeConfig } from '../types'
import { WarfarinWikiApiError } from '../services/warfarin-wiki'
import { WikiSearchSource } from './fold'
import { formatWikiCommandError, formatWikiContext, formatWikiSearchBatch, formatWikiSearchResults, getWikiBatchSize } from './format'
import { WikiSearchOrchestrator } from './search'
import { WikiSelectionStore } from './selection'
import { createWikiReplySender } from './reply'

const NEED_SEARCH_FIRST = '请先使用 w 关键词 检索。'
const SESSION_ONLY = '只能在会话中使用该命令。'
const NEED_KEYWORD = '请输入关键词，例如：w 息壤'

export interface WikiCommandsDeps {
  ctx: Context
  wiki: RuntimeConfig['wiki']
  search: WikiSearchOrchestrator
  selections: WikiSelectionStore
  logger: ScopedLogger
}

/** "息壤 2" → 搜索后直接看第 2 条 */
function parseShortcut(input: string) {
  const match = input.match(/^(.+?)\s+(\d+)$/)
  if (!match) return undefined
  const keyword = match[1].trim()
  const index = Number(match[2])
  if (!keyword || !Number.isInteger(index) || index <= 0) return undefined
  return { keyword, index }
}

export function registerWikiCommands(deps: WikiCommandsDeps) {
  const { ctx, wiki, search, selections, logger } = deps
  const reply = createWikiReplySender(wiki, logger)
  const listFormat = { commandName: 'w', sourceLabel: '综合搜索', showSourceLabel: false }
  async function searchAndRemember(session: any, keyword: string, source: WikiSearchSource = 'wiki') {
    if (!session) return SESSION_ONLY
    const normalized = String(keyword || '').trim()
    if (!normalized) return NEED_KEYWORD
    try {
      const result = source === 'story'
        ? await search.searchSingleSource(normalized, 'story')
        : await search.searchAllSources(normalized)
      const dataUpdatedLabel = await search.storyDataUpdatedLabel()
      selections.remember(session, {
        keyword: normalized,
        offset: 0,
        total: result.total,
        results: result.results,
        dataUpdatedLabel,
      })
      return formatWikiSearchBatch({
        ...result,
        ...listFormat,
        keyword: normalized,
        offset: 0,
        pageSize: wiki.pageSize,
        pageCount: wiki.initialPageCount,
        dataUpdatedLabel,
      })
    } catch (error) {
      const what = source === 'story' ? '剧情/任务全文' : '终末地资料'
      logger.warn(`${what}检索失败：${formatError(error)}`)
      return formatWikiCommandError(error, source === 'story'
        ? '剧情/任务检索暂时不可用，请稍后重试。'
        : '资料检索暂时不可用，请稍后重试。')
    }
  }

  /** w 后面既可能是关键词，也可能是编号 / 翻页符 / “关键词 编号”速记 */
  async function handleInput(session: any, input: string) {
    const normalized = String(input || '').trim()
    if (!normalized) return NEED_KEYWORD
    if (/^\d+$/.test(normalized) && selections.has(session)) return showContext(session, normalized)
    if (normalized === '+' || normalized === '下一页') return shiftPage(session, 1)
    if (normalized === '-' || normalized === '上一页') return shiftPage(session, -1)
    const shortcut = parseShortcut(normalized)
    if (shortcut) {
      await searchAndRemember(session, shortcut.keyword)
      return showContext(session, String(shortcut.index))
    }
    return searchAndRemember(session, normalized)
  }

  async function showContext(session: any, target: string, source?: WikiSearchSource) {
    if (!session) return SESSION_ONLY
    const anchor = selections.resolveAnchor(session, target, source)
    if (!anchor) return '请先使用 w 关键词 检索，再用 w 编号 查看详情。'
    const actualSource = source || anchor.sourceKind || 'wiki'
    const asAnchorOnly = () => formatWikiContext({ anchor, full_text: [], summary: null, source_ref: anchor.source })
    try {
      return formatWikiContext(await search.fetchContext(anchor, actualSource))
    } catch (error) {
      const what = actualSource === 'story' ? '剧情/任务全文' : '终末地资料'
      logger.warn(`${what}上下文检索失败：${formatError(error)}`)
      // 官方详情拿不到时退回搜索摘要，条目本身仍然可读。
      if (actualSource === 'wiki' || (error instanceof WarfarinWikiApiError && error.code === 404)) return asAnchorOnly()
      return formatWikiCommandError(error, '资料上下文暂时不可用，请稍后重试。')
    }
  }
  /** w+ / w-：整批前后挪 */
  function shiftPage(session: any, direction: 1 | -1) {
    if (!session) return SESSION_ONLY
    const entry = selections.shiftBatch(session, direction, getWikiBatchSize(wiki))
    if (!entry) return NEED_SEARCH_FIRST
    return formatWikiSearchBatch({
      ...entry,
      ...listFormat,
      took_ms: 0,
      pageSize: wiki.pageSize,
      pageCount: wiki.initialPageCount,
    })
  }

  /** w+2：跳到第 2 页，只发那一页 */
  function jumpToPage(session: any, page: unknown) {
    if (!session) return SESSION_ONLY
    const pageNumber = Number(page)
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) return '页码必须是大于 0 的整数。'
    const entry = selections.jumpToPage(session, pageNumber, wiki.pageSize)
    if (!entry) return NEED_SEARCH_FIRST
    return formatWikiSearchResults({ ...entry, ...listFormat, took_ms: 0, pageSize: wiki.pageSize })
  }

  ctx.command('w <input:text>', '检索 Warfarin Wiki 终末地资料')
    .action(async ({ session }, input?: string) => reply.from(session, () => handleInput(session, input || '')))

  ctx.command('wn <input:text>', '按关键词检索 Warfarin Wiki，纯数字也按搜索处理')
    .action(async ({ session }, input?: string) => reply.from(session, () => searchAndRemember(session, input || '')))

  ctx.command('w+', '显示下一页 Warfarin Wiki 检索结果')
    .action(async ({ session }) => reply.from(session, () => shiftPage(session, 1)))

  ctx.command('w+<page:number>', '跳转到指定页 Warfarin Wiki 检索结果')
    .action(async ({ session }, page?: number) => reply.from(session, () => jumpToPage(session, page)))

  ctx.command('w-', '显示上一页 Warfarin Wiki 检索结果')
    .action(async ({ session }) => reply.from(session, () => shiftPage(session, -1)))

  // Koishi 的 w+<page> 参数解析吃不到 "w+2" 这种紧贴写法，用中间件兜一层
  ctx.middleware(async (session, next) => {
    const content = String(session?.stripped?.content ?? session?.content ?? '').trim()
    const match = content.match(/^w\+([1-9]\d*)$/)
    if (!match) return next()
    const text = jumpToPage(session, Number(match[1]))
    const fallback = text ? await reply.send(session, text) : ''
    if (fallback) await session.send(fallback)
  })
}
