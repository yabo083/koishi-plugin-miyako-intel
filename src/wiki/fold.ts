// 跨来源结果的去重与折叠：官方搜索与本地剧情包描述的是同一个 wiki
import { WarfarinWikiAnchor } from '../services/warfarin-wiki'

export type WikiSearchSource = 'wiki' | 'story'
export type SelectedWikiAnchor = WarfarinWikiAnchor & { sourceKind?: WikiSearchSource }

export type WikiReplyPayload = string | string[]

export interface WikiSearchResult<T = WarfarinWikiAnchor> {
  results: T[]
  total: number
  took_ms: number
}

export function tagWikiSearchResult(result: WikiSearchResult, source: WikiSearchSource): WikiSearchResult<SelectedWikiAnchor> {
  return {
    ...result,
    results: result.results.map((item) => ({ ...item, sourceKind: source })),
  }
}

export function emptyWikiSearchResult(): WikiSearchResult<SelectedWikiAnchor> {
  return { results: [], total: 0, took_ms: 0 }
}

/** 同一来源里 anchor_id+scope 重复的直接丢掉（同一 anchor_id 可跨 scope 复用，如 items/gear） */
export function dedupeWikiResults(results: SelectedWikiAnchor[]) {
  const seen = new Set<string>()
  const unique: SelectedWikiAnchor[] = []
  for (const item of results) {
    const key = `${item.sourceKind || 'wiki'}:${item.scope || ''}:${item.anchor_id}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

// 同一类型（scope）下标题相同的条目是同一个页面，合并时保留正文更丰富的一条，
// 避免官方与本地两个来源各显示一遍。
export function foldCrossSourceDuplicates(results: SelectedWikiAnchor[]): SelectedWikiAnchor[] {
  const groups = new Map<string, SelectedWikiAnchor>()
  for (const item of results) {
    const key = `${item.scope || ''}\t${wikiSourceTitleKey(item.source)}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, item)
      continue
    }
    if (normalizeWikiFoldText(item.content).length > normalizeWikiFoldText(existing.content).length) {
      groups.set(key, item)
    }
  }
  return Array.from(groups.values())
}

function wikiSourceTitleKey(source: string) {
  const withoutHint = source.replace(/（另有 \d+ 个变体）/g, '')
  const index = withoutHint.indexOf('：')
  const label = index >= 0 ? withoutHint.slice(0, index) : ''
  const title = (index >= 0 ? withoutHint.slice(index + 1) : withoutHint).replace(/\s+/g, '')
  // 官方与本地对同一页面的类目标签不同（材料 vs 物品信息），归为同一类参与折叠；
  // "生产蓝图"是插件自设的独立类目，必须与物品本体区分开。
  const foldClass = label === '生产蓝图' ? '生产蓝图' : '*'
  return `${foldClass}|${title}`
}

function normalizeWikiFoldText(text: string) {
  return String(text || '').replace(/\s+/g, '')
}
