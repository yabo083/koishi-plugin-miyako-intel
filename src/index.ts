import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { decode } from 'html-entities'
import { Context, h, Schema, Session } from 'koishi'
import { z } from 'zod'

declare module 'koishi' {
  interface Context {
    puppeteer?: {
      page: () => Promise<any>
    }
    chatluna?: {
      platform?: {
        registerTool?: (name: string, toolCreator: any) => (() => void) | void
        unregisterTool?: (name: string) => void
      }
    }
  }
}

interface WikiSearchResult {
  pageid: number
  title: string
  snippet: string
  size: number
  timestamp: string
}

interface SearchContextEntry {
  query: string
  results: WikiSearchResult[]
  updatedAt: number
}

interface TokenBucket {
  tokens: number
  updatedAt: number
}

interface WikiSearchResponse {
  query?: {
    search?: Array<{
      pageid: number
      title: string
      snippet?: string
      size: number
      timestamp: string
    }>
  }
}

interface WikiParseResponse {
  parse?: {
    title: string
    text: string
  }
}

interface PageSummary {
  title: string
  text: string
  url: string
}

export interface Config {
  baseUrl: string
  maxResults: number
  contextTtlSeconds: number
  summaryLength: number
  adminUsers: string[]
  allowedGroups: string[]
  defaultPermission: 'all' | 'admin' | 'none'
  enableRateLimit: boolean
  rateLimitPerMinute: number
  enableScreenshot: boolean
  screenshotTimeoutMs: number
  screenshotRetentionHours: number
  defaultViewport: 'desktop' | 'mobile'
  enableChatLunaTool: boolean
  chatLunaToolName: string
}

export const name = 'prts-search'

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('https://prts.wiki').description('PRTS Wiki 根地址'),
  maxResults: Schema.number().default(5).min(1).max(10).description('搜索默认返回条数'),
  contextTtlSeconds: Schema.number().default(300).min(30).description('搜索上下文有效期（秒）'),
  summaryLength: Schema.number().default(1000).min(200).max(5000).description('详情最大文本长度'),
  adminUsers: Schema.array(String).default([]).description('管理员用户 ID 列表'),
  allowedGroups: Schema.array(String).default([]).description('允许使用的群组 ID 列表（空表示不过滤）'),
  defaultPermission: Schema.union(['all', 'admin', 'none']).default('all').description('默认权限策略'),
  enableRateLimit: Schema.boolean().default(true).description('是否开启限流'),
  rateLimitPerMinute: Schema.number().default(20).min(1).max(100).description('每用户每分钟请求数'),
  enableScreenshot: Schema.boolean().default(true).description('是否允许截图'),
  screenshotTimeoutMs: Schema.number().default(45000).min(5000).description('截图超时毫秒'),
  screenshotRetentionHours: Schema.number().default(24).min(1).description('截图文件保留时长（小时）'),
  defaultViewport: Schema.union(['desktop', 'mobile']).default('desktop').description('默认截图视口'),
  enableChatLunaTool: Schema.boolean().default(true).description('是否注册 ChatLuna 工具'),
  chatLunaToolName: Schema.string().default('prts_search').description('ChatLuna 工具名'),
})

class WikiClient {
  private readonly apiUrl: string
  private readonly rootUrl: string

  constructor(baseUrl: string) {
    const trimmed = baseUrl.replace(/\/+$/, '')
    if (trimmed.endsWith('/api.php')) {
      this.rootUrl = trimmed.slice(0, -8)
      this.apiUrl = trimmed
      return
    }
    this.rootUrl = trimmed
    this.apiUrl = `${trimmed}/api.php`
  }

  async search(query: string, limit: number, category?: string): Promise<WikiSearchResult[]> {
    const searchTerm = category ? `${query} incategory:"${category}"` : query
    const data = await this.request<WikiSearchResponse>({
      action: 'query',
      list: 'search',
      srsearch: searchTerm,
      srlimit: String(limit),
      srprop: 'snippet|size|timestamp',
      format: 'json',
      formatversion: '2',
    })

    const items = data.query?.search ?? []
    const normalized = items.map((item) => ({
      pageid: item.pageid,
      title: item.title,
      snippet: this.cleanText(item.snippet ?? ''),
      size: item.size,
      timestamp: item.timestamp,
    }))

    return normalized.sort((a, b) => {
      if (a.title === query) return -1
      if (b.title === query) return 1
      return 0
    })
  }

  async getPageSummary(title: string, maxLength: number): Promise<PageSummary> {
    const data = await this.request<WikiParseResponse>({
      action: 'parse',
      page: title,
      redirects: '1',
      prop: 'text',
      format: 'json',
      formatversion: '2',
    })

    if (!data.parse) {
      throw new Error('页面不存在或无法解析。')
    }

    const plain = this.cleanText(data.parse.text)
    const text = plain.length > maxLength
      ? `${plain.slice(0, maxLength)}...`
      : plain

    return {
      title: data.parse.title,
      text: text || '未提取到可展示的文本内容。',
      url: this.getPageUrl(data.parse.title),
    }
  }

  getPageUrl(title: string): string {
    const normalized = title.replace(/ /g, '_')
    return `${this.rootUrl}/index.php?title=${encodeURIComponent(normalized)}`
  }

  private async request<T>(params: Record<string, string>): Promise<T> {
    const search = new URLSearchParams(params)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(`${this.apiUrl}?${search.toString()}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'koishi-plugin-prts-search/0.1.0',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`PRTS API 请求失败: ${response.status} ${response.statusText}`)
      }
      return await response.json() as T
    } finally {
      clearTimeout(timer)
    }
  }

  private cleanText(input: string): string {
    return decode(input)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h\d|table|section)>/gi, '\n')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  const wiki = new WikiClient(config.baseUrl)
  const searchContext = new Map<string, SearchContextEntry>()
  const rateBuckets = new Map<string, TokenBucket>()
  let unregisterTool: (() => void) | undefined

  const getContextKey = (session: Session) => {
    const scope = session.guildId ? `guild:${session.guildId}` : `user:${session.userId ?? 'unknown'}`
    return `${session.platform}:${scope}`
  }

  const normalizeViewport = (viewport?: string): 'desktop' | 'mobile' => {
    if (viewport === 'mobile') return 'mobile'
    return 'desktop'
  }

  const checkPermission = (session: Session): string | null => {
    const userId = session.userId ?? ''
    if (config.adminUsers.includes(userId)) return null

    const guildId = session.guildId
    if (config.allowedGroups.length > 0 && guildId) {
      if (!config.allowedGroups.includes(guildId)) {
        return '当前群组未授权使用 PRTS 搜索。'
      }
    }

    if (config.defaultPermission === 'none') {
      return 'PRTS 搜索已禁用。'
    }

    if (config.defaultPermission === 'admin') {
      return '当前仅管理员可使用 PRTS 搜索。'
    }

    return null
  }

  const checkRateLimit = (session: Session): string | null => {
    if (!config.enableRateLimit) return null

    const key = `${session.platform}:${session.userId}`
    const now = Date.now()
    const limit = config.rateLimitPerMinute
    const refillRate = limit / 60
    const bucket = rateBuckets.get(key) ?? { tokens: limit, updatedAt: now }
    const elapsed = Math.max(0, (now - bucket.updatedAt) / 1000)
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRate)
    bucket.updatedAt = now

    if (bucket.tokens < 1) {
      rateBuckets.set(key, bucket)
      const waitSeconds = Math.ceil((1 - bucket.tokens) / refillRate)
      return `请求过于频繁，请在 ${waitSeconds} 秒后重试。`
    }

    bucket.tokens -= 1
    rateBuckets.set(key, bucket)
    return null
  }

  const requireAccess = (session: Session): string | null => {
    return checkPermission(session) ?? checkRateLimit(session)
  }

  const getContext = (session: Session): SearchContextEntry | undefined => {
    const key = getContextKey(session)
    const entry = searchContext.get(key)
    if (!entry) return undefined

    const maxAge = config.contextTtlSeconds * 1000
    if (Date.now() - entry.updatedAt > maxAge) {
      searchContext.delete(key)
      return undefined
    }
    return entry
  }

  const saveContext = (session: Session, query: string, results: WikiSearchResult[]) => {
    searchContext.set(getContextKey(session), {
      query,
      results,
      updatedAt: Date.now(),
    })
  }

  const capturePage = async (title: string, viewport: 'desktop' | 'mobile') => {
    if (!config.enableScreenshot) {
      throw new Error('截图功能已关闭。')
    }

    const puppeteer = ctx.puppeteer
    if (!puppeteer?.page) {
      throw new Error('未检测到 Koishi puppeteer 服务，请安装并启用 koishi-plugin-puppeteer。')
    }

    const outputDir = path.resolve(ctx.baseDir, 'data', 'prts-search')
    await fs.mkdir(outputDir, { recursive: true })
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
    const outputPath = path.join(outputDir, `${safeTitle}-${Date.now()}.png`)

    const page = await puppeteer.page()
    try {
      const viewportSize = viewport === 'mobile'
        ? { width: 430, height: 932 }
        : { width: 1366, height: 900 }
      await page.setViewport(viewportSize)
      await page.goto(wiki.getPageUrl(title), {
        waitUntil: 'networkidle2',
        timeout: config.screenshotTimeoutMs,
      })
      await page.screenshot({
        path: outputPath,
        fullPage: true,
      })
      return outputPath
    } finally {
      await page.close().catch(() => undefined)
    }
  }

  const renderSearchResult = (query: string, results: WikiSearchResult[]) => {
    const lines: string[] = []
    lines.push(`PRTS 搜索「${query}」共 ${results.length} 条：`)
    lines.push('')
    for (const [index, item] of results.entries()) {
      lines.push(`${index + 1}. ${item.title}`)
      if (item.snippet) {
        lines.push(`   ${item.snippet.slice(0, 120)}`)
      }
      lines.push('')
    }
    lines.push(`回复数字 1-${results.length} 可直接查看详情，或使用 prts.view <编号>。`)
    return lines.join('\n')
  }

  const doView = async (
    session: Session,
    index: number,
    withScreenshot: boolean,
    viewport: 'desktop' | 'mobile',
  ) => {
    const entry = getContext(session)
    if (!entry) {
      return '没有可用的搜索上下文，请先执行 prts <关键词>。'
    }

    if (index < 0 || index >= entry.results.length) {
      return `编号超出范围，请输入 1-${entry.results.length}。`
    }

    const item = entry.results[index]
    const summary = await wiki.getPageSummary(item.title, config.summaryLength)

    if (withScreenshot) {
      try {
        const filePath = await capturePage(summary.title, viewport)
        await session.send(h.image(pathToFileURL(filePath).href))
      } catch (error) {
        logger.warn(`截图失败 (${summary.title}): ${String(error)}`)
      }
    }

    return [
      `【${summary.title}】`,
      '',
      summary.text,
      '',
      summary.url,
    ].join('\n')
  }

  ctx.command('prts [keywords:text]', '搜索 PRTS Wiki 内容')
    .option('category', '-c <category:string>', { fallback: '' })
    .option('limit', '-n <limit:number>', { fallback: 0 })
    .action(async ({ session, options }, keywords) => {
      if (!session) return '当前上下文不支持该指令。'
      const query = keywords?.trim()
      if (!query) {
        return '用法：prts <关键词>\n可选：-c <分类> -n <数量>'
      }

      const opts = options ?? {}
      const denied = requireAccess(session)
      if (denied) return denied

      const limit = Math.max(1, Math.min((opts.limit as number) || config.maxResults, 10))
      const category = (opts.category as string | undefined)?.trim() || undefined

      try {
        const results = await wiki.search(query, limit, category)
        if (!results.length) {
          return `未找到与「${query}」相关的内容。`
        }
        saveContext(session, query, results)
        return renderSearchResult(query, results)
      } catch (error) {
        logger.error(error)
        return '搜索失败，请稍后再试。'
      }
    })

  ctx.command('prts.view <index:number>', '查看最近搜索结果中的指定条目')
    .option('screenshot', '-s', { fallback: false })
    .option('viewport', '-v <viewport:string>', { fallback: '' })
    .action(async ({ session, options }, index) => {
      if (!session) return '当前上下文不支持该指令。'
      const opts = options ?? {}
      const denied = requireAccess(session)
      if (denied) return denied

      try {
        return await doView(
          session,
          index - 1,
          Boolean(opts.screenshot),
          normalizeViewport((opts.viewport as string | undefined) || config.defaultViewport),
        )
      } catch (error) {
        logger.error(error)
        return '获取详情失败，请稍后再试。'
      }
    })

  ctx.command('prts.shot <title:text>', '对指定 PRTS 页面截图')
    .option('viewport', '-v <viewport:string>', { fallback: '' })
    .action(async ({ session, options }, title) => {
      if (!session) return '当前上下文不支持该指令。'
      const pageTitle = title?.trim()
      if (!pageTitle) {
        return '请提供页面标题，例如：prts.shot 银灰'
      }

      const opts = options ?? {}
      const denied = requireAccess(session)
      if (denied) return denied

      try {
        const filePath = await capturePage(pageTitle, normalizeViewport((opts.viewport as string | undefined) || config.defaultViewport))
        await session.send(h.image(pathToFileURL(filePath).href))
        return `截图已生成：${pageTitle}`
      } catch (error) {
        logger.error(error)
        return `截图失败：${String(error)}`
      }
    })

  ctx.command('prts.clear', '清空当前会话的搜索上下文')
    .action(({ session }) => {
      if (!session) return '当前上下文不支持该指令。'
      searchContext.delete(getContextKey(session))
      return '已清空当前搜索上下文。'
    })

  ctx.middleware(async (session, next) => {
    const content = session.stripped.content?.trim()
    if (!content) return next()

    const entry = getContext(session)
    if (!entry) return next()

    if (/^[cC]$/.test(content)) {
      searchContext.delete(getContextKey(session))
      return '已取消本次结果会话。'
    }

    if (!/^\d+$/.test(content)) return next()
    const index = Number(content) - 1

    try {
      return await doView(session, index, false, config.defaultViewport)
    } catch (error) {
      logger.error(error)
      return '查看详情失败，请稍后再试。'
    }
  })

  const registerChatLunaTool = () => {
    if (!config.enableChatLunaTool) return

    const platform = ctx.chatluna?.platform
    if (!platform?.registerTool) {
      logger.info('未检测到 ChatLuna，跳过工具注册。')
      return
    }

    try {
      const schema: any = z.object({
        query: z.string().optional().describe('搜索关键词'),
        title: z.string().optional().describe('直接指定页面标题获取摘要'),
        category: z.string().optional().describe('分类过滤，例如 干员 / 关卡'),
        limit: z.number().int().min(1).max(10).optional().describe('返回数量，默认 5'),
      })

      const maybeUnregister = platform.registerTool(config.chatLunaToolName, {
        createTool: () => new DynamicStructuredTool({
          name: config.chatLunaToolName,
          description: 'Search PRTS Wiki by query, or return page summary by title.',
          schema,
          func: async (input) => {
            const args = input as {
              query?: string
              title?: string
              category?: string
              limit?: number
            }

            if (args.title) {
              const summary = await wiki.getPageSummary(args.title, config.summaryLength)
              return JSON.stringify(summary, null, 2)
            }

            const query = args.query?.trim() ?? ''
            const limit = Math.max(1, Math.min(args.limit ?? config.maxResults, 10))
            const results = await wiki.search(query, limit, args.category?.trim() || undefined)
            return JSON.stringify({
              query,
              count: results.length,
              results: results.map((item) => ({
                title: item.title,
                snippet: item.snippet,
                url: wiki.getPageUrl(item.title),
              })),
            }, null, 2)
          },
        }),
        selector: () => true,
      })
      if (typeof maybeUnregister === 'function') {
        unregisterTool = maybeUnregister
      }

      logger.info(`ChatLuna 工具已注册：${config.chatLunaToolName}`)
    } catch (error) {
      logger.warn(`ChatLuna 工具注册失败：${String(error)}`)
    }
  }

  const cleanupExpiredData = async () => {
    const now = Date.now()
    const contextMaxAge = config.contextTtlSeconds * 1000

    for (const [key, entry] of searchContext.entries()) {
      if (now - entry.updatedAt > contextMaxAge) {
        searchContext.delete(key)
      }
    }

    const staleRateLimitAge = 30 * 60 * 1000
    for (const [key, bucket] of rateBuckets.entries()) {
      if (now - bucket.updatedAt > staleRateLimitAge) {
        rateBuckets.delete(key)
      }
    }

    const outputDir = path.resolve(ctx.baseDir, 'data', 'prts-search')
    const maxAge = config.screenshotRetentionHours * 60 * 60 * 1000

    try {
      const files = await fs.readdir(outputDir, { withFileTypes: true })
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.png')) continue
        const fullPath = path.join(outputDir, file.name)
        const stat = await fs.stat(fullPath)
        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(fullPath).catch(() => undefined)
        }
      }
    } catch {
      // Ignore when directory does not exist.
    }
  }

  ctx.on('ready', () => {
    registerChatLunaTool()
  })

  ctx.setInterval(() => {
    void cleanupExpiredData()
  }, 60_000)

  ctx.on('dispose', () => {
    if (unregisterTool) {
      unregisterTool()
      unregisterTool = undefined
    } else if (ctx.chatluna?.platform?.unregisterTool) {
      ctx.chatluna.platform.unregisterTool(config.chatLunaToolName)
    }
  })

  logger.info('PRTS Search 插件已加载。')
}
