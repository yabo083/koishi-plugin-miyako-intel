import { h } from 'koishi'
import { CachedImageResult, CaptureKind, Config } from '../types'
import { DailyImageCache, getZonedParts } from './cache'
import { matchesCronExpression } from './cron'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
export const DAILY_CAPTURE_ID = 'prts-capture-daily-v2'
const QQ_IMAGE_MAX_BYTES = 2 * 1024 * 1024

export function normalizeHeadingText(input: string) {
  return input.replace(/[\s ]+/g, ' ').trim()
}

export function parseRefreshHours(text: string) {
  const day = Number((text.match(/(\d+)\s*天/) || [0, 0])[1])
  const hour = Number((text.match(/(\d+)\s*小时/) || [0, 0])[1])
  const minute = Number((text.match(/(\d+)\s*分钟/) || [0, 0])[1])
  return day * 24 + hour + minute / 60
}

export function shouldHighlightRefresh(hours: number, threshold = 72) {
  return Number.isFinite(hours) && hours < threshold
}

export function getCountdownUrgencyClass(hours: number) {
  if (!Number.isFinite(hours)) return 'safe'
  if (hours < 12) return 'danger'
  if (hours < 72) return 'warn'
  return 'safe'
}

export function shouldRemoveFromStatusColumn(text: string) {
  return /全局剿灭|常驻中坚|采购凭证区|信物库存|后结束|后刷新/.test(text)
}

export function shouldRemoveFromCoreColumn(text: string) {
  return /现在时间|今日资源收集|物资筹备分区|芯片搜索分区|资质凭证采购/.test(text)
}

export function isNoiseNodeText(text: string) {
  const value = text.trim()
  return value === '[查看详情]' || value === '↑' || value === 'TOP'
}

export function isRedcertDetailNode(html: string) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const normalizedText = text.replace(/\s+/g, '')
  if (!normalizedText.includes('采购凭证区的信物库存将于')) return false
  if (!normalizedText.includes('以下信物将会被刷新')) return false
  const classText = (html.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[1]
    || html.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[2]
    || html.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[3]
    || '')
  return !/\bmw-customtoggle-redcert_warn\b/.test(classText)
}

export function hasRedcertRawDetailText(text: string) {
  const normalized = text.replace(/\s+/g, '')
  return normalized.includes('采购凭证区的信物库存将于') && normalized.includes('以下信物将会被刷新')
}

export function extractRedcertDetailHtmlFromHtml(html: string) {
  const marker = /<([a-z0-9]+)\b[^>]*\bid\s*=\s*(?:"mw-customcollapsible-redcert_warn"|'mw-customcollapsible-redcert_warn'|mw-customcollapsible-redcert_warn)[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = marker.exec(html))) {
    const element = extractBalancedElement(html, match.index, match[1])
    if (element && isRedcertDetailNode(element)) return element
  }
  return ''
}

export function shouldDiscardOriginalRedcertNode(html: string) {
  const firstTag = html.match(/<([a-z0-9]+)\b([^>]*)>/i)
  if (!firstTag) return false
  const attrs = firstTag[2] || ''
  const classText = getAttribute(attrs, 'class')
  if (/\bprts-redcert-detail\b/.test(classText)) return false
  if (getAttribute(attrs, 'id') !== 'mw-customcollapsible-redcert_warn') return false
  if (/\bmw-customtoggle-redcert_warn\b/.test(classText)) return false
  return isRedcertDetailNode(html)
}

export function buildDailyTerminalStyles(captureId: string) {
  return `
    #${captureId} {
      width: 1280px;
      box-sizing: border-box;
      margin: 0 auto;
      padding: 18px 20px 22px;
      color: #e7edf3 !important;
      background:
        linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
        #1a1c1e;
      background-size: 32px 32px, 32px 32px, cover;
      font-family: "Source Han Sans CN", "Microsoft YaHei", "Segoe UI", sans-serif;
      line-height: 1.42;
    }
    #${captureId} * {
      box-sizing: border-box;
      color: #e7edf3;
      letter-spacing: 0;
    }
    #${captureId} a {
      color: #82d9ff !important;
      text-decoration: none;
    }
    .prts-mono,
    .prts-golden-meta,
    .CDMiniContainer,
    .CDScontainer,
    .wgTimeClock {
      font-family: "JetBrains Mono", "Cascadia Mono", "Consolas", monospace;
      font-variant-numeric: tabular-nums;
    }
    .prts-golden-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      min-height: 44px;
      margin-bottom: 12px;
      padding: 9px 12px;
      border: 1px solid rgba(0,178,255,.45);
      background: linear-gradient(90deg, rgba(0,178,255,.12), rgba(10,14,18,.72));
      position: relative;
    }
    .prts-golden-header::before,
    .prts-golden-header::after {
      content: "";
      position: absolute;
      width: 16px;
      height: 16px;
      border-color: #00b2ff;
      opacity: .9;
    }
    .prts-golden-header::before {
      left: -1px;
      top: -1px;
      border-left: 2px solid;
      border-top: 2px solid;
    }
    .prts-golden-header::after {
      right: -1px;
      bottom: -1px;
      border-right: 2px solid;
      border-bottom: 2px solid;
    }
    .prts-golden-title {
      font-weight: 850;
      color: #f4f8fb !important;
      text-transform: uppercase;
    }
    .prts-golden-title::before {
      content: "RI-";
      color: #00b2ff;
      margin-right: 4px;
    }
    .prts-golden-meta {
      font-size: 13px;
      color: #9fb2c2 !important;
    }
    .prts-dashboard-grid {
      display: grid;
      grid-template-columns: 1fr 2fr 1fr;
      gap: 12px;
      align-items: start;
    }
    .prts-terminal-column {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 12px;
    }
    .prts-card {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border: 1px solid rgba(0,178,255,.25);
      border-radius: 6px;
      background: rgba(30,34,39,.92);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 10px 28px rgba(0,0,0,.28);
    }
    .prts-card--status .prts-card-body {
      min-height: 245px;
    }
    .prts-card--core .prts-card-body {
      min-height: 245px;
    }
    .prts-card-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px 10px 18px;
      border-left: 4px solid #00b2ff;
      border-bottom: 1px solid rgba(0,178,255,.18);
      background: linear-gradient(90deg, rgba(0,178,255,.20), rgba(8,22,32,.72));
      font-size: 20px;
      font-weight: 850;
      color: #f7fbff !important;
    }
    .prts-card-header small {
      flex: none;
      font-family: "JetBrains Mono", "Cascadia Mono", "Consolas", monospace;
      font-size: 10px;
      font-weight: 700;
      color: rgba(255,207,0,.88) !important;
      text-transform: uppercase;
    }
    .prts-card-body {
      padding: 12px 14px 14px;
      max-height: 900px;
      overflow: hidden;
      column-gap: 14px;
    }
    .prts-card-body.too-tall { column-count: 2; }
    .prts-card-body ul,
    .prts-card-body ol {
      margin: 4px 0 7px 18px;
    }
    .prts-card-body li {
      margin: 2px 0;
      line-height: 1.42;
    }
    .prts-card-body p {
      margin: 3px 0 7px;
      line-height: 1.48;
    }
    .prts-countdown-meter {
      display: block;
      width: min(260px, 100%);
      height: 3px;
      margin-top: 4px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.08);
      overflow: hidden;
    }
    .prts-countdown-meter::before {
      content: "";
      display: block;
      width: var(--prts-progress, 50%);
      height: 100%;
      background: #00b2ff;
    }
    .prts-countdown-meter--safe::before { background: #00b2ff; }
    .prts-countdown-meter--warn::before { background: #ffcf00; }
    .prts-countdown-meter--danger::before { background: #ff5a66; }
    .prts-card--operators .prts-card-body {
      padding-top: 10px;
    }
    .prts-card--operators img {
      max-width: 64px !important;
    }
    .prts-card--recent .prts-card-body {
      min-height: 300px;
    }
    .prts-warning {
      border: 1px solid rgba(255,207,0,.34) !important;
      background: rgba(255,207,0,.055) !important;
      color: #f7fbff !important;
      font-weight: 700 !important;
    }
    .prts-warning * {
      color: #f7fbff !important;
    }
    .prts-redcert-detail {
      position: relative;
      margin-top: 6px !important;
      padding: 10px 12px 10px 40px !important;
      border: 1px solid rgba(255,207,0,.28) !important;
      border-left: 3px solid #ffcf00 !important;
      background: rgba(55,18,24,.36) !important;
      color: #f2f6fa !important;
    }
    .prts-redcert-detail::before {
      content: "[!]";
      position: absolute;
      left: 12px;
      top: 10px;
      color: #ffcf00;
      font-family: "JetBrains Mono", "Cascadia Mono", "Consolas", monospace;
      font-weight: 900;
    }
    .prts-redcert-detail .mw-collapsible-content {
      display: block !important;
      height: auto !important;
      max-height: none !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .prts-redcert-detail > [id="mw-customcollapsible-redcert_warn"],
    .prts-redcert-detail > .mw-customtoggle-redcert_warn {
      display: none !important;
    }
    .prts-redcert-detail * {
      color: #f2f6fa !important;
      text-shadow: none !important;
    }
    .prts-redcert-detail > div,
    .prts-redcert-detail > div > div {
      border-color: transparent !important;
      background: transparent !important;
      padding: 0 !important;
    }
    .prts-redcert-detail b {
      color: #ffffff !important;
    }
    .prts-card [id="mw-customcollapsible-redcert_warn"],
    .prts-card .mw-customtoggle-redcert_warn {
      color: #fff !important;
      border: 1px solid rgba(255,207,0,.22) !important;
      background: linear-gradient(90deg, rgba(96,16,24,.62), rgba(70,12,20,.28)) !important;
    }
    .prts-card [id="mw-customcollapsible-redcert_warn"] *,
    .prts-card .mw-customtoggle-redcert_warn * {
      color: #fff !important;
    }
    .prts-card .smw-collapsible-content,
    .prts-card .mw-collapsible-content,
    .mw-collapsible-content {
      display: block !important;
      height: auto !important;
      max-height: none !important;
      opacity: 1 !important;
      visibility: visible !important;
      overflow: visible !important;
    }
    .mw-collapsible-toggle {
      display: none !important;
    }
    .prts-credit-bar {
      display: flex;
      justify-content: flex-end;
      gap: 18px;
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid rgba(0,178,255,.18);
      color: #8796a3 !important;
      font-family: "JetBrains Mono", "Cascadia Mono", "Consolas", monospace;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .prts-credit-bar span {
      color: #8796a3 !important;
    }
  `
}

export class PrtsCaptureService {
  private readonly homepageUrl: string

  constructor(
    private readonly ctx: any,
    private readonly config: Config,
    private readonly cache: DailyImageCache,
    private readonly logger: { warn: (message: string) => void; info: (message: string) => void; debug?: (message: string) => void },
  ) {
    this.homepageUrl = new URL(config.homepagePath, config.baseUrl).toString()
  }

  async getDailyInfo(force = false) {
    return this.resolveCachedImage('daily', force, () => this.captureDailyInfo())
  }

  async sendImage(session: { send: (message: any) => Promise<unknown> }, result: CachedImageResult, staleMessage?: string) {
    if (result.stale && staleMessage) {
      await session.send(staleMessage)
    }

    await session.send(this.toImageFragment(result))
  }

  toImageFragment(result: CachedImageResult) {
    const dataUrl = `data:image/png;base64,${result.buffer.toString('base64')}`
    return h.image(dataUrl)
  }

  async refreshDue() {
    const now = this.getNow()
    const parts = getZonedParts(now, this.config.timezone)
    if (!matchesCronExpression(this.config.refreshCron, parts)) {
      this.logger.debug?.(`PRTS 定时刷新未到触发时间：${this.config.refreshCron}`)
      return
    }

    const needsDaily = !await this.cache.hasToday('daily')
    if (!needsDaily) {
      this.logger.debug?.('PRTS 定时刷新跳过：今日缓存已存在。')
      return
    }

    try {
      this.logger.info(`PRTS 定时刷新开始：${this.config.refreshCron}`)
      await this.getDailyInfo(true)
      this.logger.info('PRTS 定时刷新完成。')
    } catch (error) {
      this.logger.warn(`PRTS 定时刷新失败：${formatError(error)}`)
    }
  }

  private async resolveCachedImage(kind: CaptureKind, force: boolean, capture: () => Promise<{ buffer: Buffer; sourceUrls: string[]; titles?: string[] }>) {
    if (!force) {
      const cached = await this.cache.readToday(kind)
      if (cached) return cached
    }

    try {
      const fresh = await capture()
      return this.cache.write(kind, fresh.buffer, { sourceUrls: fresh.sourceUrls, titles: fresh.titles })
    } catch (error) {
      this.logger.warn(`PRTS ${kind} 截图失败：${formatError(error)}`)
      if (this.config.staleFallback) {
        const stale = await this.cache.readLatest(kind)
        if (stale) return { ...stale, stale: true }
      }
      throw error
    }
  }

  private async captureDailyInfo() {
    const buffer = await this.withPage(async (page) => {
      await this.openHomepage(page)
      await page.waitForSelector('#今日信息_2', { timeout: this.config.navigationTimeoutMs })
      await this.waitForImages(page)
      await this.waitForRenderDelay(page)
      const result = await page.evaluate((payload: { captureId: string; styles: string }) => {
        const parser = {
          normalizeHeadingText: (input: string) => input.replace(/[\s ]+/g, ' ').trim(),
          parseRefreshHours: (text: string) => {
            const day = Number((text.match(/(\d+)\s*天/) || [0, 0])[1])
            const hour = Number((text.match(/(\d+)\s*小时/) || [0, 0])[1])
            const minute = Number((text.match(/(\d+)\s*分钟/) || [0, 0])[1])
            return day * 24 + hour + minute / 60
          },
          shouldHighlightRefresh: (hours: number, threshold = 72) => Number.isFinite(hours) && hours < threshold,
          isNoiseNodeText: (text: string) => {
            const value = text.trim()
            return value === '[查看详情]' || value === '↑'
          },
          isRedcertDetailNode: (html: string) => {
            const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            const normalizedText = text.replace(/\s+/g, '')
            if (!normalizedText.includes('采购凭证区的信物库存将于')) return false
            if (!normalizedText.includes('以下信物将会被刷新')) return false
            const classText = (html.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[1]
              || html.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[2]
              || html.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[3]
              || '')
            return !/\bmw-customtoggle-redcert_warn\b/.test(classText)
          },
          hasRedcertRawDetailText: (text: string) => {
            const normalized = text.replace(/\s+/g, '')
            return normalized.includes('采购凭证区的信物库存将于') && normalized.includes('以下信物将会被刷新')
          },
          getCountdownUrgencyClass: (hours: number) => {
            if (!Number.isFinite(hours)) return 'safe'
            if (hours < 12) return 'danger'
            if (hours < 72) return 'warn'
            return 'safe'
          },
          shouldRemoveFromStatusColumn: (text: string) => /全局剿灭|常驻中坚|采购凭证区|信物库存|后结束|后刷新/.test(text),
          shouldRemoveFromCoreColumn: (text: string) => /现在时间|今日资源收集|物资筹备分区|芯片搜索分区|资质凭证采购/.test(text),
          extractRedcertDetailHtmlFromHtml: (html: string) => {
            const marker = /<([a-z0-9]+)\b[^>]*\bid\s*=\s*(?:"mw-customcollapsible-redcert_warn"|'mw-customcollapsible-redcert_warn'|mw-customcollapsible-redcert_warn)[^>]*>/gi
            const extractElement = (source: string, startIndex: number, tagName: string) => {
              const pattern = new RegExp(`<\\\\/?${tagName}\\\\b[^>]*>`, 'gi')
              pattern.lastIndex = startIndex
              let depth = 0
              let item: RegExpExecArray | null
              while ((item = pattern.exec(source))) {
                const isClosing = item[0].startsWith('</')
                depth += isClosing ? -1 : 1
                if (depth === 0) return source.slice(startIndex, pattern.lastIndex)
              }
              return ''
            }
            let item: RegExpExecArray | null
            while ((item = marker.exec(html))) {
              const element = extractElement(html, item.index, item[1])
              if (element && parser.isRedcertDetailNode(element)) return element
            }
            return ''
          },
          shouldDiscardOriginalRedcertNode: (html: string) => {
            const firstTag = html.match(/<([a-z0-9]+)\b([^>]*)>/i)
            if (!firstTag) return false
            const attrs = firstTag[2] || ''
            const attr = (name: string) => {
              const match = new RegExp(`${name}\\\\s*=\\\\s*(?:"([^"]*)"|'([^']*)'|([^\\\\s>]+))`, 'i').exec(attrs)
              return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
            }
            const classText = attr('class')
            if (/\bprts-redcert-detail\b/.test(classText)) return false
            if (attr('id') !== 'mw-customcollapsible-redcert_warn') return false
            if (/\bmw-customtoggle-redcert_warn\b/.test(classText)) return false
            return parser.isRedcertDetailNode(html)
          },
        }

        const byHeading = (name: string) => {
          const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,.mw-headline'))
          for (const node of headings) {
            const text = parser.normalizeHeadingText(node.textContent || '')
            if (text !== name) continue
            const titleHost = node.closest('h1,h2,h3,h4') || node.parentElement
            if (!titleHost) return null
            let body = titleHost.nextElementSibling
            while (body && body.tagName === 'HR') body = body.nextElementSibling
            return { titleHost, body }
          }
          return null
        }

        const collectBodiesUntilHeading = (start: Element | null) => {
          const blocks: Element[] = []
          let current = start
          while (current) {
            if (/^H[1-4]$/.test(current.tagName)) break
            blocks.push(current)
            current = current.nextElementSibling
          }
          return blocks
        }

        const todayAnchor = document.getElementById('今日信息_2')
        const todayTitleHost = todayAnchor?.closest('h1,h2,h3,h4') || todayAnchor?.parentElement || byHeading('今日信息')?.titleHost || null
        const todayBodies = (() => {
          if (!todayTitleHost) return []
          const blocks = collectBodiesUntilHeading(todayTitleHost.nextElementSibling)
          if (blocks.length) return blocks
          const fallback = document.querySelector('.mp-today')
          return fallback ? [fallback] : []
        })()

        const highlights = byHeading('亮点干员')
        const recent = byHeading('近期新增')

        const sections: Array<{ key: string; title: string; titleHost: Element; bodies: Element[] }> = []
        if (todayTitleHost && todayBodies.length) sections.push({ key: 'today', title: '今日信息', titleHost: todayTitleHost, bodies: todayBodies })
        if (highlights?.titleHost && highlights.body) sections.push({ key: 'operators', title: '亮点干员', titleHost: highlights.titleHost, bodies: [highlights.body] })
        if (recent?.titleHost && recent.body) sections.push({ key: 'recent', title: '近期新增', titleHost: recent.titleHost, bodies: [recent.body] })

        const missing = ['today', 'operators', 'recent'].filter((key) => !sections.some((item) => item.key === key))
        if (sections.length === 0) throw new Error('未找到 PRTS 今日信息/亮点干员/近期新增区域')

        const clickIfCollapsed = (node: Element) => {
          const triggerCandidates = [
            ...Array.from(node.querySelectorAll('.mw-collapsible-toggle')),
            ...Array.from(node.querySelectorAll('[aria-expanded="false"]')),
            ...Array.from(node.querySelectorAll('.collapse,.collapsed,[data-collapsed="true"]')),
          ]
          for (const trigger of triggerCandidates) {
            if (trigger instanceof HTMLElement) trigger.click()
          }
        }

        const forceExpand = (node: Element) => {
          node.querySelectorAll('.mw-collapsible-content,.mw-collapsible-toggle,.mw-collapsible-toggle-default').forEach((entry) => {
            if (!(entry instanceof HTMLElement)) return
            if (entry.classList.contains('mw-collapsible-content')) {
              entry.removeAttribute('style')
              entry.style.setProperty('display', 'block', 'important')
              entry.style.setProperty('height', 'auto', 'important')
              entry.style.setProperty('opacity', '1', 'important')
              entry.style.setProperty('visibility', 'visible', 'important')
              entry.style.setProperty('max-height', 'none', 'important')
              entry.style.setProperty('overflow', 'visible', 'important')
              return
            }
            entry.remove()
          })

          node.querySelectorAll('.mw-collapsible,.collapsible,.mw-collapsed').forEach((wrap) => {
            if (!(wrap instanceof HTMLElement)) return
            wrap.classList.remove('mw-collapsed')
            wrap.classList.add('mw-collapsible')
            wrap.removeAttribute('style')
            wrap.style.setProperty('height', 'auto', 'important')
            wrap.style.setProperty('overflow', 'visible', 'important')
          })

          node.querySelectorAll('[aria-expanded]').forEach((item) => {
            if (item instanceof HTMLElement) item.setAttribute('aria-expanded', 'true')
          })
        }

        const ensureImageSource = (root: HTMLElement) => {
          root.querySelectorAll('img').forEach((img) => {
            const image = img as HTMLImageElement
            const lazy = image.getAttribute('data-src') || image.getAttribute('data-original') || image.getAttribute('data-lazy-src') || image.getAttribute('srcset')
            if ((!image.getAttribute('src') || image.getAttribute('src')?.startsWith('data:')) && lazy) {
              const first = lazy.split(',')[0]?.trim().split(' ')[0]
              if (first) image.setAttribute('src', first)
            }
            image.loading = 'eager'
            image.decoding = 'sync'
            image.style.maxWidth = '100%'
            image.style.height = 'auto'
            image.removeAttribute('srcset')
          })
        }

        const decorateCountdowns = (root: HTMLElement) => {
          const targets = Array.from(root.querySelectorAll<HTMLElement>('p, li, div'))
            .filter((node) => !node.querySelector('.prts-countdown-meter'))
            .filter((node) => {
              const text = node.textContent || ''
              if (!/(后结束|后刷新)/.test(text)) return false
              const blockChildren = Array.from(node.children).filter((child) => {
                const tag = child.tagName
                return tag === 'DIV' || tag === 'P' || tag === 'UL' || tag === 'OL'
              })
              return blockChildren.length <= 1
            })

          for (const node of targets) {
            const hours = parser.parseRefreshHours(node.textContent || '')
            if (!Number.isFinite(hours) || hours <= 0) continue
            const meter = document.createElement('span')
            const urgency = parser.getCountdownUrgencyClass(hours)
            const progress = Math.max(8, Math.min(100, Math.round((hours / 168) * 100)))
            meter.className = `prts-countdown-meter prts-countdown-meter--${urgency}`
            meter.style.setProperty('--prts-progress', `${progress}%`)
            node.append(meter)
          }
        }

        const normalizeRedcertPanel = (root: HTMLElement) => {
          root.querySelectorAll<HTMLElement>('.TLDcontainer').forEach((node) => {
            if ((node.textContent || '').includes('采购凭证区信物即将刷新')) {
              node.style.setProperty('display', 'block', 'important')
            }
          })

          const toggleBars = Array.from(root.querySelectorAll<HTMLElement>('[id="mw-customcollapsible-redcert_warn"], .mw-customtoggle-redcert_warn'))
          const duplicateToggleBars = toggleBars.filter((node) => !parser.isRedcertDetailNode(node.outerHTML))
          if (duplicateToggleBars.length > 1) {
            for (let i = 1; i < duplicateToggleBars.length; i += 1) duplicateToggleBars[i].remove()
          }

          const clickToggles = () => {
            root.querySelectorAll<HTMLElement>('[id="mw-customcollapsible-redcert_warn"], .mw-customtoggle-redcert_warn, .mw-collapsible-toggle, [aria-expanded="false"]').forEach((node) => {
              node.click?.()
              if (node.hasAttribute('aria-expanded')) node.setAttribute('aria-expanded', 'true')
            })
          }

          const forceVisible = () => {
            root.querySelectorAll<HTMLElement>('.mw-collapsible, .mw-collapsible-content, .collapsible, .mw-collapsed').forEach((node) => {
              node.classList.remove('mw-collapsed')
              node.style.setProperty('display', 'block', 'important')
              node.style.setProperty('height', 'auto', 'important')
              node.style.setProperty('max-height', 'none', 'important')
              node.style.setProperty('visibility', 'visible', 'important')
              node.style.setProperty('opacity', '1', 'important')
              node.style.setProperty('overflow', 'visible', 'important')
            })
          }

          clickToggles()
          forceVisible()

          const detailCandidate = (() => {
            const tld = root.querySelector<HTMLElement>('.TLDcontainer')
            if (tld) {
              const structural = Array.from(tld.querySelectorAll<HTMLElement>('[id="mw-customcollapsible-redcert_warn"], .mw-collapsible, .mw-collapsible-content, div'))
                .find((node) => !node.classList.contains('mw-customtoggle-redcert_warn') && node.querySelector('a, b, br, .CDScontainer'))
              if (structural) return structural
            }

            const byId = Array.from(root.querySelectorAll<HTMLElement>('[id="mw-customcollapsible-redcert_warn"]'))
              .find((node) => !node.classList.contains('mw-customtoggle-redcert_warn') && node.querySelector('a, b, br, .CDScontainer'))
            if (byId) return byId

            const rawDetailHtml = parser.extractRedcertDetailHtmlFromHtml(root.innerHTML)
            if (rawDetailHtml) {
              const template = document.createElement('template')
              template.innerHTML = rawDetailHtml.trim()
              const rawDetail = template.content.firstElementChild
              if (rawDetail instanceof HTMLElement) return rawDetail
            }

            const nodes = Array.from(root.querySelectorAll<HTMLElement>('.mw-collapsible, .mw-collapsible-content, .TLDcontainer > div, div, li, td, p'))
            const direct = nodes.find((node) => (node.textContent || '').includes('采购凭证区的信物库存将于') && (node.textContent || '').includes('以下信物将会被刷新'))
            if (direct) return direct

            const start = nodes.find((node) => (node.textContent || '').includes('采购凭证区的信物库存将于'))
            if (!start) return null
            const container = nodes.find((node) => node.contains(start) && (node.textContent || '').includes('以下信物将会被刷新'))
            return container || start
          })()

          if (!detailCandidate) return

          const detailPanel = detailCandidate.cloneNode(true) as HTMLElement
          forceExpand(detailPanel)
          detailPanel.classList.add('prts-redcert-detail')
          detailPanel.classList.remove('mw-collapsed')
          detailPanel.removeAttribute('id')
          detailPanel.querySelectorAll<HTMLElement>('.mw-collapsible-toggle,.mw-collapsible-toggle-default,[id="mw-customcollapsible-redcert_warn"],.mw-customtoggle-redcert_warn').forEach((node) => node.remove())
          detailPanel.querySelectorAll<HTMLElement>('*').forEach((entry) => {
            entry.style.removeProperty('color')
            entry.style.removeProperty('background')
          })

          const existing = root.querySelector<HTMLElement>('.prts-redcert-detail')
          if (existing) existing.remove()

          const header = root.querySelector<HTMLElement>('[id="mw-customcollapsible-redcert_warn"], .mw-customtoggle-redcert_warn')
          if (header?.parentElement) {
            header.insertAdjacentElement('afterend', detailPanel)
          } else {
            root.prepend(detailPanel)
          }

          if (detailCandidate.parentElement) detailCandidate.remove()
        }

        for (const section of sections) {
          const sectionRoot = document.createElement('div')
          section.bodies.forEach((body) => sectionRoot.append(body.cloneNode(true)))
          forceExpand(sectionRoot)
          clickIfCollapsed(sectionRoot)
          const special = Array.from(sectionRoot.querySelectorAll('*')).find((node) => (node.textContent || '').includes('采购凭证区信物即将刷新'))
          if (special) {
            const wrap = special.closest('.mw-collapsible,.collapsible,.mw-collapsed') || special.parentElement
            if (wrap) {
              clickIfCollapsed(wrap)
              forceExpand(wrap)
            }
          }
          forceExpand(sectionRoot)
          ensureImageSource(sectionRoot)
          normalizeRedcertPanel(sectionRoot)
          decorateCountdowns(sectionRoot)
          section.bodies = [sectionRoot]
        }

        document.querySelectorAll('.mw-collapsible-content').forEach((content) => {
          if (!(content instanceof HTMLElement)) return
          content.style.display = 'block'
          content.style.height = 'auto'
          content.style.opacity = '1'
          content.style.visibility = 'visible'
          content.style.maxHeight = 'none'
        })

        window.dispatchEvent(new Event('resize'))

        const cleanup = (root: HTMLElement) => {
          root.querySelectorAll('.mw-editsection,script,style,noscript,.printfooter,.catlinks,.noprint,a[href^="#"]').forEach((node) => node.remove())
          root.querySelectorAll('*').forEach((node) => {
            if (!(node instanceof HTMLElement)) return
            const style = window.getComputedStyle(node)
            if (style.display === 'none' && node.childElementCount === 0 && !node.textContent?.trim()) {
              node.remove()
              return
            }
            if (node.childElementCount === 0 && parser.isNoiseNodeText(node.textContent || '')) {
              node.remove()
              return
            }
            if (node.childElementCount === 0 && (node.textContent || '').trim() === 'PRTS') {
              node.remove()
            }
            if (parser.shouldDiscardOriginalRedcertNode(node.outerHTML)) {
              node.remove()
            }
          })

          root.querySelectorAll('img').forEach((img) => {
            const image = img as HTMLImageElement
            image.style.maxWidth = '100%'
            image.style.height = 'auto'
            image.onerror = () => {
              image.style.display = 'none'
            }
          })

          const all = Array.from(root.querySelectorAll('*'))
          for (const node of all) {
            const text = node.textContent || ''
            if (!text.includes('刷新')) continue
            const hours = parser.parseRefreshHours(text)
            if (!parser.shouldHighlightRefresh(hours)) continue
            const card = node.closest('.prts-card-body') as HTMLElement | null
            if (card) card.classList.add('prts-warning')
          }
        }

        const removeEmptyShells = (root: HTMLElement) => {
          Array.from(root.querySelectorAll<HTMLElement>('p, li, div, span')).reverse().forEach((node) => {
            if (node.querySelector('img')) return
            if ((node.textContent || '').trim()) return
            if (node.children.length > 0) return
            node.remove()
          })
        }

        const splitTodayContent = (root: HTMLElement) => {
          const status = root.cloneNode(true) as HTMLElement
          const core = root.cloneNode(true) as HTMLElement

          status.querySelectorAll<HTMLElement>('.TLDcontainer, .prts-redcert-detail, [id="mw-customcollapsible-redcert_warn"], .mw-customtoggle-redcert_warn').forEach((node) => node.remove())
          status.querySelectorAll<HTMLElement>('p, li').forEach((node) => {
            const text = node.textContent || ''
            if (parser.shouldRemoveFromStatusColumn(text)) node.remove()
          })
          removeEmptyShells(status)

          core.querySelectorAll<HTMLElement>('p, li').forEach((node) => {
            const text = node.textContent || ''
            if (parser.shouldRemoveFromCoreColumn(text)) node.remove()
          })
          removeEmptyShells(core)

          return { status, core }
        }

        document.getElementById(payload.captureId)?.remove()
        document.querySelectorAll<HTMLElement>('a[href="#top"], #back-to-top, .back-to-top, .backToTop, .to-top, .scroll-to-top, .noprint').forEach((node) => node.remove())
        document.querySelectorAll<HTMLElement>('body *').forEach((node) => {
          if (!parser.isNoiseNodeText(node.textContent || '')) return
          const style = window.getComputedStyle(node)
          if (style.position === 'fixed' || style.position === 'sticky') node.remove()
        })

        const wrapper = document.createElement('main')
        wrapper.id = payload.captureId
        wrapper.className = 'prts-grid-bg'
        wrapper.innerHTML = `
          <style>
            ${payload.styles}
          </style>
        `

        const top = document.createElement('section')
        top.className = 'prts-golden-header'
        const left = document.createElement('div')
        left.className = 'prts-golden-title'
        left.textContent = 'PRTS.map'
        const right = document.createElement('div')
        right.className = 'prts-golden-meta'
        right.textContent = `生成时间 ${new Date().toLocaleString('zh-CN', { hour12: false })} · ONLINE`
        top.append(left, right)
        wrapper.append(top)

        const grid = document.createElement('section')
        grid.className = 'prts-dashboard-grid'
        const leftColumn = document.createElement('div')
        leftColumn.className = 'prts-terminal-column prts-terminal-column--left'
        const centerColumn = document.createElement('div')
        centerColumn.className = 'prts-terminal-column prts-terminal-column--center'
        const rightColumn = document.createElement('div')
        rightColumn.className = 'prts-terminal-column prts-terminal-column--right'

        const createCard = (key: string, titleText: string, code: string, content: HTMLElement) => {
          const card = document.createElement('section')
          card.className = `prts-card prts-card--${key}`

          const head = document.createElement('div')
          head.className = 'prts-card-header'
          const title = document.createElement('span')
          title.textContent = titleText
          const small = document.createElement('small')
          small.textContent = code
          head.append(title, small)

          const body = document.createElement('div')
          body.className = 'prts-card-body'
          body.append(content)
          if (body.scrollHeight > 900) body.classList.add('too-tall')

          card.append(head, body)
          return card
        }

        for (const section of sections) {
          const cloned = section.bodies[0].cloneNode(true) as HTMLElement
          cleanup(cloned)
          if (section.key === 'today' && cloned.textContent?.includes('采购凭证区信物即将刷新') && !cloned.querySelector('.prts-redcert-detail')) {
            const hasRawDetail = parser.hasRedcertRawDetailText(cloned.textContent || '')
            const hasStructuralDetail = !!cloned.querySelector('[id="mw-customcollapsible-redcert_warn"]:not(.mw-customtoggle-redcert_warn)')
            if (!hasRawDetail && !hasStructuralDetail) {
              const redcertBar = cloned.querySelector<HTMLElement>('[id="mw-customcollapsible-redcert_warn"], .mw-customtoggle-redcert_warn')
              if (redcertBar) {
                redcertBar.classList.add('prts-warning')
                redcertBar.insertAdjacentHTML('afterend', '<div class="prts-redcert-detail">采购凭证详情暂不可用，请稍后重试或使用缓存图片。</div>')
              }
            }
          }

          if (section.key === 'today') {
            const { status, core } = splitTodayContent(cloned)
            leftColumn.append(createCard('status', '◉ 系统状态', 'SYS STATUS', status))
            centerColumn.append(createCard('core', '▰ 核心动态', 'ACTIVE QUEUE', core))
            continue
          }

          if (section.key === 'operators') {
            rightColumn.append(createCard('operators', '◆ 亮点干员', 'OPERATOR LOG', cloned))
            continue
          }

          centerColumn.append(createCard('recent', '▣ 近期新增', 'DEPOT BRIEF', cloned))
        }

        grid.append(leftColumn, centerColumn, rightColumn)
        wrapper.append(grid)

        const credits = document.createElement('footer')
        credits.className = 'prts-credit-bar'
        for (const text of ['信息源：prts.wiki', '生成者：miyako-intel', '开发者：miyako']) {
          const item = document.createElement('span')
          item.textContent = text
          credits.append(item)
        }
        wrapper.append(credits)

        const host = document.querySelector('#mw-content-text .mw-parser-output') || document.body
        host.prepend(wrapper)

        return { missing }
      }, { captureId: DAILY_CAPTURE_ID, styles: buildDailyTerminalStyles(DAILY_CAPTURE_ID) })

      await this.waitForRenderDelay(page)
      await this.waitForImages(page)
      const target = await page.$(`#${DAILY_CAPTURE_ID}`)
      if (!target) throw new Error('今日信息截图节点创建失败(v2)')
      let screenshot = ensureBuffer(await target.screenshot({ type: 'png' }))
      if (screenshot.byteLength > QQ_IMAGE_MAX_BYTES) {
        this.logger.info(`PRTS daily v2 oversized image fallback applied: ${screenshot.byteLength}`)
        screenshot = ensureBuffer(await target.screenshot({ type: 'jpeg', quality: 85 }))
      }

      if (result.missing?.length) {
        this.logger.warn(`PRTS daily v2 missing sections: ${result.missing.join(',')}`)
      }

      return screenshot
    })

    return { buffer, sourceUrls: [this.homepageUrl], titles: ['今日信息', '亮点干员', '近期新增'] }
  }

  private async openHomepage(page: any) {
    await page.goto(this.homepageUrl, { waitUntil: 'networkidle2', timeout: this.config.navigationTimeoutMs })
  }

  private async withPage<T>(callback: (page: any) => Promise<T>): Promise<T> {
    const puppeteer = this.ctx.puppeteer
    if (!puppeteer || typeof puppeteer.page !== 'function') {
      throw new Error('未检测到 koishi-plugin-puppeteer 服务。')
    }

    const page = await puppeteer.page()
    try {
      if (page.setUserAgent) await page.setUserAgent(USER_AGENT)
      if (page.setViewport) {
        await page.setViewport({ width: this.config.viewportWidth, height: this.config.viewportHeight })
      }
      return await callback(page)
    } finally {
      if (page.close) await page.close().catch(() => undefined)
    }
  }

  private async waitForImages(page: any) {
    if (!page.waitForFunction) return
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), {
      timeout: Math.min(10000, this.config.navigationTimeoutMs),
    }).catch(() => undefined)
  }

  private async waitForRenderDelay(page: any) {
    if (this.config.renderDelayMs <= 0) return
    if (page.waitForTimeout) {
      await page.waitForTimeout(this.config.renderDelayMs)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, this.config.renderDelayMs))
  }

  private getNow() {
    return this.config.now ? new Date(this.config.now) : new Date()
  }
}

function extractBalancedElement(html: string, startIndex: number, tagName: string) {
  const pattern = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, 'gi')
  pattern.lastIndex = startIndex

  let depth = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return html.slice(startIndex, pattern.lastIndex)
    } else {
      depth += 1
    }
  }

  return ''
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getAttribute(attrs: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = pattern.exec(attrs)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function ensureBuffer(source: unknown) {
  if (Buffer.isBuffer(source)) return source
  if (source instanceof Uint8Array) return Buffer.from(source)
  if (source instanceof ArrayBuffer) return Buffer.from(source)
  if (typeof source === 'string') {
    const dataUrlPrefix = /^data:[^;]+;base64,/
    if (dataUrlPrefix.test(source)) {
      return Buffer.from(source.replace(dataUrlPrefix, ''), 'base64')
    }
    return Buffer.from(source, 'base64')
  }

  const typeName = source && typeof source === 'object'
    ? (source as { constructor?: { name?: string } }).constructor?.name
    : typeof source
  throw new Error(`截图结果不是有效二进制数据，实际类型: ${typeName || 'unknown'}`)
}
