// 零宽字符与同音字混淆：出站文本打散防风控，入站查询先还原保证「还能搜到」
export interface ObfuscateHomophone {
  from: string
  to: string
}

export interface ObfuscateOptions {
  enabled: boolean
  zeroWidthInterval: number
  homophones: ObfuscateHomophone[]
}

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\uFEFF]/g
const URL_RE = /(https?:\/\/\S+)/g
const CJK_RUN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]+/g
const ZWSP = '\u200B'

export function stripZeroWidth(text: string) {
  return String(text ?? '').replace(ZERO_WIDTH_RE, '')
}

/** 入站归一化：先去零宽，再把同音混淆字换回正字（长的先换），最后收敛空白 */
export function normalizeQueryText(text: string, homophones: ObfuscateHomophone[] = []) {
  let value = stripZeroWidth(text)
  for (const pair of sortByLength(homophones, 'to')) {
    value = value.split(pair.to).join(pair.from)
  }
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * 出站混淆：URL 原样保留；其余片段先做同音替换，再按 interval 在汉字串里插零宽空格。
 * 纯 ASCII / 数字 / 命令（w 1、w+2）不含汉字，结果与输入逐字节一致。
 */
export function obfuscateOutgoing(text: string, opts: ObfuscateOptions) {
  const source = String(text ?? '')
  if (!opts?.enabled) return source
  const interval = Math.max(0, Math.trunc(opts.zeroWidthInterval || 0))
  const pairs = sortByLength(opts.homophones || [], 'from')
  return source.split(URL_RE).map((part, index) => {
    if (index % 2 === 1 || !part) return part
    let out = part
    for (const { from, to } of pairs) out = out.split(from).join(to)
    if (interval > 0) {
      out = out.replace(CJK_RUN_RE, (run) => {
        let result = ''
        for (let i = 0; i < run.length; i++) {
          result += run[i]
          if ((i + 1) % interval === 0 && i + 1 < run.length) result += ZWSP
        }
        return result
      })
    }
    return out
  }).join('')
}

function sortByLength(pairs: ObfuscateHomophone[], key: 'from' | 'to') {
  return pairs.filter((pair) => pair?.from && pair?.to).slice().sort((a, b) => b[key].length - a[key].length)
}
