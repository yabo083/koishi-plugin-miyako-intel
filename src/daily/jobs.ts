// 日报的后台任务：定时推送、缓存归档（触发时机由 miyako-delivery 调度）
import { ScopedLogger } from '../core/logger'
import { formatError } from '../core/errors'
import { DailyClaim } from '../core/scheduler'
import { DeliveryHandle } from '../core/delivery'
import { Config as RuntimeConfig } from '../types'
import { DEFAULT_CACHE_MAINTENANCE, DailyImageCache } from '../services/cache'
import { PrtsCaptureService } from '../services/capture'
import { toDailyImageMessage } from './message'

const DAILY_SCOPE = 'miyako-intel:daily'

export interface DailyJobsDeps {
  capture: PrtsCaptureService
  cache: DailyImageCache
  config: RuntimeConfig
  gate: DailyClaim
  /** 共享投递服务（硬依赖） */
  delivery: DeliveryHandle
  logger: ScopedLogger
}

export function createDailyJobs(deps: DailyJobsDeps) {
  const { capture, cache, config, gate, delivery, logger } = deps

  async function pushDaily() {
    const schedule = config.scheduledPush
    if (!schedule.enabled) {
      logger.debug('日报定时推送跳过：未启用。')
      return
    }
    const channels = schedule.channels.map((item) => item.trim()).filter(Boolean)
    if (!channels.length) {
      logger.debug('日报定时推送跳过：频道白名单为空。')
      return
    }
    const dayKey = await gate.claim('push')
    if (!dayKey) return

    const channelCount = channels.length
    try {
      logger.info(`日报定时推送开始：${dayKey}，频道 ${channelCount} 个。`)
      const daily = await capture.getDailyInfo(false)
      const message = toDailyImageMessage(daily)
      const broadcast = delivery.broadcast
      if (!broadcast) throw new Error('miyako-delivery 未提供 broadcast')
      // 一个频道一项：投递服务按目标独立重试/记账，dayKey 作为幂等键挡住重复推送
      const result = await broadcast(channels.map((channelId) => ({
        target: { channelId },
        elements: [message],
        scope: DAILY_SCOPE,
        dedupeKey: dayKey,
      })))
      for (const outcome of result.outcomes) {
        if (outcome.ok) continue
        logger.warn(`日报定时推送失败（${outcome.target?.channelId ?? '未知频道'}）：${outcome.error?.code ?? 'UNKNOWN'} ${outcome.error?.message ?? ''}`.trim())
      }
      if (!result.ok) {
        logger.warn(`日报定时推送未全部成功：成功 ${result.deliveredCount}/${result.totalCount}。`)
        return
      }
      logger.info(`日报定时推送完成：${dayKey}，频道 ${channelCount} 个。`)
    } catch (error) {
      logger.warn(`日报定时推送失败：${formatError(error)}`)
    }
  }

  async function maintainCache() {
    const maintenance = DEFAULT_CACHE_MAINTENANCE
    const dayKey = await gate.claim('maintain')
    if (!dayKey) return
    try {
      const report = await cache.maintain(maintenance)
      logger.info(`缓存维护完成：保留 ${report.keptDayKeys.length} 天，归档 ${report.archivedDayKeys.length} 天，删除 ${report.deletedDayKeys.length} 天。`)
    } catch (error) {
      logger.warn(`缓存维护失败：${formatError(error)}`)
    }
  }

  return { pushDaily, maintainCache }
}
