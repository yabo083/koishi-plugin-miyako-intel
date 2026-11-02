# koishi-plugin-miyako-intel

Miyako 游戏情报插件。提供 PRTS 每日「今日信笺」情报卡片（自动抓取渲染 + 定时推送），以及 Warfarin Wiki 资料与剧情全文检索。

## 功能

- **每日情报卡片**：每天按 `refreshCron` 自动抓取 PRTS 首页，渲染成情报卡片——今日资源收集、核心动态倒计时、生日干员半身立绘、近期新增干员与关卡，并通过 `scheduledPush` 定时推送到指定群。卡片按配置自动运行；`prts d`（手动出图）、`prts r`（强制重渲）、`prts cache`（缓存诊断）为调试命令。
- **抓取失败回退卡片**：抓取或渲染失败时不再推旧卡，改为发一张「信使把报纸弄丢了」的插画，牌子上写一句致歉；理由从三条预置文案里随机抽取，无需配置。连浏览器都起不来时退到插画本体（牌子留空）。回退卡片不写缓存，下一个刷新点照常重试。
- **卡片风格**（`cardStyle`）：
  - `letter` 今日信笺（手账风）：米白信纸 + 手写体 + 立绘贴画。
  - `weekly` 泰拉周刊（夜间书脊）：深底 + 立绘光晕 + 磨砂玻璃分区卡 + 左侧强调色书脊。每次渲染从已下载的生日干员 PNG 立绘实时提取颜色，应用于书脊、星期徽章、角色卡底边和情报速递关键词；生日区衬影使用实际立绘。无需预置干员色表，新干员随图片自动支持。多位生日干员取首个可提取颜色的立绘，无有效颜色时回退星期色；其他区域保持星期轮换色。版面按「群聊压到 400px 宽仍可读」定尺，正文不小于 26px。当日生日干员恰好一位时，封面展示「干员报到」台词（取自 PRTS 语音记录，字号按台词长度自适应；抓取失败回退生日贺语）。
  - `newspaper` 泰拉晨报（报纸风）：宋体分栏 + 双细线，早期版本。
- `w <关键词>`：检索 Warfarin Wiki 官方资料和本地全文缓存；默认一次返回一页 5 项（Top-K）。
- `w <编号>`：查看上一轮检索结果详情，例如 `w 1`。详情会按条目类型回源官方详情接口，展示 overview / description / 档案 / 对话等叙事正文（属性表与技能表不进入正文）；详情接口不可用时回退到搜索结果摘要。正文展示受 `contextMode` 控制：默认 `clipped` 以关键词为中心节选 `contextChars` 字并附 `详情：` 链接，`link` 只出元信息与链接，`full` 完整渲染。
- `w+` / `w-` / `w+2`：翻页或跳转到指定页。
- `w <关键词> <编号>`：搜索后直接查看指定结果，例如 `w 息壤 2`。
- `w热点`：预览本群本周热点检索词条（只生成文本预览，不上传、不清统计窗口）；仅限群内使用。
- `w热点图`：把本群周报长图按切片发到当前会话（只预览，不入相册、不发提示、不清窗口）；仅限群内使用，需要 puppeteer。

## 运行要求

- 「今日信笺」渲染需要 Koishi `puppeteer` 服务；字体（霞鹜文楷 Lite / 志莽行书 / Noto Serif SC）随 npm 依赖自动安装，无需系统字体。
- `w` 官方资料检索需要能访问 Warfarin Wiki API。
- Warfarin 全文检索使用本地缓存和远程压缩包更新；运行中的插件不会自行全量爬取 Warfarin 源站文本接口。
- **必须**同时加载 `koishi-plugin-miyako-delivery`（>= 0.3.0）：cron 调度（固定东八区）、日切水位、日报群发与周报相册上传全部由该服务承担；本插件不再内置 cron 解析与轮询。

## 配置示例

```yaml
plugins:
  miyako-intel:
    dailyCardEnabled: true
    cardStyle: weekly
    logLevel: info
    refreshCron: 5 4 * * *
    scheduledPush:
      enabled: false
      channels:
        - onebot:123456789
      cron: 10 8 * * *

    # Warfarin Wiki
    wiki:
      language: cn
      storySearchEnabled: true
      storyUpdateCron: 20 4 * * *
      storyUpdateOnStart: false
      pageSize: 5
      initialPageCount: 1

      # 输出：列表摘要长度 / 详情节选模式
      excerptChars: 60            # 列表单条摘要字数（关键词居中）
      contextMode: clipped        # link | clipped | full
      contextChars: 800           # clipped 模式正文节选字数（关键词居中）

      # 出站混淆：URL 不动；汉字间插零宽空格 + 可选同音替换（入站自动还原）
      obfuscateEnabled: true
      obfuscateZeroWidthInterval: 6   # 每几个汉字插一个零宽空格，0 关闭
      obfuscateHomophones: []         # 例：[{ from: 壤, to: 瀼 }]

      # 每周热点检索词条周报：按群渲长图上传群相册，再发一行提示
      digestEnabled: false
      digestAlbums: []            # 「群号/相册ID」，候选项自动探测自 scheduledPush.channels
      digestCron: 0 9 * * 1
      digestMinCount: 3
      digestTopN: 10
      digestNotify: true
      digestResetAfterSend: true
      albumUploadTimeoutMs: 60000
```

cron 使用 5 段格式：`分钟 小时 日期 月份 星期`，按东八区生效。`wiki.pageSize` 控制每条搜索结果消息包含多少项，`wiki.initialPageCount` 控制首次 `w <关键词>` 和 `w+` / `w-` 相对翻页一次发送多少页。默认首次发送 `1-5`，`w+` 继续发送 `6-10`，`w-` 返回上一批窗口；`pageSize × initialPageCount` 即一次回复的 Top-K 窗口。列表消息不含链接；详情只在末尾附 `详情：<url>`。

**热点检索词条周报**：按群统计 `w` 检索词与「被点进详情」的词条；`digestCron` 触发时，`digestAlbums` 里配置的每个「群号/相册ID」各渲一张长图（每条检索词一张卡片：点过详情的展示全文与「详情」标记，没点过的展示检索索引与「索引」标记），顺序切片上传对应群相册，再按 `digestNotify` 发一行提示。有统计但没配相册的群只在日志生成文本预览。相册依赖 SnowLuma（OneBot v11 扩展动作 `get_qun_album_list` / `upload_image_to_qun_album`）与 puppeteer；SnowLuma 建不了相册，先手动在群里建好相册。插件只探测 `scheduledPush.channels` 里列出的群（`onebot:群号` / `onebot:group:群号` / 裸群号），且仅在插件启动（或机器人首次上线）时探测一次——相册接口调用频繁易触发风控，不做周期探测；新建相册后在 WebUI 保存一次配置让插件重载即可刷新候选。探测结果落到 `stats/albums.json`，直接在配置 `digestAlbums`（`digestEnabled` 下方）的下拉里选「群名（群号）/ 相册名」。上传失败不通知、不重置统计。

## 缓存与更新

「今日信笺」卡片按 04:00（东八区）日切写入本地缓存（`data/miyako-intel/cache`），抓取失败时发回退卡片而不是旧图；过期缓存按月归档并清理。生日干员半身立绘来自 PRTS Wiki，按 30 天磁盘缓存，抓取失败时自动退化为头像图。

Warfarin 全文数据随包带一份中文种子；后续更新只读取远程 manifest 和压缩包。下载后会校验 `sha256`，通过后再替换本地全文缓存。

本地锚点以 `anchors/store.ndjson`（一行一条 JSON）落盘，内存里只常驻检索字段，正文按需按行偏移回读；旧版 `bundle.json` / `seed.json` 首次启动会自动迁移为 `store.ndjson` 并删除旧文件（manifest 记 `storeFormat: 'ndjson'`）。同一 `anchor_id` 可跨 scope 复用（如 items/gear 同物两行），详情按 `scope + anchor_id` 取行。

检索词与词条查看按群统计（`<storyDataDirectory>/stats/queries.json`，只记群号/检索词/词条点击/时间，不记用户身份，私聊不计），供 `digestCron` 周报与 `w热点` 预览使用；`digestResetAfterSend` 关闭后统计窗口跨周累积。群相册探测结果缓存于 `stats/albums.json`。

## 设计

- 「今日信笺」版式原型见 `design/letter-prototype/`。
- 「泰拉周刊」版式原型见 `design/weekly-prototype/`（含七日配色、七版外框、夜间模式对比页，以及模拟群聊压缩的验证脚本）。

道具与芯片图标是固定素材，随包放在 `assets/icons/`，渲染时内联成 data URL；干员头像与生日立绘运行时从 PRTS 抓取，头像抓不到时退化为内联 SVG 占位。

## 开发

```bash
npm install
npm run build
npm test
```

服务端 TypeScript 会编译到 `lib/`，Koishi 控制台客户端会构建到 `dist/`。`scripts/e2e-letter-card.js` 可脱离 Koishi 直接驱动真实 PRTS 出一张卡片图做视觉验证。

## 许可证

本插件使用 `AGPL-3.0-only`。发布修改版或作为网络服务提供时，请按 AGPL 要求公开对应源码，并保留版权声明。
