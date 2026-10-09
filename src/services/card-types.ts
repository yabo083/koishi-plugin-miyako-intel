// 卡片渲染的数据形状。渲染器（card-template / card-weekly / card-newspaper）与
// 抓取侧都依赖它，单独成文件才不会让「注册表 → 渲染器 → 注册表」绕成循环依赖。

export interface SealSlot {
  ch: string
  x: number
  y: number
}

export interface DailyCoreItem {
  name: string
  action: '刷新' | '结束'
  remainingText: string
  urgency: 'safe' | 'warn' | 'danger'
}

export interface DailyOperator {
  name: string
  rarity: number
  /** 首页头像直链；「泰拉周刊」用它做名字前的圆形图砖，抓取失败时留空由渲染器兜底 */
  avatar?: string
}

export interface DailyBirthdayOperator {
  name: string
  /** 首页头像直链，立绘抓取失败时的兜底 */
  avatar: string
  /** base64 数据 URL；抓取失败时为空串 */
  art: string
  tilt: number
  tape: string
  /** 「干员报到」台词（PRTS 语音记录子页）；仅当日唯一生日干员时提取，失败留空 */
  quote?: string
}

export interface DailyStageGroup {
  /** 关卡集名，如「踏上归家长途」 */
  title: string
  /** 压缩后的号段，如「TO-EX-1 ~ TO-EX-8」 */
  codes: string
}

export interface DailyCardData {
  dateText: string
  weekText: string
  sealSlots: SealSlot[]
  capturedAtText: string
  collectIntro: string
  collectMaterial: string[]
  collectChips: string[]
  /**
   * 「特别开放」窗口内 PRTS 首页的「每日开放」只输出一行「资源收集所有关卡全天开放中，N后结束」，
   * 不再列物资筹备 / 芯片搜索分区；非空时它就是今日可刷的全部内容（整句，如
   * 「全部资源关卡全天开放中（10天19小时后结束）」）。
   */
  collectAllOpen: string
  core: DailyCoreItem[]
  birthdays: DailyBirthdayOperator[]
  recentOperators: DailyOperator[]
  poolOperators: DailyOperator[]
  /** 单行版关卡信息（今日信笺 / 泰拉晨报用） */
  stageLine: string
  /** 活动名，如「SideStory 「直到大地变成一颗酸橙」」 */
  stageTitle: string
  /** 各关卡集（泰拉周刊按这个分行排） */
  stageGroups: DailyStageGroup[]
}
