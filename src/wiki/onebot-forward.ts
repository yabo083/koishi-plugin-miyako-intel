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

/** 每个节点最多 groupForwardNodeLineLimit 行、且不超过单条消息字符上限，超长文本先切片再按行分组 */
export function buildOneBotForwardNodes(texts: string[], wikiConfig: WikiConfig): OneBotForwardNode[] {
  const limit = Math.max(3, Math.min(80, Number(wikiConfig.groupForwardNodeLineLimit || 20)))
  const chunks: string[] = []
  for (const text of texts) {
    for (const piece of splitWikiMessage(text)) {
      const lines = piece.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += limit) {
        chunks.push(lines.slice(index, index + limit).join('\n').trim())
      }
    }
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

// NapCat 实测：单张合并转发总正文 5000 字可发、6000 字报「发送转发消息失败」，
// 所以按 4000 字一批拆成多张转发卡片，而不是一张塞满整个详情。
export const FORWARD_BATCH_CHARS = 4000

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
  const userId = session?.userId || session?.uid
    || (isOneBotPrivateChannel(session?.cid) ? session.cid : session?.channelId)
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
