// 聊天文本分片：OneBot/QQ 对单条消息有硬上限，超长正文必须切片后再发
export const MAX_MESSAGE_CHARS = 1200

/** 按行装片，单行超长再硬切；调用方不再需要关心平台上限 */
export function splitWikiMessage(text: string, maxChars = MAX_MESSAGE_CHARS): string[] {
  const source = String(text || '')
  if (!source.trim()) return []
  if (source.length <= maxChars) return [source]
  const chunks: string[] = []
  let current: string[] = []
  let size = 0
  for (const line of source.split(/\r?\n/)) {
    if (line.length > maxChars) {
      if (current.length) {
        chunks.push(current.join('\n').trim())
        current = []
        size = 0
      }
      for (let index = 0; index < line.length; index += maxChars) chunks.push(line.slice(index, index + maxChars))
      continue
    }
    const nextSize = size ? size + 1 + line.length : line.length
    if (nextSize > maxChars) {
      chunks.push(current.join('\n').trim())
      current = [line]
      size = line.length
    } else {
      current.push(line)
      size = nextSize
    }
  }
  if (current.length) chunks.push(current.join('\n').trim())
  return chunks.filter(Boolean)
}
