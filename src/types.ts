export interface Config {
  /** 每日情报卡片总开关：关闭后不抓取、不推送 */
  dailyCardEnabled: boolean
  /** 日报卡片风格 id（见 card-template 的 CARD_STYLES） */
  cardStyle: string

  refreshCron: string
  logLevel: LogLevel
  scheduledPush: ScheduledPushConfig
  wiki: WarfarinWikiConfig
  /** 测试用时间覆盖 */
  now?: string
}

export interface WarfarinWikiConfig {
  mode: WarfarinWikiMode
  baseUrl: string
  language: string
  storyBaseUrl: string
  storyLanguage: string
  storySearchEnabled: boolean
  storyDataDirectory: string
  storyUpdateCron: string
  storyUpdateOnStart: boolean
  storyBundleManifestUrl: string
  timeoutMs: number
  userAgent: string
  searchCacheTtlMs: number
  searchCacheMaxEntries: number
  pageSize: number
  initialPageCount: number
  selectionTtlMs: number
  /** 列表单条摘要长度（关键词居中截取的窗口字数） */
  excerptChars: number
  /** 详情正文展示模式：仅链接 / 截断 / 全文 */
  contextMode: WikiContextMode
  /** 详情正文截断长度（clipped 模式生效） */
  contextChars: number
  groupForwardEnabled: boolean
  groupForwardNodeLineLimit: number
  groupForwardSenderName: string
  groupForwardSenderUin: string
  obfuscateEnabled: boolean
  obfuscateZeroWidthInterval: number
  obfuscateHomophones: Array<{ from: string; to: string }>
  digestEnabled: boolean
  digestCron: string
  digestMinCount: number
  /** 周报 Top N 个检索词条 */
  digestTopN: number
  /** 「群号/相册ID」：热点检索词条周报长图按群上传到对应相册 */
  digestAlbums: string[]
  /** 上传成功后在群里发一行提示 */
  digestNotify: boolean
  digestResetAfterSend: boolean
  albumUploadTimeoutMs: number
}

export type WikiContextMode = 'link' | 'clipped' | 'full'

export type WarfarinWikiMode = 'official' | 'anchor'

export interface ScheduledPushConfig {
  enabled: boolean
  channels: string[]
  cron: string
  hour?: number
  minute?: number
}

export interface CacheMaintenanceConfig {
  enabled: boolean
  keepRecentDays: number
  archiveEnabled: boolean
  archiveDirectory: string
  archiveCron: string
  deleteAfterArchive: boolean
}

export type LogLevel = 'silent' | 'warn' | 'info' | 'debug'
export type CaptureKind = 'daily'

export interface CachedImageResult {
  buffer: Buffer
  dayKey: string
  filePath: string
  mimeType?: string
}

export interface CacheManifest {
  kind: CaptureKind
  dayKey: string
  generatedAt: string
  mimeType?: string
}
