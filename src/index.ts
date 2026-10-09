import { Context } from 'koishi'
import { Config as RuntimeConfig } from './types'
import { Config, STORY_SCOPES, resolveConfig } from './config'
import { createScopedLogger } from './core/logger'
import { createKoishiHttpFetch } from './core/http'
import { DailyCronGate, startBackgroundLoop } from './core/scheduler'
import { DAILY_CACHE_DIRECTORY, DAY_REFRESH_HOUR, TIMEZONE } from './core/constants'
import { getPrtsDayKey } from './core/time'
import { DailyImageCache } from './services/cache'
import { PrtsCaptureService } from './services/capture'
import { WarfarinWikiClient } from './services/warfarin-wiki'
import { WarfarinStorySearchService } from './services/warfarin-story-search'
import { registerDailyCommands } from './daily/commands'
import { createDailyJobs } from './daily/jobs'
import { WikiSearchOrchestrator } from './wiki/search'
import { WikiSelectionStore } from './wiki/selection'
import { registerWikiCommands } from './wiki/commands'
import { createStoryUpdater } from './wiki/story-update'
import { registerConsolePanel } from './console/status'

export { getPrtsDayKey }
export { Config }
export { buildForwardFallbackMessages } from './wiki/onebot-forward'
export { foldCrossSourceDuplicates } from './wiki/fold'
export type { Config as ArknightsIntelConfig } from './types'

export const name = 'miyako-intel'
export const inject = { optional: ['puppeteer', 'console', 'database'] as const }

export const usage = `
<p><strong>每日情报信笺</strong></p>
<ul>
  <li>每天自动抓取 PRTS 首页并渲染「今日信笺」卡片图（资源收集、核心动态、生日干员贴画、近期新增）。</li>
  <li><code>refreshCron</code> 为后台刷新时间，<code>scheduledPush.cron</code> 为推送时间，格式均为 <code>分钟 小时 日期 月份 星期</code>。</li>
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
export function apply(ctx: Context, config: RuntimeConfig) {
  const resolved = resolveConfig(config)
  const { wiki } = resolved
  const logger = createScopedLogger(ctx.logger(name), resolved.logLevel)
  const nowProvider = () => resolved.now ? new Date(resolved.now) : new Date()
  const httpFetch = createKoishiHttpFetch(ctx.http, wiki.timeoutMs)

  const cache = new DailyImageCache(ctx.baseDir, DAILY_CACHE_DIRECTORY, TIMEZONE, DAY_REFRESH_HOUR, nowProvider)
  const capture = new PrtsCaptureService(ctx, cache, logger, {
    refreshCron: resolved.refreshCron,
    nowProvider,
    styleId: resolved.cardStyle,
    fallbackReason: resolved.fallbackReason,
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

  const gate = new DailyCronGate(nowProvider)
  const search = new WikiSearchOrchestrator({ wikiClient, storyClient, storySearch, wiki, storyScopes: STORY_SCOPES, logger })
  const selections = new WikiSelectionStore(wiki.selectionTtlMs)
  const storyUpdater = createStoryUpdater({ storySearch, search, wiki, gate, logger })
  const dailyJobs = createDailyJobs({ ctx, capture, cache, config: resolved, gate, logger })

  registerConsolePanel({ ctx, config: resolved, search, storySearch, storyUpdater, storyScopes: STORY_SCOPES })
  registerDailyCommands({ ctx, capture, cache, logger })
  registerWikiCommands({ ctx, wiki, search, selections, logger })
  storyUpdater.loadOnStart()

  startBackgroundLoop(ctx, async () => {
    if (resolved.dailyCardEnabled) await dailyJobs.runDue()
    await storyUpdater.runDue()
  })

  logger.info(`Miyako 游戏情报插件已加载。日报刷新 ${resolved.dailyCardEnabled ? resolved.refreshCron : '关闭'}；推送 ${resolved.scheduledPush.enabled ? resolved.scheduledPush.cron : '关闭'}。`)
}
