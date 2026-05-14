import { Context, Schema } from 'koishi'
import { resolve } from 'node:path'
import { Config as RuntimeConfig, SummaryDisplayItemConfig, SummaryDisplayItemKey } from './types'
import { DailyImageCache, getPrtsDayKey, getZonedParts } from './services/cache'
import { PrtsCaptureService } from './services/capture'
import { matchesCronExpression } from './services/cron'

export { getPrtsDayKey }
export type { Config as ArknightsIntelConfig } from './types'

export const name = 'miyako-intel'
export const inject = { optional: ['puppeteer', 'console'] as const }

export const usage = `
<p><strong>PRTS 今日情报</strong></p>
<ul>
  <li><code>prts d</code> 发送首页「今日信息」整合图。</li>
  <li><code>prts s</code> 发送首页「今日信息」规则摘要文本。</li>
  <li><code>prts cache</code> 查看缓存诊断与维护状态。</li>
  <li><code>prts r d</code> 强制刷新今日截图缓存；<code>prts r s</code> 强制刷新并发送今日摘要。</li>
  <li><code>prts h</code> 查看命令帮助。</li>
</ul>
<p><strong>定时</strong>：<code>refreshCron</code> 是补缓存时间，<code>scheduledPush.cron</code> 是推送时间；格式为 <code>分钟 小时 日期 月份 星期</code>。</p>
<p><strong>推送目标</strong>：<code>scheduledPush.channels</code> 填 Koishi 频道 ID。OneBot / NapCat 群示例：<code>onebot:11111111</code>。机器人必须已加入该群，且对应适配器在线。</p>
`

const cronDescription = [
  'cron 格式：`分钟 小时 日期 月份 星期`，按 `timezone` 生效。',
  '例：`5 4 * * *` = 每天 04:05；`*/30 * * * *` = 每 30 分钟一次。',
].join('\n')

const summaryDisplayItemsDefault = [
  { key: 'resource', enabled: true },
  { key: 'annihilation', enabled: true },
  { key: 'event', enabled: true },
  { key: 'voucher', enabled: true },
  { key: 'operator-birthday', enabled: true },
  { key: 'operator-recent', enabled: true },
  { key: 'operator-voucher', enabled: true },
  { key: 'operator-kernel-headhunting', enabled: true },
  { key: 'operator-outfit', enabled: true },
  { key: 'operator-new-module', enabled: true },
  { key: 'operator-headhunting', enabled: true },
  { key: 'operator-event', enabled: true },
  { key: 'recent-stage', enabled: false },
  { key: 'recent-furniture', enabled: true },
  { key: 'recent-other', enabled: true },
] satisfies SummaryDisplayItemConfig[]

const summaryDisplayItemSchema = Schema.union([
  Schema.const('resource').description('今日资源收集。'),
  Schema.const('annihilation').description('剿灭/保全等周期状态。'),
  Schema.const('event').description('活动与网页活动。'),
  Schema.const('voucher').description('采购凭证/信物刷新。'),
  Schema.const('operator-birthday').description('生日干员。'),
  Schema.const('operator-recent').description('近期新增干员。'),
  Schema.const('operator-voucher').description('凭证兑换干员。'),
  Schema.const('operator-kernel-headhunting').description('中坚甄选干员。'),
  Schema.const('operator-outfit').description('新增时装干员。'),
  Schema.const('operator-new-module').description('新增模组干员。'),
  Schema.const('operator-headhunting').description('寻访/卡池干员。'),
  Schema.const('operator-event').description('活动相关干员。'),
  Schema.const('recent-stage').description('近期新增关卡。'),
  Schema.const('recent-furniture').description('近期新增家具。'),
  Schema.const('recent-other').description('其他近期新增。'),
])

export const Config: Schema<RuntimeConfig> = Schema.intersect([
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
    deviceScaleFactor: Schema.number().min(1).max(3).step(0.25).default(1).description('截图设备像素比；调高可提升清晰度，也会增加图片体积。'),
    imageFormat: Schema.union([
      Schema.const('png').description('PNG：清晰度优先，体积较大。'),
      Schema.const('jpeg').description('JPEG：体积优先，可配合较高像素比使用。'),
    ]).role('radio').default('png').description('截图输出格式。'),
    jpegQuality: Schema.number().min(50).max(100).default(85).description('JPEG 输出质量，仅在 imageFormat 为 jpeg 或图片过大自动降级时生效。'),
    staleFallback: Schema.boolean().default(true).description('刷新失败时是否回退发送上一份缓存。'),
    now: Schema.string().default('').description('测试用时间覆盖；生产环境保持为空。'),
  }).description('截图'),
  Schema.object({
    messagePrefix: Schema.string().default('').role('textarea').description('发送图片或摘要前的自定义开场白，留空则不发送。'),
    messageSuffix: Schema.string().default('').role('textarea').description('发送图片或摘要后的自定义结束语，留空则不发送。'),
    summaryMaxItems: Schema.number().min(1).max(20).default(8).description('摘要文本最多列出的信息条目数。'),
    summaryDatePreview: Schema.boolean().default(true).description('是否把“几天后结束/刷新”换算成具体日期和星期。'),
    summaryDisplayItems: Schema.array(Schema.object({
      key: summaryDisplayItemSchema.required().description('文本类别。'),
      enabled: Schema.boolean().default(true).description('是否在摘要中展示。'),
    })).role('table').default(summaryDisplayItemsDefault.map((item) => ({ ...item }))).description('摘要文本展示项。默认隐藏近期新增关卡；可在表格中自由开关每一类文本。'),
  }).description('输出文本'),
  Schema.object({
    cardTheme: Schema.object({
      fontFamily: Schema.string().default('').description('截图卡片字体栈；留空使用默认中文无衬线字体。'),
      backgroundColor: Schema.string().default('').description('卡片背景色；留空使用默认终端黑。'),
      primaryColor: Schema.string().default('').description('主题主色；留空使用默认 PRTS 蓝。'),
      warningColor: Schema.string().default('').description('警告色；留空使用默认金色。'),
      dangerColor: Schema.string().default('').description('危险/紧急色；留空使用默认红色。'),
      textColor: Schema.string().default('').description('正文文字色；留空使用默认浅灰。'),
    }).description('卡片主题'),
  }).description('视觉主题'),
  Schema.object({
    scheduledPush: Schema.object({
      enabled: Schema.boolean().default(false).description('是否启用后台定时推送。'),
      channels: Schema.array(String).default([]).description('推送目标频道。OneBot/NapCat 群示例：onebot:11111111；多群点“添加项目”。'),
      cron: Schema.string().default('10 4 * * *').description(`推送触发时间。\n${cronDescription}\n默认表示每天 04:10 推送。`),
    }).description('定时推送设置'),
    cacheMaintenance: Schema.object({
      enabled: Schema.boolean().default(true).description('是否启用缓存自动维护。'),
      keepRecentDays: Schema.number().min(1).max(90).default(7).description('保留最近多少个日期目录。'),
      archiveEnabled: Schema.boolean().default(true).description('是否将过期缓存写入压缩归档。'),
      archiveDirectory: Schema.string().default('archives').description('归档目录；相对缓存根目录。'),
      archiveCron: Schema.string().default('30 4 * * *').description(`缓存维护触发时间。\n${cronDescription}\n默认表示每天 04:30 维护。`),
      deleteAfterArchive: Schema.boolean().default(true).description('归档成功后是否删除原日期目录。'),
    }).description('缓存维护'),
  }).description('定时任务'),
])

declare module 'koishi' {
  interface Context {
    puppeteer?: {
      page: () => Promise<any>
    }
    console?: {
      addEntry: (entry: { dev: string; prod: string }) => void
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
  let lastMaintainedDayKey = ''
  let backgroundRunning = false

  ctx.console?.addEntry({
    dev: resolve(__dirname, '../client/index.ts'),
    prod: resolve(__dirname, '../dist'),
  })

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

  const sendSummary = async (session: any, force = false) => {
    if (!session) return '只能在会话中使用该命令。'
    try {
      const summary = await service.getDailySummary(force)
      if (resolved.messagePrefix.trim()) await session.send(resolved.messagePrefix.trim())
      await session.send(summary)
      if (resolved.messageSuffix.trim()) await session.send(resolved.messageSuffix.trim())
      return 'PRTS 今日摘要已发送。'
    } catch (error) {
      logger.warn(`发送今日摘要失败：${formatError(error)}`)
      return 'PRTS 今日摘要生成失败，且没有可用缓存。请确认 puppeteer 插件已启用并稍后重试。'
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

  root.subcommand('.s', '发送 PRTS 今日信息摘要文本')
    .alias('.summary')
    .action(async ({ session }) => sendSummary(session, false))

  root.subcommand('.cache', '查看 PRTS 缓存诊断')
    .action(() => buildCacheDiagnostics())

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
    if (!['d', 's', 'summary', 'all'].includes(target)) {
      return '刷新目标只能是 d、s 或 all。'
    }

    if (target === 's' || target === 'summary') {
      const summaryResult = await sendSummary(session, true)
      if (typeof summaryResult === 'string' && summaryResult.includes('失败')) return summaryResult
      return 'PRTS 缓存已刷新：今日摘要。'
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
      await runCacheMaintenanceIfDue()
    } finally {
      backgroundRunning = false
    }
  }

  async function buildCacheDiagnostics() {
    const diagnostics = await cache.inspect('daily')
    const maintenance = resolved.cacheMaintenance
    return [
      'PRTS 缓存诊断',
      `Koishi baseDir：${diagnostics.baseDir}`,
      `缓存根目录：${diagnostics.cacheRoot}`,
      `当前缓存日：${diagnostics.currentDayKey}`,
      `今日缓存：${diagnostics.todayExists ? '存在' : '不存在'}`,
      `最近缓存：${diagnostics.latestDayKey || '无'}`,
      `缓存目录数：${diagnostics.dayKeys.length}`,
      `维护：${maintenance.enabled ? `开启，保留最近 ${maintenance.keepRecentDays} 天，归档 ${maintenance.archiveEnabled ? '开启' : '关闭'}` : '关闭'}`,
    ].join('\n')
  }

  async function runCacheMaintenanceIfDue() {
    const maintenance = resolved.cacheMaintenance
    if (!maintenance.enabled) {
      logger.debug('PRTS 缓存维护跳过：未启用。')
      return
    }

    const now = nowProvider()
    const parts = getZonedParts(now, resolved.timezone)
    if (!matchesCronExpression(maintenance.archiveCron, parts)) {
      logger.debug(`PRTS 缓存维护未到触发时间：${maintenance.archiveCron}`)
      return
    }

    const dayKey = getPrtsDayKey(now, resolved.timezone, resolved.dailyRefreshHour)
    if (dayKey === lastMaintainedDayKey) {
      logger.debug(`PRTS 缓存维护跳过：${dayKey} 已维护。`)
      return
    }

    try {
      const report = await cache.maintain(maintenance)
      lastMaintainedDayKey = dayKey
      logger.info(`PRTS 缓存维护完成：保留 ${report.keptDayKeys.length} 天，归档 ${report.archivedDayKeys.length} 天，删除 ${report.deletedDayKeys.length} 天。`)
    } catch (error) {
      logger.warn(`PRTS 缓存维护失败：${formatError(error)}`)
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
      await ctx.broadcast(channels, service.toBroadcastMessage(daily), true)
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
    'prts s：PRTS 今日信息摘要文本',
    'prts cache：查看缓存根目录、当前日切和最近缓存',
    'prts r [d|s|all]：强制刷新今日信息截图或摘要，默认 all',
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
    deviceScaleFactor: config.deviceScaleFactor ?? 1,
    imageFormat: config.imageFormat || 'png',
    jpegQuality: config.jpegQuality ?? 85,
    staleFallback: config.staleFallback ?? true,
    messagePrefix: config.messagePrefix || '',
    messageSuffix: config.messageSuffix || '',
    summaryMaxItems: config.summaryMaxItems ?? 8,
    summaryDatePreview: config.summaryDatePreview ?? true,
    summaryDisplayItems: resolveSummaryDisplayItems(config.summaryDisplayItems),
    cardTheme: {
      fontFamily: config.cardTheme?.fontFamily || '',
      backgroundColor: config.cardTheme?.backgroundColor || '',
      primaryColor: config.cardTheme?.primaryColor || '',
      warningColor: config.cardTheme?.warningColor || '',
      dangerColor: config.cardTheme?.dangerColor || '',
      textColor: config.cardTheme?.textColor || '',
    },
    cacheMaintenance: {
      enabled: config.cacheMaintenance?.enabled ?? true,
      keepRecentDays: config.cacheMaintenance?.keepRecentDays ?? 7,
      archiveEnabled: config.cacheMaintenance?.archiveEnabled ?? true,
      archiveDirectory: config.cacheMaintenance?.archiveDirectory || 'archives',
      archiveCron: config.cacheMaintenance?.archiveCron || '30 4 * * *',
      deleteAfterArchive: config.cacheMaintenance?.deleteAfterArchive ?? true,
    },
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

function resolveSummaryDisplayItems(items: RuntimeConfig['summaryDisplayItems'] | undefined) {
  const map = new Map<string, SummaryDisplayItemConfig>(summaryDisplayItemsDefault.map((item) => [item.key, { ...item }]))
  for (const item of items || []) {
    const key = normalizeSummaryDisplayItemKey(String(item?.key || ''))
    if (!key || !map.has(key)) continue
    map.set(key, { key, enabled: item.enabled !== false })
  }
  return Array.from(map.values()) as RuntimeConfig['summaryDisplayItems']
}

function normalizeSummaryDisplayItemKey(item: string): SummaryDisplayItemKey | '' {
  const normalized = item.replace(/[。\s]+$/g, '').trim()
  if (!normalized) return ''
  if (summaryDisplayItemsDefault.some((entry) => entry.key === normalized)) return normalized as SummaryDisplayItemKey
  if (/今日资源|资源收集/.test(normalized)) return 'resource'
  if (/剿灭|保全/.test(normalized)) return 'annihilation'
  if (/活动与网页活动|网页活动/.test(normalized)) return 'event'
  if (/采购凭证|信物|凭证刷新/.test(normalized)) return 'voucher'
  if (/生日干员/.test(normalized)) return 'operator-birthday'
  if (/近期新增干员/.test(normalized)) return 'operator-recent'
  if (/凭证兑换干员/.test(normalized)) return 'operator-voucher'
  if (/中坚甄选干员|甄选干员/.test(normalized)) return 'operator-kernel-headhunting'
  if (/新增时装干员|时装干员/.test(normalized)) return 'operator-outfit'
  if (/新增模组干员|模组干员/.test(normalized)) return 'operator-new-module'
  if (/寻访|卡池/.test(normalized)) return 'operator-headhunting'
  if (/活动相关干员/.test(normalized)) return 'operator-event'
  if (/近期新增关卡|新增关卡/.test(normalized)) return 'recent-stage'
  if (/近期新增家具|新增家具/.test(normalized)) return 'recent-furniture'
  if (/其他近期新增|近期新增/.test(normalized)) return 'recent-other'
  return ''
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
