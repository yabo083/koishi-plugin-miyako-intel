// ChatLuna 工具接入：两阶段检索——search 只给候选，read 才回受限正文
import { WarfarinWikiContextResult, WarfarinWikiSearchResult } from '../services/warfarin-wiki'
import { excerptAroundKeyword, formatWikiContext } from './format'

export interface ChatLunaToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  execute: (input: Record<string, any>) => Promise<any>
}

export interface WarfarinWikiToolsDeps {
  search: (keyword: string) => Promise<WarfarinWikiSearchResult>
  context: (anchorId: string, scope?: string) => Promise<WarfarinWikiContextResult>
  topK: number
  excerptChars: number
  contextChars: number
}

export function createWarfarinWikiTools(deps: WarfarinWikiToolsDeps): ChatLunaToolDefinition[] {
  return [
    {
      name: 'warfarin_wiki_search',
      description: '按关键词检索 Warfarin Wiki，返回候选条目的 anchor_id、scope、来源与摘要。',
      parameters: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
      execute: async (input) => {
        const keyword = String(input.keyword || '')
        const result = await deps.search(keyword)
        return result.results.slice(0, deps.topK).map((item) => ({
          anchor_id: item.anchor_id,
          scope: item.scope,
          source: item.source,
          excerpt: excerptAroundKeyword(item.content, keyword, deps.excerptChars),
        }))
      },
    },
    {
      name: 'warfarin_wiki_read',
      description: '读取指定 Warfarin Wiki 条目正文。正文仅供模型参考，不得原样转发到群。',
      parameters: {
        type: 'object',
        properties: {
          anchor_id: { type: 'string' },
          scope: { type: 'string' },
        },
        required: ['anchor_id'],
      },
      execute: async (input) => {
        const result = await deps.context(String(input.anchor_id || ''), input.scope ? String(input.scope) : undefined)
        const text = formatWikiContext(result, { mode: 'clipped', maxChars: deps.contextChars })
        return {
          anchor_id: result.anchor.anchor_id,
          source: result.source_ref || result.anchor.source,
          text,
          truncated: text.includes('已节选'),
          url: result.anchor.url,
        }
      },
    },
  ]
}
