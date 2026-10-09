// 「今日信笺」卡片渲染：数据 → 完整 HTML（file:// 加载后截图 #letter）
// 版式与 design/letter-prototype 保持一致；字体从渲染目录的字体文件相对引用。

import { DailyCardData, SealSlot } from './card-types'
import { renderNewspaperHtml } from './card-newspaper'
import { renderWeeklyHtml } from './card-weekly'

// ==================== 日报风格注册表 ====================
// 新增风格：实现 render(data, options) 并注册进 CARD_STYLES，配置下拉自动出现新选项。
export interface CardStyle {
  id: string
  label: string
  /** 卡片自己的名字（不带风格注脚），回退文案里会引用它，如「今日的『泰拉周刊』」 */
  shortLabel: string
  render: (data: DailyCardData, options: { fontsCssLinks: string }) => string
  /** 版式需要「近期新增 / 凭证甄选」干员的头像时置为 true，抓取阶段才会去拉头像 */
  needsOperatorAvatars?: boolean
}

export const CARD_STYLES: Record<string, CardStyle> = {
  letter: { id: 'letter', label: '今日信笺（手账风）', shortLabel: '今日信笺', render: renderCardHtml },
  weekly: { id: 'weekly', label: '泰拉周刊（夜间书脊）', shortLabel: '泰拉周刊', render: renderWeeklyHtml, needsOperatorAvatars: true },
  newspaper: { id: 'newspaper', label: '泰拉晨报（报纸风）', shortLabel: '泰拉晨报', render: renderNewspaperHtml },
}

export function resolveCardStyle(styleId: string | undefined): CardStyle {
  return CARD_STYLES[styleId || ''] ?? CARD_STYLES.letter
}

export function renderCardByStyle(styleId: string | undefined, data: DailyCardData, options: { fontsCssLinks: string }): string {
  return resolveCardStyle(styleId).render(data, options)
}

// 农历日期印章：如「七月初九」→ 右上七、右下月、左上初、左下九（传统右起竖读）
export function buildSealSlots(date: Date): SealSlot[] {
  // lunar-javascript 按本地时区解析，先平移到东八区墙钟
  const shifted = new Date(date.getTime() + (480 + date.getTimezoneOffset()) * 60000)
  const lunar = (require('lunar-javascript') as any).Lunar.fromDate(shifted)
  const leap = lunar.getMonth() < 0
  const text = (leap ? '闰' : lunar.getMonthInChinese() + '月') + lunar.getDayInChinese()
  const positions = [[71, 29], [71, 71], [29, 29], [29, 71]]
  return Array.from(text).slice(0, 4).map((ch, index) => ({ ch, x: positions[index][0], y: positions[index][1] }))
}

const SEAL_SLOT_XY: Record<string, { x: number; y: number }> = {
  '0': { x: 71, y: 29 },
  '1': { x: 71, y: 71 },
  '2': { x: 29, y: 29 },
  '3': { x: 29, y: 71 },
}

function stampSvg(slots: SealSlot[]) {
  const texts = slots.map((slot) => `<text x="${slot.x}" y="${slot.y}" text-anchor="middle" dominant-baseline="central" font-family="'LXGW WenKai Lite','KaiTi',serif" font-weight="700" font-size="23" fill="#c34a3a">${slot.ch}</text>`).join('')
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs><filter id="rough-stamp" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/>
  </filter></defs>
  <g filter="url(#rough-stamp)">
    <rect x="5" y="5" width="90" height="90" rx="7" fill="none" stroke="#c34a3a" stroke-width="4.5"/>
    <path d="M 50 8 V 92 M 8 50 H 92" stroke="#c34a3a" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.65"/>
    ${texts}
  </g>
</svg>`
}

const CARD_CSS = `
:root {
  --paper: #f8f3e7;
  --paper-edge: #efe7d5;
  --ink: #40382e;
  --ink-soft: #8a7f6f;
  --line: rgba(64, 56, 46, 0.14);
  --red: #c34a3a;
  --red-soft: rgba(195, 74, 58, 0.12);
  --teal: #4f8578;
  --gold: #c99b3f;
  --hand: "LXGW WenKai Lite", "Kaiti SC", "KaiTi", "STKaiti", serif;
  --print: "PingFang SC", "MiSans", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--print); color: var(--ink); }
.letter {
  position: relative;
  width: 1280px;
  padding: 56px 64px 40px;
  background: linear-gradient(180deg, rgba(255,255,255,.5), transparent 120px), var(--paper);
  border: 1px solid var(--paper-edge);
  overflow: hidden;
}
.letter::before { content: ""; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 60px rgba(160,140,100,.12); }
.tape { position: absolute; width: 150px; height: 34px; background: rgba(79,133,120,.32); border-left: 1px dashed rgba(255,255,255,.5); border-right: 1px dashed rgba(255,255,255,.5); box-shadow: 0 1px 3px rgba(64,56,46,.12); }
.tape--head { left: -34px; top: 26px; transform: rotate(-12deg); }
.letter-head { position: relative; display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 18px; border-bottom: 2px solid var(--ink); margin-bottom: 30px; }
.letter-head::after { content: ""; position: absolute; left: 0; right: 0; bottom: -5px; border-bottom: 1px solid var(--ink); }
.letter-brand { font-size: 11px; letter-spacing: .35em; color: var(--ink-soft); margin-bottom: 6px; }
.letter-title { font-family: var(--hand); font-weight: 700; font-size: 46px; letter-spacing: .12em; line-height: 1.1; }
.letter-date { text-align: right; font-family: var(--hand); line-height: 1.3; }
.letter-date-day { display: block; font-size: 26px; font-weight: 700; }
.letter-date-week { display: block; font-size: 16px; color: var(--ink-soft); }
.stamp-item { position: absolute; opacity: .9; filter: drop-shadow(0 2px 3px rgba(64,56,46,.25)); }
.stamp-item svg { display: block; width: 100%; height: auto; }
.section { margin-bottom: 34px; }
.hand-heading { font-family: var(--hand); font-size: 27px; font-weight: 700; letter-spacing: .08em; margin-bottom: 12px; }
.hand-doodle { margin-right: 8px; font-size: 22px; }
.print-heading { display: flex; align-items: baseline; gap: 10px; font-size: 18px; font-weight: 700; letter-spacing: .28em; margin-bottom: 12px; }
.print-heading-en { font-size: 10px; letter-spacing: .3em; color: var(--ink-soft); font-weight: 400; }
.handwriting { font-family: var(--hand); }
.collect-block { padding: 18px 22px 20px; border-radius: 6px; background: repeating-linear-gradient(180deg, transparent 0, transparent 37px, var(--line) 37px, var(--line) 38px), rgba(255,255,255,.42); border: 1px solid rgba(64,56,46,.1); font-size: 19px; line-height: 38px; }
.collect-line { color: var(--ink-soft); font-size: 17px; }
.collect-list { list-style: none; }
.collect-item { position: relative; padding-left: 34px; }
.checkbox { position: absolute; left: 2px; top: 9px; width: 20px; height: 20px; border: 2px solid var(--ink); border-radius: 4px; background: #fff; }
.checkbox::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--red); font-size: 15px; font-weight: 700; transform: rotate(-6deg); }
.collect-item b { color: var(--teal); font-weight: 700; }
.core-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.core-item { display: flex; align-items: center; gap: 14px; padding: 13px 18px; background: rgba(255,255,255,.55); border: 1px solid rgba(64,56,46,.12); border-left: 4px solid var(--ink-soft); border-radius: 5px; font-size: 16px; }
.core-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--ink-soft); }
.core-item--warn { border-left-color: var(--gold); }
.core-item--warn .core-dot { background: var(--gold); }
.core-item--danger { border-left-color: var(--red); }
.core-item--danger .core-dot { background: var(--red); }
.core-count { display: inline-block; margin: 0 2px; padding: 1px 8px; border-radius: 4px; background: var(--red-soft); color: var(--red); font-weight: 700; font-variant-numeric: tabular-nums; }
.core-item--warn .core-count { background: rgba(201,155,63,.14); color: #9a7226; }
.section--birthday { position: relative; padding: 22px 24px 16px; border: 1px dashed rgba(64,56,46,.28); border-radius: 8px; background-image: radial-gradient(rgba(195,74,58,.07) 2px, transparent 2px); background-size: 26px 26px; }
.collage { position: relative; height: 300px; }
.sticker { position: absolute; width: 168px; padding: 7px 7px 6px; background: #fffdf8; border: 1px solid rgba(64,56,46,.14); box-shadow: 0 3px 10px rgba(64,56,46,.22); transform: rotate(var(--tilt, 0deg)); }
.sticker img { display: block; width: 100%; height: 212px; object-fit: contain; object-position: top center; }
.sticker::before { content: ""; position: absolute; top: -11px; left: 50%; width: 62px; height: 18px; transform: translateX(-50%) rotate(var(--tape-tilt, -3deg)); background: var(--tape-color, rgba(195,74,58,.35)); box-shadow: 0 1px 2px rgba(64,56,46,.15); }
.sticker-name { margin-top: 5px; text-align: center; font-size: 20px; font-weight: 400; color: var(--ink); }
.signature { font-family: "Zhi Mang Xing", var(--hand); }
.collage-note { margin-top: 10px; text-align: center; font-size: 16px; color: var(--ink-soft); }
.recent-group { margin-bottom: 14px; }
.recent-label { font-size: 12px; letter-spacing: .22em; color: var(--ink-soft); margin-bottom: 8px; }
.recent-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 5px 14px; font-size: 14px; background: rgba(255,255,255,.6); border: 1px solid rgba(64,56,46,.16); border-radius: 999px; }
/* 干员胶囊：稀有度色框；星星以极简角注形式置于右下（V12） */
.chip--operator { position: relative; display: inline-block; padding: 2px 40px 4px 22px; font-family: "Zhi Mang Xing", var(--hand); font-size: 23px; line-height: 1.3; color: var(--ink); background: color-mix(in srgb, var(--rarity-color, var(--ink)) 6%, rgba(255,255,255,.5)); border: 1.5px solid color-mix(in srgb, var(--rarity-color, var(--ink)) 78%, transparent); border-radius: 999px; }
.chip-stars { position: absolute; right: 12px; bottom: 2px; font-style: normal; font-family: var(--print); font-size: 9.5px; letter-spacing: 1px; color: color-mix(in srgb, #e8b93c 80%, var(--ink) 20%); opacity: .9; }
.recent-stage { font-size: 14px; line-height: 1.6; }
.letter-foot { display: flex; align-items: baseline; gap: 26px; padding-top: 14px; border-top: 1px solid rgba(64,56,46,.2); font-size: 12px; color: var(--ink-soft); }
.letter-sign { margin-left: auto; font-size: 16px; }
`

const LAYOUT_SCRIPT = `
(function () {
  var RARITY_COLORS = { 6: "#d08a2e", 5: "#e0b73e", 4: "#9b7fd4", 3: "#5b9bd5", 2: "#9a9a90", 1: "#9a9a90" };

  function renderChips(rootId, list) {
    var root = document.querySelector('.recent-chips[data-group="' + rootId + '"]');
    if (!root) return;
    list.forEach(function (op) {
      var chip = document.createElement('span');
      chip.className = 'chip chip--operator';
      chip.style.setProperty('--rarity-color', RARITY_COLORS[op.rarity] || RARITY_COLORS[2]);
      chip.innerHTML = op.name + '<i class="chip-stars">' + '★'.repeat(op.rarity) + '</i>';
      root.appendChild(chip);
    });
  }

  function layoutCollage() {
    var root = document.getElementById('collage');
    if (!root) return;
    root.innerHTML = '';
    var stickers = (window.CARD_DATA || {}).birthdays || [];
    var CARD_W = 168;
    var STEP = Math.round(CARD_W * 0.8);
    var containerW = root.clientWidth || 1104;
    var perRow = Math.max(1, Math.floor((containerW - CARD_W) / STEP) + 1);
    var cards = stickers.map(function (s) {
      var card = document.createElement('figure');
      card.className = 'sticker';
      card.style.setProperty('--tilt', s.tilt + 'deg');
      card.style.setProperty('--tape-color', s.tape);
      card.style.setProperty('--tape-tilt', (s.tilt > 0 ? 4 : -4) + 'deg');
      var img = document.createElement('img');
      img.src = s.art;
      img.alt = s.name;
      var name = document.createElement('figcaption');
      name.className = 'sticker-name signature';
      name.textContent = s.name;
      card.appendChild(img);
      card.appendChild(name);
      return card;
    });
    if (!cards.length) return;
    var cardH = cards[0].offsetHeight || 276;
    var rowGap = 18;
    var rows = Math.ceil(stickers.length / perRow);
    stickers.forEach(function (s, i) {
      var row = Math.floor(i / perRow);
      var indexInRow = i % perRow;
      var inRow = Math.min(perRow, stickers.length - row * perRow);
      var rowSpan = CARD_W + (inRow - 1) * STEP;
      var left0 = Math.max(0, (containerW - rowSpan) / 2);
      var card = cards[i];
      card.style.left = (left0 + indexInRow * STEP) + 'px';
      card.style.top = (row * (cardH + rowGap)) + 'px';
      card.style.zIndex = i + 1;
      card.style.opacity = indexInRow === 0 ? 1 : Math.max(0.8, 1 - 0.05 * ((i % perRow) + row));
      card.style.marginTop = (indexInRow % 2 === 1 ? -16 : 6 + row * 4) + 'px';
      root.appendChild(card);
    });
    root.style.height = (rows * (cardH + rowGap)) + 'px';
  }

  renderChips('recent', (window.CARD_DATA || {}).recentOperators || []);
  renderChips('pool', (window.CARD_DATA || {}).poolOperators || []);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { layoutCollage(); setTimeout(layoutCollage, 250); });
  } else {
    layoutCollage();
  }
})();
`

function escapeHtml(text: string) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function boldQuoted(text: string) {
  return escapeHtml(text).replace(/(『[^』]+』)/g, '<b>$1</b>')
}

export function renderCardHtml(data: DailyCardData, options: { fontsCssLinks: string }) {
  const collectItems = [
    { label: '物资筹备分区', values: data.collectMaterial },
    { label: '芯片搜索分区', values: data.collectChips },
  ].filter((item) => item.values.length)
  // 「特别开放」窗口首页不列分区，只给一行「全部资源关卡全天开放中」——卡面照搬这一状态
  if (!collectItems.length && data.collectAllOpen) {
    collectItems.push({ label: '特别开放', values: [data.collectAllOpen] })
  }

  const coreHtml = data.core.map((item) => `
      <li class="core-item core-item--${item.urgency}">
        <span class="core-dot"></span>
        <div class="core-text">${boldQuoted(item.name)}
          <span class="core-count">${escapeHtml(item.remainingText)}后</span>${escapeHtml(item.action)}
        </div>
      </li>`).join('')

  const collectHtml = collectItems.map((item) => `
        <li class="collect-item collect-item--checked">
          <span class="checkbox"></span>${escapeHtml(item.label)}：
          <b>${item.values.map(escapeHtml).join(' · ')}</b>
        </li>`).join('')

  const birthdaySection = data.birthdays.length
    ? `
  <section class="section section--birthday">
    <h2 class="hand-heading"><span class="hand-doodle">🎂</span> 今天生日<span class="print-heading-en">${escapeHtml(data.dateText)}</span></h2>
    <div class="collage" id="collage"></div>
    <p class="collage-note handwriting">—— 祝${data.birthdays.length}位干员生日快乐，罗德岛请客吃蛋糕 ──</p>
  </section>`
    : ''

  const stageHtml = data.stageLine
    ? `
    <div class="recent-group">
      <p class="recent-label">新增关卡</p>
      <p class="recent-stage">${escapeHtml(data.stageLine)}</p>
    </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>明日方舟 · 今日信笺</title>
${options.fontsCssLinks}
<style>${CARD_CSS}</style>
</head>
<body>
<main class="letter" id="letter">
  <header class="letter-head">
    <div class="tape tape--head"></div>
    <div class="letter-head-text">
      <p class="letter-brand">ARKNIGHTS · DAILY LETTER</p>
      <h1 class="letter-title">今日信笺</h1>
    </div>
    <div class="letter-date">
      <span class="letter-date-day">${escapeHtml(data.dateText)}</span>
      <span class="letter-date-week">${escapeHtml(data.weekText)}</span>
    </div>
    <div class="stamp-item" style="left: 1023px; top: 51px; width: 78px; transform: rotate(-9deg);">${stampSvg(data.sealSlots)}</div>
  </header>

  <section class="section section--collect">
    <h2 class="hand-heading"><span class="hand-doodle">✎</span> 今天可以收集</h2>
    <div class="handwriting collect-block">
      <p class="collect-line">${escapeHtml(data.collectIntro)}</p>
      <ul class="collect-list">${collectHtml}
      </ul>
    </div>
  </section>

  <section class="section section--core">
    <h2 class="print-heading">核心动态<span class="print-heading-en">ACTIVE</span></h2>
    <ul class="core-list">${coreHtml}
    </ul>
  </section>
${birthdaySection}
  <section class="section section--recent">
    <h2 class="print-heading">近期新增<span class="print-heading-en">RECENT</span></h2>
    <div class="recent-group">
      <p class="recent-label">近期新增干员</p>
      <div class="recent-chips" data-group="recent"></div>
    </div>
    <div class="recent-group">
      <p class="recent-label">凭证兑换 / 中坚甄选</p>
      <div class="recent-chips" data-group="pool"></div>
    </div>${stageHtml}
  </section>

  <footer class="letter-foot">
    <span>抓取时间：${escapeHtml(data.capturedAtText)}</span>
    <span>信息源：prts.wiki</span>
    <span>生成者：miyako-intel</span>
    <span class="handwriting letter-sign">—— 裁纸为笺，见字如面</span>
  </footer>
</main>
<script>window.CARD_DATA = ${JSON.stringify({
    birthdays: data.birthdays,
    recentOperators: data.recentOperators,
    poolOperators: data.poolOperators,
  })};</script>
<script>${LAYOUT_SCRIPT}</script>
</body>
</html>`
}
