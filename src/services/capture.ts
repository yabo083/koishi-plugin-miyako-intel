import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { TIMEZONE } from '../core/constants'
import { matchesCronExpression } from '../core/cron'
import { formatError } from '../core/errors'
import { getZonedParts } from '../core/time'
import { CachedImageResult, CaptureKind } from '../types'
import { buildSealSlots, renderCardByStyle, resolveCardStyle } from './card-template'
import { DEFAULT_FALLBACK_REASON, FALLBACK_REASONS, readFallbackImage, readPngSize, renderFallbackHtml } from './card-fallback'
import { DailyCardData, DailyCoreItem, DailyOperator, SealSlot } from './card-types'
import { DailyImageCache } from './cache'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const HOMEPAGE_URL = 'https://prts.wiki/w/%E9%A6%96%E9%A1%B5'
const NAVIGATION_TIMEOUT_MS = 45000
const RENDER_DELAY_MS = 800
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1 }
const QQ_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const ART_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const RENDER_FONTS_VERSION = 2
// 「泰拉周刊」正文用 500、标题用 900，宋体四档一起备好
const SERIF_CSS_FILES = [
  'chinese-simplified-400.css',
  'chinese-simplified-500.css',
  'chinese-simplified-700.css',
  'chinese-simplified-900.css',
]

const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Referer: 'https://prts.wiki/',
}

export type DailyFetcher = (url: string, init?: DailyRequestInit) => Promise<any>

export interface DailyRequestInit {
  method?: string
  headers?: Record<string, string>
  responseType?: 'json' | 'text' | 'arraybuffer'
}

/** 浏览器内提取的原始结构化数据（字段形态由 PRTS 首页 DOM 决定，映射为卡片数据在 Node 侧完成） */
export interface RawDailyData {
  groups: Array<{ title: string; entries: Array<{ name: string; avatar: string; rarity: number }> }>
  todayParagraphs: string[]
  coreItems: Array<{ text: string; epoch: number }>
  /** 每个小节（新增关卡 / 新增家具）：lead 是活动名，groups 是活动下的各关卡集 */
  stageBlocks: Array<{ title: string; lead: string; groups: Array<{ title: string; codes: string[] }> }>
}

export const EXTRACT_DAILY_SNIPPET = function extractDailyData() {
  const clean = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim()
  const decode = (value: string) => {
    try { return decodeURIComponent(value || '') } catch { return value || '' }
  }

  const groups = Array.from(document.querySelectorAll('.mp-operators-content')).map((group) => ({
    title: clean(group.querySelector('.mp-operators-title')?.textContent),
    entries: Array.from(group.querySelectorAll('a[title]')).map((anchor) => {
      const holder = anchor.closest('span')?.parentElement || anchor.parentElement
      const rarityRaw = decode(holder?.querySelector('img[id="levlicon"]')?.getAttribute('src') || '')
      const match = rarityRaw.match(/稀有度_([^_.]+)_(\d+)\.png/)
      return {
        name: clean(anchor.getAttribute('title')),
        avatar: holder?.querySelector('img[id="charicon"]')?.getAttribute('src') || '',
        // PRTS 稀有度角标文件名里的数字 = 星级 - 1
        rarity: match ? Number(match[2]) + 1 : 0,
      }
    }).filter((entry) => entry.name && !/(一览|进行中)/.test(entry.name)),
  }))

  const today = document.querySelector('.mp-today')
  const todayParagraphs = today
    ? Array.from(today.querySelectorAll('p')).map((p) => clean(p.textContent)).filter(Boolean)
    : []
  const coreItems = today
    ? Array.from(today.querySelectorAll('p'))
      .filter((p) => p.querySelector('.CDScontainer'))
      .map((p) => ({
        text: clean(p.textContent),
        epoch: Number(p.querySelector('.CDScontainer')?.getAttribute('data-time')) || 0,
      }))
    : []

  const nav = document.querySelector('.mp-extranav')
  const stageBlocks: Array<{ title: string; lead: string; groups: Array<{ title: string; codes: string[] }> }> = []
  if (nav) {
    for (const heading of Array.from(nav.querySelectorAll('h3'))) {
      // 结构：<p><b>活动名</b></p> 然后是若干组「<p><b>关卡集名</b></p> + <ul>关卡</ul>」
      const lead = { text: '' }
      const groups: Array<{ title: string; codes: string[] }> = []
      let node = heading.parentElement ? heading.parentElement.nextElementSibling : heading.nextElementSibling
      while (node && !/^H[1-4]$/.test(node.tagName) && !node.classList?.contains('mw-heading')) {
        if (node.tagName === 'UL') {
          const codes = Array.from(node.querySelectorAll('li')).map((li) => clean(li.textContent))
          if (groups.length) groups[groups.length - 1].codes.push(...codes)
          else groups.push({ title: '', codes })
        } else {
          const text = clean(node.textContent)
          // 只有「后面紧跟的不是关卡列表」的首个段落才算活动名，其余都是关卡集小标题
          const isLead = !lead.text && !groups.length
            && (!node.nextElementSibling || node.nextElementSibling.tagName !== 'UL')
          if (text && isLead) lead.text = text
          else if (text) groups.push({ title: text, codes: [] })
        }
        node = node.nextElementSibling
      }
      stageBlocks.push({
        title: clean(heading.textContent),
        lead: lead.text,
        groups: groups.filter((group) => group.codes.length),
      })
    }
  }

  return { groups, todayParagraphs, coreItems, stageBlocks }
}

/* ==================== 纯映射函数（Node 侧，可单测） ==================== */

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function formatRemainingText(remainingMs: number) {
  const totalMinutes = Math.max(0, Math.round(remainingMs / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days) parts.push(`${days}天`)
  if (hours) parts.push(`${hours}小时`)
  if (minutes || !parts.length) parts.push(`${minutes}分钟`)
  return parts.join('')
}

export function parseCoreItem(text: string, epoch: number, now: Date): DailyCoreItem | null {
  if (!epoch) return null
  const remainingMs = epoch * 1000 - now.getTime()
  if (remainingMs <= 0) return null
  const nameMatch = text.match(/^(.*?)将于/)
  const actionMatch = text.match(/后(刷新|结束)/)
  if (!nameMatch || !actionMatch) return null
  const hours = remainingMs / 3600000
  return {
    name: nameMatch[1].trim(),
    action: actionMatch[1] as '刷新' | '结束',
    remainingText: formatRemainingText(remainingMs),
    urgency: hours < 12 ? 'danger' : hours < 72 ? 'warn' : 'safe',
  }
}

export function splitCollectValues(text: string) {
  return text.split(/\s*\/\s*/).map((item) => item.trim()).filter(Boolean)
}

export function compressStageCodes(codes: string[]) {
  const groups = new Map<string, Array<{ n: number; raw: string }>>()
  for (const code of codes) {
    const match = code.match(/^(.*?)-(\d+)$/)
    if (!match) continue
    const list = groups.get(match[1]) || []
    list.push({ n: Number(match[2]), raw: match[2] })
    groups.set(match[1], list)
  }
  const parts: string[] = []
  for (const [prefix, entries] of groups) {
    const sorted = [...entries].sort((a, b) => a.n - b.n)
    const nums = sorted.map((entry) => entry.n)
    const contiguous = nums.length > 1 && nums[nums.length - 1] - nums[0] + 1 === nums.length
    parts.push(contiguous
      ? `${prefix}-${sorted[0].raw} ~ ${prefix}-${sorted[sorted.length - 1].raw}`
      : sorted.map((entry) => `${prefix}-${entry.raw}`).join('、'))
  }
  return parts.join(' / ')
}

/**
 * 从「干员名/语音记录」子页的 wikitext 中提取「干员报到」的中文台词。
 * 结构固定：`|标题N=干员报到` 下一行是 `|台词N={{VoiceData/word|中文|台词正文}}`。
 */
export function extractOperatorQuote(wikitext: string): string {
  const match = String(wikitext || '').match(
    /\|标题\d+=干员报到\s*\n\s*\|台词\d+={{VoiceData\/word\|中文\|((?:[^{}]|}(?=[^}]))*?)\}\}/,
  )
  return match ? match[1].replace(/\s+/g, ' ').trim() : ''
}

export function mapRawToDailyCard(raw: RawDailyData, options: { now: Date }): DailyCardData {
  const parts = getZonedParts(options.now, TIMEZONE)
  const tilts = [-5, 3, -2, 4, -6, 5, -3, 6]
  const tapes = [
    'rgba(79, 133, 120, 0.35)',
    'rgba(195, 74, 58, 0.32)',
    'rgba(201, 155, 63, 0.38)',
    'rgba(120, 100, 160, 0.3)',
  ]

  const findGroup = (pattern: RegExp) => raw.groups.find((group) => pattern.test(group.title))
  const toOperators = (group?: RawDailyData['groups'][number]): DailyOperator[] =>
    (group?.entries || [])
      .filter((entry) => !/(一览|进行中)/.test(entry.name))
      .map((entry) => ({ name: entry.name, rarity: entry.rarity, avatar: entry.avatar }))

  const collectParagraph = raw.todayParagraphs.find((text) => text.includes('物资筹备分区')) || ''
  const materialMatch = collectParagraph.match(/物资筹备分区：([\s\S]*?)芯片搜索分区/)
  const chipMatch = collectParagraph.match(/芯片搜索分区：([\s\S]*)$/)

  // 「特别开放」窗口内（模板:当前信息/每日开放 的 ifexpr 分支）首页不列分区，只给一行
  // 「资源收集所有关卡全天开放中，N后结束」。倒计时优先按同一段的 data-time 现算，
  // 页面脚本没把倒计时写进正文时只报状态；没有这一行时按分区轮换渲染。
  const allOpenParagraph = raw.todayParagraphs.find((text) => /资源收集[\s\S]*?全天开放中/.test(text)) || ''
  const allOpenEpoch = allOpenParagraph
    ? raw.coreItems.find((item) => item.text === allOpenParagraph)?.epoch || 0
    : 0
  const allOpenRemaining = allOpenParagraph
    ? (allOpenEpoch
      ? formatRemainingText(allOpenEpoch * 1000 - options.now.getTime())
      : allOpenParagraph.match(/([^，。\s]+?)后结束/)?.[1] || '')
    : ''
  const collectAllOpen = allOpenParagraph
    ? `全部资源关卡全天开放中${allOpenRemaining ? `（${allOpenRemaining}后结束）` : ''}`
    : ''

  const stageBlock = raw.stageBlocks.find((block) => block.title === '新增关卡')
  // 每个关卡集单独压缩号段：PRTS 首页把「踏上归家长途 / 眺望待行之路 / 奇象巡展 …」分组列出，卡面照搬这个分组
  const stageGroups = (stageBlock?.groups || []).map((group) => ({
    title: group.title,
    codes: compressStageCodes(group.codes
      .map((code) => code.split(/\s+/)[0])
      .filter((code) => /^[A-Za-z]/.test(code))),
  })).filter((group) => group.title || group.codes)
  const stageTitle = stageBlock?.lead || ''
  // 单行版本给「今日信笺 / 泰拉晨报」用
  const stageLine = stageGroups.length
    ? [stageTitle, ...stageGroups.map((group) => `${group.title}${group.codes ? `（${group.codes}）` : ''}`)]
      .filter(Boolean).join(' · ')
    : stageTitle

  const birthdays = (findGroup(/生日/)?.entries || []).map((entry, index) => ({
    name: entry.name,
    avatar: entry.avatar,
    art: '',
    tilt: tilts[index % tilts.length],
    tape: tapes[index % tapes.length],
  }))

  return {
    dateText: `${parts.month}月${parts.day}日`,
    weekText: `星期${WEEKDAY_LABELS[parts.weekday]}`,
    collectIntro: collectAllOpen ? '今日全部资源关卡特别开放，想刷哪关刷哪关——' : '今日资源收集，别忘了刷一遍——',
    sealSlots: buildSealSlots(options.now) as SealSlot[],
    capturedAtText: [String(parts.hour).padStart(2, '0'), String(parts.minute).padStart(2, '0')].join(':'),
    collectMaterial: splitCollectValues(materialMatch?.[1] || ''),
    collectChips: splitCollectValues(chipMatch?.[1] || ''),
    collectAllOpen,
    core: raw.coreItems
      .map((item) => parseCoreItem(item.text, item.epoch, options.now))
      .filter((item): item is DailyCoreItem => !!item),
    birthdays,
    recentOperators: toOperators(findGroup(/近期新增/)),
    poolOperators: [...toOperators(findGroup(/凭证兑换/)), ...toOperators(findGroup(/甄选/))],
    stageLine,
    stageTitle,
    stageGroups,
  }
}

/* ==================== 服务 ==================== */

function defaultFetcher(url: string, init?: DailyRequestInit): Promise<any> {
  return (async () => {
    const response = await fetch(url, {
      method: init?.method || 'GET',
      headers: init?.headers,
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    if (init?.responseType === 'arraybuffer') return await response.arrayBuffer()
    if (init?.responseType === 'text') return await response.text()
    return await response.json()
  })()
}

export class PrtsCaptureService {
  private readonly homepageUrl = HOMEPAGE_URL

  private get now() {
    return this.options.nowProvider?.() ?? new Date()
  }

  constructor(
    private readonly ctx: { puppeteer?: { page: () => Promise<any> } },
    private readonly cache: DailyImageCache,
    private readonly logger: { warn: (message: string) => void; info: (message: string) => void; debug?: (message: string) => void },
    private readonly options: { refreshCron?: string; fetcher?: DailyFetcher; nowProvider?: () => Date; styleId?: string; fallbackReason?: string } = {},
  ) {}

  async getDailyInfo(force = false): Promise<CachedImageResult> {
    return this.resolveCachedImage('daily', force, () => this.captureDailyCard())
  }

  async refreshDue() {
    const refreshCron = this.options.refreshCron || '5 4 * * *'
    const parts = getZonedParts(new Date(), TIMEZONE)
    if (!matchesCronExpression(refreshCron, parts)) {
      this.logger.debug?.(`日报定时刷新未到触发时间：${refreshCron}`)
      return
    }
    if (await this.cache.hasToday('daily')) {
      this.logger.debug?.('日报定时刷新跳过：今日缓存已存在。')
      return
    }
    try {
      this.logger.info(`日报定时刷新开始：${refreshCron}`)
      await this.getDailyInfo(true)
      this.logger.info('日报定时刷新完成。')
    } catch (error) {
      this.logger.warn(`日报定时刷新失败：${formatError(error)}`)
    }
  }

  private async resolveCachedImage(kind: CaptureKind, force: boolean, capture: () => Promise<{ buffer: Buffer; mimeType?: string }>) {
    if (!force) {
      const cached = await this.cache.readToday(kind)
      if (cached) return cached
    }
    try {
      const fresh = await capture()
      return await this.cache.write(kind, fresh.buffer, { mimeType: fresh.mimeType })
    } catch (error) {
      this.logger.warn(`日报卡片生成失败：${formatError(error)}`)
      // 失败就发回退卡片（不写缓存，明天照常重试）；宁可明说没送到，也不把旧卡当今天的推出去
      return await this.renderFallbackCard()
    }
  }

  /**
   * 回退卡片：插画 + 一句可配置的致歉。浏览器连回退卡片都渲不出来时退到插画本体，牌子留空。
   */
  private async renderFallbackCard(): Promise<CachedImageResult> {
    const fallbackImage = await readFallbackImage()
    try {
      const reason = FALLBACK_REASONS[this.options.fallbackReason || ''] ?? FALLBACK_REASONS[DEFAULT_FALLBACK_REASON]
      const message = reason.sentence(resolveCardStyle(this.options.styleId).shortLabel)
      const { width, height } = readPngSize(fallbackImage)
      const html = renderFallbackHtml({
        imageDataUrl: `data:image/png;base64,${fallbackImage.toString('base64')}`,
        message,
        fontsCssLinks: await this.ensureRenderAssets(),
        width,
        height,
      })
      const renderDir = path.join(this.cache.rootDirectory, 'render')
      await fs.mkdir(renderDir, { recursive: true })
      const htmlPath = path.join(renderDir, 'fallback.html')
      await fs.writeFile(htmlPath, html, 'utf8')

      const buffer = await this.withPage(async (page) => {
        const fileUrl = 'file://' + (process.platform === 'win32' ? '/' : '') + htmlPath.replace(/\\/g, '/')
        await page.setViewport({ width, height, deviceScaleFactor: 1 })
        await page.goto(fileUrl, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS })
        await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => undefined) : undefined)).catch(() => undefined)
        await this.waitForRenderDelay(page)
        await this.waitForImages(page)
        const target = await page.$('#letter')
        if (!target) throw new Error('回退卡片截图节点创建失败')
        return ensureBuffer(await target.screenshot({ type: 'png' }))
      })
      return { buffer, dayKey: this.cache.currentDayKey, filePath: htmlPath, mimeType: 'image/png' }
    } catch (error) {
      this.logger.warn(`回退卡片渲染失败，直接发插画本体：${formatError(error)}`)
      return { buffer: fallbackImage, dayKey: this.cache.currentDayKey, filePath: '', mimeType: 'image/png' }
    }
  }

  /** 抓取 PRTS 首页 → 结构化数据 → 拉立绘 → 渲染「今日信笺」 → 截图 */
  private async captureDailyCard(): Promise<{ buffer: Buffer; mimeType: string }> {
    const raw: RawDailyData = await this.withPage(async (page) => {
      await page.goto(this.homepageUrl, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT_MS })
      await page.waitForSelector('.mp-today', { timeout: NAVIGATION_TIMEOUT_MS })
      await this.waitForImages(page)
      await this.waitForRenderDelay(page)
      return page.evaluate(EXTRACT_DAILY_SNIPPET)
    })

    const data = mapRawToDailyCard(raw, { now: this.now })
    if (!data.collectMaterial.length && !data.collectChips.length && !data.collectAllOpen && !data.core.length) {
      throw new Error('PRTS 首页未解析出有效日报数据')
    }
    for (const birthday of data.birthdays) {
      birthday.art = await this.fetchBirthdayArt(birthday.name, birthday.avatar)
    }
    // 当日唯一生日干员：补「干员报到」台词（泰拉周刊单人封面用）；失败留空由渲染器回退原贺语
    if (data.birthdays.length === 1) {
      const solo = data.birthdays[0]
      try {
        solo.quote = await this.fetchOperatorQuote(solo.name)
      } catch (error) {
        this.logger.warn(`干员「${solo.name}」报到台词获取失败：${formatError(error)}`)
      }
    }
    if (resolveCardStyle(this.options.styleId).needsOperatorAvatars) {
      await this.inlineOperatorAvatars([...data.recentOperators, ...data.poolOperators])
    }

    const fontsCssLinks = await this.ensureRenderAssets()
    const html = renderCardByStyle(this.options.styleId, data, { fontsCssLinks })
    const renderDir = path.join(this.cache.rootDirectory, 'render')
    await fs.mkdir(renderDir, { recursive: true })
    const htmlPath = path.join(renderDir, 'card.html')
    await fs.writeFile(htmlPath, html, 'utf8')

    let mimeType = 'image/png'
    const buffer = await this.withPage(async (page) => {
      const fileUrl = 'file://' + (process.platform === 'win32' ? '/' : '') + htmlPath.replace(/\\/g, '/')
      await page.setViewport(VIEWPORT)
      await page.goto(fileUrl, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS })
      await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => undefined) : undefined)).catch(() => undefined)
      await this.waitForRenderDelay(page)
      await this.waitForImages(page)
      const target = await page.$('#letter')
      if (!target) throw new Error('今日信笺截图节点创建失败')
      let screenshot = ensureBuffer(await target.screenshot({ type: 'png' }))
      if (screenshot.byteLength > QQ_IMAGE_MAX_BYTES) {
        this.logger.info(`日报卡片图片超出 QQ 限制（${screenshot.byteLength}B），回退 JPEG。`)
        screenshot = ensureBuffer(await target.screenshot({ type: 'jpeg', quality: 90 }))
        mimeType = 'image/jpeg'
      }
      return screenshot
    })

    return { buffer, mimeType }
  }

  /* ---------- 干员头像（不落盘：一天只渲一次，缓存不值当；失败留空由渲染器出占位） ---------- */

  private async inlineOperatorAvatars(operators: DailyOperator[]) {
    const fetcher = this.options.fetcher || defaultFetcher
    const cache = new Map<string, string>()
    for (const operator of operators) {
      const url = operator.avatar
      if (!url || url.startsWith('data:')) continue
      if (cache.has(url)) {
        operator.avatar = cache.get(url)
        continue
      }
      try {
        const dataUrl = await this.downloadAsDataUrl(url, fetcher)
        cache.set(url, dataUrl)
        operator.avatar = dataUrl
      } catch (error) {
        cache.set(url, '')
        operator.avatar = ''
        this.logger.warn(`干员「${operator.name}」头像获取失败，改用占位图：${formatError(error)}`)
      }
    }
  }

  /* ---------- 生日干员半身立绘（磁盘缓存 + 头像兜底） ---------- */

  private async fetchBirthdayArt(name: string, avatarUrl: string): Promise<string> {
    const fetcher = this.options.fetcher || defaultFetcher
    const artDir = path.join(this.cache.rootDirectory, 'art')
    const cacheFile = path.join(artDir, `${name.replace(/[\\/:*?"<>|]/g, '_')}.b64.txt`)
    try {
      const stat = await fs.stat(cacheFile)
      if (Date.now() - stat.mtimeMs < ART_CACHE_TTL_MS) {
        return (await fs.readFile(cacheFile, 'utf8')).trim()
      }
    } catch {}

    const save = async (dataUrl: string) => {
      await fs.mkdir(artDir, { recursive: true })
      await fs.writeFile(cacheFile, dataUrl, 'utf8')
      return dataUrl
    }

    try {
      const artUrl = await this.resolveHalfBodyUrl(name, fetcher)
      return await save(await this.downloadAsDataUrl(artUrl, fetcher))
    } catch (error) {
      this.logger.warn(`干员「${name}」半身立绘获取失败，尝试头像兜底：${formatError(error)}`)
    }
    if (avatarUrl) {
      try {
        return await save(await this.downloadAsDataUrl(avatarUrl, fetcher))
      } catch (error) {
        this.logger.warn(`干员「${name}」头像兜底也失败：${formatError(error)}`)
      }
    }
    return ''
  }

  /* ---------- 生日干员「干员报到」台词（不落盘：一天最多一次请求） ---------- */

  private async fetchOperatorQuote(name: string): Promise<string> {
    const fetcher = this.options.fetcher || defaultFetcher
    const api = `https://prts.wiki/api.php?action=parse&page=${encodeURIComponent(`${name}/语音记录`)}&prop=wikitext&format=json&formatversion=2`
    const payload = await fetcher(api, {
      responseType: 'json',
      headers: { ...BROWSER_HEADERS, Accept: 'application/json' },
    })
    return extractOperatorQuote(String(payload?.parse?.wikitext || ''))
  }

  private async resolveHalfBodyUrl(name: string, fetcher: DailyFetcher): Promise<string> {
    const api = `https://prts.wiki/api.php?action=query&list=allimages&aiprefix=${encodeURIComponent(`半身像_${name}`)}&ailimit=10&format=json`
    const payload = await fetcher(api, {
      responseType: 'json',
      headers: { ...BROWSER_HEADERS, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
    const images: Array<{ name: string; url: string }> = payload?.query?.allimages || []
    const artImages = images.filter((image) => decodeURIComponent(image.name).startsWith('半身像_'))
    if (!artImages.length) throw new Error(`PRTS 无「${name}」的半身像文件`)
    const pick = artImages.find((image) => /_2\.png$/i.test(image.name))
      || artImages.find((image) => /_1\.png$/i.test(image.name))
      || artImages[0]
    return pick.url
  }

  private async downloadAsDataUrl(url: string, fetcher: DailyFetcher): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const buffer = ensureBuffer(await fetcher(url, { responseType: 'arraybuffer', headers: BROWSER_HEADERS }))
        if (buffer.byteLength < 500) throw new Error(`响应过小（${buffer.byteLength}B）`)
        return `data:image/png;base64,${buffer.toString('base64')}`
      } catch (error) {
        if (attempt === 1) throw error
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
    }
    throw new Error('unreachable')
  }

  /* ---------- 渲染资源（字体） ---------- */

  private async ensureRenderAssets(): Promise<string> {
    try {
      const lxgwDir = path.dirname(require.resolve('lxgw-wenkai-lite-webfont/lxgwwenkailite-regular.css'))
      const zmxDir = path.dirname(require.resolve('@fontsource/zhi-mang-xing/index.css'))
      const serifDir = path.dirname(require.resolve('@fontsource/noto-serif-sc/chinese-simplified-400.css'))
      const version = JSON.stringify({
        version: RENDER_FONTS_VERSION,
        lxgw: readPackageVersion(lxgwDir),
        zmx: readPackageVersion(zmxDir),
        serif: readPackageVersion(serifDir),
      })
      // 字体按版本共享在系统临时目录，多实例/多测试只复制一次
      const hash = createHash('md5').update(version).digest('hex').slice(0, 8)
      const fontsDir = path.join(os.tmpdir(), 'miyako-intel-render-fonts', hash)
      if (!await exists(path.join(fontsDir, 'version.json'))) {
        await fs.rm(fontsDir, { recursive: true, force: true })
        await copyInto(lxgwDir, path.join(fontsDir, 'lxgw'), ['lxgwwenkailite-regular.css', 'lxgwwenkailite-bold.css'])
        await copyInto(zmxDir, path.join(fontsDir, 'zmx'), ['index.css'])
        await copyInto(serifDir, path.join(fontsDir, 'serif'), SERIF_CSS_FILES, /chinese-simplified-[4579]00[^/]*\.woff2$/)
        await fs.writeFile(path.join(fontsDir, 'version.json'), version, 'utf8')
        this.logger.debug?.('日报渲染字体资源已就绪。')
      }
      return [
        'lxgw/lxgwwenkailite-regular.css',
        'lxgw/lxgwwenkailite-bold.css',
        'zmx/index.css',
        ...SERIF_CSS_FILES.map((file) => `serif/${file}`),
      ].map((relative) => `<link rel="stylesheet" href="${pathToFileURL(path.join(fontsDir, relative)).href}">`).join('\n')
    } catch (error) {
      this.logger.warn(`渲染字体资源缺失，退化为系统楷体：${formatError(error)}`)
      return ''
    }
  }

  /* ---------- 页面工具 ---------- */

  private async withPage<T>(callback: (page: any) => Promise<T>): Promise<T> {
    const puppeteer = this.ctx.puppeteer
    if (!puppeteer || typeof puppeteer.page !== 'function') {
      throw new Error('未检测到 koishi-plugin-puppeteer 服务。')
    }
    const page = await puppeteer.page()
    try {
      if (page.setUserAgent) await page.setUserAgent(USER_AGENT)
      return await callback(page)
    } finally {
      if (page.close) await page.close().catch(() => undefined)
    }
  }

  private async waitForImages(page: any) {
    if (!page.waitForFunction) return
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), {
      timeout: Math.min(10000, NAVIGATION_TIMEOUT_MS),
    }).catch(() => undefined)
  }

  private async waitForRenderDelay(page: any) {
    if (page.waitForTimeout) {
      await page.waitForTimeout(RENDER_DELAY_MS)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, RENDER_DELAY_MS))
  }
}

async function copyInto(sourceDir: string, targetDir: string, files: string[], fileFilter?: RegExp) {
  await fs.mkdir(targetDir, { recursive: true })
  for (const file of files) {
    await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file))
  }
  const filesDir = path.join(sourceDir, 'files')
  if (!await exists(filesDir)) return
  const targetFilesDir = path.join(targetDir, 'files')
  await fs.mkdir(targetFilesDir, { recursive: true })
  for (const entry of await fs.readdir(filesDir)) {
    if (fileFilter && !fileFilter.test(entry)) continue
    await fs.copyFile(path.join(filesDir, entry), path.join(targetFilesDir, entry))
  }
}

function readPackageVersion(packageDir: string) {
  try {
    return require(path.join(packageDir, 'package.json')).version || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function ensureBuffer(source: unknown): Buffer {
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
