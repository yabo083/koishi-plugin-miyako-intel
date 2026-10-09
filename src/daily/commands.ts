// prts 调试命令族：手动出图 / 强制重渲 / 缓存诊断
import { Context } from 'koishi'
import { ScopedLogger } from '../core/logger'
import { formatError } from '../core/errors'
import { DailyImageCache } from '../services/cache'
import { PrtsCaptureService } from '../services/capture'
import { toDailyImageMessage } from './message'

export interface DailyCommandsDeps {
  ctx: Context
  capture: PrtsCaptureService
  cache: DailyImageCache
  logger: ScopedLogger
}

function buildHelp() {
  return [
    'Miyako 每日信笺调试命令',
    'prts d：手动发送今日信笺卡片图',
    'prts r：忽略缓存强制重新抓取渲染',
    'prts cache：查看卡片缓存诊断',
  ].join('\n')
}

export function registerDailyCommands(deps: DailyCommandsDeps) {
  const { ctx, capture, cache, logger } = deps

  async function sendDaily(session: any, force: boolean) {
    if (!session) return '只能在会话中使用该命令。'
    try {
      const result = await capture.getDailyInfo(force)
      await session.send(toDailyImageMessage(result))
    } catch (error) {
      logger.warn(`发送今日信笺失败：${formatError(error)}`)
      return '今日信笺生成失败，回退卡片也没能发出。请确认 puppeteer 插件已启用并稍后重试。'
    }
  }

  async function buildCacheDiagnostics() {
    const diagnostics = await cache.inspect('daily')
    return [
      '今日信笺缓存诊断',
      `缓存根目录：${diagnostics.cacheRoot}`,
      `当前缓存日：${diagnostics.currentDayKey}`,
      `今日缓存：${diagnostics.todayExists ? '存在' : '不存在'}`,
      `最近缓存：${diagnostics.latestDayKey || '无'}`,
      `缓存目录数：${diagnostics.dayKeys.length}`,
    ].join('\n')
  }

  const root = ctx.command('prts', 'Miyako 每日信笺调试命令').action(() => buildHelp())

  root.subcommand('.d', '手动发送今日信笺卡片图')
    .alias('.daily')
    .action(async ({ session }) => sendDaily(session, false))

  root.subcommand('.r', '忽略缓存强制重新抓取渲染')
    .alias('.refresh', '.reset')
    .action(async ({ session }) => sendDaily(session, true))

  root.subcommand('.cache', '查看卡片缓存诊断')
    .action(() => buildCacheDiagnostics())

  root.subcommand('.h', '查看调试命令帮助')
    .alias('.help')
    .action(() => buildHelp())
}
