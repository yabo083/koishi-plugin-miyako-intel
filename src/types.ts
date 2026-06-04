export interface Config {
  baseUrl: string
  homepagePath: string
  cacheDirectory: string
  timezone: string
  dailyRefreshHour: number
  scheduledRefreshMinute?: number
  refreshCron: string
  logLevel: LogLevel
  navigationTimeoutMs: number
  renderDelayMs: number
  viewportWidth: number
  viewportHeight: number
  deviceScaleFactor: number
  imageFormat: ImageFormat
  jpegQuality: number
  staleFallback: boolean
  messagePrefix: string
  messageSuffix: string
  summaryMaxItems: number
  summaryDatePreview: boolean
  summaryDisplayItems: SummaryDisplayItemConfig[]
  cardTheme: CardThemeConfig
  cacheMaintenance: CacheMaintenanceConfig
  scheduledPush: ScheduledPushConfig
  wiki: WarfarinWikiConfig
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

export interface CardThemeConfig {
  fontFamily: string
  backgroundColor: string
  primaryColor: string
  warningColor: string
  dangerColor: string
  textColor: string
}

export type LogLevel = 'silent' | 'warn' | 'info' | 'debug'
export type ImageFormat = 'png' | 'jpeg'
export type SummaryDisplayItemKey =
  | 'resource'
  | 'annihilation'
  | 'event'
  | 'voucher'
  | 'operator-birthday'
  | 'operator-recent'
  | 'operator-voucher'
  | 'operator-kernel-headhunting'
  | 'operator-outfit'
  | 'operator-new-module'
  | 'operator-headhunting'
  | 'operator-event'
  | 'recent-stage'
  | 'recent-furniture'
  | 'recent-other'

export interface SummaryDisplayItemConfig {
  key: SummaryDisplayItemKey
  enabled: boolean
}

export type CaptureKind = 'daily'

export interface CachedImageResult {
  buffer: Buffer
  stale: boolean
  dayKey: string
  filePath: string
  mimeType?: string
  titles?: string[]
  sourceUrls?: string[]
  summaryItems?: SummarySection[]
}

export interface CacheManifest {
  kind: CaptureKind
  dayKey: string
  generatedAt: string
  sourceUrls: string[]
  titles?: string[]
  mimeType?: string
  summaryItems?: SummarySection[]
}

export interface SummarySection {
  title: string
  items: string[]
}
