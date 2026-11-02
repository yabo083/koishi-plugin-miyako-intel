// Koishi 控制台的状态面板：注册页面入口 + 两个 RPC 监听
import { Context } from 'koishi'
import { resolve } from 'node:path'
import { Config as RuntimeConfig } from '../types'
import { WarfarinStorySearchService } from '../services/warfarin-story-search'
import { WikiSearchOrchestrator } from '../wiki/search'
import { StoryUpdater } from '../wiki/story-update'

export interface ConsolePanelDeps {
  ctx: Context
  config: RuntimeConfig
  search: WikiSearchOrchestrator
  storySearch: WarfarinStorySearchService
  storyUpdater: StoryUpdater
  storyScopes: string[]
  /** 所有群的热点检索词条预览文本 */
  digestPreview?: () => Promise<string>
  /** 立即执行一次热点词条周报（忽略 cron 与 6 天间隔），返回每群结果文本 */
  digestRun?: () => Promise<string[]>
}

function formatSearchCacheStatus(ttlMs: number, entries: number, maxEntries: number) {
  if (!ttlMs) return '关闭'
  const minutes = Math.max(1, Math.round(ttlMs / 60000))
  return `${entries}/${maxEntries}，${minutes} 分钟`
}

export function registerConsolePanel(deps: ConsolePanelDeps) {
  const { ctx, config, search, storySearch, storyUpdater, storyScopes, digestPreview, digestRun } = deps
  const { wiki } = config

  /** 只看能不能连上，不关心响应内容 */
  const ping = async (url: string) => {
    try {
      await ctx.http(url, { method: 'GET', timeout: wiki.timeoutMs, validateStatus: () => true })
      return '可用'
    } catch {
      return '不可用'
    }
  }

  async function buildStatus() {
    const trimmed = (url: string) => url.replace(/\/+$/g, '')
    return {
      daily: {
        enabled: config.dailyCardEnabled,
        refreshCron: config.refreshCron,
      },
      push: {
        enabled: config.scheduledPush.enabled,
        channels: config.scheduledPush.channels.filter(Boolean).length,
        cron: config.scheduledPush.cron,
      },
      sites: {
        prts: await ping('https://prts.wiki/'),
        warfarin: await ping(`${trimmed(wiki.baseUrl)}/${wiki.language}/search?q=%E6%81%AF%E5%A3%A4`),
        story: wiki.storySearchEnabled
          ? `本地 ${storySearch.size} 条`
          : await ping(`${trimmed(wiki.storyBaseUrl)}/${wiki.storyLanguage}/search?q=%E7%94%BB%E5%8D%B7%E9%80%9A%E9%81%93&scope=${storyScopes.join(',')}`),
      },
      cache: {
        searchTtlMs: wiki.searchCacheTtlMs,
        searchEntries: search.cachedEntryCount,
        searchMaxEntries: wiki.searchCacheMaxEntries,
        searchLabel: formatSearchCacheStatus(wiki.searchCacheTtlMs, search.cachedEntryCount, wiki.searchCacheMaxEntries),
      },
    }
  }

  async function updateStory() {
    if (!wiki.storySearchEnabled) return { ok: false, message: 'Warfarin 本地全文搜索未启用。' }
    if (storyUpdater.isUpdating) return { ok: false, message: 'Warfarin 全文包正在更新，请稍后。' }
    return await storyUpdater.run('手动拉取')
      ? { ok: true, message: `已从远端拉取 Warfarin 全文包，本地 ${storySearch.size} 条。` }
      : { ok: false, message: 'Warfarin 全文包拉取失败，请查看日志。' }
  }

  ctx.console?.addEntry({
    dev: resolve(__dirname, '../../client/index.ts'),
    prod: resolve(__dirname, '../../dist'),
  })
  ctx.console?.addListener?.('miyako-intel/status', buildStatus)
  ctx.console?.addListener?.('miyako-intel/update-story', updateStory)
  ctx.console?.addListener?.('miyako-intel/wiki-digest-preview', async () => ({ ok: true, text: await digestPreview?.() || '' }))
  ctx.console?.addListener?.('miyako-intel/wiki-digest-run', async () => {
    const results = await digestRun?.() || []
    return { ok: true, text: results.length ? results.join('\n') : '没有可执行的热点词条周报。' }
  })
}
