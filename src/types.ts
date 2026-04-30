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
  staleFallback: boolean
  scheduledPush: ScheduledPushConfig
  now?: string
}

export interface ScheduledPushConfig {
  enabled: boolean
  channels: string[]
  cron: string
  hour?: number
  minute?: number
}

export type LogLevel = 'silent' | 'warn' | 'info' | 'debug'

export type CaptureKind = 'daily'

export interface CachedImageResult {
  buffer: Buffer
  stale: boolean
  dayKey: string
  filePath: string
}

export interface CacheManifest {
  kind: CaptureKind
  dayKey: string
  generatedAt: string
  sourceUrls: string[]
  titles?: string[]
}
