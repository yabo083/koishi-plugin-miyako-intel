import { Schema } from 'koishi'
import { Config as RuntimeConfig } from './types'
import { defaultUserAgent } from './core/constants'
import { CARD_STYLES } from './services/card-template'
import { DEFAULT_FALLBACK_REASON, FALLBACK_REASONS } from './services/card-fallback'

/** 本地剧情包只检索任务文本这一个 scope */
export const STORY_SCOPES = ['missions']

export const DEFAULT_STORY_BUNDLE_MANIFEST_URL =
  'https://github.com/yabo083/koishi-plugin-miyako-intel/releases/download/warfarin-story-latest/warfarin-story-cn.manifest.json'

const cronDescription = [
  'cron 格式：`分钟 小时 日期 月份 星期`，按东八区生效。',
  '例：`5 4 * * *` = 每天 04:05；`*/30 * * * *` = 每 30 分钟一次。',
].join('\n')

export const Config = Schema.intersect([
  Schema.object({
    dailyCardEnabled: Schema.boolean().default(true).description('每日情报信笺：关闭后不抓取、不推送。'),
    cardStyle: Schema.union(Object.entries(CARD_STYLES).map(([id, style]) => Schema.const(id).description(style.label))).default('letter').description('日报卡片风格。'),
    fallbackReason: Schema.union(Object.entries(FALLBACK_REASONS).map(([id, reason]) => Schema.const(id).description(reason.label))).role('radio').default(DEFAULT_FALLBACK_REASON).description('日报生成失败时，回退卡片上写哪一句致歉（回退卡片见 assets/fallback）。'),
    logLevel: Schema.union([
      Schema.const('silent').description('静默：不输出插件运行日志。'),
      Schema.const('warn').description('警告：只输出失败和异常。'),
      Schema.const('info').description('信息：输出加载、定时刷新、定时推送结果。'),
      Schema.const('debug').description('调试：额外输出定时任务跳过原因。'),
    ]).role('radio').default('info').description('插件日志等级。'),
  }).description('基础设置'),
  Schema.object({
    refreshCron: Schema.string().default('5 4 * * *').description(`每日卡片后台刷新时间。\n${cronDescription}`),
    scheduledPush: Schema.object({
      enabled: Schema.boolean().default(false).description('是否启用定时推送。'),
      channels: Schema.array(String).default([]).description('推送目标频道。OneBot/NapCat 群示例：onebot:11111111；多群点“添加项目”。'),
      cron: Schema.string().default('10 8 * * *').description(`推送触发时间。\n${cronDescription}`),
    }).description('定时推送设置'),
  }).description('定时任务'),
  Schema.object({
    wiki: Schema.object({
      language: Schema.string().default('cn').description('资料语言。'),
      storySearchEnabled: Schema.boolean().default(true).description('是否启用剧情/任务全文搜索。'),
      storyUpdateCron: Schema.string().default('20 4 * * *').description('剧情数据自动更新时间。'),
      storyUpdateOnStart: Schema.boolean().default(false).description('插件启动时是否立即更新剧情数据。'),
      storyBundleManifestUrl: Schema.string().default(DEFAULT_STORY_BUNDLE_MANIFEST_URL).description('远程压缩剧情文本合集 manifest 地址。留空则只使用随包种子和已有本地缓存，不访问 Warfarin 源站。'),
      timeoutMs: Schema.number().min(1000).max(60000).default(10000).description('资料请求超时时间。'),
      searchCacheTtlMs: Schema.number().min(0).max(86400000).default(600000).description('搜索结果缓存时间，单位毫秒。'),
      searchCacheMaxEntries: Schema.number().min(1).max(1000).default(100).description('搜索缓存最大数量。'),
      pageSize: Schema.number().min(1).max(10).default(5).description('每页显示结果数。'),
      initialPageCount: Schema.number().min(1).max(10).default(5).description('首次关键词检索和 w+ / w- 相对翻页时一次发送多少页。'),
      selectionTtlMs: Schema.number().min(30000).max(3600000).default(300000).description('编号选择保留时间，单位毫秒。'),
      groupForwardEnabled: Schema.boolean().default(false).description('群聊中是否将 Warfarin 查询回复作为 OneBot/NapCat 合并转发发送。失败时自动回退普通文本。'),
      groupForwardNodeLineLimit: Schema.number().min(3).max(80).default(20).description('合并转发每个节点最多包含多少行文本。'),
      groupForwardSenderName: Schema.string().default('Warfarin Wiki').description('合并转发节点显示昵称。'),
      groupForwardSenderUin: Schema.string().default('2854196310').description('合并转发节点显示 QQ 号。'),
    }).description('Warfarin 资料检索'),
  }).description('Warfarin 资料检索'),
]) as Schema<RuntimeConfig>
/**
 * 补齐运行时需要但没有暴露给用户的字段（源站地址、UA、本地数据目录等），
 * 并把旧版的 scheduledPush.hour/minute 折叠成 cron。
 */
export function resolveConfig(config: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    dailyCardEnabled: config.dailyCardEnabled ?? true,
    cardStyle: config.cardStyle || 'letter',
    fallbackReason: config.fallbackReason || DEFAULT_FALLBACK_REASON,
    refreshCron: config.refreshCron || '5 4 * * *',
    logLevel: config.logLevel || 'info',
    scheduledPush: {
      enabled: config.scheduledPush?.enabled ?? false,
      channels: config.scheduledPush?.channels ?? [],
      cron: config.scheduledPush?.cron || `${config.scheduledPush?.minute ?? 10} ${config.scheduledPush?.hour ?? 8} * * *`,
      hour: config.scheduledPush?.hour,
      minute: config.scheduledPush?.minute,
    },
    wiki: {
      mode: config.wiki?.mode || 'official',
      baseUrl: config.wiki?.baseUrl || 'https://api.warfarin.wiki/v1',
      language: config.wiki?.language || 'cn',
      storyBaseUrl: config.wiki?.storyBaseUrl || 'https://api.warfarin.wiki/v1',
      storyLanguage: config.wiki?.storyLanguage || 'cn',
      storySearchEnabled: config.wiki?.storySearchEnabled ?? true,
      storyDataDirectory: config.wiki?.storyDataDirectory || 'data/miyako-intel/warfarin-story',
      storyUpdateCron: config.wiki?.storyUpdateCron || '20 4 * * *',
      storyUpdateOnStart: config.wiki?.storyUpdateOnStart ?? false,
      storyBundleManifestUrl: config.wiki?.storyBundleManifestUrl ?? DEFAULT_STORY_BUNDLE_MANIFEST_URL,
      timeoutMs: config.wiki?.timeoutMs ?? 10000,
      userAgent: config.wiki?.userAgent || defaultUserAgent,
      searchCacheTtlMs: config.wiki?.searchCacheTtlMs ?? 600000,
      searchCacheMaxEntries: config.wiki?.searchCacheMaxEntries ?? 100,
      pageSize: config.wiki?.pageSize ?? 5,
      initialPageCount: config.wiki?.initialPageCount ?? 5,
      selectionTtlMs: config.wiki?.selectionTtlMs ?? 300000,
      groupForwardEnabled: config.wiki?.groupForwardEnabled ?? false,
      groupForwardNodeLineLimit: config.wiki?.groupForwardNodeLineLimit ?? 20,
      groupForwardSenderName: config.wiki?.groupForwardSenderName || 'Warfarin Wiki',
      groupForwardSenderUin: config.wiki?.groupForwardSenderUin || '2854196310',
    },
    now: config.now || undefined,
  }
}
