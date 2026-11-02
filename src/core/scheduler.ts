// 日切水位：cron 触发由 miyako-delivery 负责，这里只做「当天第一次占用」的判定
import { ScopedLogger } from './logger'
import { DAY_REFRESH_HOUR, TIMEZONE } from './constants'
import { getPrtsDayKey } from './time'
import type { DeliveryHandle } from './delivery'

/**
 * 日切水位的持久化入口（由共享投递服务提供）：同一 slot 当天第一次调用返回 dayKey，
 * 之后返回 undefined。调度时机由 `delivery.scheduleCron` 负责，这里不再判 cron。
 */
export interface DailyClaim {
  claim(slot: string): Promise<string | undefined>
}

export interface DailyClaimOptions {
  nowProvider: () => Date
  delivery: DeliveryHandle
  logger?: ScopedLogger
}

export function createDailyClaim(options: DailyClaimOptions): DailyClaim {
  const { nowProvider, delivery, logger } = options
  return {
    async claim(slot) {
      const dayKey = getPrtsDayKey(nowProvider(), TIMEZONE, DAY_REFRESH_HOUR)
      if (await delivery.gateDailySlot(slot, dayKey)) return dayKey
      logger?.debug(`${slot} 跳过：${dayKey} 已执行。`)
      return undefined
    },
  }
}
