const assert = require('node:assert/strict')
const test = require('node:test')

const {
  compressStageCodes,
  formatRemainingText,
  mapRawToDailyCard,
  parseCoreItem,
  splitCollectValues,
} = require('../lib/services/capture.js')
const { renderCardHtml } = require('../lib/services/card-template.js')

const NOW = new Date('2026-08-30T12:00:00+08:00')

const RAW_FIXTURE = {
  groups: [
    {
      title: '今天生日',
      entries: [
        { name: '火龙S黑角', avatar: 'https://media.prts.wiki/avatar1.png', rarity: 5 },
        { name: '特克诺', avatar: '', rarity: 5 },
      ],
    },
    {
      title: '近期新增',
      entries: [
        { name: '珊比', avatar: '', rarity: 6 },
        { name: '时隙', avatar: '', rarity: 5 },
      ],
    },
    {
      title: '凭证兑换',
      entries: [
        { name: '提丰', avatar: '', rarity: 6 },
        { name: '卡池一览', avatar: '', rarity: 0 },
      ],
    },
    {
      title: '中坚甄选',
      entries: [{ name: '云迹', avatar: '', rarity: 4 }],
    },
  ],
  todayParagraphs: [
    '现在时间：8月30日(星期六) 20:00。',
    '今日资源收集物资筹备分区：作战记录 / 采购凭证 / 龙门币 / 技巧概要芯片搜索分区：医疗&重装 / 近卫&特种 / 先锋&辅助 职业芯片(组)',
  ],
  coreItems: [
    { text: '剿灭作战 & 周常任务（含特勤任务）将于7小时17分钟后刷新。', epoch: Math.floor(NOW.getTime() / 1000) + 7 * 3600 + 17 * 60 },
    { text: '活动『墟·复刻』将于1天7小时16分钟后结束。', epoch: Math.floor(NOW.getTime() / 1000) + 31 * 3600 },
    { text: '已过期的活动将于1小时前结束。', epoch: Math.floor(NOW.getTime() / 1000) - 3600 },
  ],
  stageBlocks: [
    {
      title: '新增关卡',
      lead: 'SideStory 「直到大地变成一颗酸橙」',
      groups: [
        { title: '踏上归家长途', codes: ['TO-EX-1 电影防沉迷', 'TO-EX-2 邮包流水线', 'TO-EX-3 地下捉迷藏', 'TO-EX-8 有袋鼷兽奇遇'] },
        { title: '眺望待行之路', codes: ['TO-S-1 邮箱保卫战', 'TO-S-4 “家族聚会”', 'TO-MO-1 大涌泉镇盛宴'] },
        { title: '奇象巡展', codes: ['EE-01 奇象收录时间！', 'EE-02 奇象收录时间！'] },
      ],
    },
  ],
}

test('mapRawToDailyCard builds the letter card data from raw homepage extract', () => {
  const card = mapRawToDailyCard(RAW_FIXTURE, { now: NOW })

  assert.equal(card.dateText, '8月30日')
  assert.equal(card.weekText, '星期日')
  assert.deepEqual(card.collectMaterial, ['作战记录', '采购凭证', '龙门币', '技巧概要'])
  assert.deepEqual(card.collectChips, ['医疗&重装', '近卫&特种', '先锋&辅助 职业芯片(组)'])

  assert.equal(card.core.length, 2)
  assert.equal(card.core[0].name, '剿灭作战 & 周常任务（含特勤任务）')
  assert.equal(card.core[0].action, '刷新')
  assert.equal(card.core[0].remainingText, '7小时17分钟')
  assert.equal(card.core[0].urgency, 'danger')
  assert.equal(card.core[1].remainingText, '1天7小时')
  assert.equal(card.core[1].urgency, 'warn')

  assert.deepEqual(card.birthdays.map((item) => item.name), ['火龙S黑角', '特克诺'])
  assert.equal(card.birthdays[0].art, '')
  assert.equal(card.recentOperators.length, 2)
  assert.equal(card.recentOperators[0].rarity, 6)
  assert.deepEqual(card.poolOperators.map((item) => item.name), ['提丰', '云迹'])
  // 关卡按 PRTS 首页的分组保留：活动名 + 每个关卡集各自的号段
  assert.equal(card.stageTitle, 'SideStory 「直到大地变成一颗酸橙」')
  assert.deepEqual(card.stageGroups, [
    { title: '踏上归家长途', codes: 'TO-EX-1、TO-EX-2、TO-EX-3、TO-EX-8' },
    { title: '眺望待行之路', codes: 'TO-S-1、TO-S-4 / TO-MO-1' },
    { title: '奇象巡展', codes: 'EE-01 ~ EE-02' },
  ])
  assert.match(card.stageLine, /SideStory 「直到大地变成一颗酸橙」/)
  assert.match(card.stageLine, /踏上归家长途（TO-EX-1、TO-EX-2、TO-EX-3、TO-EX-8）/)
  assert.match(card.stageLine, /奇象巡展（EE-01 ~ EE-02）/)
})

// 2026-10-09 矢量突破#3：号段带字母后缀（VEC-SP01）与整段字母（VEC-A），旧压缩只认「前缀-纯数字」把它们丢了
test('compressStageCodes keeps letter-suffixed and pure-letter stage codes', () => {
  assert.equal(
    compressStageCodes(['VEC-01', 'VEC-02', 'VEC-12']),
    'VEC-01、VEC-02、VEC-12')
  assert.equal(
    compressStageCodes(['VEC-01', 'VEC-02', 'VEC-03']),
    'VEC-01 ~ VEC-03')
  assert.equal(
    compressStageCodes(['VEC-SP01', 'VEC-SP03', 'VEC-SP02']),
    'VEC-SP01 ~ VEC-SP03')
  assert.equal(
    compressStageCodes(['VEC-A', 'VEC-B', 'VEC-C', 'VEC-D']),
    'VEC-A ~ VEC-D')
  assert.equal(
    compressStageCodes(['VEC-A', 'VEC-C']),
    'VEC-A、VEC-C')
  // 数字段与字母段同前缀时不能互相吞并
  assert.equal(
    compressStageCodes(['VEC-01', 'VEC-02', 'VEC-A']),
    'VEC-01 ~ VEC-02 / VEC-A')
  // 认不出来的写法原样留着，不静默丢
  assert.equal(compressStageCodes(['VEC-01B']), 'VEC-01B')
})

test('mapRawToDailyCard keeps every stage group of a 矢量突破 style board', () => {
  const card = mapRawToDailyCard({
    ...RAW_FIXTURE,
    stageBlocks: [
      {
        title: '新增关卡',
        lead: '矢量突破#3 「拟生态」',
        groups: [
          { title: '核心突破', codes: Array.from({ length: 12 }, (_, i) => `VEC-${String(i + 1).padStart(2, '0')} 关卡`) },
          { title: '全力以赴', codes: ['VEC-A 卓绝之巅', 'VEC-B 高优先通道', 'VEC-C 惊吓幕后', 'VEC-D 挽救治疗'] },
          { title: '特别战线', codes: ['VEC-SP01 重力危机', 'VEC-SP02 心中热火', 'VEC-SP03 馆藏珍品', 'VEC-SP09 人气巡演', 'VEC-SP10 后院死局', 'VEC-SP04 明星靶场', 'VEC-SP11 影院出口', 'VEC-SP12 四号站台', 'VEC-SP05 难以相交', 'VEC-SP06 林间小憩', 'VEC-SP07 荒废矿道', 'VEC-SP13 紧急夺还', 'VEC-SP14 乙醇暴动', 'VEC-SP08 一意孤行', 'VEC-SP15 刺耳机床', 'VEC-SP16 最终愿望'] },
        ],
      },
    ],
  }, { now: NOW })

  assert.deepEqual(card.stageGroups, [
    { title: '核心突破', codes: 'VEC-01 ~ VEC-12' },
    { title: '全力以赴', codes: 'VEC-A ~ VEC-D' },
    { title: '特别战线', codes: 'VEC-SP01 ~ VEC-SP16' },
  ])
  assert.match(card.stageLine, /特别战线（VEC-SP01 ~ VEC-SP16）/)
})

// 2026-10-09 昨日海：整组没有号段（条目本身就是「悖论模拟 信诺」这种名字），旧逻辑 /^[A-Za-z]/ 把整组滤空
test('mapRawToDailyCard keeps name-only stage groups like 悖论模拟', () => {
  const card = mapRawToDailyCard({
    ...RAW_FIXTURE,
    stageBlocks: [
      {
        title: '新增关卡',
        lead: '昨日海',
        groups: [
          {
            title: '雷亚-伊比利亚',
            codes: ['YW-ST-1 羽兽盘旋', 'YW-1 互助会', 'YW-TR-1 炼金术遗产考察', 'YW-2 浮浮沉沉',
              'YW-3 破手铐', 'YW-4 走上街道', 'YW-ST-2 海声嘈杂', 'YW-5 三岔路口',
              'YW-6 大人物', 'YW-7 殉葬品', 'YW-8 鳞的记忆', 'YW-ST-3 留给明天'],
          },
          {
            title: '悖论模拟',
            codes: ['悖论模拟 信诺', '悖论模拟 无所遁形', '悖论模拟 “继续下潜！”', '悖论模拟 齐奏落下'],
          },
        ],
      },
    ],
  }, { now: NOW })

  assert.deepEqual(card.stageGroups, [
    { title: '雷亚-伊比利亚', codes: 'YW-ST-1 ~ YW-ST-3 / YW-1 ~ YW-8 / YW-TR-1' },
    { title: '悖论模拟', codes: '信诺、无所遁形、“继续下潜！”、齐奏落下' },
  ])
  // 有号段的组照旧只留号段（名字仍不占版面）
  assert.doesNotMatch(card.stageGroups[0].codes, /羽兽盘旋/)
  assert.match(card.stageLine, /悖论模拟（信诺、无所遁形、“继续下潜！”、齐奏落下）/)
})

// 「特别开放」窗口：首页「每日开放」只剩一行「资源收集所有关卡全天开放中，N后结束」
const ALL_OPEN_FIXTURE = {
  ...RAW_FIXTURE,
  todayParagraphs: [
    '现在时间：10月9日(星期五) 08:00。',
    '资源收集所有关卡全天开放中，10天19小时后结束。',
  ],
  coreItems: [
    { text: '资源收集所有关卡全天开放中，10天19小时后结束。', epoch: Math.floor(NOW.getTime() / 1000) + (10 * 24 + 19) * 3600 },
  ],
}

test('mapRawToDailyCard reads the 特别开放 line as the collect state', () => {
  const card = mapRawToDailyCard(ALL_OPEN_FIXTURE, { now: NOW })

  // 特别开放窗口里首页不列分区：两个分区都空，倒计时按同一段的 data-time 现算
  assert.deepEqual(card.collectMaterial, [])
  assert.deepEqual(card.collectChips, [])
  assert.equal(card.collectAllOpen, '全部资源关卡全天开放中（10天19小时后结束）')
  assert.deepEqual(card.core, [])
  assert.match(card.collectIntro, /特别开放/)

  const letter = renderCardHtml(card, { fontsCssLinks: '' })
  assert.match(letter, /特别开放：\s*<b>全部资源关卡全天开放中（10天19小时后结束）<\/b>/)

  const { renderWeeklyHtml } = require('../lib/services/card-weekly.js')
  const weekly = renderWeeklyHtml(card, { fontsCssLinks: '' })
  assert.match(weekly, /wk-collect__key">特别开放</)
  assert.match(weekly, /<em>全部资源关卡全天开放中（10天19小时后结束）<\/em>/)

  const { renderNewspaperHtml } = require('../lib/services/card-newspaper.js')
  const newspaper = renderNewspaperHtml(card, { fontsCssLinks: '' })
  assert.match(newspaper, /np-collect-title">特别开放</)
  assert.match(newspaper, /<li><b>全部资源关卡全天开放中（10天19小时后结束）<\/b><\/li>/)
})

test('特别开放 falls back to the printed countdown and to a state-only line', () => {
  // 页面脚本没把倒计时写进正文时，退回正文里的「N后结束」
  const printed = mapRawToDailyCard({
    ...ALL_OPEN_FIXTURE,
    todayParagraphs: [...ALL_OPEN_FIXTURE.todayParagraphs.slice(0, 1), '资源收集所有关卡全天开放中，10天19小时后结束。'],
    coreItems: [],
  }, { now: NOW })
  assert.equal(printed.collectAllOpen, '全部资源关卡全天开放中（10天19小时后结束）')

  // 正文里连倒计时都没有时只报状态，不编造剩余时间
  const bare = mapRawToDailyCard({
    ...ALL_OPEN_FIXTURE,
    todayParagraphs: [...ALL_OPEN_FIXTURE.todayParagraphs.slice(0, 1), '资源收集所有关卡全天开放中，后结束。'],
    coreItems: [],
  }, { now: NOW })
  assert.equal(bare.collectAllOpen, '全部资源关卡全天开放中')
  assert.match(renderCardHtml(bare, { fontsCssLinks: '' }), /特别开放：\s*<b>全部资源关卡全天开放中<\/b>/)
})

test('renderFallbackHtml writes the apology into the sign area', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { renderFallbackHtml, readPngSize, FALLBACK_REASONS } = require('../lib/services/card-fallback.js')

  const sentences = Object.values(FALLBACK_REASONS).map((reason) => reason.sentence('泰拉周刊'))
  assert.deepEqual(sentences, [
    '很抱歉博士！今日的「泰拉周刊」遇到了天灾。',
    '很抱歉博士！今日的「泰拉周刊」被见习信使弄丢了。',
    '很抱歉博士！今日的「泰拉周刊」城际网络丢包了。',
  ])

  const png = fs.readFileSync(path.join(__dirname, '..', 'assets', 'fallback', 'lost-card.png'))
  const { width, height } = readPngSize(png)
  assert.deepEqual({ width, height }, { width: 1024, height: 1535 })

  const html = renderFallbackHtml({
    imageDataUrl: 'data:image/png;base64,AAAA',
    message: sentences[1],
    fontsCssLinks: '<link rel="stylesheet" href="x.css">',
    width,
    height,
  })
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="">/)
  // 牌子在插画里的位置（比例）与按牌子高度算出的字号
  assert.match(html, /left: 26\.370%; top: 20\.720%; width: 48\.050%; height: 16\.680%/)
  assert.match(html, /<p class="sign-text" style="font-size: 47px">很抱歉博士！今日的「泰拉周刊」被见习信使弄丢了。<\/p>/)
})

test('compressStageCodes keeps leading zeros and merges contiguous codes', () => {
  assert.equal(compressStageCodes(['TO-EX-1', 'TO-EX-2', 'TO-EX-8']), 'TO-EX-1、TO-EX-2、TO-EX-8')
  assert.equal(compressStageCodes(['EE-01 奇象收录时间！'.split(' ')[0], 'EE-02', 'EE-03']), 'EE-01 ~ EE-03')
  assert.equal(compressStageCodes(['TO-S-1', 'TO-S-4', 'TO-MO-1']), 'TO-S-1、TO-S-4 / TO-MO-1')
})

test('parseCoreItem rejects expired or malformed entries', () => {
  assert.equal(parseCoreItem('活动将于后结束。', 0, NOW), null)
  assert.equal(parseCoreItem('没有倒计时格式。', Math.floor(NOW.getTime() / 1000), NOW), null)
  const item = parseCoreItem('限时寻访『联合行动23』将于5分钟后结束。', Math.floor(NOW.getTime() / 1000) + 5 * 60, NOW)
  const unfilled = parseCoreItem('活动将于后结束。', Math.floor(NOW.getTime() / 1000) + 3600, NOW)
  assert.equal(unfilled?.name, '活动')
  assert.equal(unfilled?.action, '结束')
  assert.equal(item?.name, '限时寻访『联合行动23』')
  assert.equal(item?.remainingText, '5分钟')
})

test('formatRemainingText humanizes remaining time', () => {
  assert.equal(formatRemainingText(7 * 3600000 + 17 * 60000), '7小时17分钟')
  assert.equal(formatRemainingText(31 * 3600000), '1天7小时')
  assert.equal(formatRemainingText(30 * 1000), '1分钟')
})

test('splitCollectValues splits slash separated resource lists', () => {
  assert.deepEqual(splitCollectValues('作战记录 / 采购凭证 / 龙门币'), ['作战记录', '采购凭证', '龙门币'])
  assert.deepEqual(splitCollectValues('医疗&重装'), ['医疗&重装'])
})

test('renderCardHtml embeds stamp, chips groups and card data', () => {
  const card = mapRawToDailyCard(RAW_FIXTURE, { now: NOW })
  card.birthdays[0].art = 'data:image/png;base64,AAAA'
  const html = renderCardHtml(card, { fontsCssLinks: '<link rel="stylesheet" href="./fonts/lxgw/lxgwwenkailite-regular.css">' })

  assert.match(html, /id="letter"/)
  assert.match(html, /class="stamp-item"/)
  assert.match(html, /田字格|rough-stamp/)
  assert.match(html, /fonts\/lxgw\/lxgwwenkailite-regular\.css/)
  assert.match(html, /data-group="recent"/)
  assert.match(html, /今日资源收集，别忘了刷一遍/)
  assert.match(html, /7小时17分钟后/)
  assert.match(html, /data:image\/png;base64,AAAA/)
  const cardData = html.match(/window\.CARD_DATA = (\{[\s\S]*?\});</)
  assert.ok(cardData, 'CARD_DATA should be embedded')
  const parsed = JSON.parse(cardData[1])
  assert.equal(parsed.birthdays.length, 2)
  assert.equal(parsed.recentOperators[0].rarity, 6)
})

test('renderCardHtml omits font links when font assets are missing', () => {
  const html = renderCardHtml(mapRawToDailyCard(RAW_FIXTURE, { now: NOW }), { fontsCssLinks: '' })
  assert.doesNotMatch(html, /fonts\/lxgw/)
})

test('buildSealSlots lays lunar date chars into the seal grid', () => {
  const { buildSealSlots } = require('../lib/services/card-template.js')
  const slots = buildSealSlots(new Date('2026-08-30T20:00:00+08:00'))

  // 2026-08-30 农历七月十八：右列上下「七月」，左列上下「十八」
  assert.equal(slots.length, 4)
  assert.deepEqual(slots.map((slot) => slot.ch), ['七', '月', '十', '八'])
  assert.deepEqual(slots.map((slot) => [slot.x, slot.y]), [[71, 29], [71, 71], [29, 29], [29, 71]])
})

test('card style registry falls back to letter for unknown ids', async () => {
  const card = mapRawToDailyCard(RAW_FIXTURE, { now: NOW })
  const { renderCardByStyle, CARD_STYLES } = require('../lib/services/card-template.js')

  assert.equal(CARD_STYLES.letter.label, '今日信笺（手账风）')
  const byId = renderCardByStyle('letter', card, { fontsCssLinks: '' })
  const byName = renderCardHtml(card, { fontsCssLinks: '' })
  assert.equal(byId, byName)
  assert.equal(renderCardByStyle('nonexistent', card, { fontsCssLinks: '' }), byName)
})

test('renderWeeklyHtml groups operators by rarity and inlines bundled item icons', () => {
  const { renderWeeklyHtml } = require('../lib/services/card-weekly.js')
  const card = mapRawToDailyCard(RAW_FIXTURE, { now: NOW })
  card.birthdays[0].art = 'data:image/png;base64,BBBB'
  card.recentOperators[0].avatar = 'data:image/png;base64,CCCC'
  const html = renderWeeklyHtml(card, { fontsCssLinks: '<link rel="stylesheet" href="x.css">' })

  // 截图节点是外框，书脊与内页都在里面
  assert.match(html, /id="letter"/)
  assert.match(html, /wk-frame__spine/)
  // 星级块每档只出现一次：新增 6★/5★ 各一次，凭证甄选合并后 6★ 与 4★ 各一次
  assert.equal((html.match(/wk-ladder__row" style="--rank-color/g) || []).length, 4)
  // 生日立绘同时用作顶部色雾
  assert.match(html, /wk-hero__img[^>]*data:image\/png;base64,BBBB/)
  assert.match(html, /data:image\/png;base64,CCCC/)
  // 随包道具图标内联成 data URL；头像缺失时退化为内联 SVG 占位
  assert.match(html, /wk-val__ico" style="background-image:url\('data:image\/png;base64,/)
  assert.match(html, /wk-op__ico" style="background-image:url\('data:image\/svg\+xml;base64,/)
  assert.match(html, /<b>7<\/b><i>时<\/i>/)
  // 关卡按小节分行，每个关卡集自带小标题
  assert.match(html, /wk-stage__lead">SideStory 「直到大地变成一颗酸橙」/)
  assert.match(html, /wk-stage__name">踏上归家长途</)
  assert.match(html, /wk-stage__codes">TO-EX-1、TO-EX-2、TO-EX-3、TO-EX-8</)
  assert.match(html, /wk-stage__name">奇象巡展</)
  // 芯片按职业组合匹配到正确的关卡缩略图（比对随包文件的字节，不看文件名）
  const chipIcon = (file) => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '..', 'assets', 'icons', file)).toString('base64')
  const tile = (file, text) => `background-image:url('data:image/png;base64,${chipIcon(file)}')"></i><em>${text}`
  assert.ok(html.includes(tile('chip-medic-defender.png', '医疗&amp;重装')), '医疗&重装 应配固若金汤')
  assert.ok(html.includes(tile('chip-supporter-vanguard.png', '先锋&amp;辅助')), '先锋&辅助 应配势不可挡')
  assert.ok(html.includes(tile('chip-guard-specialist.png', '近卫&amp;特种')), '近卫&特种 应配身先士卒')
})

test('weekly style is registered and asks for operator avatars', () => {
  const { CARD_STYLES, resolveCardStyle } = require('../lib/services/card-template.js')
  assert.equal(CARD_STYLES.weekly.label, '泰拉周刊（夜间书脊）')
  assert.equal(resolveCardStyle('weekly').needsOperatorAvatars, true)
  assert.equal(resolveCardStyle('letter').needsOperatorAvatars, undefined)
})

test('extractOperatorQuote pulls the Chinese report line from the voice-record wikitext', () => {
  const { extractOperatorQuote } = require('../lib/services/capture.js')
  const wikitext = [
    '<noinclude>==语音记录==</noinclude>{{#widget:VoiceTable}}{{VoiceTable|表格标题=语音记录',
    '|语音key=char_298_susuro',
    '',
    '|标题11=信赖触摸',
    '|台词11={{VoiceData/word|中文|摸摸头。}}',
    '',
    '|标题12=干员报到',
    '|台词12={{VoiceData/word|中文|医疗干员苏苏洛向您报到。即使博士您身兼多种要职，是干员们的导师，但医生的话，您也是要听的哦。}}{{VoiceData/word|日文|医療オペレーターのスーズーロー、着任しました。}}',
    '|语音12=CN_012.wav',
    '|触发类型12=RECEPTION',
  ].join('\n')
  assert.equal(
    extractOperatorQuote(wikitext),
    '医疗干员苏苏洛向您报到。即使博士您身兼多种要职，是干员们的导师，但医生的话，您也是要听的哦。',
  )
  // 没有「干员报到」条目（或页面抓空）时返回空串，由渲染器回退原贺语
  assert.equal(extractOperatorQuote(''), '')
  assert.equal(extractOperatorQuote('|标题1=任命助理\n|台词1={{VoiceData/word|中文|博士早。}}'), '')
})

test('weekly solo birthday renders the report quote and keeps note fallback', () => {
  const { renderWeeklyHtml } = require('../lib/services/card-weekly.js')
  const card = mapRawToDailyCard(RAW_FIXTURE, { now: NOW })
  card.birthdays[0].art = 'data:image/png;base64,AAAA'

  card.birthdays = [card.birthdays[0]]
  card.birthdays[0].quote = '医疗干员苏苏洛向您报到。'
  const withQuote = renderWeeklyHtml(card, { fontsCssLinks: '' })
  assert.match(withQuote, /id="wk-solo"/)
  assert.match(withQuote, /wk-solo__quote">医疗干员苏苏洛向您报到。</)
  assert.match(withQuote, /WEEKLY|wk-solo/)
  assert.match(withQuote, /--solo-h/)  // 自适应脚本在页内
  assert.doesNotMatch(withQuote, /wk-solo__note">/)

  // 台词缺失（抓取失败）时回退原贺语
  delete card.birthdays[0].quote
  const fallback = renderWeeklyHtml(card, { fontsCssLinks: '' })
  assert.match(fallback, /wk-solo__note">今天只有一位干员生日。/)
  assert.doesNotMatch(fallback, /wk-solo__quote">/)

  // 多人生日维持既有立绘墙，不出现台词
  card.birthdays = [
    { ...card.birthdays[0], quote: '医疗干员苏苏洛向您报到。' },
    { ...card.birthdays[0], name: '特克诺', quote: '行动预备干员特克诺，前来报到。' },
  ]
  const multi = renderWeeklyHtml(card, { fontsCssLinks: '' })
  assert.match(multi, /wk-portraits"(?! wk-portraits--solo)/)
  assert.doesNotMatch(multi, /wk-solo__quote">/)
})
