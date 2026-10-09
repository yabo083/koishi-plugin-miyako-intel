// 「泰拉晨报」报纸风格：宋体、分栏、双细线、朱红点缀
import { DailyCardData, DailyOperator } from './card-types'
import { getNewspaperTheme, newspaperThemeVars } from './card-newspaper-theme'

const NEWSPAPER_CSS = `
:root {
  --np-paper: #f7f2e6;
  --np-ink: #1c1a17;
  --np-ink-soft: #6f6a60;
  --np-rule: rgba(28, 26, 23, 0.8);
  --np-rule-thin: rgba(28, 26, 23, 0.35);
  --np-red: #a02c20;
  --np-star: #8a7f4a;
  --np-serif: "Noto Serif SC", "Source Han Serif SC", "SimSun", "Songti SC", serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--np-serif); color: var(--np-ink); }
.np {
  position: relative;
  width: 1280px;
  padding: 40px 56px 32px;
  background: var(--np-paper);
  box-shadow: inset 0 0 0 1px rgba(28,26,23,.15), 0 2px 8px rgba(28,26,23,.2);
}

/* ---------- 报头 ---------- */
.np-masthead-top {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 12px; color: var(--np-ink-soft);
  padding-bottom: 6px; border-bottom: 1px solid var(--np-rule-thin);
}
.np-masthead {
  text-align: center;
  padding: 18px 0 12px;
  border-bottom: 4px double var(--np-rule);
  position: relative;
}
.np-title {
  font-size: 72px; font-weight: 900;
  letter-spacing: .28em; text-indent: .28em;
  line-height: 1.15;
}
.np-title-en {
  font-size: 12px; letter-spacing: .55em; text-indent: .55em;
  color: var(--np-ink-soft);
  font-family: Georgia, "Times New Roman", serif;
  margin-top: 4px;
}
.np-title-seal {
  position: absolute; right: 120px; top: 26px;
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  border: 2.5px solid var(--np-red); border-radius: 6px;
  color: var(--np-red); font-size: 15px; font-weight: 700;
  transform: rotate(8deg); opacity: .78; line-height: 1.15;
  text-align: center;
}
.np-dateline {
  display: flex; justify-content: center; gap: 14px;
  align-items: baseline;
  padding: 8px 0 10px;
  border-bottom: 1px solid var(--np-rule-thin);
  font-size: 15px; letter-spacing: .12em;
}
.np-dateline .np-lunar { color: var(--np-ink-soft); font-size: 14px; }
.np-dateline .np-issue { color: var(--np-red); font-weight: 700; }

/* ---------- 分栏 ---------- */
.np-grid {
  display: grid;
  grid-template-columns: 1fr 1.15fr 1fr;
  padding: 18px 0 6px;
}
.np-col { padding: 0 22px; border-left: 1px solid var(--np-rule-thin); min-width: 0; }
.np-col:first-child { border-left: 0; padding-left: 2px; }
.np-col:last-child { padding-right: 2px; }

.np-section-head {
  display: flex; align-items: center; gap: 10px;
  justify-content: center;
  margin-bottom: 12px;
  font-size: 17px; font-weight: 900; letter-spacing: .3em; text-indent: .3em;
}
.np-section-head::before, .np-section-head::after {
  content: ""; flex: 1; height: 1px;
  background: var(--np-rule-thin);
}
.np-section-head .np-diamond { font-size: 10px; color: var(--np-red); letter-spacing: 0; text-indent: 0; }

/* ---------- 今日要点（资源） ---------- */
.np-collect-lead { font-size: 13px; color: var(--np-ink-soft); text-align: center; margin-bottom: 10px; }
.np-collect-group { margin-bottom: 14px; }
.np-collect-title {
  font-size: 15px; font-weight: 900; letter-spacing: .1em;
  border-left: 3px solid var(--np-red);
  padding-left: 8px; margin-bottom: 6px;
}
.np-collect-list { list-style: none; font-size: 14px; line-height: 1.9; text-align: justify; }
.np-collect-list li { padding-left: 14px; position: relative; }
.np-collect-list li::before { content: "·"; position: absolute; left: 2px; font-weight: 900; }
.np-collect-list b { font-weight: 900; }

/* ---------- 要闻（核心动态） ---------- */
.np-news { display: flex; flex-direction: column; gap: 14px; }
.np-news-item { border-top: 1px solid var(--np-rule-thin); padding-top: 10px; }
.np-news-item:first-child { border-top: 0; padding-top: 0; }
.np-news-tag {
  display: inline-block;
  font-size: 10px; letter-spacing: .2em;
  color: var(--np-paper); background: var(--np-ink);
  padding: 1px 7px; margin-bottom: 5px;
}
.np-news-item--danger .np-news-tag { background: var(--np-red); }
.np-news-title { font-size: 17px; font-weight: 900; line-height: 1.5; text-align: justify; }
.np-news-sub { font-size: 13px; color: var(--np-ink-soft); margin-top: 3px; }
.np-news-sub b { color: var(--np-red); font-weight: 900; }

/* ---------- 生辰启事 ---------- */
.np-birth-list { display: grid; grid-template-columns: repeat(2, 130px); gap: 14px 12px; justify-content: center; }
.np-birth-item {
  width: 130px; text-align: center;
  background: #fffdf6;
  border: 1px solid var(--np-rule);
  padding: 6px 6px 4px;
  box-shadow: 2px 2px 0 rgba(28,26,23,.12);
}
.np-birth-item img {
  display: block; width: 100%; height: 170px;
  object-fit: contain; object-position: center 15%;
  filter: grayscale(1) contrast(1.06);
  margin: 0 auto;
}
.np-birth-name { font-size: 15px; font-weight: 900; letter-spacing: .1em; padding-top: 4px; }
.np-birth-empty { text-align: center; font-size: 14px; color: var(--np-ink-soft); padding: 20px 0; }
.np-birth-note { text-align: center; font-size: 12px; color: var(--np-ink-soft); margin-top: 12px; }

/* ---------- 新增内容 ---------- */
.np-extra { border-top: 4px double var(--np-rule); margin-top: 10px; padding-top: 14px; }
.np-extra-section { margin-bottom: 12px; }
.np-extra-label {
  font-size: 13px; font-weight: 900; letter-spacing: .2em;
  margin-bottom: 6px;
}
.np-extra-label::before { content: "▍"; color: var(--np-red); margin-right: 4px; }
.np-extra-chips { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 14.5px; }
.np-extra-chip { display: inline-flex; align-items: baseline; gap: 6px; }
.np-extra-chip .np-rank { font-family: var(--print); font-size: 11px; letter-spacing: 2px; color: var(--np-star); vertical-align: super; }
.np-extra-chip b { font-weight: 900; }
.np-stage { font-size: 14px; text-align: justify; line-height: 1.7; }
.np-stage b { font-weight: 900; }

/* ---------- 底部 ---------- */
.np-foot {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-top: 16px; padding-top: 8px;
  border-top: 1px solid var(--np-rule-thin);
  font-size: 11.5px; color: var(--np-ink-soft);
  letter-spacing: .08em;
}
`

function escapeHtml(text: string) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function lunarDateText(date: Date) {
  const shifted = new Date(date.getTime() + (480 + date.getTimezoneOffset()) * 60000)
  const lunar = (require('lunar-javascript') as any).Lunar.fromDate(shifted)
  const leap = lunar.getMonth() < 0
  return `农历${leap ? '闰' : ''}${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
}

function issueNumber(date: Date) {
  // 明日方舟国服公测 2019-05-01 起算的期数
  const launch = Date.UTC(2019, 4, 1)
  const days = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - launch) / 86400000)
  return Math.max(1, days + 1)
}

const RANK_CN = ['', '壹', '贰', '叁', '肆', '伍', '陆']

function operatorLine(op: DailyOperator) {
  return `<span class="np-extra-chip"><b>${escapeHtml(op.name)}</b><span class="np-rank">${RANK_CN[op.rarity] || ''}</span></span>`
}

export function renderNewspaperHtml(data: DailyCardData, options: { fontsCssLinks: string }) {
  const theme = getNewspaperTheme(new Date().getDay())
  const themeCss = newspaperThemeVars(theme)
  const collectItems = [
    { title: '物资筹备分区', values: data.collectMaterial },
    { title: '芯片搜索分区', values: data.collectChips },
  ].filter((item) => item.values.length)
  // 「特别开放」窗口首页不列分区，只给一行「全部资源关卡全天开放中」——卡面照搬这一状态
  if (!collectItems.length && data.collectAllOpen) {
    collectItems.push({ title: '特别开放', values: [data.collectAllOpen] })
  }

  const collectHtml = collectItems.map((item) => `
      <div class="np-collect-group">
        <div class="np-collect-title">${escapeHtml(item.title)}</div>
        <ul class="np-collect-list">${item.values.map((value) => `<li><b>${escapeHtml(value)}</b></li>`).join('')}</ul>
      </div>`).join('')

  const newsHtml = data.core.map((item) => `
      <div class="np-news-item np-news-item--${item.urgency}">
        <span class="np-news-tag">${item.urgency === 'danger' ? '快讯' : '预告'}</span>
        <div class="np-news-title">${escapeHtml(item.name)}</div>
        <div class="np-news-sub">将于 <b>${escapeHtml(item.remainingText)}后</b>${escapeHtml(item.action)}</div>
      </div>`).join('')

  const birthHtml = data.birthdays.length
    ? `
      <div class="np-birth-list">${data.birthdays.map((item) => `
        <figure class="np-birth-item">
          <img src="${item.art}" alt="${escapeHtml(item.name)}">
          <figcaption class="np-birth-name">${escapeHtml(item.name)}</figcaption>
        </figure>`).join('')}
      </div>
      <p class="np-birth-note">── 以上干员今日过生日，罗德岛备好蛋糕 ──</p>`
    : `
      <p class="np-birth-empty">今日无干员生日。</p>`

  const stageHtml = data.stageLine
    ? `
    <div class="np-extra-section">
      <div class="np-extra-label">新增关卡</div>
      <p class="np-stage">${escapeHtml(data.stageLine)}</p>
    </div>`
    : ''

  const collectColumn = collectItems.length
    ? `
      <div class="np-section-head"><span class="np-diamond">◆</span>今日要点<span class="np-diamond">◆</span></div>
      <p class="np-collect-lead">${escapeHtml(data.collectIntro)}</p>${collectHtml}`
    : ''

  const newsColumn = data.core.length
    ? `
      <div class="np-section-head"><span class="np-diamond">◆</span>要闻<span class="np-diamond">◆</span></div>
      <div class="np-news">${newsHtml}</div>`
    : ''

  const birthColumn = `
      <div class="np-section-head"><span class="np-diamond">◆</span>生辰启事<span class="np-diamond">◆</span></div>${birthHtml}`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>泰拉晨报</title>
${options.fontsCssLinks}
<style>${NEWSPAPER_CSS}:root{${themeCss}}</style>
</head>
<body>
<main class="np" id="letter">
  <div class="np-masthead-top">
    <span>第 ${issueNumber(new Date())} 期 · 每日一期</span>
    <span>截稿时间：${escapeHtml(data.capturedAtText)}</span>
  </div>
  <div class="np-masthead">
    <div class="np-title">泰拉晨报</div>
    <div class="np-title-en">THE TERRA MORNING POST</div>
    <div class="np-title-seal">日<br>刊</div>
  </div>
  <div class="np-dateline">
    <span>${escapeHtml(data.dateText)}</span>
    <span>${escapeHtml(data.weekText)}</span>
    <span class="np-lunar">${escapeHtml(lunarDateText(new Date()))}</span>
    <span class="np-issue">｜休刊无期</span>
  </div>

  <div class="np-grid">
    <div class="np-col">${collectColumn}</div>
    <div class="np-col">${newsColumn}</div>
    <div class="np-col">${birthColumn}</div>
  </div>

  <div class="np-extra">
    <div class="np-extra-section">
      <div class="np-extra-label">近期新增干员</div>
      <div class="np-extra-chips">${data.recentOperators.map(operatorLine).join('')}</div>
    </div>
    <div class="np-extra-section">
      <div class="np-extra-label">凭证兑换 / 中坚甄选</div>
      <div class="np-extra-chips">${data.poolOperators.map(operatorLine).join('')}</div>
    </div>${stageHtml}
  </div>

  <div class="np-foot">
    <span>截稿时间：${escapeHtml(data.capturedAtText)}</span>
    <span>信息源：prts.wiki</span>
    <span>生成者：miyako-intel</span>
    <span>── 泰拉晨报编辑部 谨呈 ──</span>
  </div>
</main>
</body>
</html>`
}
