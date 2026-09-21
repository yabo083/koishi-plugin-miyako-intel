// 泰拉周刊 v2 · 渲染器（原型）
// 纯函数：data → { accent, html }。字段与插件 DailyCardData 一致，便于直接移植。
// 尺寸前提：画布 1080 宽，群聊压到 ~400 宽仍要可读，故正文不小于 26px。
;(function () {
  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
  // 每日一色：只换强调色，纸墨恒定
  const ACCENTS = {
    0: '#b0303f', // 周日 · 胭脂
    1: '#2f4f7a', // 周一 · 靛蓝
    2: '#a44a2a', // 周二 · 陶土
    3: '#4f6b3c', // 周三 · 橄榄
    4: '#6a4a7c', // 周四 · 藕紫
    5: '#8f6516', // 周五 · 赭金
    6: '#22706b', // 周六 · 松绿
  }
  // 夜间模式要更亮更饱和才压得住深底
  const ACCENTS_DARK = {
    0: '#ff5f70', // 周日 · 胭脂
    1: '#6698e0', // 周一 · 靛蓝
    2: '#ff8a52', // 周二 · 陶土
    3: '#93c96d', // 周三 · 橄榄
    4: '#c294e0', // 周四 · 藕紫
    5: '#efb63f', // 周五 · 赭金
    6: '#45cbbc', // 周六 · 松绿
  }
  // 星级底色：反白数字要压得住，取中深调
  const RANK_COLORS = { 6: '#9d7222', 5: '#7c7430', 4: '#5f4a6d', 3: '#3a5273', 2: '#5f5c56', 1: '#5f5c56' }

  /* ---------- 素材：物资 / 芯片 / 干员头像 ----------
     原型直接用本地文件；迁进插件后换成随包的静态资源或 PRTS 图源。 */
  const ICON_DIR = './assets/icons/'
  const ITEM_ICONS = [
    [/作战记录|经验/, 'item-exp.png'],
    [/采购凭证/, 'item-voucher.png'],
    [/龙门币/, 'item-lmd.png'],
    [/技巧概要/, 'item-skill.png'],
    [/碳素|建材/, 'item-carbon.png'],
  ]
  // 芯片搜索四关：固若金汤 = 医疗&重装 / 势不可挡 = 辅助&先锋 / 摧枯拉朽 = 术师&狙击 / 身先士卒 = 近卫&特种
  // 文件名直接写职业，避免再按 PR-A/B/C/D 的顺序记错
  const CHIP_ICONS = [
    [/重装|医疗/, 'chip-medic-defender.png'],
    [/辅助|先锋/, 'chip-supporter-vanguard.png'],
    [/术师|狙击/, 'chip-caster-sniper.png'],
    [/近卫|特种/, 'chip-guard-specialist.png'],
  ]

  function matchIcon(table, text) {
    const hit = table.find(([pattern]) => pattern.test(String(text || '')))
    return hit ? ICON_DIR + hit[1] : ''
  }

  // 干员头像：原型按名字查本地文件，插件里直接用 PRTS 首页给的 avatar 直链
  function operatorIcon(op) {
    if (op && op.avatar) return op.avatar
    return ''
  }

  // 带衬影的文字单元：<i> 是图，<em> 是字，两种模式由根节点的 class 决定
  // 图必须写成 <i> 的 background-image：放进 CSS 自定义属性时，相对路径会按样式表位置解析而不是文档
  function shaded(kind, icon, text) {
    return `<span class="wk-${kind}${icon ? '' : ' wk-shade--none'}">`
      + `<i class="wk-${kind}__ico"${icon ? ` style="background-image:url('${icon}')"` : ''}></i>`
      + `<em>${esc(text)}</em></span>`
  }

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const pad2 = (n) => String(n).padStart(2, '0')

  function lunarText(date) {
    if (!window.Lunar) return ''
    const lunar = window.Lunar.fromDate(date)
    return `${lunar.getMonth() < 0 ? '闰' : ''}${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
  }

  function issueNumber(date) {
    const launch = Date.UTC(2019, 4, 1)
    const days = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - launch) / 86400000)
    return Math.max(1, days + 1)
  }

  // "1天7小时46分钟" → 特大数字 + 小单位；只保留前两段，避免挤压
  function clockHtml(text) {
    const units = { 天: '天', 小时: '时', 分钟: '分' }
    const parts = (String(text || '').match(/\d+(?:天|小时|分钟)/g) || []).slice(0, 2)
    if (!parts.length) return '<b>--</b>'
    return parts.map((part) => {
      const [, n, unit] = part.match(/(\d+)(天|小时|分钟)/)
      return `<b>${n}</b><i>${units[unit]}</i>`
    }).join('')
  }

  const tab = (cn) => `<h2 class="wk-tab">${esc(cn)}</h2>`
  /* ---------- 生辰干员 ---------- */
  // 同一行里所有名字用同一档字号：按最长的那个名字定档，避免一行里大小不一
  function nameClass(list) {
    const longest = Math.max(...list.map((op) => String(op.name || '').length), 0)
    if (longest <= 4) return ''
    if (longest <= 6) return ' wk-figure__name--tight'
    return ' wk-figure__name--tighter'
  }

  function coverBand(data) {
    const list = data.birthdays || []
    if (!list.length) return ''
    if (list.length === 1) {
      const op = list[0]
      return `<section class="wk-band">
        ${tab('今日生日')}
        <div class="wk-portraits wk-portraits--solo">
          <figure class="wk-figure">
            <div class="wk-figure__frame"><img src="${esc(op.art || op.avatar)}" alt="${esc(op.name)}"></div>
          </figure>
          <div class="wk-solo">
            <p class="wk-solo__name">${esc(op.name)}</p>
            <div class="wk-solo__bar"></div>
            <p class="wk-solo__note">今天只有一位干员生日。<br>蛋糕已经在后勤部备好了。</p>
          </div>
        </div>
      </section>`
    }
    return `<section class="wk-band">
      ${tab('今日生日')}
      <div class="wk-portraits">${list.map((op) => `
        <figure class="wk-figure">
          <div class="wk-figure__frame"><img src="${esc(op.art || op.avatar)}" alt="${esc(op.name)}"></div>
          <figcaption class="wk-figure__name${nameClass(list)}">${esc(op.name)}</figcaption>
        </figure>`).join('')}
      </div>
    </section>`
  }

  /* ---------- 情报速递 ---------- */
  function newsBand(data) {
    const list = data.core || []
    if (!list.length) return ''
    return `<section class="wk-band">
      ${tab('情报速递')}
      ${list.map((item) => `
      <article class="wk-news__item wk-news__item--${esc(item.urgency)}">
        <div class="wk-news__clock">${clockHtml(item.remainingText)}</div>
        <div class="wk-news__body">
          <div class="wk-news__head">
            <span class="wk-news__act">${esc(item.action)}</span>
            <h3 class="wk-news__title">${esc(item.name).replace(/(『[^』]+』)/g, '<b>$1</b>')}</h3>
          </div>
        </div>
      </article>`).join('')}
    </section>`
  }
  /* ---------- 今日要点 ---------- */
  function collectBand(data) {
    const rows = [
      { key: '物资筹备', table: ITEM_ICONS, values: data.collectMaterial || [] },
      { key: '芯片搜索', table: CHIP_ICONS, values: data.collectChips || [] },
    ].filter((row) => row.values.length)
    if (!rows.length) return ''
    return `<section class="wk-band">
      ${tab('今日可刷')}
      ${rows.map((row) => `
      <div class="wk-collect__row">
        <span class="wk-collect__key">${esc(row.key)}</span>
        <span class="wk-collect__vals">${row.values
          .map((value) => shaded('val', matchIcon(row.table, value), value)).join('')}</span>
      </div>`).join('')}
    </section>`
  }

  /* ---------- 名录：星级阶梯 ---------- */
  function ladder(list) {
    const buckets = new Map()
    for (const op of list || []) {
      const rank = Number(op.rarity) || 0
      if (!buckets.has(rank)) buckets.set(rank, [])
      buckets.get(rank).push(op)
    }
    const ranks = [...buckets.keys()].sort((a, b) => b - a)
    if (!ranks.length) return '<p class="wk-empty">本期无更新</p>'
    return ranks.map((rank) => `
      <div class="wk-ladder__row" style="--rank-color:${RANK_COLORS[rank] || RANK_COLORS[2]}">
        <span class="wk-ladder__rank">${rank || '–'}<i>★</i></span>
        <span class="wk-ladder__names">${buckets.get(rank)
          .map((op) => shaded('op', operatorIcon(op), op.name)).join('')}</span>
      </div>`).join('')
  }

  /** 新增关卡：活动名一行，其下每个关卡集一行（PRTS 首页就是这么分组的） */
  function stageHtml(data) {
    const groups = data.stageGroups || []
    if (!groups.length && !data.stageTitle && !data.stageLine) return ''
    const body = groups.length
      ? `<div class="wk-stage__grid">${groups.map((group) => `
          <span class="wk-stage__name">${esc(group.title)}</span>
          <span class="wk-stage__codes">${esc(group.codes)}</span>`).join('')}
        </div>`
      : `<p class="wk-stage__lead">${esc(data.stageLine)}</p>`
    return `<div class="wk-stage">
      <span class="wk-stage__label">新增关卡</span>
      <div class="wk-stage__body">
        ${data.stageTitle ? `<p class="wk-stage__lead">${esc(data.stageTitle)}</p>` : ''}
        ${body}
      </div>
    </div>`
  }

  function rosterBand(data) {
    const recent = (data.recentOperators || []).length
    const pool = (data.poolOperators || []).length
    if (!recent && !pool) return ''
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
      ${stageHtml(data)}
    </section>`
  }
  /* ---------- 整页 ---------- */
  function buildWeekly(data, now, options) {
    const at = now || new Date()
    const dark = !!(options && options.theme === 'dark')
    const dm = String(data.dateText || '').match(/(\d+)月(\d+)日/)
    const numeric = dm ? `${pad2(dm[1])}.${pad2(dm[2])}` : esc(data.dateText)
    const weekIndex = Math.max(0, WEEK_CN.indexOf(String(data.weekText || '').replace('星期', '')))
    // 夜间模式的顶部色雾用第一张立绘糊出来；没有生日干员就只留渐变底
    const heroArt = (data.birthdays || [])[0]
    const hero = dark && heroArt && (heroArt.art || heroArt.avatar)
      ? `<div class="wk-hero">
  <span class="wk-hero__img" style="background-image:url('${heroArt.art || heroArt.avatar}')"></span>
  <span class="wk-hero__scrim"></span>
</div>`
      : ''
    return {
      accent: (dark ? ACCENTS_DARK : ACCENTS)[weekIndex],
      html: `${hero}<header class="wk-cap">
  <div>
    <h1 class="wk-cap__title">泰拉周刊</h1>
    <p class="wk-cap__en">Terra Weekly · No.${issueNumber(at)}</p>
  </div>
  <div class="wk-cap__right">
    <p class="wk-cap__date">${numeric}</p>
    <p class="wk-cap__meta">
      <span class="wk-cap__clip">${esc(data.lunarText || lunarText(at))}</span>
      <span class="wk-cap__week">${esc(data.weekText)}</span>
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
  <span>截稿 <b>${esc(data.capturedAtText)}</b></span>
  <span>情报源 <b>PRTS.WIKI</b></span>
  <span>MIYAKO-INTEL</span>
</footer>`,
    }
  }

  window.buildWeekly = buildWeekly
})()
