import { Context, Schema } from 'koishi'
import { Config as RuntimeConfig } from './types'
import { DailyImageCache, getPrtsDayKey, getZonedParts } from './services/cache'
import { PrtsCaptureService } from './services/capture'

export { getPrtsDayKey }
export type { Config as ArknightsIntelConfig } from './types'

export const name = 'arknights-intel'
export const inject = { optional: ['puppeteer'] as const }

const usage = [
  '明日方舟情报截图命令：',
  '- prts d：发送 PRTS 首页「今日信息」整合图。',
  '- prts r [d|all]：无视缓存强制刷新今日信息。',
  '- prts h：查看帮助。',
  '- 支持后台定时推送（开关 + 分群白名单）。',
].join('\n')

export const Config: Schema<RuntimeConfig> = Schema.intersect([
  Schema.object({}).description(usage),
  Schema.object({
    baseUrl: Schema.string().default('https://prts.wiki').description('PRTS Wiki 根地址。'),
    homepagePath: Schema.string().default('/w/%E9%A6%96%E9%A1%B5').description('PRTS 首页路径。'),
    cacheDirectory: Schema.string().default('data/arknights-intel/cache').description('截图缓存目录，相对 Koishi baseDir。'),
    timezone: Schema.string().default('Asia/Shanghai').description('缓存日切所使用的时区。'),
    dailyRefreshHour: Schema.number().min(0).max(23).default(4).description('每日缓存刷新小时，默认按明日方舟 04:00 日切。'),
    scheduledRefreshMinute: Schema.number().min(0).max(59).default(5).description('定时刷新分钟，默认 04:05 后执行。'),
  }).description('缓存与站点'),
  Schema.object({
    navigationTimeoutMs: Schema.number().min(5000).max(120000).default(45000).description('页面导航和关键元素等待超时。'),
    renderDelayMs: Schema.number().min(0).max(10000).default(1000).description('图片加载完成后的额外等待时间。'),
    viewportWidth: Schema.number().min(800).max(2400).default(1366).description('截图浏览器视口宽度。'),
    viewportHeight: Schema.number().min(600).max(2000).default(900).description('截图浏览器视口高度。'),
    staleFallback: Schema.boolean().default(true).description('刷新失败时是否回退发送上一份缓存。'),
    now: Schema.string().default('').description('测试用时间覆盖；生产环境保持为空。'),
  }).description('截图'),
  Schema.object({
    scheduledPush: Schema.object({
      enabled: Schema.boolean().default(false).description('是否启用后台定时推送。'),
      channels: Schema.array(String).default([]).description('允许接收定时推送的频道列表，建议使用 platform:id。'),
      hour: Schema.number().min(0).max(23).default(4).description('定时推送小时（按 timezone）。'),
      minute: Schema.number().min(0).max(59).default(10).description('定时推送分钟（按 timezone）。'),
    }).description('定时推送设置'),
  }).description('定时任务'),
])

declare module 'koishi' {
  interface Context {
    puppeteer?: {
      page: () => Promise<any>
    }
  }
}

export function apply(ctx: Context, config: RuntimeConfig) {
  const logger = ctx.logger(name)
  const resolved = resolveConfig(config)
  const nowProvider = () => resolved.now ? new Date(resolved.now) : new Date()
  const cache = new DailyImageCache(ctx.baseDir, resolved.cacheDirectory, resolved.timezone, resolved.dailyRefreshHour, nowProvider)
  const service = new PrtsCaptureService(ctx, resolved, cache, logger)
  let lastPushedDayKey = ''
  let backgroundRunning = false

  const sendDaily = async (session: any, force = false) => {
    if (!session) return '只能在会话中使用该命令。'
    try {
      const result = await service.getDailyInfo(force)
      await service.sendImage(session, result, '当前 PRTS 获取失败，发送上一份缓存。')
      if (force) return `今日信息缓存已刷新（${result.dayKey}）。`
      return result.stale
        ? `今日信息截图已发送（使用旧缓存 ${result.dayKey}）。`
        : `今日信息截图已发送（${result.dayKey}）。`
    } catch (error) {
      logger.warn(`发送今日信息失败：${formatError(error)}`)
      return 'PRTS 今日信息截图失败，且没有可用缓存。请确认 puppeteer 插件已启用并稍后重试。'
    }
  }

  const root = ctx.command('prts', '明日方舟情报截图服务')
    .option('daily', '-d')
    .option('refresh', '-r [target:string]')
    .action(async ({ session, options }) => {
      if (options?.daily) return sendDaily(session, false)
      if (options?.refresh !== undefined) return refreshTarget(session, options.refresh || 'all')
      return buildHelp()
    })

  root.subcommand('.d', '发送 PRTS 今日信息截图')
    .alias('.daily')
    .action(async ({ session }) => sendDaily(session, false))

  root.subcommand('.r [target:string]', '强制刷新 PRTS 截图缓存')
    .alias('.refresh', '.reset')
    .action(async ({ session }, target?: string) => refreshTarget(session, target || 'all'))

  root.subcommand('.h', '查看 PRTS 截图命令帮助')
    .alias('.help')
    .action(() => buildHelp())

  ctx.setInterval(() => {
    return runBackgroundJobs()
  }, 10 * 60 * 1000)

  logger.info('明日方舟情报截图插件已加载。')

  async function refreshTarget(session: any, rawTarget: string) {
    const target = rawTarget.toLowerCase().replace(/[：:，,。.!！]+$/g, '')
    if (!['d', 'all'].includes(target)) {
      return '刷新目标只能是 d 或 all。'
    }

    const dailyResult = await sendDaily(session, true)
    if (typeof dailyResult === 'string' && dailyResult.includes('失败')) return dailyResult
    return 'PRTS 缓存已刷新：今日信息。'
  }

  async function runBackgroundJobs() {
    if (backgroundRunning) return
    backgroundRunning = true
    try {
      await service.refreshDue()
      await runScheduledPushIfDue()
    } finally {
      backgroundRunning = false
    }
  }

  async function runScheduledPushIfDue() {
    const schedule = resolved.scheduledPush
    if (!schedule.enabled) return

    const channels = schedule.channels.map((item) => item.trim()).filter(Boolean)
    if (!channels.length) return
    const now = nowProvider()
    const parts = getZonedParts(now, resolved.timezone)
    const isDue = parts.hour > schedule.hour || (parts.hour === schedule.hour && parts.minute >= schedule.minute)
    if (!isDue) return

    const dayKey = getPrtsDayKey(now, resolved.timezone, resolved.dailyRefreshHour)
    if (dayKey === lastPushedDayKey) return

    try {
      const daily = await service.getDailyInfo(false)
      await ctx.broadcast(channels, service.toImageFragment(daily), true)
      lastPushedDayKey = dayKey
      logger.info(`PRTS 定时推送完成：${dayKey}，频道 ${channels.length} 个。`)
    } catch (error) {
      logger.warn(`PRTS 定时推送失败：${formatError(error)}`)
    }
  }
}

function buildHelp() {
  return [
    '明日方舟情报截图命令',
    'prts d：PRTS 今日信息整合图',
    'prts r [d|all]：强制刷新今日信息缓存，默认 all',
    'prts h：查看帮助',
    '缓存按 04:00 日切；当天重复请求会直接读取本地缓存。',
  ].join('\n')
}

function resolveConfig(config: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    baseUrl: config.baseUrl || 'https://prts.wiki',
    homepagePath: config.homepagePath || '/w/%E9%A6%96%E9%A1%B5',
    cacheDirectory: config.cacheDirectory || 'data/arknights-intel/cache',
    timezone: config.timezone || 'Asia/Shanghai',
    dailyRefreshHour: config.dailyRefreshHour ?? 4,
    scheduledRefreshMinute: config.scheduledRefreshMinute ?? 5,
    navigationTimeoutMs: config.navigationTimeoutMs ?? 45000,
    renderDelayMs: config.renderDelayMs ?? 1000,
    viewportWidth: config.viewportWidth ?? 1366,
    viewportHeight: config.viewportHeight ?? 900,
    staleFallback: config.staleFallback ?? true,
    scheduledPush: {
      enabled: config.scheduledPush?.enabled ?? false,
      channels: config.scheduledPush?.channels ?? [],
      hour: config.scheduledPush?.hour ?? 4,
      minute: config.scheduledPush?.minute ?? 10,
    },
    now: config.now || undefined,
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
