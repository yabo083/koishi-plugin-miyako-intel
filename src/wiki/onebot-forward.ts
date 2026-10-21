// OneBot/NapCat 合并转发：把多段文本拆成节点、发群/发私聊、失败重试一次
import { Config as RuntimeConfig } from '../types'
import { splitWikiMessage } from './message-split'

type WikiConfig = RuntimeConfig['wiki']

const FORWARD_RETRY_DELAY_MS = 2000

/** onebot:group:123 / 纯数字 都归一成 OneBot 需要的数字 id */
export function normalizeOneBotId(value: unknown) {
  const text = String(value || '').trim()
  const match = text.match(/^onebot:(?:group|private):(\d+)$/i)
  if (match) return Number(match[1])
  return /^\d+$/.test(text) ? Number(text) : text
}

export function isOneBotGroupChannel(value: unknown) {
  return /^onebot:group:\d+$/i.test(String(value || '').trim())
}

export function isOneBotPrivateChannel(value: unknown) {
  return /^onebot:private:\d+$/i.test(String(value || '').trim())
}

export interface OneBotForwardNode {
  type: 'node'
  data: { name: string; uin: number | string; content: string }
}

// NapCat 默认把每个节点的全文塞进合并转发的 ARK 预览（news），正文一多客户端就拒收
// （实测 5000 字可发 / 6000 字失败）；改传空 news 后 25 个节点、10798 字仍能单张卡片发出。
// 因此优先走原始 API 并带 news: []，拿不到原始 API 时才退回按 5000 字拆卡片。
export const FORWARD_BATCH_CHARS = 5000
const FORWARD_NODE_CHARS = 4000

type ForwardTransport = Record<string, unknown> & {
  _get?: (action: string, params: Record<string, unknown>) => Promise<unknown>
}

function forwardTransport(session: unknown): ForwardTransport | undefined {
  if (!session || typeof session !== 'object') return undefined
  const value = session as { onebot?: unknown; bot?: { internal?: unknown } }
  const onebot = value.onebot ?? value.bot?.internal
  return onebot && typeof onebot === 'object' ? onebot as ForwardTransport : undefined
}

/** Koishi 的 OneBot internal 才有 _get，可透传 NapCat 的 news 扩展字段 */
export function canSendSingleCardForward(session: unknown) {
  return typeof forwardTransport(session)?._get === 'function'
}

/** 有分节（空行）时按章节装节点；没有分节（对话体）时退回按行分组 */
function splitForwardPieces(text: string, lineLimit: number): string[] {
  const source = String(text || '').trim()
  if (!source) return []
  const sections = source.split(/\n{2,}/).map((section) => section.trim()).filter(Boolean)
  if (sections.length <= 1) {
    const pieces: string[] = []
    for (const chunk of splitWikiMessage(source, FORWARD_NODE_CHARS)) {
      const lines = chunk.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += lineLimit) {
        pieces.push(lines.slice(index, index + lineLimit).join('\n').trim())
      }
    }
    return pieces.filter(Boolean)
  }
  const pieces: string[] = []
  for (const section of sections) {
    if (section.length > FORWARD_NODE_CHARS) pieces.push(...splitWikiMessage(section, FORWARD_NODE_CHARS))
    else pieces.push(section)
  }
  // 只有标题/简介的短节（检索页头、干员简介）并进下一节，卡片里不单独占一个节点。
  const merged: string[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.length < 200 && last.length + piece.length + 2 <= FORWARD_NODE_CHARS) {
      merged[merged.length - 1] = `${last}\n\n${piece}`
    } else {
      merged.push(piece)
    }
  }
  return merged.filter(Boolean)
}

export function buildOneBotForwardNodes(texts: string[], wikiConfig: WikiConfig): OneBotForwardNode[] {
  const limit = Math.max(3, Math.min(80, Number(wikiConfig.groupForwardNodeLineLimit || 20)))
  const chunks: string[] = []
  for (const text of texts) {
    chunks.push(...splitForwardPieces(text, limit))
  }
  return chunks.filter(Boolean).map((content) => ({
    type: 'node',
    data: {
      name: wikiConfig.groupForwardSenderName || 'Warfarin Wiki',
      uin: normalizeOneBotId(wikiConfig.groupForwardSenderUin || '2854196310'),
      content,
    },
  }))
}

export function batchOneBotForwardNodes(nodes: OneBotForwardNode[], maxChars = FORWARD_BATCH_CHARS): OneBotForwardNode[][] {
  const batches: OneBotForwardNode[][] = []
  let current: OneBotForwardNode[] = []
  let size = 0
  for (const node of nodes) {
    const length = node.data.content.length
    if (current.length && size + length > maxChars) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(node)
    size += length
  }
  if (current.length) batches.push(current)
  return batches
}

/** 群优先、私聊兜底；两套命名（驼峰 / 下划线）都试，适配不同 OneBot 实现 */
async function sendOneBotForwardNodes(session: any, messages: OneBotForwardNode[], wikiConfig: WikiConfig) {
  const onebot = session?.onebot || session?.bot?.internal
  const groupId = session?.guildId
    || (session?.subtype === 'group' ? session?.channelId || session?.cid : '')
    || (isOneBotGroupChannel(session?.cid) ? session.cid : '')
  const userId = session?.userId || session?.uid
    || (isOneBotPrivateChannel(session?.cid) ? session.cid : session?.channelId)
  // 原始 API 能透传 news：空数组会让 QQ 渲染出乱码且打不开卡片，所以给每节点一条截断预览；
  // 卡片体积只跟预览字数有关，正文仍完整留在转发包里，单张卡片可以放任意条数。
  const transport = forwardTransport(session)
  if (typeof transport?._get === 'function') {
    const news = messages.map((node) => {
      const flat = node.data.content.replace(/\s+/g, ' ').trim()
      return { text: flat.length > 26 ? `${flat.slice(0, 26)}…` : flat }
    })
    if (groupId) {
      await transport._get('send_group_forward_msg', { group_id: normalizeOneBotId(groupId), messages, news })
      return true
    }
    if (userId) {
      await transport._get('send_private_forward_msg', { user_id: normalizeOneBotId(userId), messages, news })
      return true
    }
    return false
  }
  if (groupId) {
    if (onebot?.sendGroupForwardMsg) {
      await onebot.sendGroupForwardMsg(groupId, messages)
      return true
    }
    if (onebot?.send_group_forward_msg) {
      await onebot.send_group_forward_msg({ group_id: normalizeOneBotId(groupId), messages })
      return true
    }
  }
  if (!userId) return false
  if (onebot?.sendPrivateForwardMsg) {
    await onebot.sendPrivateForwardMsg(userId, messages)
    return true
  }
  if (onebot?.send_private_forward_msg) {
    await onebot.send_private_forward_msg({ user_id: normalizeOneBotId(userId), messages })
    return true
  }
  return false
}

/** 转发接口偶发失败，隔 2s 重试一次；重试仍失败就交给上层改走普通文本 */
export async function sendOneBotForwardNodesWithRetry(session: any, messages: OneBotForwardNode[], wikiConfig: WikiConfig) {
  try {
    return await sendOneBotForwardNodes(session, messages, wikiConfig)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, FORWARD_RETRY_DELAY_MS))
    return sendOneBotForwardNodes(session, messages, wikiConfig)
  }
}
