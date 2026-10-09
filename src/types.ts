export interface Config {
  /** 每日情报卡片总开关：关闭后不抓取、不推送 */
  dailyCardEnabled: boolean
  /** 日报卡片风格 id（见 card-template 的 CARD_STYLES） */
  cardStyle: string
  /** 日报生成失败时回退卡片上写的理由 id（见 card-fallback 的 FALLBACK_REASONS） */
  fallbackReason: string
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
  groupForwardEnabled: boolean
  groupForwardNodeLineLimit: number
  groupForwardSenderName: string
  groupForwardSenderUin: string
}

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
