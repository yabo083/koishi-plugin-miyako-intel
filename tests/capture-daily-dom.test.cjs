const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseRefreshHours,
  shouldHighlightRefresh,
  normalizeHeadingText,
  isNoiseNodeText,
  DAILY_CAPTURE_ID,
  isRedcertDetailNode,
  hasRedcertRawDetailText,
  extractRedcertDetailHtmlFromHtml,
  shouldDiscardOriginalRedcertNode,
  buildDailyTerminalStyles,
  getCountdownUrgencyClass,
  shouldRemoveFromCoreColumn,
  shouldRemoveFromStatusColumn,
} = require('../dist/services/capture.js')

test('parseRefreshHours parses day+hour+minute text', () => {
  const h = parseRefreshHours('1天15小时34分钟后刷新')
  assert.equal(h, 39.56666666666667)
})

test('shouldHighlightRefresh highlights when <72h', () => {
  assert.equal(shouldHighlightRefresh(71.9), true)
  assert.equal(shouldHighlightRefresh(72), false)
})

test('getCountdownUrgencyClass maps remaining hours to visual urgency', () => {
  assert.equal(getCountdownUrgencyClass(96), 'safe')
  assert.equal(getCountdownUrgencyClass(24), 'warn')
  assert.equal(getCountdownUrgencyClass(5.5), 'danger')
})

test('normalizeHeadingText trims extra spaces', () => {
  assert.equal(normalizeHeadingText('  亮点干员  '), '亮点干员')
})

test('isNoiseNodeText catches static-image noise labels', () => {
  assert.equal(isNoiseNodeText('[查看详情]'), true)
  assert.equal(isNoiseNodeText('↑'), true)
  assert.equal(isNoiseNodeText('TOP'), true)
  assert.equal(isNoiseNodeText('正常正文'), false)
})

test('daily capture id constant is v2', () => {
  assert.equal(DAILY_CAPTURE_ID, 'prts-capture-daily-v2')
})

test('isRedcertDetailNode should keep detail panel even with duplicate id', () => {
  const toggleHtml = '<div id="mw-customcollapsible-redcert_warn" class="mw-customtoggle-redcert_warn">采购凭证区信物即将刷新 <span class="mdi mdi-chevron-down"></span></div>'
  const detailHtml = '<div id="mw-customcollapsible-redcert_warn" class="mw-collapsible mw-collapsed"><div>采购凭证区的信物库存将于1天后刷新。以下信物将会被刷新：A、B、C。</div></div>'

  assert.equal(isRedcertDetailNode(toggleHtml), false)
  assert.equal(isRedcertDetailNode(detailHtml), true)
})

test('hasRedcertRawDetailText should match tag-split detail text', () => {
  const splitText = '采购凭证区的信物库存将于后刷新。以下信物将会被刷新：6★皇家信物'
  assert.equal(hasRedcertRawDetailText(splitText), true)
})

test('hasRedcertRawDetailText should match multiline detail text', () => {
  const multiline = '采购凭证区\n的\n信物库存\n将于后刷新。\n以下信物将会被刷新：\nA'
  assert.equal(hasRedcertRawDetailText(multiline), true)
})

test('extractRedcertDetailHtmlFromHtml extracts PRTS custom timed collapse detail', () => {
  const html = `
    <span class="TLDcontainer" style="display:none" data-time="1,2">
      <div class="mw-customtoggle-redcert_warn mw-collapsible" id="mw-customcollapsible-redcert_warn">采购凭证区信物即将刷新</div>
      <div class="mw-customtoggle-redcert_warn mw-collapsible mw-collapsed" id="mw-customcollapsible-redcert_warn">采购凭证区信物即将刷新</div>
      <div class="mw-collapsible mw-collapsed" id="mw-customcollapsible-redcert_warn">
        <div>采购凭证区的<b>信物库存</b>将于<span class="CDScontainer"></span>后刷新。<br>以下信物将会被刷新：<br>6★皇家信物：特种、近卫</div>
      </div>
    </span>`

  const detail = extractRedcertDetailHtmlFromHtml(html)

  assert.match(detail, /采购凭证区的/)
  assert.match(detail, /以下信物将会被刷新/)
  assert.doesNotMatch(detail, /mw-customtoggle-redcert_warn/)
})

test('isRedcertDetailNode distinguishes raw detail from toggle bars for removal', () => {
  const expandedToggle = '<div class="mw-customtoggle-redcert_warn mw-collapsible" id="mw-customcollapsible-redcert_warn">采购凭证区信物即将刷新</div>'
  const collapsedToggle = '<div class="mw-customtoggle-redcert_warn mw-collapsible mw-collapsed" id="mw-customcollapsible-redcert_warn">采购凭证区信物即将刷新</div>'
  const rawDetail = '<div class="mw-collapsible mw-collapsed" id="mw-customcollapsible-redcert_warn"><div>采购凭证区的<b>信物库存</b>将于<span class="CDScontainer"></span>后刷新。<br>以下信物将会被刷新：</div></div>'

  assert.equal(isRedcertDetailNode(expandedToggle), false)
  assert.equal(isRedcertDetailNode(collapsedToggle), false)
  assert.equal(isRedcertDetailNode(rawDetail), true)
})

test('shouldDiscardOriginalRedcertNode removes only raw duplicated detail', () => {
  const toggle = '<div class="mw-customtoggle-redcert_warn mw-collapsible" id="mw-customcollapsible-redcert_warn">采购凭证区信物即将刷新</div>'
  const rawDetail = '<div class="mw-collapsible mw-collapsed" id="mw-customcollapsible-redcert_warn"><div>采购凭证区的<b>信物库存</b>将于<span class="CDScontainer"></span>后刷新。<br>以下信物将会被刷新：</div></div>'
  const renderedDetail = '<div class="prts-redcert-detail">采购凭证区的<b>信物库存</b>将于后刷新。以下信物将会被刷新：</div>'
  const ancestor = `<div>${rawDetail}</div>`

  assert.equal(shouldDiscardOriginalRedcertNode(toggle), false)
  assert.equal(shouldDiscardOriginalRedcertNode(rawDetail), true)
  assert.equal(shouldDiscardOriginalRedcertNode(renderedDetail), false)
  assert.equal(shouldDiscardOriginalRedcertNode(ancestor), false)
})

test('buildDailyTerminalStyles uses Rhodes terminal visual system', () => {
  const css = buildDailyTerminalStyles('capture-test')

  assert.match(css, /#1a1c1e/)
  assert.match(css, /#00b2ff/)
  assert.match(css, /#ffcf00/)
  assert.match(css, /grid-template-columns:\s*1fr\s+2fr\s+1fr/)
  assert.match(css, /font-variant-numeric:\s*tabular-nums/)
  assert.match(css, /\.prts-countdown-meter/)
  assert.match(css, /\.prts-terminal-column/)
  assert.match(css, /\.prts-card--core/)
  assert.match(css, /\.prts-card--status/)
  assert.match(css, /linear-gradient\(90deg,\s*rgba\(96,16,24/)
  assert.match(css, /\.prts-golden-header::before/)
  assert.doesNotMatch(css, /\.prts-card::before/)
  assert.doesNotMatch(css, /\.prts-card::after/)
  assert.match(css, /\.prts-credit-bar/)
  assert.doesNotMatch(css, /#7d1020/)
})

test('today split keeps resource collection even when it mentions purchase certificates', () => {
  const resourceLine = '物资筹备分区：作战记录 / 采购凭证 / 龙门币'
  const chipLine = '芯片搜索分区：医疗&重装 / 先锋&辅助 职业芯片(组)'
  const voucherLine = '资质凭证采购将于今晚刷新。'

  assert.equal(shouldRemoveFromStatusColumn(resourceLine), false)
  assert.equal(shouldRemoveFromStatusColumn(chipLine), false)
  assert.equal(shouldRemoveFromStatusColumn(voucherLine), false)

  assert.equal(shouldRemoveFromCoreColumn(resourceLine), true)
  assert.equal(shouldRemoveFromCoreColumn(chipLine), true)
  assert.equal(shouldRemoveFromCoreColumn(voucherLine), true)
})

test('today split sends combat dynamics to core column only', () => {
  assert.equal(shouldRemoveFromStatusColumn('全局剿灭模拟开放中，24天12小时后结束。'), true)
  assert.equal(shouldRemoveFromStatusColumn('本轮『常驻中坚寻访』将于5小时后结束。'), true)
  assert.equal(shouldRemoveFromStatusColumn('采购凭证区信物即将刷新 18小时+'), true)
  assert.equal(shouldRemoveFromStatusColumn('采购凭证区的信物库存将于18小时后刷新。'), true)

  assert.equal(shouldRemoveFromCoreColumn('全局剿灭模拟开放中，24天12小时后结束。'), false)
  assert.equal(shouldRemoveFromCoreColumn('本轮『常驻中坚寻访』将于5小时后结束。'), false)
  assert.equal(shouldRemoveFromCoreColumn('采购凭证区信物即将刷新 18小时+'), false)
})
