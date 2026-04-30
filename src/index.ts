import { Context, Schema } from 'koishi'
import { Config as RuntimeConfig } from './types'
import { DailyImageCache, getPrtsDayKey, getZonedParts } from './services/cache'
import { PrtsCaptureService } from './services/capture'
import { matchesCronExpression } from './services/cron'

export { getPrtsDayKey }
export type { Config as ArknightsIntelConfig } from './types'

export const name = 'miyako-intel'
export const inject = { optional: ['puppeteer'] as const }

const usage = [
  '## Miyako 游戏情报',
  '',
  '当前提供 PRTS Wiki 首页「今日信息」整合图。',
  '',
  '### 指令',
  '',
  '- `prts d`：发送今日信息截图，优先读取当天缓存。',
  '- `prts r [d|all]`：强制刷新今日信息缓存。',
  '- `prts h`：查看命令帮助。',
  '',
  '### 定时',
  '',
  '定时项使用 5 段 cron：`分钟 小时 日期 月份 星期`，并按下方 `timezone` 解释。',
  '例如 `10 4 * * *` 表示每天 04:10 执行；`*/30 * * * *` 表示每 30 分钟执行一次。',
  '后台推送只会发送到白名单频道，频道格式建议写成 `platform:id`。',
].join('\n')

const cronDescription = [
  '5 段 cron 表达式：`分钟 小时 日期 月份 星期`，按 `timezone` 生效。',
  '例：`5 4 * * *` = 每天 04:05；`0 8 * * 1` = 每周一 08:00。',
  '支持 `*`、`,`、`-`、`/`，星期可用 `0` 或 `7` 表示周日。',
].join('\n')

export const Config: Schema<RuntimeConfig> = Schema.intersect([
  Schema.object({}).description(usage),
  Schema.object({
    baseUrl: Schema.string().default('https://prts.wiki').description('PRTS Wiki 根地址。'),
    homepagePath: Schema.string().default('/w/%E9%A6%96%E9%A1%B5').description('PRTS 首页路径。'),
    cacheDirectory: Schema.string().default('data/miyako-intel/cache').description('截图缓存目录，相对 Koishi baseDir。'),
    timezone: Schema.string().default('Asia/Shanghai').description('缓存日切所使用的时区。'),
    dailyRefreshHour: Schema.number().min(0).max(23).default(4).description('每日缓存归属的日切小时，默认按明日方舟 04:00 日切。'),
    refreshCron: Schema.string().default('5 4 * * *').description(`后台补缓存触发时间。\n${cronDescription}`),
    logLevel: Schema.union([
      Schema.const('silent').description('静默：不输出插件运行日志。'),
      Schema.const('warn').description('警告：只输出失败和异常。'),
      Schema.const('info').description('信息：输出加载、定时刷新、定时推送结果。'),
      Schema.const('debug').description('调试：额外输出定时任务跳过原因。'),
    ]).role('radio').default('info').description('插件日志等级。'),
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
      cron: Schema.string().default('10 4 * * *').description(`推送触发时间。\n${cronDescription}\n当前默认值表示每天 04:10 推送一次。`),
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
  const resolved = resolveConfig(config)
  const logger = createScopedLogger(ctx.logger(name), resolved.logLevel)
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

  const root = ctx.command('prts', 'Miyako 游戏情报截图服务')
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
  }, 60 * 1000)

  logger.info(`Miyako 游戏情报插件已加载。补缓存 ${resolved.refreshCron}；推送 ${resolved.scheduledPush.enabled ? resolved.scheduledPush.cron : '关闭'}。`)

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
    if (!schedule.enabled) {
      logger.debug('PRTS 定时推送跳过：未启用。')
      return
    }

    const channels = schedule.channels.map((item) => item.trim()).filter(Boolean)
    if (!channels.length) {
      logger.debug('PRTS 定时推送跳过：频道白名单为空。')
      return
    }
    const now = nowProvider()
    const parts = getZonedParts(now, resolved.timezone)
    if (!matchesCronExpression(schedule.cron, parts)) {
      logger.debug(`PRTS 定时推送未到触发时间：${schedule.cron}`)
      return
    }

    const dayKey = getPrtsDayKey(now, resolved.timezone, resolved.dailyRefreshHour)
    if (dayKey === lastPushedDayKey) {
      logger.debug(`PRTS 定时推送跳过：${dayKey} 已推送。`)
      return
    }

    try {
      logger.info(`PRTS 定时推送开始：${dayKey}，频道 ${channels.length} 个。`)
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
    'Miyako 游戏情报命令',
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
    cacheDirectory: config.cacheDirectory || 'data/miyako-intel/cache',
    timezone: config.timezone || 'Asia/Shanghai',
    dailyRefreshHour: config.dailyRefreshHour ?? 4,
    scheduledRefreshMinute: config.scheduledRefreshMinute,
    refreshCron: config.refreshCron || `${config.scheduledRefreshMinute ?? 5} ${config.dailyRefreshHour ?? 4} * * *`,
    logLevel: config.logLevel || 'info',
    navigationTimeoutMs: config.navigationTimeoutMs ?? 45000,
    renderDelayMs: config.renderDelayMs ?? 1000,
    viewportWidth: config.viewportWidth ?? 1366,
    viewportHeight: config.viewportHeight ?? 900,
    staleFallback: config.staleFallback ?? true,
    scheduledPush: {
      enabled: config.scheduledPush?.enabled ?? false,
      channels: config.scheduledPush?.channels ?? [],
      cron: config.scheduledPush?.cron || `${config.scheduledPush?.minute ?? 10} ${config.scheduledPush?.hour ?? 4} * * *`,
      hour: config.scheduledPush?.hour,
      minute: config.scheduledPush?.minute,
    },
    now: config.now || undefined,
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createScopedLogger(base: any, level: RuntimeConfig['logLevel']) {
  const rank = { silent: 0, warn: 1, info: 2, debug: 3 } as const
  const current = rank[level] ?? rank.info
  return {
    warn(message: string) {
      if (current >= rank.warn) base.warn(message)
    },
    info(message: string) {
      if (current >= rank.info) base.info(message)
    },
    debug(message: string) {
      if (current >= rank.debug) (base.debug || base.info).call(base, message)
    },
  }
}
