import { Context, Universal } from 'koishi'
import { isAbsolute, join, resolve } from 'node:path'
import { Config as RuntimeConfig } from './types'
import { Config, STORY_SCOPES, resolveConfig } from './config'
import { createScopedLogger } from './core/logger'
import { createKoishiHttpFetch } from './core/http'
import { createDailyClaim } from './core/scheduler'
import { requireDelivery } from './core/delivery'
import { DAILY_CACHE_DIRECTORY, DAY_REFRESH_HOUR, TIMEZONE } from './core/constants'
import { getPrtsDayKey } from './core/time'
import { DEFAULT_CACHE_MAINTENANCE, DailyImageCache } from './services/cache'
import { PrtsCaptureService } from './services/capture'
import { WarfarinWikiClient } from './services/warfarin-wiki'
import { WarfarinStorySearchService } from './services/warfarin-story-search'
import { registerDailyCommands } from './daily/commands'
import { createDailyJobs } from './daily/jobs'
import { WikiSearchOrchestrator } from './wiki/search'
import { WikiSelectionStore } from './wiki/selection'
import { registerWikiCommands } from './wiki/commands'
import { createStoryUpdater } from './wiki/story-update'
import { QueryStatsStore } from './wiki/query-stats'
import { buildWikiDigestGroupData, formatWikiDigestText, renderWikiDigestImage, renderWikiDigest404Image, wikiDigestAbsentNotice, wikiDigestNotice } from './wiki/digest'
import { channelGroupId, createAlbumHub } from './wiki/album'
import { } from './wiki/detail-image'
import { obfuscateOutgoing } from './wiki/obfuscate'
import { formatError } from './core/errors'
import { registerConsolePanel } from './console/status'

export { getPrtsDayKey }
export { Config }
export { splitWikiMessage } from './wiki/message-split'
export { foldCrossSourceDuplicates } from './wiki/fold'
export type { Config as ArknightsIntelConfig } from './types'

export const name = 'miyako-intel'
export const inject = {
  required: ['miyako-delivery'] as const,
  optional: ['puppeteer', 'console', 'database'] as const,
}

export const usage = `
<p><strong>每日情报信笺</strong></p>
<ul>
  <li>每天自动抓取 PRTS 首页并渲染「今日信笺」卡片图（资源收集、核心动态、生日干员贴画、近期新增）。</li>
  <li><code>refreshCron</code> 为后台刷新时间，<code>scheduledPush.cron</code> 为推送时间，格式均为 <code>分钟 小时 日期 月份 星期</code>，由 <code>miyako-delivery</code> 按东八区调度。</li>
  <li>推送目标 <code>scheduledPush.channels</code> 填 Koishi 频道 ID，OneBot/NapCat 群示例：<code>onebot:11111111</code>。</li>
  <li>关闭「每日情报卡片」开关后不抓取、不推送；<code>cardStyle</code> 可切换日报卡片风格。</li>
</ul>
<p><strong>Warfarin 检索</strong>：<code>w 息壤</code> 检索；<code>w 1</code> 查看结果，<code>w+</code> 翻页，<code>w+2</code> 跳页；<code>wn 321</code> 强制搜索纯数字关键词。</p>
`

declare module 'koishi' {
  interface Context {
    puppeteer?: {
      page: () => Promise<any>
    }
    console?: {
      addEntry: (entry: { dev: string; prod: string }) => void
      addListener?: (name: string, listener: (...args: any[]) => any) => void
    }
  }
}

/** 只做装配：建服务 → 注册命令与控制台 → 挂后台循环 */
export interface ApplyInternals {
  /** 仅测试用：缩短群相册探测防抖（生产默认 10s） */
  albumDetectDebounceMs?: number
  /** 仅测试用：固定回退卡片/404 图的随机理由抽取结果 */
  random?: () => number
}

export function apply(ctx: Context, config: RuntimeConfig, internals?: ApplyInternals) {
  const resolved = resolveConfig(config)
  const { wiki } = resolved
  const logger = createScopedLogger(ctx.logger(name), resolved.logLevel)
  const nowProvider = () => resolved.now ? new Date(resolved.now) : new Date()
  const httpFetch = createKoishiHttpFetch(ctx.http, wiki.timeoutMs)

  const cache = new DailyImageCache(ctx.baseDir, DAILY_CACHE_DIRECTORY, TIMEZONE, DAY_REFRESH_HOUR, nowProvider)
  const capture = new PrtsCaptureService(ctx, cache, logger, {
    nowProvider,
    styleId: resolved.cardStyle,
    random: internals?.random,
  })

  const wikiClient = new WarfarinWikiClient({
    baseUrl: wiki.baseUrl, mode: wiki.mode, language: wiki.language,
    userAgent: wiki.userAgent, timeoutMs: wiki.timeoutMs, fetch: httpFetch,
  })
  const storyClient = new WarfarinWikiClient({
    baseUrl: wiki.storyBaseUrl, mode: 'story', language: wiki.storyLanguage,
    scopes: STORY_SCOPES, pageBaseUrl: '',
    userAgent: wiki.userAgent, timeoutMs: wiki.timeoutMs, fetch: httpFetch,
  })
  const storySearch = new WarfarinStorySearchService({
    baseDir: ctx.baseDir, dataDirectory: wiki.storyDataDirectory, language: wiki.storyLanguage,
    timeoutMs: wiki.timeoutMs, bundleManifestUrl: wiki.storyBundleManifestUrl, fetch: httpFetch,
  })

  // 共享投递服务（miyako-delivery）：cron 调度、日切水位、日报群发、周报相册上传都走它。
  // 它是硬依赖（inject.required），Koishi 会等它就绪后再 apply 本插件。
  const delivery = requireDelivery(ctx)
  const gate = createDailyClaim({ nowProvider, delivery, logger })
  logger.info('已接入 miyako-delivery：定时调度、日切水位、日报群发与周报相册由其承担。')
  const search = new WikiSearchOrchestrator({ wikiClient, storyClient, storySearch, wiki, storyScopes: STORY_SCOPES, logger })
  const selections = new WikiSelectionStore(wiki.selectionTtlMs)
  const storyUpdater = createStoryUpdater({ storySearch, search, wiki, gate, logger })
  const dailyJobs = createDailyJobs({ capture, cache, config: resolved, gate, delivery, logger })

  // 热点检索词条统计与周报共用剧情数据目录；统计只记检索词/词条点击/时间，不落身份信息
  const storyDataRoot = isAbsolute(wiki.storyDataDirectory) ? wiki.storyDataDirectory : resolve(ctx.baseDir, wiki.storyDataDirectory)
  const statsDirectory = join(storyDataRoot, 'stats')
  const queryStats = new QueryStatsStore(join(statsDirectory, 'queries.json'), { now: nowProvider })
  const albumHub = createAlbumHub({ ctx, wiki, logger, statsDirectory, pushChannels: () => resolved.scheduledPush.channels || [], delivery })
  void albumHub.initSchema()

  // 群相册探测：每次插件启动只跑一次（频繁调用相册接口易触发风控）；
  // 启动时 bot 还没上线就等它首次上线再跑，跑过之后不再响应任何事件。
  const ALBUM_DETECT_DEBOUNCE_MS = internals?.albumDetectDebounceMs ?? 10_000
  let albumDetectTimer: ReturnType<typeof setTimeout> | undefined
  let albumDetected = false
  const oneBotOnline = () => (ctx.bots as any[]).some((bot) => bot?.platform === 'onebot' && bot?.status === Universal.Status.ONLINE)
  const scheduleAlbumDetect = () => {
    if (albumDetected || albumDetectTimer) return
    albumDetectTimer = setTimeout(() => {
      albumDetectTimer = undefined
      if (albumDetected || !oneBotOnline()) return
      albumDetected = true
      albumHub.detectAlbums().catch((error) => logger.warn(`群相册探测失败：${formatError(error)}`))
    }, ALBUM_DETECT_DEBOUNCE_MS)
    albumDetectTimer.unref?.()
  }
  for (const event of ['login-added', 'login-updated'] as const) {
    ctx.on(event, (session) => { if (session?.bot?.platform === 'onebot') scheduleAlbumDetect() })
  }
  ctx.on('dispose', () => { if (albumDetectTimer) clearTimeout(albumDetectTimer) })
  scheduleAlbumDetect()

  /** 单个群的周报数据（检索词 → 词条详情或检索索引） */
  const digestGroupData = (groupId: string) =>
    buildWikiDigestGroupData({ wiki, search, stats: queryStats, logger }, groupId, albumHub.groupLabel(groupId), queryStats.windowStart(groupId), nowProvider())
  /** w热点：本群热点检索词条预览（只生成，不上传、不清窗口） */
  const digestPreview = async (groupId: string) => {
    await queryStats.ready()
    return formatWikiDigestText(await digestGroupData(groupId), wiki.digestMinCount)
  }
  /** w热点图：本群周报长图切片（只渲染发送，不上传/不通知/不重置） */
  const digestImages = async (groupId: string): Promise<Buffer[] | string> => {
    await queryStats.ready()
    const data = await digestGroupData(groupId)
    if (!ctx.puppeteer?.page) return '未启用 puppeteer，无法渲染长图。'
    try {
      return [data.terms.length
        ? await renderWikiDigestImage(ctx, data)
        : await renderWikiDigest404Image(ctx, data, wiki.digestMinCount, internals?.random)]
    } catch (error) {
      logger.warn(`热点词条周报「${groupId}」长图渲染失败：${formatError(error)}`)
      return '长图渲染失败，请查看日志。'
    }
  }
  /** 控制台预览：只列配置里的群（scheduledPush.channels + digestAlbums 并集，渠道在前），有统计但不在配置的不出现 */
  const digestPreviewAll = async () => {
    await queryStats.ready()
    const albumByGroup = new Map<string, string>()
    for (const value of wiki.digestAlbums || []) {
      const [groupId, albumId] = String(value || '').split('/')
      if (groupId && albumId && !albumByGroup.has(groupId)) albumByGroup.set(groupId, albumId)
    }
    const groupIds: string[] = []
    for (const groupId of (resolved.scheduledPush.channels || []).map(channelGroupId).filter(Boolean) as string[]) {
      if (!groupIds.includes(groupId)) groupIds.push(groupId)
    }
    for (const groupId of albumByGroup.keys()) {
      if (!groupIds.includes(groupId)) groupIds.push(groupId)
    }
    if (!groupIds.length) return '未配置任何群：请在 scheduledPush.channels 填写群。'
    const parts = await Promise.all(groupIds.map(async (groupId) => {
      const albumId = albumByGroup.get(groupId)
      const albumLine = albumId ? `相册：${albumHub.albumLabel(groupId, albumId)}` : '相册：未选择'
      return `【${albumHub.groupLabel(groupId)}】\n${albumLine}\n${await digestPreview(groupId)}`
    }))
    return parts.join('\n\n')
  }

  registerConsolePanel({ ctx, config: resolved, search, storySearch, storyUpdater, storyScopes: STORY_SCOPES,
    digestPreview: digestPreviewAll, digestRun: () => runWikiDigest(true) })
  registerDailyCommands({ ctx, capture, cache, logger })
  registerWikiCommands({ ctx, wiki, search, selections, logger, stats: queryStats, digestPreview, digestImages })
  storyUpdater.loadOnStart()
  ctx.on('dispose', () => void queryStats.dispose())

  const obfuscateOptions = {
    enabled: wiki.obfuscateEnabled,
    zeroWidthInterval: wiki.obfuscateZeroWidthInterval,
    homophones: wiki.obfuscateHomophones,
  }

  /** 热点词条周报：digestAlbums 里每个「群/相册」渲一张长图上传；未配置相册的群只记日志 */
  async function runWikiDigest(skipGuards: boolean) {
    const results: string[] = []
    if (!skipGuards && !wiki.digestEnabled) return results
    const dayKey = skipGuards ? 'manual' : await gate.claim('wiki-digest')
    if (!dayKey) return results
    await queryStats.ready()
    const now = nowProvider()
    const configured = (wiki.digestAlbums || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => {
        const [groupId, albumId] = value.split('/')
        return { groupId: String(groupId || ''), albumId: String(albumId || '') }
      })
      .filter((item) => item.groupId && item.albumId)
    const configuredGroups = new Set(configured.map((item) => item.groupId))

    for (const { groupId, albumId } of configured) {
      const last = queryStats.lastDigestAt(groupId)
      if (!skipGuards && last && now.getTime() - last.getTime() <= 6 * 24 * 60 * 60 * 1000) {
        results.push(`${groupId}：距上次发送不足 6 天，跳过`)
        continue
      }
      const data = await digestGroupData(groupId)
      const absent = !data.terms.length
      if (!ctx.puppeteer) {
        results.push(`${groupId}：puppeteer 不可用，跳过`)
        continue
      }
      let uploaded = false
      try {
        const image = absent
          ? await renderWikiDigest404Image(ctx, data, wiki.digestMinCount, internals?.random)
          : await renderWikiDigestImage(ctx, data)
        uploaded = await albumHub.uploadImages(groupId, albumId, [image])
      } catch (error) {
        logger.warn(`热点词条周报「${groupId}」渲染或上传异常：${formatError(error)}`)
      }
      if (!uploaded) {
        results.push(`${groupId}：上传相册失败，未通知、未重置`)
        continue
      }
      const albumName = albumHub.albumLabel(groupId, albumId)
      if (wiki.digestNotify) {
        const notice = absent
          ? wikiDigestAbsentNotice(albumName, wiki.digestMinCount)
          : wikiDigestNotice(albumName, data.terms.length)
        try {
          await albumHub.notifyGroup(groupId, obfuscateOutgoing(notice, obfuscateOptions))
        } catch (error) {
          logger.warn(`热点词条周报「${groupId}」通知发送失败：${formatError(error)}`)
        }
      }
      queryStats.markDigest(groupId, now)
      if (!absent && wiki.digestResetAfterSend) queryStats.reset(groupId)
      results.push(`${groupId}：已上传「${albumName}」（${data.terms.length} 条）`)
    }

    // 配置渠道内但没配相册的群：只生成文本预览日志；渠道之外的统计群（如沙盒）不处理
    const channelGroups = new Set((resolved.scheduledPush.channels || []).map(channelGroupId).filter(Boolean) as string[])
    for (const groupId of queryStats.groups()) {
      if (configuredGroups.has(groupId) || !channelGroups.has(groupId)) continue
      const data = await digestGroupData(groupId)
      if (data.terms.length) logger.info(`热点词条周报（${albumHub.groupLabel(groupId)}，未配置相册，仅生成）：\n${formatWikiDigestText(data, wiki.digestMinCount)}`)
    }
    await queryStats.flush()
    return results
  }

  // 周期任务全部交给 miyako-delivery 调度（表达式仍来自本插件配置，按东八区计算）
  const scheduledStops: Array<() => void> = []
  let scheduledCount = 0
  const singleFlight = (label: string, run: () => void | Promise<unknown>) => {
    let running = false
    return async () => {
      if (running) {
        logger.debug(`${label}上一轮仍在运行，跳过本次触发。`)
        return
      }
      running = true
      try {
        await run()
      } catch (error) {
        logger.warn(`${label}执行失败：${formatError(error)}`)
      } finally {
        running = false
      }
    }
  }
  // 日报相关任务共享一条串行链：保持迁移前「刷新 → 推送 → 维护」的顺序，
  // 避免同分钟触发时 refresh 与 push 各自渲染一次卡片
  let dailyTail: Promise<unknown> = Promise.resolve()
  const queueDaily = (label: string, run: () => void | Promise<unknown>) => {
    const task = singleFlight(label, run)
    return () => {
      const chained = dailyTail.then(task, task)
      dailyTail = chained.then(() => undefined, () => undefined)
      return chained
    }
  }
  const schedule = (label: string, expression: string, run: () => void | Promise<unknown>) => {
    try {
      scheduledStops.push(delivery.scheduleCron(expression, singleFlight(label, run), { timeZone: TIMEZONE }))
      scheduledCount += 1
    } catch (error) {
      logger.warn(`${label} cron 表达式「${expression}」无效（${formatError(error)}），已跳过调度。`)
    }
  }

  if (resolved.dailyCardEnabled) {
    schedule('日报刷新', resolved.refreshCron, queueDaily('日报刷新', () => capture.refreshIfMissing()))
    if (resolved.scheduledPush.enabled) schedule('日报推送', resolved.scheduledPush.cron, queueDaily('日报推送', () => dailyJobs.pushDaily()))
    schedule('缓存维护', DEFAULT_CACHE_MAINTENANCE.archiveCron, queueDaily('缓存维护', () => dailyJobs.maintainCache()))
  }
  if (wiki.storySearchEnabled) schedule('剧情文本更新', wiki.storyUpdateCron, () => storyUpdater.runDue())
  if (wiki.digestEnabled) schedule('热点词条周报', wiki.digestCron, () => runWikiDigest(false))
  ctx.on('dispose', () => { for (const stop of scheduledStops) stop() })

  logger.info(`Miyako 游戏情报插件已加载。${scheduledCount} 个定时任务由 miyako-delivery 调度（东八区）；日报刷新 ${resolved.dailyCardEnabled ? resolved.refreshCron : '关闭'}；推送 ${resolved.scheduledPush.enabled ? resolved.scheduledPush.cron : '关闭'}。`)
}
