// 长图渲染：HTML → 整页单图截图（超 QQ 上限退回 JPEG q85/q70），供群相册上传与群内预览
import { Context } from 'koishi'
import { QQ_IMAGE_MAX_BYTES } from '../services/capture'

export function escapeHtml(text: string) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface SlicePage {
  setViewport(viewport: Record<string, unknown>): Promise<unknown>
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>
  setContent(html: string, options?: Record<string, unknown>): Promise<unknown>
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>
  screenshot(options?: Record<string, unknown>): Promise<unknown>
  close(): Promise<unknown>
}

export interface RenderedPageImage {
  image: Buffer
  mime: 'image/png' | 'image/jpeg'
  /** 文档实际高度（px），供调用方决定要不要缩小内容重渲 */
  height: number
}

/** 整页单图渲染：量出文档高度后全页截图；超 QQ 大小上限依次退回 JPEG q85/q70。
 *  传 filePath 时改走 file:// 加载（file:// 字体链接只能在页面导航下生效，setContent 会被拦）。 */
export async function renderPageImage(ctx: Context, html: string, width: number, options: { filePath?: string } = {}): Promise<RenderedPageImage> {
  const page = await ctx.puppeteer!.page() as SlicePage
  try {
    if (options.filePath) {
      await page.setViewport({ width, height: 800, deviceScaleFactor: 1 })
      const fileUrl = 'file://' + (process.platform === 'win32' ? '/' : '') + options.filePath.replace(/\\/g, '/')
      await page.goto(fileUrl, { waitUntil: 'load' })
      await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => undefined) : undefined)).catch(() => undefined)
    } else {
      await page.setViewport({ width, height: 800, deviceScaleFactor: 1 })
      await page.setContent(html, { waitUntil: 'load' })
    }
    const height = Math.max(1, Math.ceil(await page.evaluate(() => {
      const doc = document.documentElement
      return Math.max(doc?.scrollHeight || 0, document.body?.scrollHeight || 0)
    })))
    let image = Buffer.from(await page.screenshot({ type: 'png', fullPage: true }) as Uint8Array)
    let mime: RenderedPageImage['mime'] = 'image/png'
    for (const quality of [85, 70]) {
      if (image.byteLength <= QQ_IMAGE_MAX_BYTES) break
      image = Buffer.from(await page.screenshot({ type: 'jpeg', quality, fullPage: true }) as Uint8Array)
      mime = 'image/jpeg'
    }
    return { image, mime, height }
  } finally {
    await page.close().catch(() => undefined)
  }
}
