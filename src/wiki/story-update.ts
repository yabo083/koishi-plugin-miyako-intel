// 剧情全文包的更新：启动时、定时、控制台手动三个入口共用一个串行执行器
import { ScopedLogger } from '../core/logger'
import { formatError } from '../core/errors'
import { DailyClaim } from '../core/scheduler'
import { Config as RuntimeConfig } from '../types'
import { WarfarinStorySearchService } from '../services/warfarin-story-search'
import { WikiSearchOrchestrator } from './search'

export interface StoryUpdateDeps {
  storySearch: WarfarinStorySearchService
  search: WikiSearchOrchestrator
  wiki: RuntimeConfig['wiki']
  gate: DailyClaim
  logger: ScopedLogger
}

export function createStoryUpdater(deps: StoryUpdateDeps) {
  const { storySearch, search, wiki, gate, logger } = deps
  let updating = false

  /** 同一时刻只允许一个更新在跑；更新成功后清掉剧情搜索缓存 */
  async function run(reason: string) {
    if (updating) return false
    updating = true
    try {
      const report = await storySearch.update()
      search.clearStoryCache()
      if (report.warning) logger.warn(`Warfarin GitHub 全文合集${reason}异常，继续使用本地缓存：${report.warning}`)
      logger.info(`Warfarin 全文文本${reason}完成：成功 ${report.success}，跳过 ${report.skipped}，重查 ${report.refreshed}，待补 ${report.pending}，失败 ${report.failed}。`)
      return true
    } catch (error) {
      logger.warn(`Warfarin 剧情文本${reason}失败：${formatError(error)}`)
      return false
    } finally {
      updating = false
    }
  }

  return {
    run,
    get isUpdating() {
      return updating
    },
    /** 插件加载时把本地包读进内存；失败只告警，不阻塞插件启动 */
    loadOnStart() {
      if (!wiki.storySearchEnabled) return
      storySearch.load().catch((error) => logger.warn(`加载本地剧情文本失败：${formatError(error)}`))
      if (wiki.storyUpdateOnStart) void run('启动更新')
    },
    async runDue() {
      if (!wiki.storySearchEnabled) return
      const dayKey = await gate.claim('story-update')
      if (!dayKey) return
      await run('定时更新')
    },
  }
}

export type StoryUpdater = ReturnType<typeof createStoryUpdater>
