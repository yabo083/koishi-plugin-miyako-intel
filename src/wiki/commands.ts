// w / wn / w+ / w- / w热点 / w热点图 命令族：解析输入 → 调编排器 → 存选择态 → 交给发送器
import { Context, h } from 'koishi'
import { ScopedLogger } from '../core/logger'
import { formatError } from '../core/errors'
import { Config as RuntimeConfig } from '../types'
import { WarfarinWikiApiError } from '../services/warfarin-wiki'
import { WikiSearchSource } from './fold'
import { formatWikiCommandError, formatWikiContext, formatWikiSearchBatch, formatWikiSearchResults, getWikiBatchSize } from './format'
import { WikiSearchOrchestrator } from './search'
import { WikiSelectionStore } from './selection'
import { createWikiReplySender } from './reply'
import { normalizeQueryText } from './obfuscate'
import { normalizeOneBotId } from './onebot-forward'
import { QueryStatsStore } from './query-stats'

const NEED_SEARCH_FIRST = '请先使用 w 关键词 检索。'
const SESSION_ONLY = '只能在会话中使用该命令。'
const NEED_KEYWORD = '请输入关键词，例如：w 息壤'

export interface WikiCommandsDeps {
  ctx: Context
  wiki: RuntimeConfig['wiki']
  search: WikiSearchOrchestrator
  selections: WikiSelectionStore
  logger: ScopedLogger
  stats?: QueryStatsStore
  /** 周报预览文本（按群生成，只预览不发送） */
  digestPreview?: (groupId: string) => Promise<string> | string
  /** 周报长图切片；返回字符串时是失败原因/空态文案，原样回复 */
  digestImages?: (groupId: string) => Promise<Buffer[] | string>
}

/** h.image 的 mime：切片默认 PNG，超限时渲染端会退回 JPEG，按魔数认 */
function imageMime(buffer: Buffer) {
  return buffer[0] === 0xff && buffer[1] === 0xd8 ? 'image/jpeg' : 'image/png'
}

function asBatchText(batch: string | string[]) {
  return Array.isArray(batch) ? batch.join('\n\n') : batch
}

/** 群号统一归一为 OneBot 数字字符串；私聊没有群号，返回空串不入统计 */
function sessionGroupId(session: any): string {
  const raw = session?.guildId || (session?.subtype === 'group' ? session?.channelId || session?.cid : '')
  if (!raw) return ''
  return String(normalizeOneBotId(raw) ?? '')
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
  const normalize = (input: string) => normalizeQueryText(input, wiki.obfuscateHomophones)

  async function searchAndRemember(session: any, keyword: string, source: WikiSearchSource = 'wiki') {
    if (!session) return SESSION_ONLY
    const normalized = normalize(keyword)
    if (!normalized) return NEED_KEYWORD
    try {
      const result = source === 'story'
        ? await search.searchSingleSource(normalized, 'story')
        : await search.searchAllSources(normalized)
      const groupId = sessionGroupId(session)
      if (groupId) void deps.stats?.recordSearch(groupId, normalized, result.total)
      const dataUpdatedLabel = await search.storyDataUpdatedLabel()
      selections.remember(session, {
        keyword: normalized,
        offset: 0,
        total: result.total,
        results: result.results,
        dataUpdatedLabel,
      })
      return asBatchText(formatWikiSearchBatch({
        ...result,
        ...listFormat,
        keyword: normalized,
        offset: 0,
        pageSize: wiki.pageSize,
        pageCount: wiki.initialPageCount,
        dataUpdatedLabel,
        excerptChars: wiki.excerptChars,
      }))
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
    const normalized = normalize(input)
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
    const keyword = selections.get(session)?.keyword
    const format = (result: Parameters<typeof formatWikiContext>[0]) =>
      formatWikiContext(result, { mode: wiki.contextMode, maxChars: wiki.contextChars, keyword })
    try {
      const result = await search.fetchContext(anchor, actualSource)
      const groupId = sessionGroupId(session)
      // 详情查看归因到当次检索词（选择态里存的 keyword）
      if (groupId) void deps.stats?.recordView(groupId, keyword, anchor)
      return format(result)
    } catch (error) {
      const what = actualSource === 'story' ? '剧情/任务全文' : '终末地资料'
      logger.warn(`${what}上下文检索失败：${formatError(error)}`)
      // 官方详情拿不到时退回搜索摘要，条目本身仍然可读。
      if (actualSource === 'wiki' || (error instanceof WarfarinWikiApiError && error.code === 404)) {
        return format({ anchor, full_text: [], summary: null, source_ref: anchor.source })
      }
      return formatWikiCommandError(error, '资料上下文暂时不可用，请稍后重试。')
    }
  }
  /** w+ / w-：整批前后挪 */
  function shiftPage(session: any, direction: 1 | -1) {
    if (!session) return SESSION_ONLY
    const entry = selections.shiftBatch(session, direction, getWikiBatchSize(wiki))
    if (!entry) return NEED_SEARCH_FIRST
    return asBatchText(formatWikiSearchBatch({
      ...entry,
      ...listFormat,
      took_ms: 0,
      pageSize: wiki.pageSize,
      pageCount: wiki.initialPageCount,
      excerptChars: wiki.excerptChars,
    }))
  }

  /** w+2：跳到第 2 页，只发那一页 */
  function jumpToPage(session: any, page: unknown) {
    if (!session) return SESSION_ONLY
    const pageNumber = Number(page)
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) return '页码必须是大于 0 的整数。'
    const entry = selections.jumpToPage(session, pageNumber, wiki.pageSize)
    if (!entry) return NEED_SEARCH_FIRST
    return formatWikiSearchResults({ ...entry, ...listFormat, took_ms: 0, pageSize: wiki.pageSize, excerptChars: wiki.excerptChars })
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

  ctx.command('w热点', '预览本群本周 Warfarin 热点检索词条（仅生成，不发送）')
    .action(async ({ session }) => reply.from(session, async () => {
      const groupId = sessionGroupId(session)
      if (!groupId) return '请在群内使用。'
      return (await deps.digestPreview?.(groupId)) || '热点词条统计不可用。'
    }))

  // 把周报长图按切片逐条发到当前会话：只预览，不上传相册、不发提示、不清窗口
  ctx.command('w热点图', '渲染本群本周 Warfarin 热点检索词条长图（仅预览，不入相册）')
    .action(async ({ session }) => {
      if (!session) return SESSION_ONLY
      const groupId = sessionGroupId(session)
      if (!groupId) return '请在群内使用。'
      const result = await deps.digestImages?.(groupId)
      if (typeof result === 'string') return result
      if (!result?.length) return '热点词条统计不可用。'
      for (const slice of result) await session.send(h.image(slice, imageMime(slice)))
      return undefined
    })

  // Koishi 的 w+<page> 参数解析吃不到 "w+2" 这种紧贴写法，用中间件兜一层
  ctx.middleware(async (session, next) => {
    const content = normalize(String(session?.stripped?.content ?? session?.content ?? ''))
    const match = content.match(/^w\+([1-9]\d*)$/)
    if (!match) return next()
    const text = jumpToPage(session, Number(match[1]))
    const fallback = text ? await reply.send(session, text) : ''
    if (fallback) await session.send(fallback)
  })
}
