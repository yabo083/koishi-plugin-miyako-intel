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
  isTimedInfoDetailNode,
  shouldDiscardOriginalTimedInfoNode,
  buildDailyTerminalStyles,
  getCountdownUrgencyClass,
  shouldRemoveFromCoreColumn,
  shouldRemoveFromStatusColumn,
  extractOperatorNamesFromHtml,
  extractOperatorSummaryItemsFromHtml,
} = require('../lib/services/capture.js')

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

test('generic timed info helpers preserve current PRTS web-event detail', () => {
  const toggle = '<div class="mw-customtoggle-PRTShome_webevent mw-collapsible" id="mw-customcollapsible-PRTShome_webevent">尚有正在进行中的网页活动！</div>'
  const detail = '<div class="mw-collapsible mw-collapsed" id="mw-customcollapsible-PRTShome_webevent"><div style="background:#e1e9ff">网页活动『<a href="/w/足迹">足迹</a>』将于<b><span class="CDScontainer"></span></b>后结束。</div></div>'
  const rendered = '<div class="prts-timed-detail">网页活动『足迹』将于后结束。</div>'

  assert.equal(isTimedInfoDetailNode(toggle), false)
  assert.equal(isTimedInfoDetailNode(detail), true)
  assert.equal(shouldDiscardOriginalTimedInfoNode(toggle), false)
  assert.equal(shouldDiscardOriginalTimedInfoNode(detail), true)
  assert.equal(shouldDiscardOriginalTimedInfoNode(rendered), false)
})

test('buildDailyTerminalStyles uses Rhodes terminal visual system', () => {
  const css = buildDailyTerminalStyles('capture-test')

  assert.match(css, /#1a1c1e/)
  assert.match(css, /#00b2ff/)
  assert.match(css, /#ffcf00/)
  assert.match(css, /grid-template-columns:\s*1fr\s+2fr\s+1fr/)
  assert.match(css, /font-variant-numeric:\s*tabular-nums/)
  assert.match(css, /\.prts-countdown-meter/)
  assert.match(css, /\.prts-timed-detail/)
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

test('buildDailyTerminalStyles accepts custom card theme variables', () => {
  const css = buildDailyTerminalStyles('capture-test', {
    fontFamily: '"Noto Sans SC", sans-serif',
    backgroundColor: '#101418',
    primaryColor: '#7dd3fc',
    warningColor: '#facc15',
    dangerColor: '#fb7185',
    textColor: '#f8fafc',
  })

  assert.match(css, /--prts-font-family:\s*"Noto Sans SC", sans-serif/)
  assert.match(css, /--prts-bg:\s*#101418/)
  assert.match(css, /--prts-primary:\s*#7dd3fc/)
  assert.match(css, /--prts-warning:\s*#facc15/)
  assert.match(css, /--prts-danger:\s*#fb7185/)
  assert.match(css, /--prts-text:\s*#f8fafc/)
  assert.match(css, /font-family:\s*var\(--prts-font-family\)/)
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
  assert.equal(shouldRemoveFromStatusColumn('尚有正在进行中的网页活动！'), true)
  assert.equal(shouldRemoveFromStatusColumn('网页活动『足迹』将于23天后结束。'), true)

  assert.equal(shouldRemoveFromCoreColumn('全局剿灭模拟开放中，24天12小时后结束。'), false)
  assert.equal(shouldRemoveFromCoreColumn('本轮『常驻中坚寻访』将于5小时后结束。'), false)
  assert.equal(shouldRemoveFromCoreColumn('采购凭证区信物即将刷新 18小时+'), false)
  assert.equal(shouldRemoveFromCoreColumn('网页活动『足迹』将于23天后结束。'), false)
})

test('extractOperatorNamesFromHtml reads mp-operators anchor titles', () => {
  const html = `
    <div class="other"><a title="污染项">头像</a></div>
    <div class="mp-operators">
      <a href="/w/%E7%BB%B4%E4%BB%80%E6%88%B4%E5%B0%94" title="维什戴尔"><img alt="头像"></a>
      <a href="/w/%E9%80%BB%E5%90%84%E6%96%AF" title="逻各斯"><img alt="头像"></a>
      <a href="/w/%E7%BB%B4%E4%BB%80%E6%88%B4%E5%B0%94" title="维什戴尔"><img alt="重复"></a>
    </div>`

  assert.deepEqual(extractOperatorNamesFromHtml(html), ['维什戴尔', '逻各斯'])
})

test('extractOperatorSummaryItemsFromHtml keeps operator categories', () => {
  const html = `
    <section>
      <h4>今天生日</h4>
      <div class="mp-operators">
        <a title="艾雅法拉"></a>
        <a title="煌"></a>
      </div>
    </section>
    <section>
      <h4>新增模组</h4>
      <div class="mp-operators">
        <a title="令"></a>
      </div>
    </section>`

  assert.deepEqual(extractOperatorSummaryItemsFromHtml(html), [
    '今日生日干员：艾雅法拉、煌',
    '新增模组干员：令',
  ])
})

test('extractOperatorSummaryItemsFromHtml scopes category labels to each operator block', () => {
  const html = `
    <section>
      <h2>亮点干员</h2>
      <div>
        <p>今日生日</p>
        <div class="mp-operators"><a title="艾雅法拉"></a><a title="煌"></a></div>
      </div>
      <div>
        <p>新增模组</p>
        <div class="mp-operators"><a title="令"></a><a title="澄闪"></a></div>
      </div>
      <div>
        <p>常驻标准寻访</p>
        <div class="mp-operators"><a title="能天使"></a><a title="推进之王"></a></div>
      </div>
    </section>`

  assert.deepEqual(extractOperatorSummaryItemsFromHtml(html), [
    '今日生日干员：艾雅法拉、煌',
    '新增模组干员：令、澄闪',
    '寻访亮点干员：能天使、推进之王',
  ])
})

test('extractOperatorSummaryItemsFromHtml splits PRTS mp-operators content groups', () => {
  const html = `
    <div class="mp-operators">
      <div class="mp-operators-content">
        <div class="mp-operators-title">今天生日</div>
        <div class="mp-operators-icons"><a title="仇白"></a><a title="刺玫"></a></div>
      </div>
      <div class="mp-operators-content">
        <div class="mp-operators-title">近期新增</div>
        <div class="mp-operators-icons"><a title="维伊"></a><a title="可露希尔"></a></div>
      </div>
      <div class="mp-operators-content">
        <div class="mp-operators-title">凭证兑换</div>
        <div class="mp-operators-icons"><a title="左乐"></a><a title="杏仁"></a></div>
      </div>
      <div class="mp-operators-content">
        <div class="mp-operators-title">中坚甄选</div>
        <div class="mp-operators-icons"><a title="卡池一览"></a></div>
      </div>
      <div class="mp-operators-content">
        <div class="mp-operators-title">新增时装</div>
        <div class="mp-operators-icons"><a title="阿罗玛"></a><a title="新约能天使"></a></div>
      </div>
      <div class="mp-operators-content">
        <div class="mp-operators-title">新增模组</div>
        <div class="mp-operators-icons"><a title="维伊#军械库"></a><a title="裂响#漂洗"></a></div>
      </div>
    </div>`

  assert.deepEqual(extractOperatorSummaryItemsFromHtml(html), [
    '今日生日干员：仇白、刺玫',
    '近期新增干员：维伊、可露希尔',
    '凭证兑换干员：左乐、杏仁',
    '中坚甄选干员：卡池一览',
    '新增时装干员：阿罗玛、新约能天使',
    '新增模组干员：维伊#军械库、裂响#漂洗',
  ])
})
