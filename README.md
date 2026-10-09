# koishi-plugin-miyako-intel

Miyako 游戏情报插件。提供 PRTS 每日「今日信笺」情报卡片（自动抓取渲染 + 定时推送），以及 Warfarin Wiki 资料与剧情全文检索。

## 功能

- **每日情报卡片**：每天按 `refreshCron` 自动抓取 PRTS 首页，渲染成情报卡片——今日资源收集、核心动态倒计时、生日干员半身立绘、近期新增干员与关卡，并通过 `scheduledPush` 定时推送到指定群。卡片按配置自动运行；`prts d`（手动出图）、`prts r`（强制重渲）、`prts cache`（缓存诊断）为调试命令。
- **抓取失败回退卡片**：抓取或渲染失败时不再推旧卡，改为发一张「信使把报纸弄丢了」的插画，牌子上写一句致歉；理由三选一（`fallbackReason`），控制台可改。连浏览器都起不来时退到插画本体（牌子留空）。回退卡片不写缓存，下一个刷新点照常重试。
- **卡片风格**（`cardStyle`）：
  - `letter` 今日信笺（手账风）：米白信纸 + 手写体 + 立绘贴画。
  - `weekly` 泰拉周刊（夜间书脊）：深底 + 立绘光晕 + 磨砂玻璃分区卡 + 左侧强调色书脊。每次渲染从已下载的生日干员 PNG 立绘实时提取颜色，应用于书脊、星期徽章、角色卡底边和情报速递关键词；生日区衬影使用实际立绘。无需预置干员色表，新干员随图片自动支持。多位生日干员取首个可提取颜色的立绘，无有效颜色时回退星期色；其他区域保持星期轮换色。版面按「群聊压到 400px 宽仍可读」定尺，正文不小于 26px。当日生日干员恰好一位时，封面展示「干员报到」台词（取自 PRTS 语音记录，字号按台词长度自适应；抓取失败回退生日贺语）。
  - `newspaper` 泰拉晨报（报纸风）：宋体分栏 + 双细线，早期版本。
- `w <关键词>`：检索 Warfarin Wiki 官方资料和本地全文缓存；默认一次返回 5 条消息，每条 5 项。
- `w <编号>`：查看上一轮检索结果详情，例如 `w 1`。
- `w+` / `w-` / `w+2`：翻页或跳转到指定页。
- `w <关键词> <编号>`：搜索后直接查看指定结果，例如 `w 息壤 2`。

## 运行要求

- 「今日信笺」渲染需要 Koishi `puppeteer` 服务；字体（霞鹜文楷 Lite / 志莽行书 / Noto Serif SC）随 npm 依赖自动安装，无需系统字体。
- `w` 官方资料检索需要能访问 Warfarin Wiki API。
- Warfarin 全文检索使用本地缓存和远程压缩包更新；运行中的插件不会自行全量爬取 Warfarin 源站文本接口。

## 配置示例

```yaml
plugins:
  miyako-intel:
    dailyCardEnabled: true
    cardStyle: weekly
    fallbackReason: disaster
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
      initialPageCount: 5
```

cron 使用 5 段格式：`分钟 小时 日期 月份 星期`，按东八区生效。`wiki.pageSize` 控制每条搜索结果消息包含多少项，`wiki.initialPageCount` 控制首次 `w <关键词>` 和 `w+` / `w-` 相对翻页一次发送多少页。默认会先发送 `1-25`，`w+` 继续发送 `26-50`，`w-` 返回上一批窗口。

## 缓存与更新

「今日信笺」卡片按 04:00（东八区）日切写入本地缓存（`data/miyako-intel/cache`），抓取失败时发回退卡片而不是旧图；过期缓存按月归档并清理。生日干员半身立绘来自 PRTS Wiki，按 30 天磁盘缓存，抓取失败时自动退化为头像图。

Warfarin 全文数据随包带一份中文种子；后续更新只读取远程 manifest 和压缩包。下载后会校验 `sha256`，通过后再替换本地全文缓存。

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
