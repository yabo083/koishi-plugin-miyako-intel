// 日报生成失败时的回退卡片：一张「信使把报纸弄丢了」的插画 + 写在牌子上的一句致歉。
// 牌子（深色对话框）的位置按插画宽高比例给出，换图时只改 SIGN 常量；
// 致歉理由三选一（disaster / courier / packet），由控制台配置决定用哪一句。
import fs from 'node:fs/promises'
import path from 'node:path'

const ASSET_DIRECTORY = path.join(__dirname, '..', '..', 'assets', 'fallback')
const FALLBACK_IMAGE_FILE = 'lost-card.png'

/** 牌子在插画里的位置（占图片宽高的比例），取自 assets/fallback/lost-card.png */
const SIGN = { left: 0.2637, top: 0.2072, width: 0.4805, height: 0.1668 }
/** 牌子内框留白（占牌子宽高的比例）与字号（占牌子高度的比例）：字号按「24 字排三行」定尺 */
const SIGN_PADDING_X = 0.07
const SIGN_PADDING_Y = 0.06
const SIGN_FONT_RATIO = 0.185

export interface FallbackReason {
  id: string
  /** 控制台里显示的理由本身 */
  label: string
  /** 写到牌子上的整句话；cardName 是当前卡片风格名，如「泰拉周刊」 */
  sentence: (cardName: string) => string
}

export const FALLBACK_REASONS: Record<string, FallbackReason> = {
  disaster: { id: 'disaster', label: '遇到了天灾', sentence: (card) => `很抱歉博士！今日的「${card}」遇到了天灾。` },
  courier: { id: 'courier', label: '被见习信使弄丢了', sentence: (card) => `很抱歉博士！今日的「${card}」被见习信使弄丢了。` },
  packet: { id: 'packet', label: '城际网络丢包了', sentence: (card) => `很抱歉博士！今日的「${card}」城际网络丢包了。` },
}

export const DEFAULT_FALLBACK_REASON = 'disaster'

/** 回退插画本体：连浏览器都起不来时直接发它，牌子留空也好过什么都不发 */
export async function readFallbackImage(): Promise<Buffer> {
  return fs.readFile(path.join(ASSET_DIRECTORY, FALLBACK_IMAGE_FILE))
}

/** 从 PNG 头读宽高，插画换分辨率时版式跟着走 */
export function readPngSize(buffer: Buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('回退插画不是 PNG 文件。')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function escapeHtml(text: string) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const FALLBACK_CSS = `
html, body { margin: 0; padding: 0; background: #ffffff; }
#letter { position: relative; }
#letter > img { display: block; width: 100%; height: 100%; }
.sign {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.sign-text {
  margin: 0;
  color: #eef0f3;
  font-family: "LXGW WenKai Lite", "Kaiti SC", "KaiTi", "STKaiti", serif;
  font-weight: 700;
  line-height: 1.32;
  letter-spacing: 0.02em;
  text-align: center;
  word-break: break-all;
}
`

/** 回退卡片 HTML：插画按原始像素铺满，致歉句写在牌子里 */
export function renderFallbackHtml(options: {
  imageDataUrl: string
  message: string
  fontsCssLinks: string
  width: number
  height: number
}) {
  const { imageDataUrl, message, fontsCssLinks, width, height } = options
  const signWidth = width * SIGN.width
  const signHeight = height * SIGN.height
  const fontSize = Math.round(signHeight * SIGN_FONT_RATIO)
  const paddingX = Math.round(signWidth * SIGN_PADDING_X)
  const paddingY = Math.round(signHeight * SIGN_PADDING_Y)
  const percent = (value: number) => `${(value * 100).toFixed(3)}%`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>明日方舟 · 日报回退</title>
${fontsCssLinks}
<style>${FALLBACK_CSS}</style>
</head>
<body>
<main id="letter" style="width: ${width}px; height: ${height}px">
  <img src="${imageDataUrl}" alt="">
  <div class="sign" style="left: ${percent(SIGN.left)}; top: ${percent(SIGN.top)}; width: ${percent(SIGN.width)}; height: ${percent(SIGN.height)}; padding: ${paddingY}px ${paddingX}px">
    <p class="sign-text" style="font-size: ${fontSize}px">${escapeHtml(message)}</p>
  </div>
</main>
</body>
</html>`
}
