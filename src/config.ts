import { Schema } from 'koishi'
import { Config as RuntimeConfig } from './types'
import { defaultUserAgent } from './core/constants'
import { CARD_STYLES } from './services/card-template'


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
      initialPageCount: Schema.number().min(1).max(10).default(1).description('首次关键词检索和 w+ / w- 相对翻页时一次发送多少页。'),
      excerptChars: Schema.number().min(40).max(200).default(60).description('列表单条摘要长度（关键词居中截取）。'),
      contextMode: Schema.union([
        Schema.const('link').description('仅链接：元信息 + 摘要 + 跳转链接。'),
        Schema.const('clipped').description('截断：正文截取到限定字数后附跳转链接。'),
        Schema.const('full').description('全文：完整渲染正文（与旧版一致）。'),
      ]).role('radio').default('clipped').description('详情正文展示模式。'),
      contextChars: Schema.number().min(200).max(5000).default(800).description('详情正文截断长度（clipped 模式生效）。'),
      selectionTtlMs: Schema.number().min(30000).max(3600000).default(300000).description('编号选择保留时间，单位毫秒。'),
      groupForwardEnabled: Schema.boolean().default(false).description('群聊中是否将 Warfarin 查询回复作为 OneBot/NapCat 合并转发发送。失败时自动回退普通文本。'),
      groupForwardNodeLineLimit: Schema.number().min(3).max(80).default(20).description('合并转发每个节点最多包含多少行文本。'),
      groupForwardSenderName: Schema.string().default('Warfarin Wiki').description('合并转发节点显示昵称。'),
      groupForwardSenderUin: Schema.string().default('2854196310').description('合并转发节点显示 QQ 号。'),
      obfuscateEnabled: Schema.boolean().default(true).description('出站文本混淆：非链接片段做同音替换并在汉字间插零宽空格，降低风控命中。'),
      obfuscateZeroWidthInterval: Schema.number().min(0).max(50).default(6).description('每几个汉字插入一个零宽空格，0 表示不插入。'),
      obfuscateHomophones: Schema.array(Schema.object({
        from: Schema.string().description('正字'),
        to: Schema.string().description('混淆字'),
      })).role('table').default([]).description('同音/形近混淆字表。出站把正字替换为混淆字；收到查询时反向还原，不影响搜索命中。'),
      digestEnabled: Schema.boolean().default(false).description('每周热点检索词条周报：按 cron 汇总本群高频检索词，渲染长图上传群相册。'),
      digestAlbums: Schema.array(Schema.dynamic('miyako-intel.album')).default([]).description('相册候选自动从 scheduledPush.channels 里的群探测（需 OneBot/SnowLuma 在线，且群里已手动建相册）；每项选一个群的相册，周报按群上传。'),
      digestCron: Schema.string().default('0 9 * * 1').description(`热点检索词条周报触发时间。\n${cronDescription}`),
      digestMinCount: Schema.number().min(1).max(100).default(3).description('检索词条进入周报所需的最低检索次数。'),
      digestTopN: Schema.number().min(1).max(50).default(10).description('周报最多列出多少个检索词条。'),
      digestNotify: Schema.boolean().default(true).description('周报长图上传成功后在对应群里发一行提示。'),
      digestResetAfterSend: Schema.boolean().default(true).description('周报发送后清空本群本周期统计。'),
      albumUploadTimeoutMs: Schema.number().min(5000).max(120000).default(60000).description('群相册上传超时时间，单位毫秒。'),
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
      initialPageCount: config.wiki?.initialPageCount ?? 1,
      excerptChars: config.wiki?.excerptChars ?? 60,
      contextMode: config.wiki?.contextMode || 'clipped',
      contextChars: config.wiki?.contextChars ?? 800,
      selectionTtlMs: config.wiki?.selectionTtlMs ?? 300000,
      groupForwardEnabled: config.wiki?.groupForwardEnabled ?? false,
      groupForwardNodeLineLimit: config.wiki?.groupForwardNodeLineLimit ?? 20,
      groupForwardSenderName: config.wiki?.groupForwardSenderName || 'Warfarin Wiki',
      groupForwardSenderUin: config.wiki?.groupForwardSenderUin || '2854196310',
      obfuscateEnabled: config.wiki?.obfuscateEnabled ?? true,
      obfuscateZeroWidthInterval: config.wiki?.obfuscateZeroWidthInterval ?? 6,
      obfuscateHomophones: config.wiki?.obfuscateHomophones ?? [],
      digestEnabled: config.wiki?.digestEnabled ?? false,
      digestCron: config.wiki?.digestCron || '0 9 * * 1',
      digestMinCount: config.wiki?.digestMinCount ?? 3,
      digestTopN: config.wiki?.digestTopN ?? 10,
      digestAlbums: config.wiki?.digestAlbums ?? [],
      digestNotify: config.wiki?.digestNotify ?? true,
      digestResetAfterSend: config.wiki?.digestResetAfterSend ?? true,
      albumUploadTimeoutMs: config.wiki?.albumUploadTimeoutMs ?? 60000,
    },
    now: config.now || undefined,
  }
}
