// 「泰拉周刊」夜间书脊版：深底 + 立绘光晕 + 磨砂玻璃分区卡 + 左侧强调色书脊
// 版式原型见 design/weekly-prototype（1080 宽内页 / 群聊压到 ~400 宽仍要读得清，故正文不小于 26px）
import fs from 'node:fs'
import path from 'node:path'
import { DailyCardData, DailyOperator } from './card-types'
import { operatorThemeColor } from './operator-colors'

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

// 每日一色：只换强调色，纸墨恒定；夜间底色深，强调色取高亮版
const ACCENTS: Record<number, string> = {
  0: '#ff5f70', // 周日 · 胭脂
  1: '#6698e0', // 周一 · 靛蓝
  2: '#ff8a52', // 周二 · 陶土
  3: '#93c96d', // 周三 · 橄榄
  4: '#c294e0', // 周四 · 藕紫
  5: '#efb63f', // 周五 · 赭金
  6: '#45cbbc', // 周六 · 松绿
}

// 星级块底色（渲染时再往白里兑，压深底）
const RANK_COLORS: Record<number, string> = {
  6: '#9d7222', 5: '#7c7430', 4: '#5f4a6d', 3: '#3a5273', 2: '#5f5c56', 1: '#5f5c56',
}

// 固定素材随包：道具按物资名匹配，芯片按职业组合匹配
const ITEM_ICONS: Array<[RegExp, string]> = [
  [/作战记录|经验/, 'item-exp.png'],
  [/采购凭证/, 'item-voucher.png'],
  [/龙门币/, 'item-lmd.png'],
  [/技巧概要/, 'item-skill.png'],
  [/碳|建材|家具/, 'item-carbon.png'],
]
// 芯片搜索四关（PRTS 首页的职业组合 → 关卡缩略图）：
// 固若金汤 = 医疗&重装 / 势不可挡 = 辅助&先锋 / 摧枯拉朽 = 术师&狙击 / 身先士卒 = 近卫&特种
// 文件名直接写职业，避免再按 PR-A/B/C/D 的顺序记错
const CHIP_ICONS: Array<[RegExp, string]> = [
  [/重装|医疗/, 'chip-medic-defender.png'],
  [/辅助|先锋/, 'chip-supporter-vanguard.png'],
  [/术师|狙击/, 'chip-caster-sniper.png'],
  [/近卫|特种/, 'chip-guard-specialist.png'],
]

const ICON_DIRECTORY = path.join(__dirname, '..', '..', 'assets', 'icons')
const iconCache = new Map<string, string>()

/** 随包图标读成 data URL：相对路径写进 file:// 页面会解析失败，内联最稳 */
function iconDataUrl(file: string): string {
  if (!iconCache.has(file)) {
    try {
      const buffer = fs.readFileSync(path.join(ICON_DIRECTORY, file))
      iconCache.set(file, `data:image/png;base64,${buffer.toString('base64')}`)
    } catch {
      iconCache.set(file, '')
    }
  }
  return iconCache.get(file) || ''
}

function matchIcon(table: Array<[RegExp, string]>, text: string): string {
  const hit = table.find(([pattern]) => pattern.test(String(text || '')))
  return hit ? iconDataUrl(hit[1]) : ''
}

/** 头像抓取失败时的占位：内联 SVG，不发请求 */
function avatarPlaceholder(rarity: number): string {
  const label = rarity ? `${rarity}★` : '?'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">`
    + `<rect width="120" height="120" rx="60" fill="#2b2b35"/>`
    + `<circle cx="60" cy="60" r="57" fill="none" stroke="#5d5d6b" stroke-width="4"/>`
    + `<text x="60" y="60" text-anchor="middle" dominant-baseline="central" fill="#b9b9c6"`
    + ` font-family="sans-serif" font-size="42" font-weight="700">${label}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function escapeHtml(text: unknown) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const pad2 = (value: number | string) => String(value).padStart(2, '0')

/** 平移到东八区墙钟：lunar-javascript 与期号都按本地字段读取 */
function toZoned(date: Date) {
  return new Date(date.getTime() + (480 + date.getTimezoneOffset()) * 60000)
}

function lunarText(zoned: Date) {
  const lunar = (require('lunar-javascript') as any).Lunar.fromDate(zoned)
  return `${lunar.getMonth() < 0 ? '闰' : ''}${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
}

function issueNumber(zoned: Date) {
  // 明日方舟国服公测 2019-05-01 起算的期数（按东八区日期，否则每天 00:00~08:00 会少算一期）
  const launch = Date.UTC(2019, 4, 1)
  const today = Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate())
  return Math.max(1, Math.floor((today - launch) / 86400000) + 1)
}

/** "1天7小时46分钟" → 特大数字 + 小单位；只保留前两段，避免挤压 */
function clockHtml(text: string) {
  const units: Record<string, string> = { 天: '天', 小时: '时', 分钟: '分' }
  const parts = (String(text || '').match(/\d+(?:天|小时|分钟)/g) || []).slice(0, 2)
  if (!parts.length) return '<b>--</b>'
  return parts.map((part) => {
    const matched = part.match(/(\d+)(天|小时|分钟)/)
    return matched ? `<b>${matched[1]}</b><i>${units[matched[2]]}</i>` : ''
  }).join('')
}

const tab = (title: string) => `<h2 class="wk-tab">${escapeHtml(title)}</h2>`

/** 带图砖的文字单元：图必须写进 <i> 的 background-image（CSS 变量里的相对路径会按样式表位置解析） */
function shaded(kind: 'val' | 'op', icon: string, text: string) {
  return `<span class="wk-${kind}${icon ? '' : ' wk-shade--none'}">`
    + `<i class="wk-${kind}__ico"${icon ? ` style="background-image:url('${icon}')"` : ''}></i>`
    + `<em>${escapeHtml(text)}</em></span>`
}

const WEEKLY_CSS = `
:root {
  --ink: #f5f2ec;
  --ink-2: rgba(245, 242, 236, 0.76);
  --ink-3: rgba(245, 242, 236, 0.52);
  --hair: rgba(245, 242, 236, 0.16);
  --glass-line: rgba(255, 255, 255, 0.11);
  --glass-top: rgba(255, 255, 255, 0.14);
  --shadow: 0 14px 34px rgba(0, 0, 0, 0.42);
  --serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;
  --sans: "PingFang SC", "MiSans", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #191920;
  font-family: var(--serif);
  font-weight: 700;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

/* ---------------- 外框：装订书脊 ---------------- */
.wk-frame {
  position: relative;
  width: 1160px;
  padding: 16px 16px 16px 64px;
  background: #0d0d12;
  border: 3px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 26px 64px rgba(0, 0, 0, 0.62);
}
.wk-frame__spine {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 26px;
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 48px;
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--birthday-accent) 88%, #fff 12%),
    color-mix(in srgb, var(--birthday-accent) 62%, #000 38%));
  color: #14131a;
  writing-mode: vertical-rl;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.34em;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.28), 6px 0 22px rgba(0, 0, 0, 0.45);
}
.wk-frame__spine i { font-style: normal; opacity: 0.62; letter-spacing: 0.2em; }
/* ---------------- 内页：深底 + 顶部立绘色雾 ---------------- */
.wk {
  position: relative;
  width: 1080px;
  overflow: hidden;
  background: radial-gradient(120% 70% at 50% -10%, #1d1d27 0%, #101015 58%, #0c0c11 100%);
}
.wk-hero {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 620px;
  overflow: hidden;
  z-index: 0;
}
.wk-hero__img {
  position: absolute;
  inset: -80px -40px auto -40px;
  height: 620px;
  background-position: 50% 22%;
  background-size: cover;
  filter: blur(52px) saturate(165%) brightness(0.78);
  opacity: 0.78;
}
/* 蒙版：上密下透，压住报头字、底部干净收掉 */
.wk-hero__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg,
    rgba(10, 10, 15, 0.5) 0%, rgba(10, 10, 15, 0.42) 40%, rgba(16, 16, 21, 0.94) 86%, #101015 100%);
}
.wk-cap, .wk-body, .wk-foot { position: relative; z-index: 1; }

/* ---------------- 报头：玻璃条 ---------------- */
.wk-cap {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 30px;
  padding: 20px 44px 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  backdrop-filter: blur(16px) saturate(130%);
  border-bottom: 1px solid var(--glass-line);
  box-shadow: inset 0 1px 0 var(--glass-top);
}
.wk-cap__title {
  font-size: 96px;
  font-weight: 900;
  line-height: 0.9;
  letter-spacing: 0.05em;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.55);
}
.wk-cap__en {
  margin-top: 12px;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: rgba(245, 242, 236, 0.62);
}
.wk-cap__right { flex: none; text-align: right; }
.wk-cap__date {
  font-size: 78px;
  font-weight: 900;
  line-height: 0.86;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}
.wk-cap__meta {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  font-size: 25px;
  font-weight: 900;
  letter-spacing: 0.08em;
}
.wk-cap__clip { color: rgba(245, 242, 236, 0.66); font-weight: 700; }
.wk-cap__week {
  background: var(--birthday-accent);
  color: #14131a;
  padding: 4px 14px 6px;
  border-radius: 6px;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--birthday-accent) 45%, transparent);
}

/* ---------------- 分区：磨砂玻璃卡 ---------------- */
.wk-body { padding: 18px 26px 4px; }
.wk-band {
  /* 内宽要留够 4 张 230px 立绘：1080 - 26*2 - 20*2 = 988 */
  padding: 16px 20px 18px;
  margin-bottom: 11px;
  border: 1px solid var(--glass-line);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.028));
  backdrop-filter: blur(18px) saturate(125%);
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-top);
}
.wk-band:last-of-type { margin-bottom: 0; }
/* ---------------- 栏目标签：亮块压深底 ---------------- */
.wk-tab {
  display: inline-block;
  background: rgba(245, 242, 236, 0.94);
  color: #14131a;
  font-size: 31px;
  font-weight: 900;
  letter-spacing: 0.16em;
  padding: 8px 20px 10px;
  margin-bottom: 16px;
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

/* ---------------- 生辰干员 ---------------- */
.wk-portraits {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: center;
  gap: 16px 18px;
}
.wk-figure { width: 230px; }
.wk-figure__frame {
  position: relative;
  height: 250px;
  overflow: hidden;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.5), inset 0 0 0 1px var(--glass-line);
}
.wk-figure__frame::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 6px;
  border-radius: 0 0 16px 16px;
  background: var(--birthday-accent);
}
/* 半身立绘是窄长图，等比放进方框会留大片空白；改为裁切填满，只保留头肩 */
.wk-figure__frame img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 6%;
}
.wk-figure__name {
  padding-top: 10px;
  text-align: center;
  font-size: 37px;
  font-weight: 900;
  letter-spacing: 0.03em;
  line-height: 1.2;
  white-space: nowrap;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
/* 同一行按最长名字统一降档，避免一行里字号不一 */
.wk-figure__name--tight { font-size: 30px; letter-spacing: 0; }
.wk-figure__name--tighter { font-size: 25px; letter-spacing: -0.01em; }

/* ---------------- 单人封面 + 报到台词 ---------------- */
/* 头像以「姓名 + 台词」栏的实际高度垂直居中：栏高由下方脚本写入 --solo-h，立绘框与栏等高即居中 */
.wk-portraits--solo { justify-content: flex-start; gap: 40px; align-items: center; }
.wk-portraits--solo .wk-figure { width: 380px; }
.wk-portraits--solo .wk-figure__frame { height: var(--solo-h, 396px); }
.wk-solo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.wk-solo__name {
  font-size: 96px;
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 0.04em;
}
.wk-solo__bar {
  width: 140px;
  height: 10px;
  border-radius: 5px;
  background: var(--accent);
  margin: 24px 0 22px;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 50%, transparent);
}
.wk-solo__note {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.7;
  color: var(--ink-2);
}
/* 报到台词：楷体手账风（渲染管线已加载 lxgw-wenkai-lite），只留台词本身；
   字号由下方脚本自适应（40px 起，放不下先扩板块再降字号，22px 下限） */
.wk-solo__quote {
  font-family: "LXGW WenKai Lite", "Kaiti SC", "KaiTi", "STKaiti", serif;
  font-weight: 700;
  line-height: 1.72;
  letter-spacing: 0.02em;
  color: var(--ink);
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.55);
  text-align: justify;
}
/* ---------------- 情报速递：倒计时特大数字 ---------------- */
.wk-news__item {
  display: flex;
  align-items: center;
  gap: 26px;
  padding: 12px 0;
  border-top: 2px solid var(--hair);
}
.wk-news__item:first-child { border-top: 0; padding-top: 0; }
.wk-news__clock {
  flex: none;
  width: 268px;
  display: flex;
  align-items: baseline;
  line-height: 0.85;
  font-variant-numeric: tabular-nums;
}
.wk-news__clock b { font-size: 74px; font-weight: 900; }
.wk-news__clock i {
  font-style: normal;
  font-size: 25px;
  font-weight: 900;
  color: var(--ink-3);
  margin: 0 12px 0 3px;
}
.wk-news__item--danger .wk-news__clock b {
  color: var(--accent);
  text-shadow: 0 0 26px color-mix(in srgb, var(--accent) 55%, transparent);
}
.wk-news__body { min-width: 0; }
.wk-news__head { display: flex; align-items: center; gap: 14px; }
.wk-news__act {
  flex: none;
  font-size: 23px;
  font-weight: 900;
  letter-spacing: 0.12em;
  padding: 2px 12px 4px;
  border: 3px solid var(--hair);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
}
.wk-news__item--danger .wk-news__act {
  background: var(--accent);
  border-color: transparent;
  color: #14131a;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 40%, transparent);
}
.wk-news__title {
  font-size: 36px;
  font-weight: 900;
  line-height: 1.3;
  letter-spacing: 0.02em;
}
.wk-news__title b { color: var(--birthday-accent); }
/* ---------------- 今日可刷 ---------------- */
.wk-collect__row {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 11px 0;
  border-top: 2px solid var(--hair);
}
.wk-collect__row:first-child { border-top: 0; padding-top: 0; }
.wk-collect__key {
  flex: none;
  width: 176px;
  font-size: 27px;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.wk-collect__vals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 30px;
  font-size: 34px;
  font-weight: 900;
  line-height: 1.4;
}

/* 图砖贴在字前：缩略图下多一层颜色识别 */
.wk-val, .wk-op {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.wk-val__ico, .wk-op__ico {
  flex: none;
  width: 62px;
  height: 62px;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.6));
}
.wk-op__ico {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background-size: cover;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.24), 0 4px 12px rgba(0, 0, 0, 0.5);
  filter: none;
}
.wk-shade--none .wk-val__ico, .wk-shade--none .wk-op__ico { display: none; }
.wk-val em, .wk-op em { font-style: normal; }
/* ---------------- 名录：星级阶梯（星级只在行首出现一次） ---------------- */
.wk-split { display: grid; grid-template-columns: 1fr 1fr; gap: 0 36px; }
.wk-split > div + div { padding-left: 36px; border-left: 3px solid var(--hair); }
.wk-ladder__row {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 9px 0;
  border-top: 2px solid var(--hair);
}
.wk-ladder__row:first-child { border-top: 0; padding-top: 0; }
.wk-ladder__rank {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  margin-top: 4px;
  min-width: 74px;
  padding: 5px 10px 7px;
  border-radius: 8px;
  /* 星级色往白里兑，字改深色，深底上最跳 */
  background: color-mix(in srgb, var(--rank-color, #5f5c56) 68%, #fff 32%);
  color: #14131a;
  font-size: 34px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.wk-ladder__rank i { font-style: normal; font-size: 20px; font-weight: 900; }
.wk-ladder__names {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  font-size: 33px;
  font-weight: 900;
  letter-spacing: 0.02em;
  line-height: 1.4;
}
.wk-empty { font-size: 26px; font-weight: 900; color: var(--ink-3); letter-spacing: 0.1em; }
/* ---------------- 新增关卡 ---------------- */
.wk-stage {
  padding: 16px 0 2px;
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
.wk-stage__label {
  flex: none;
  padding-top: 2px;
  font-size: 25px;
  font-weight: 900;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}
.wk-stage__body { min-width: 0; flex: 1; }
.wk-stage__lead {
  font-size: 28px;
  font-weight: 900;
  line-height: 1.4;
  margin-bottom: 4px;
}
/* 两列网格：名字列按最长的关卡集名自适应，号段列整齐左对齐 */
.wk-stage__grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 26px;
}
.wk-stage__name, .wk-stage__codes {
  padding: 5px 0;
  border-top: 2px solid var(--hair);
}
.wk-stage__grid > :nth-child(-n+2) { border-top: 0; }
.wk-stage__name {
  font-size: 26px;
  font-weight: 900;
  color: var(--ink-2);
}
.wk-stage__codes {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

/* ---------------- 落款：玻璃条 ---------------- */
.wk-foot {
  margin: 13px 26px 17px;
  padding: 12px 22px 14px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border: 1px solid var(--glass-line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.045);
  backdrop-filter: blur(14px);
  color: var(--ink-3);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.14em;
  box-shadow: inset 0 1px 0 var(--glass-top);
}
.wk-foot b { color: var(--ink); font-weight: 900; }
`

/* ==================== 分区 ==================== */

/** 同一行的名字按最长的那个统一降档 */
function nameClass(list: Array<{ name: string }>) {
  const longest = list.reduce((max, item) => Math.max(max, String(item.name || '').length), 0)
  if (longest <= 4) return ''
  if (longest <= 6) return ' wk-figure__name--tight'
  return ' wk-figure__name--tighter'
}

function coverBand(data: DailyCardData) {
  const list = data.birthdays || []
  if (!list.length) return ''
  const art = (item: typeof list[number]) => escapeHtml(item.art || item.avatar)
  if (list.length === 1) {
    const op = list[0]
    const quote = String(op.quote || '').trim()
    return `<section class="wk-band">
      ${tab('今日生日')}
      <div class="wk-portraits wk-portraits--solo" id="wk-solo">
        <figure class="wk-figure">
          <div class="wk-figure__frame"><img src="${art(op)}" alt="${escapeHtml(op.name)}"></div>
        </figure>
        <div class="wk-solo">
          <p class="wk-solo__name">${escapeHtml(op.name)}</p>
          <div class="wk-solo__bar"></div>
          ${quote
            ? `<p class="wk-solo__quote">${escapeHtml(quote)}</p>`
            : `<p class="wk-solo__note">今天只有一位干员生日。<br>蛋糕已经在后勤部备好了。</p>`}
        </div>
      </div>
    </section>`
  }
  return `<section class="wk-band">
    ${tab('今日生日')}
    <div class="wk-portraits">${list.map((op) => `
      <figure class="wk-figure">
        <div class="wk-figure__frame"><img src="${art(op)}" alt="${escapeHtml(op.name)}"></div>
        <figcaption class="wk-figure__name${nameClass(list)}">${escapeHtml(op.name)}</figcaption>
      </figure>`).join('')}
    </div>
  </section>`
}

function newsBand(data: DailyCardData) {
  const list = data.core || []
  if (!list.length) return ''
  return `<section class="wk-band">
    ${tab('情报速递')}
    ${list.map((item) => `
    <article class="wk-news__item wk-news__item--${escapeHtml(item.urgency)}">
      <div class="wk-news__clock">${clockHtml(item.remainingText)}</div>
      <div class="wk-news__body">
        <div class="wk-news__head">
          <span class="wk-news__act">${escapeHtml(item.action)}</span>
          <h3 class="wk-news__title">${escapeHtml(item.name).replace(/(『[^』]+』)/g, '<b>$1</b>')}</h3>
        </div>
      </div>
    </article>`).join('')}
  </section>`
}

function collectBand(data: DailyCardData) {
  const rows = [
    { key: '物资筹备', table: ITEM_ICONS, values: data.collectMaterial || [] },
    { key: '芯片搜索', table: CHIP_ICONS, values: data.collectChips || [] },
  ].filter((row) => row.values.length)
  if (!rows.length) return ''
  return `<section class="wk-band">
    ${tab('今日可刷')}
    ${rows.map((row) => `
    <div class="wk-collect__row">
      <span class="wk-collect__key">${escapeHtml(row.key)}</span>
      <span class="wk-collect__vals">${row.values
        .map((value) => shaded('val', matchIcon(row.table, value), value)).join('')}</span>
    </div>`).join('')}
  </section>`
}

/** 星级阶梯：同星级的干员并成一行，星级块只在行首出现一次 */
function ladder(list: DailyOperator[]) {
  const buckets = new Map<number, DailyOperator[]>()
  for (const op of list || []) {
    const rank = Number(op.rarity) || 0
    if (!buckets.has(rank)) buckets.set(rank, [])
    buckets.get(rank)!.push(op)
  }
  const ranks = [...buckets.keys()].sort((a, b) => b - a)
  if (!ranks.length) return '<p class="wk-empty">本期无更新</p>'
  return ranks.map((rank) => `
    <div class="wk-ladder__row" style="--rank-color:${RANK_COLORS[rank] || RANK_COLORS[2]}">
      <span class="wk-ladder__rank">${rank || '–'}<i>★</i></span>
      <span class="wk-ladder__names">${buckets.get(rank)!
        .map((op) => shaded('op', op.avatar || avatarPlaceholder(op.rarity), op.name)).join('')}</span>
    </div>`).join('')
}

/** 新增关卡：活动名一行，其下每个关卡集一行（PRTS 首页就是这么分组的） */
function stageHtml(data: DailyCardData) {
  const groups = data.stageGroups || []
  if (!groups.length && !data.stageTitle && !data.stageLine) return ''
  const body = groups.length
    ? `<div class="wk-stage__grid">${groups.map((group) => `
        <span class="wk-stage__name">${escapeHtml(group.title)}</span>
        <span class="wk-stage__codes">${escapeHtml(group.codes)}</span>`).join('')}
      </div>`
    : `<p class="wk-stage__lead">${escapeHtml(data.stageLine)}</p>`
  return `<div class="wk-stage">
    <span class="wk-stage__label">新增关卡</span>
    <div class="wk-stage__body">
      ${data.stageTitle ? `<p class="wk-stage__lead">${escapeHtml(data.stageTitle)}</p>` : ''}
      ${body}
    </div>
  </div>`
}

function rosterBand(data: DailyCardData) {
  const recent = (data.recentOperators || []).length
  const pool = (data.poolOperators || []).length
  const stage = stageHtml(data)
  if (!recent && !pool && !stage) return ''
  return `<section class="wk-band">
    <div class="wk-split">
      <div>
        ${tab('新增干员')}
        ${ladder(data.recentOperators)}
      </div>
      <div>
        ${tab('凭证 / 甄选')}
        ${ladder(data.poolOperators)}
      </div>
    </div>
    ${stage}
  </section>`
}

/* ==================== 整页 ==================== */

const WEEKLY_FIT_SCRIPT = `
/* 单人封面台词自适应：字号 40px 起试，放不下先扩板块高度（立绘跟随拉伸、保住可读下限），
   到 560px 上限才继续降字号，22px 下限。头像与「姓名+台词」栏实测等高，天然垂直居中。 */
(function () {
  var solo = document.getElementById('wk-solo')
  if (!solo) return
  var col = solo.querySelector('.wk-solo')
  var name = solo.querySelector('.wk-solo__name')
  var bar = solo.querySelector('.wk-solo__bar')
  var quote = solo.querySelector('.wk-solo__quote')
  if (!col || !quote) return
  var soloWidth = solo.clientWidth - 380 - 40
  function fit() {
    for (var h = 396; h <= 560; h += 24) {
      solo.style.setProperty('--solo-h', h + 'px')
      col.style.height = h + 'px'
      var availH = col.clientHeight - name.offsetHeight - bar.offsetHeight
      for (var size = 40; size >= 22; size -= 2) {
        quote.style.fontSize = size + 'px'
        if (quote.scrollHeight <= availH && quote.scrollWidth <= soloWidth) return
      }
    }
  }
  fit()
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit)
  window.addEventListener('load', fit)
  setTimeout(fit, 600)
})()
`

export function renderWeeklyHtml(data: DailyCardData, options: { fontsCssLinks: string }) {
  const zoned = toZoned(new Date())
  const matched = String(data.dateText || '').match(/(\d+)月(\d+)日/)
  const numericDate = matched ? `${pad2(matched[1])}.${pad2(matched[2])}` : escapeHtml(data.dateText)
  const weekIndex = Math.max(0, WEEK_CN.indexOf(String(data.weekText || '').replace('星期', '')))
  // 生日色覆盖书脊、星期徽章、立绘底边和情报关键词；其余强调色保持星期轮换。
  let birthdayColor = ''
  for (const operator of data.birthdays || []) {
    birthdayColor = operatorThemeColor(operator.art)
    if (birthdayColor) break
  }
  const accent = ACCENTS[weekIndex]
  // 顶部色雾用第一张立绘糊出来；没有生日干员就只留渐变底
  const heroArt = (data.birthdays || [])[0]
  const heroSource = heroArt ? heroArt.art || heroArt.avatar : ''
  const hero = heroSource
    ? `<div class="wk-hero">
      <span class="wk-hero__img" style="background-image:url('${escapeHtml(heroSource)}')"></span>
      <span class="wk-hero__scrim"></span>
    </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>泰拉周刊</title>
${options.fontsCssLinks}
<style>${WEEKLY_CSS}</style>
</head>
<body>
<div class="wk-frame" id="letter" style="--accent:${accent};--birthday-accent:${birthdayColor || accent}">
  <span class="wk-frame__spine">泰拉周刊<i>TERRA WEEKLY</i></span>
  <main class="wk">
    ${hero}
    <header class="wk-cap">
      <div>
        <h1 class="wk-cap__title">泰拉周刊</h1>
        <p class="wk-cap__en">Terra Weekly · No.${issueNumber(zoned)}</p>
      </div>
      <div class="wk-cap__right">
        <p class="wk-cap__date">${numericDate}</p>
        <p class="wk-cap__meta">
          <span class="wk-cap__clip">${escapeHtml(lunarText(zoned))}</span>
          <span class="wk-cap__week">${escapeHtml(data.weekText)}</span>
        </p>
      </div>
    </header>
    <div class="wk-body">
${coverBand(data)}
${newsBand(data)}
${collectBand(data)}
${rosterBand(data)}
    </div>
    <footer class="wk-foot">
      <span>截稿 <b>${escapeHtml(data.capturedAtText)}</b></span>
      <span>情报源 <b>PRTS.WIKI</b></span>
      <span>MIYAKO-INTEL</span>
    </footer>
  </main>
</div>
<script>${WEEKLY_FIT_SCRIPT}</script>
</body>
</html>`
}


