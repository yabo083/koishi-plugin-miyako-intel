// 回复发送：群聊/私聊统一走 OneBot 合并转发（超长拆多张卡片），转发不可用时按长度分片发普通文本
import { ScopedLogger } from '../core/logger'
import { sanitizeForwardError } from '../core/errors'
import { Config as RuntimeConfig } from '../types'
import { WikiReplyPayload } from './fold'
import { batchOneBotForwardNodes, buildOneBotForwardNodes, canSendSingleCardForward, ForwardUncertainError, sendOneBotForwardNodesWithRetry } from './onebot-forward'
import { splitWikiMessage } from './message-split'
import { obfuscateOutgoing } from './obfuscate'

type WikiConfig = RuntimeConfig['wiki']

// NapCat/QQ 对单条消息有硬上限：实测 9 KB 的私聊文本直接返回 result:10 且不落库，
// 合并转发单张也有总量上限（5000 字可发 / 6000 字失败），所以两条路径都要切。

/** 群聊、或 OneBot 私聊（转发在私聊也能用）才走合并转发 */
function shouldSendForward(session: any, wikiConfig: WikiConfig) {
  if (!wikiConfig.groupForwardEnabled || !session) return false
  if (session.guildId || session.subtype === 'group') return true
  if (session.platform === 'onebot' && (session.userId || session.uid || session.channelId)) return true
  return false
}

export interface WikiReplySender {
  /** 返回值交给 Koishi 当命令回复；已自行 send 完的场景返回 undefined */
  send: (session: any, payload: WikiReplyPayload) => Promise<string | undefined>
  from: (session: any, create: () => Promise<WikiReplyPayload> | WikiReplyPayload) => Promise<string | undefined>
}

function normalizePayload(payload: WikiReplyPayload) {
  const texts = typeof payload === 'string' ? [payload] : payload || []
  return texts.filter(Boolean)
}

export function createWikiReplySender(wikiConfig: WikiConfig, logger: ScopedLogger): WikiReplySender {
  const obfuscate = (text: string) => obfuscateOutgoing(text, {
    enabled: wikiConfig.obfuscateEnabled ?? true,
    zeroWidthInterval: wikiConfig.obfuscateZeroWidthInterval ?? 6,
    homophones: wikiConfig.obfuscateHomophones ?? [],
  })

  async function send(session: any, payload: WikiReplyPayload) {
    const texts = normalizePayload(payload)
    if (!texts.length) return undefined
    const pending: string[] = []
    if (shouldSendForward(session, wikiConfig)) {
      // 出站混淆打在节点内容上，news 预览与失败回退都沿用同一份文本
      const nodes = buildOneBotForwardNodes(texts, wikiConfig)
        .map((node) => ({ ...node, data: { ...node.data, content: obfuscate(node.data.content) } }))
      const batches = !nodes.length ? [] : canSendSingleCardForward(session)
        ? [nodes]
        : batchOneBotForwardNodes(nodes)
      let forwardOk = batches.length > 0
      for (const batch of batches) {
        if (!forwardOk) {
          pending.push(...batch.map((node) => node.data.content))
          continue
        }
        try {
          forwardOk = await sendOneBotForwardNodesWithRetry(session, batch, wikiConfig) === true
        } catch (error) {
          // 超时/中断时卡片可能已经送达，再发文本会让同一份详情重复刷屏。
          if (error instanceof ForwardUncertainError) {
            logger.warn(`Warfarin Wiki 合并转发结果未知，跳过重复发送：${sanitizeForwardError(error)}`)
            return undefined
          }
          logger.warn(`Warfarin Wiki 合并转发发送失败，回退普通文本：${sanitizeForwardError(error)}`)
          forwardOk = false
        }
        if (!forwardOk) pending.push(...batch.map((node) => node.data.content))
      }
      if (forwardOk) return undefined
    }
    // 纯文本路径只留一条出口：转发失败的回退文本（节点内容已混淆过）按原样切片
    const outgoing = pending.length
      ? pending.flatMap((chunk) => splitWikiMessage(chunk))
      : texts.flatMap((text) => splitWikiMessage(text).map(obfuscate))
    if (!outgoing.length) return undefined
    if (outgoing.length === 1) return outgoing[0]
    for (const chunk of outgoing) await session.send(chunk)
    return undefined
  }

  return {
    send,
    async from(session, create) {
      return send(session, await create())
    },
  }
}
