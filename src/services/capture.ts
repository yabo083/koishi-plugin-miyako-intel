import { h } from 'koishi'
import { CachedImageResult, CaptureKind, Config, CardThemeConfig, SummaryDisplayItemKey, SummarySection } from '../types'
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
  return /全局剿灭|常驻中坚|采购凭证区|信物库存|网页活动|正在进行中的网页活动|后结束|后刷新/.test(text)
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

export function isTimedInfoDetailNode(html: string) {
  const firstTag = html.match(/<([a-z0-9]+)\b([^>]*)>/i)
  if (!firstTag) return false
  const attrs = firstTag[2] || ''
  const id = getAttribute(attrs, 'id')
  const classText = getAttribute(attrs, 'class')
  if (!/^mw-customcollapsible-/.test(id)) return false
  if (/\bmw-customtoggle-/.test(classText)) return false

  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const normalizedText = text.replace(/\s+/g, '')
  return /将于/.test(normalizedText) && /(后结束|后刷新|以下信物将会被刷新)/.test(normalizedText)
}

export function shouldDiscardOriginalTimedInfoNode(html: string) {
  const firstTag = html.match(/<([a-z0-9]+)\b([^>]*)>/i)
  if (!firstTag) return false
  const attrs = firstTag[2] || ''
  const classText = getAttribute(attrs, 'class')
  if (/\bprts-(redcert|timed)-detail\b/.test(classText)) return false
  return isTimedInfoDetailNode(html)
}

export function extractOperatorNamesFromHtml(html: string) {
  const names: string[] = []
  const seen = new Set<string>()
  const containerPattern = /<([a-z0-9]+)\b[^>]*class\s*=\s*(?:"[^"]*\bmp-operators\b[^"]*"|'[^']*\bmp-operators\b[^']*'|[^\s>]*\bmp-operators\b[^\s>]*)[^>]*>([\s\S]*?)<\/\1>/gi
  let container: RegExpExecArray | null
  while ((container = containerPattern.exec(html))) {
    const anchorPattern = /<a\b[^>]*\btitle\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi
    let anchor: RegExpExecArray | null
    while ((anchor = anchorPattern.exec(container[2]))) {
      const name = decodeHtmlText(anchor[1] || anchor[2] || anchor[3] || '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export function extractOperatorSummaryItemsFromHtml(html: string) {
  const items: string[] = []
  const seenLabels = new Set<string>()
  const operatorGroups = extractOperatorGroupHtmls(html)
  let previousContainerEnd = 0
  for (const group of operatorGroups) {
    const names = extractOperatorNamesFromHtml(group.html)
    if (!names.length) {
      previousContainerEnd = group.end
      continue
    }
    const title = extractOperatorGroupTitle(group.html)
    const localContextHtml = html.slice(previousContainerEnd, group.start)
    const fallbackContextHtml = html.slice(Math.max(0, group.start - 240), group.start)
    const contextHtml = title || localContextHtml.trim() || fallbackContextHtml
    const context = contextHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const label = getOperatorSummaryLabel(context)
    const text = `${label}：${names.join('、')}`
    if (seenLabels.has(text)) continue
    seenLabels.add(text)
    items.push(text)
    previousContainerEnd = group.end
  }
  return items
}

function extractOperatorGroupHtmls(html: string) {
  const groupPattern = /<div\b[^>]*class\s*=\s*(?:"[^"]*\bmp-operators-content\b[^"]*"|'[^']*\bmp-operators-content\b[^']*'|[^\s>]*\bmp-operators-content\b[^\s>]*)[^>]*>/gi
  const groups: Array<{ html: string; start: number; end: number }> = []
  let group: RegExpExecArray | null
  while ((group = groupPattern.exec(html))) {
    const groupHtml = extractBalancedElement(html, group.index, 'div')
    if (!groupHtml) continue
    groups.push({ html: groupHtml, start: group.index, end: group.index + groupHtml.length })
  }
  if (groups.length) return groups

  const containerPattern = /<([a-z0-9]+)\b[^>]*class\s*=\s*(?:"[^"]*\bmp-operators\b[^"]*"|'[^']*\bmp-operators\b[^']*'|[^\s>]*\bmp-operators\b[^\s>]*)[^>]*>[\s\S]*?<\/\1>/gi
  const containers: Array<{ html: string; start: number; end: number }> = []
  let container: RegExpExecArray | null
  while ((container = containerPattern.exec(html))) {
    containers.push({ html: container[0], start: container.index, end: containerPattern.lastIndex })
  }
  return containers
}

function extractOperatorGroupTitle(html: string) {
  const titlePattern = /<([a-z0-9]+)\b[^>]*class\s*=\s*(?:"[^"]*\bmp-operators-title\b[^"]*"|'[^']*\bmp-operators-title\b[^']*'|[^\s>]*\bmp-operators-title\b[^\s>]*)[^>]*>/i
  const match = titlePattern.exec(html)
  if (!match) return ''
  return extractBalancedElement(html, match.index, match[1])
}

export function buildDailyTerminalStyles(captureId: string, theme: Partial<CardThemeConfig> = {}) {
  const resolvedTheme = resolveCardTheme(theme)
  return `
    #${captureId} {
      --prts-font-family: ${resolvedTheme.fontFamily};
      --prts-bg: ${resolvedTheme.backgroundColor};
      --prts-primary: ${resolvedTheme.primaryColor};
      --prts-warning: ${resolvedTheme.warningColor};
      --prts-danger: ${resolvedTheme.dangerColor};
      --prts-text: ${resolvedTheme.textColor};
      width: 1280px;
      box-sizing: border-box;
      margin: 0 auto;
      padding: 18px 20px 22px;
      color: var(--prts-text) !important;
      background:
        linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
        var(--prts-bg);
      background-size: 32px 32px, 32px 32px, cover;
      font-family: var(--prts-font-family);
      line-height: 1.42;
    }
    #${captureId} * {
      box-sizing: border-box;
      color: var(--prts-text);
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
    .prts-timed-header,
    .prts-timed-detail {
      color: #f7fbff !important;
      text-shadow: none !important;
    }
    .prts-timed-header {
      padding: 7px 10px !important;
      border: 1px solid rgba(0,178,255,.28) !important;
      background: linear-gradient(90deg, rgba(0,116,171,.52), rgba(0,178,255,.12)) !important;
      font-weight: 800 !important;
    }
    .prts-timed-detail {
      position: relative;
      margin-top: 6px !important;
      padding: 9px 12px 9px 36px !important;
      border: 1px solid rgba(0,178,255,.28) !important;
      border-left: 3px solid #00b2ff !important;
      background: rgba(0,178,255,.075) !important;
    }
    .prts-timed-detail::before {
      content: "[i]";
      position: absolute;
      left: 11px;
      top: 9px;
      color: #00b2ff;
      font-family: "JetBrains Mono", "Cascadia Mono", "Consolas", monospace;
      font-weight: 900;
    }
    .prts-timed-detail * {
      color: #f7fbff !important;
      background: transparent !important;
      border-color: transparent !important;
      text-shadow: none !important;
    }
    .prts-timed-detail .mdi {
      display: none !important;
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

    for (const message of this.wrapMessage(this.toImageFragment(result))) {
      await session.send(message)
    }
  }

  toImageFragment(result: CachedImageResult) {
    const dataUrl = `${this.toDataUrlPrefix(result)}${result.buffer.toString('base64')}`
    return h.image(dataUrl)
  }

  toBroadcastMessage(result: CachedImageResult) {
    return this.wrapMessage(this.toImageFragment(result)).join('\n')
  }

  async getDailySummary(force = false) {
    const result = await this.getDailyInfo(force)
    return this.buildSummary(result)
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

  private async resolveCachedImage(kind: CaptureKind, force: boolean, capture: () => Promise<{ buffer: Buffer; sourceUrls: string[]; titles?: string[]; mimeType?: string; summaryItems?: SummarySection[] }>) {
    if (!force) {
      const cached = await this.cache.readToday(kind)
      if (cached) return cached
    }

    try {
      const fresh = await capture()
      return this.cache.write(kind, fresh.buffer, {
        sourceUrls: fresh.sourceUrls,
        titles: fresh.titles,
        mimeType: fresh.mimeType,
        summaryItems: fresh.summaryItems,
      })
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
    let mimeType = this.getConfiguredMimeType()
    let summaryItems: SummarySection[] = []
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
          shouldRemoveFromStatusColumn: (text: string) => /全局剿灭|常驻中坚|采购凭证区|信物库存|网页活动|正在进行中的网页活动|后结束|后刷新/.test(text),
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
              const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)
              return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
            }
            const classText = attr('class')
            if (/\bprts-redcert-detail\b/.test(classText)) return false
            if (attr('id') !== 'mw-customcollapsible-redcert_warn') return false
            if (/\bmw-customtoggle-redcert_warn\b/.test(classText)) return false
            return parser.isRedcertDetailNode(html)
          },
          isTimedInfoDetailNode: (html: string) => {
            const firstTag = html.match(/<([a-z0-9]+)\b([^>]*)>/i)
            if (!firstTag) return false
            const attrs = firstTag[2] || ''
            const attr = (name: string) => {
              const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)
              return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
            }
            const id = attr('id')
            const classText = attr('class')
            if (!/^mw-customcollapsible-/.test(id)) return false
            if (/\bmw-customtoggle-/.test(classText)) return false
            const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            const normalizedText = text.replace(/\s+/g, '')
            return /将于/.test(normalizedText) && /(后结束|后刷新|以下信物将会被刷新)/.test(normalizedText)
          },
          shouldDiscardOriginalTimedInfoNode: (html: string) => {
            const firstTag = html.match(/<([a-z0-9]+)\b([^>]*)>/i)
            if (!firstTag) return false
            const attrs = firstTag[2] || ''
            const classText = (new RegExp(`class\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)?.[1]
              || new RegExp(`class\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)?.[2]
              || new RegExp(`class\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)?.[3]
              || '')
            if (/\bprts-(redcert|timed)-detail\b/.test(classText)) return false
            return parser.isTimedInfoDetailNode(html)
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

        const normalizeTimedInfoPanels = (root: HTMLElement) => {
          const ids = Array.from(new Set(
            Array.from(root.querySelectorAll<HTMLElement>('[id^="mw-customcollapsible-"]'))
              .map((node) => node.id)
              .filter((id) => id && id !== 'mw-customcollapsible-redcert_warn'),
          ))

          for (const id of ids) {
            const nodes = Array.from(root.querySelectorAll<HTMLElement>('[id^="mw-customcollapsible-"]')).filter((node) => node.id === id)
            const detailCandidate = nodes.find((node) => parser.isTimedInfoDetailNode(node.outerHTML))
            if (!detailCandidate) continue

            const toggleBars = nodes.filter((node) => /\bmw-customtoggle-/.test(node.className || ''))
            const header = toggleBars[0] || nodes.find((node) => node !== detailCandidate) || null
            if (header) {
              header.classList.add('prts-timed-header')
              header.querySelectorAll<HTMLElement>('.mdi, .mw-collapsible-toggle, .mw-collapsible-toggle-default').forEach((node) => node.remove())
            }
            for (let i = 1; i < toggleBars.length; i += 1) toggleBars[i].remove()

            const detailPanel = detailCandidate.cloneNode(true) as HTMLElement
            forceExpand(detailPanel)
            detailPanel.classList.add('prts-timed-detail')
            detailPanel.classList.remove('mw-collapsed')
            detailPanel.removeAttribute('id')
            detailPanel.removeAttribute('style')
            detailPanel.querySelectorAll<HTMLElement>('.mw-collapsible-toggle,.mw-collapsible-toggle-default,[id^="mw-customcollapsible-"],[class*="mw-customtoggle-"]').forEach((node) => node.remove())
            detailPanel.querySelectorAll<HTMLElement>('*').forEach((entry) => {
              entry.style.removeProperty('color')
              entry.style.removeProperty('background')
              entry.style.removeProperty('border')
              entry.style.removeProperty('position')
              entry.style.removeProperty('left')
              entry.style.removeProperty('top')
              entry.style.removeProperty('padding')
              entry.style.removeProperty('margin')
              entry.style.removeProperty('max-width')
            })

            const existing = root.querySelector<HTMLElement>(`.prts-timed-detail[data-prts-source-id="${id}"]`)
            if (existing) existing.remove()
            detailPanel.dataset.prtsSourceId = id

            if (header?.parentElement) {
              header.insertAdjacentElement('afterend', detailPanel)
            } else {
              root.prepend(detailPanel)
            }

            if (detailCandidate.parentElement) detailCandidate.remove()
          }
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
          normalizeTimedInfoPanels(sectionRoot)
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
              return
            }
            if (parser.shouldDiscardOriginalTimedInfoNode(node.outerHTML)) {
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

          status.querySelectorAll<HTMLElement>('.TLDcontainer, .prts-redcert-detail, .prts-timed-detail, [id^="mw-customcollapsible-"], [class*="mw-customtoggle-"]').forEach((node) => node.remove())
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

        const collectSummaryLines = (root: HTMLElement) => {
          const seen = new Set<string>()
          return Array.from(root.querySelectorAll<HTMLElement>('li,p,div'))
            .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
            .filter((text) => text.length >= 4 && text.length <= 80)
            .filter((text) => !/^(PRTS|SYS STATUS|ACTIVE QUEUE|OPERATOR LOG|DEPOT BRIEF)$/.test(text))
            .filter((text) => {
              if (seen.has(text)) return false
              seen.add(text)
              return true
            })
            .slice(0, 4)
        }

        const collectOperatorNames = (root: HTMLElement) => {
          const seen = new Set<string>()
          return Array.from(root.querySelectorAll<HTMLAnchorElement>('.mp-operators a[title]'))
            .map((node) => (node.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
            .filter((name) => {
              if (!name || seen.has(name)) return false
              seen.add(name)
              return true
            })
        }

        const getOperatorLabel = (context: string) => {
          if (/生日/.test(context)) return '今日生日干员'
          if (/近期新增/.test(context)) return '近期新增干员'
          if (/凭证兑换/.test(context)) return '凭证兑换干员'
          if (/中坚甄选|甄选/.test(context)) return '中坚甄选干员'
          if (/新增时装|时装/.test(context)) return '新增时装干员'
          if (/模组/.test(context)) return '新增模组干员'
          if (/寻访|卡池|常驻|标准|甄选/.test(context)) return '寻访亮点干员'
          if (/活动/.test(context)) return '活动亮点干员'
          return '亮点干员'
        }

        const getOperatorContext = (container: HTMLElement) => {
          const groupTitle = container.querySelector<HTMLElement>('.mp-operators-title')
          const groupTitleText = (groupTitle?.textContent || '').replace(/\s+/g, ' ').trim()
          if (groupTitleText) return groupTitleText

          const parts: string[] = []
          let current: Element | null = container
          for (let depth = 0; depth < 4 && current; depth += 1) {
            let sibling = current.previousElementSibling
            while (sibling && parts.length < 6) {
              const text = (sibling.textContent || '').replace(/\s+/g, ' ').trim()
              if (text) parts.unshift(text)
              if (sibling.querySelector('.mp-operators')) break
              sibling = sibling.previousElementSibling
            }
            if (parts.some((text) => /生日|模组|寻访|卡池|常驻|标准|活动/.test(text))) break
            current = current.parentElement
          }
          return parts.join(' ')
        }

        const collectOperatorItems = (root: HTMLElement) => {
          const items: string[] = []
          const seen = new Set<string>()
          const groupNodes = Array.from(root.querySelectorAll<HTMLElement>('.mp-operators-content'))
          const containers = groupNodes.length ? groupNodes : Array.from(root.querySelectorAll<HTMLElement>('.mp-operators'))
          containers.forEach((container) => {
            const names = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[title]'))
              .map((node) => (node.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean)
            const uniqueNames = names.filter((name, index) => names.indexOf(name) === index)
            if (!uniqueNames.length) return
            const context = getOperatorContext(container)
            const item = `${getOperatorLabel(context)}：${uniqueNames.join('、')}`
            if (seen.has(item)) return
            seen.add(item)
            items.push(item)
          })
          return items
        }

        const summaryItems: Array<{ title: string; items: string[] }> = []

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
            const statusItems = collectSummaryLines(status)
            const coreItems = collectSummaryLines(core)
            if (statusItems.length) summaryItems.push({ title: '系统状态', items: statusItems })
            if (coreItems.length) summaryItems.push({ title: '核心动态', items: coreItems })
            leftColumn.append(createCard('status', '◉ 系统状态', 'SYS STATUS', status))
            centerColumn.append(createCard('core', '▰ 核心动态', 'ACTIVE QUEUE', core))
            continue
          }

          if (section.key === 'operators') {
            const operatorItems = collectOperatorItems(cloned)
            const operatorNames = operatorItems.length ? [] : collectOperatorNames(cloned)
            const items = operatorItems.length
              ? operatorItems
              : operatorNames.length
                ? [`亮点干员：${operatorNames.join('、')}`]
                : collectSummaryLines(cloned)
            if (items.length) summaryItems.push({ title: '亮点干员', items })
            rightColumn.append(createCard('operators', '◆ 亮点干员', 'OPERATOR LOG', cloned))
            continue
          }

          const items = collectSummaryLines(cloned)
          if (items.length) summaryItems.push({ title: '近期新增', items })
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

        return { missing, summaryItems }
      }, { captureId: DAILY_CAPTURE_ID, styles: buildDailyTerminalStyles(DAILY_CAPTURE_ID, this.config.cardTheme) })

      summaryItems = Array.isArray(result.summaryItems) ? result.summaryItems : []

      await this.waitForRenderDelay(page)
      await this.waitForImages(page)
      const target = await page.$(`#${DAILY_CAPTURE_ID}`)
      if (!target) throw new Error('今日信息截图节点创建失败(v2)')
      const screenshotOptions = this.getScreenshotOptions()
      let screenshot = ensureBuffer(await target.screenshot(screenshotOptions))
      if (screenshot.byteLength > QQ_IMAGE_MAX_BYTES) {
        this.logger.info(`PRTS daily v2 oversized image fallback applied: ${screenshot.byteLength}`)
        screenshot = ensureBuffer(await target.screenshot({ type: 'jpeg', quality: this.config.jpegQuality }))
        mimeType = 'image/jpeg'
      }

      if (result.missing?.length) {
        this.logger.warn(`PRTS daily v2 missing sections: ${result.missing.join(',')}`)
      }

      return screenshot
    })

    return { buffer, sourceUrls: [this.homepageUrl], titles: ['今日信息', '亮点干员', '近期新增'], mimeType, summaryItems }
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
        await page.setViewport({
          width: this.config.viewportWidth,
          height: this.config.viewportHeight,
          deviceScaleFactor: this.config.deviceScaleFactor,
        })
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

  private getScreenshotOptions() {
    if (this.config.imageFormat === 'jpeg') {
      return { type: 'jpeg', quality: this.config.jpegQuality }
    }
    return { type: 'png' }
  }

  private getConfiguredMimeType() {
    return this.config.imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png'
  }

  private toDataUrlPrefix(result: CachedImageResult) {
    return `data:${result.mimeType || this.getConfiguredMimeType()};base64,`
  }

  private wrapMessage(content: any) {
    const messages = []
    const prefix = this.config.messagePrefix.trim()
    const suffix = this.config.messageSuffix.trim()
    if (prefix) messages.push(prefix)
    messages.push(content)
    if (suffix) messages.push(suffix)
    return messages
  }

  private buildSummary(result: CachedImageResult) {
    if (result.summaryItems?.length) {
      const lines = [`PRTS 今日摘要（${result.dayKey}${result.stale ? '，使用旧缓存' : ''}）`]
      let count = 0
      const seen = new Set<string>()
      for (const section of result.summaryItems) {
        for (const item of section.items) {
          if (count >= this.config.summaryMaxItems) break
          if (!this.shouldIncludeSummaryItem(section.title, item)) continue
          const normalized = this.normalizeSummaryItem(section.title, item)
          if (!normalized || seen.has(normalized)) continue
          seen.add(normalized)
          count += 1
          lines.push(this.formatNumberedSummaryItem(count, normalized))
        }
        if (count >= this.config.summaryMaxItems) break
      }
      if (result.sourceUrls?.[0]) lines.push(`信息源：${result.sourceUrls[0]}`)
      return lines.join('\n')
    }

    const titles = (result.titles?.length ? result.titles : ['今日信息', '亮点干员', '近期新增'])
      .slice(0, Math.max(1, this.config.summaryMaxItems))
    const lines = [
      `PRTS 今日摘要（${result.dayKey}${result.stale ? '，使用旧缓存' : ''}）`,
      ...titles.map((title, index) => `${index + 1}. ${title}：已整理至今日情报卡。`),
    ]
    if (result.sourceUrls?.[0]) lines.push(`信息源：${result.sourceUrls[0]}`)
    return lines.join('\n')
  }

  private normalizeSummaryItem(_sectionTitle: string, item: string) {
    const compact = this.formatResourceSummaryItem(this.removeSummaryClockNoise(item.replace(/\s+/g, ' ').trim()))
    if (!compact) return ''
    return this.config.summaryDatePreview ? this.previewRelativeDates(compact) : compact
  }

  private formatResourceSummaryItem(item: string) {
    if (!/^今日资源收集/.test(item) || !item.includes('物资筹备分区：') || !item.includes('芯片搜索分区：')) return item
    const materialIndex = item.indexOf('物资筹备分区：')
    const chipIndex = item.indexOf('芯片搜索分区：')
    if (materialIndex < 0 || chipIndex < materialIndex) return item
    const material = item.slice(materialIndex, chipIndex).replace(/[，,。.\s]+$/g, '').trim()
    const chip = item.slice(chipIndex).replace(/[，,。.\s]+$/g, '').trim()
    return ['今日资源收集：', material, chip].join('\n')
  }

  private removeSummaryClockNoise(item: string) {
    if (!item) return ''
    const cleaned = item
      .replace(/^现在时间[：:]\s*[^。.]*(?:[。.]\s*)?/, '')
      .trim()
    if (/^现在时间[：:]/.test(cleaned)) return ''
    return cleaned
  }

  private previewRelativeDates(item: string) {
    const timeLines: string[] = []
    let main = item.replace(/(?:将于\s*)?(?:(\d+)\s*[天日])?\s*(?:(\d+)\s*小时)?\s*(?:(\d+)\s*分钟)?后(结束|刷新)/g, (match, dayText, hourText, minuteText, action) => {
      if (!dayText && !hourText && !minuteText) return match
      const label = action === '刷新' ? '刷新日期' : '截止日期'
      const date = this.formatRelativeTargetDate(Number(dayText || 0), Number(hourText || 0), Number(minuteText || 0))
      timeLines.push(`${label}：${date.dateText}`)
      timeLines.push(`剩余时间：${date.remainingText}`)
      return ''
    })

    main = main
      .replace(/[，,。.\s]+$/g, '')
      .replace(/\s*[，,]\s*以下/g, '\n详情：以下')
      .trim()

    return [main, ...timeLines].filter(Boolean).join('\n')
  }

  private formatNumberedSummaryItem(index: number, normalized: string) {
    const [first, ...rest] = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
    return [
      `${index}. ${first}`,
      ...rest.map((line) => `   ${line}`),
    ].join('\n')
  }

  private formatRelativeTargetDate(day: number, hour: number, minute: number) {
    const now = this.getNow()
    const totalMinutes = (day * 24 + hour) * 60 + minute
    const target = new Date(now.getTime() + totalMinutes * 60 * 1000)
    const parts = getZonedParts(target, this.config.timezone)
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return {
      dateText: `${parts.month}月${parts.day}日（${weekdays[parts.weekday]}）`,
      remainingText: this.formatRemainingTime(totalMinutes),
    }
  }

  private formatRemainingTime(totalMinutes: number) {
    const totalHours = Math.max(0, totalMinutes / 60)
    if (totalHours < 24) {
      const hours = Math.max(1, Math.ceil(totalHours))
      return `约 ${hours} 小时`
    }

    const days = Math.max(1, Math.ceil(totalHours / 24))
    const base = `约 ${days} 天`
    if (days < 7) return base
    return `${base}（跨 ${Math.ceil(days / 7)} 个结算周）`
  }

  private shouldIncludeSummaryItem(sectionTitle: string, item: string) {
    const displayKey = this.classifySummaryDisplayItem(sectionTitle, item)
    if (!this.isSummaryDisplayItemEnabled(displayKey)) return false

    return true
  }

  private isSummaryDisplayItemEnabled(key: SummaryDisplayItemKey) {
    const item = this.config.summaryDisplayItems.find((entry) => entry.key === key)
    return item?.enabled !== false
  }

  private classifySummaryDisplayItem(sectionTitle: string, item: string): SummaryDisplayItemKey {
    if (/亮点干员/.test(sectionTitle)) {
      if (/生日/.test(item)) return 'operator-birthday'
      if (/近期新增/.test(item)) return 'operator-recent'
      if (/凭证兑换/.test(item)) return 'operator-voucher'
      if (/中坚甄选|甄选/.test(item)) return 'operator-kernel-headhunting'
      if (/新增时装|时装/.test(item)) return 'operator-outfit'
      if (/模组/.test(item)) return 'operator-new-module'
      if (/寻访|卡池|常驻|标准/.test(item)) return 'operator-headhunting'
      if (/活动/.test(item)) return 'operator-event'
      return 'operator-event'
    }

    if (/今日资源收集|物资筹备分区|芯片搜索分区/.test(item)) return 'resource'
    if (/剿灭|保全派驻/.test(item)) return 'annihilation'
    if (/采购凭证|信物库存|资质凭证/.test(item)) return 'voucher'
    if (/活动|网页活动/.test(item)) return 'event'
    if (/新增关卡|\bH\d+-\d+\b|急变预案/.test(item)) return 'recent-stage'
    if (/新增家具|家具|主题\s*单件/.test(item)) return 'recent-furniture'
    return 'recent-other'
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

function getOperatorSummaryLabel(context: string) {
  if (/生日/.test(context)) return '今日生日干员'
  if (/近期新增/.test(context)) return '近期新增干员'
  if (/凭证兑换/.test(context)) return '凭证兑换干员'
  if (/中坚甄选|甄选/.test(context)) return '中坚甄选干员'
  if (/新增时装|时装/.test(context)) return '新增时装干员'
  if (/模组/.test(context)) return '新增模组干员'
  if (/寻访|卡池|常驻|标准|甄选/.test(context)) return '寻访亮点干员'
  if (/活动/.test(context)) return '活动亮点干员'
  return '亮点干员'
}

function decodeHtmlText(input: string) {
  return input
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
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

function resolveCardTheme(theme: Partial<CardThemeConfig>) {
  return {
    fontFamily: theme.fontFamily || '"Source Han Sans CN", "Microsoft YaHei", "Segoe UI", sans-serif',
    backgroundColor: theme.backgroundColor || '#1a1c1e',
    primaryColor: theme.primaryColor || '#00b2ff',
    warningColor: theme.warningColor || '#ffcf00',
    dangerColor: theme.dangerColor || '#ff5a66',
    textColor: theme.textColor || '#e7edf3',
  }
}
