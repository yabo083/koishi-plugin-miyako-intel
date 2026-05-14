# koishi-plugin-miyako-intel

Miyako 游戏情报插件。当前版本先聚焦 PRTS Wiki 首页「今日信息」整合图：将今日状态、核心动态、亮点干员与近期新增内容整理成适合 QQ 群查看的黑蓝终端风格图片，并按明日方舟日切缓存。

## 定位

`miyako-intel` 是一个以 Miyako 为主品牌的游戏资料搜集与资讯日报入口，而不是绑定到某一个游戏或某一个资料站的单点工具。当前能力来自 PRTS Wiki；后续可以继续接入其他游戏、其他资料源或日报工作流。

PRTS Wiki 的页面排版、媒体资料与站内结构本身有很高的信息密度，普通资料查询更适合用户直接打开 PRTS 查看；插件保留低成本、有推送价值的 `prts.d`，作为资料搜集与资讯日报体系中的 PRTS 今日信息入口。

后续资料搜索能力预留给更合适的数据源或专用 API，例如 warfarin.wiki 未来的官方搜索 API。

## 功能

- `prts d` / `prts.d` / `prts -d`：发送 PRTS 今日信息整合图。
- `prts s` / `prts.s` / `prts.summary`：发送 PRTS 今日信息规则摘要文本，复用每日缓存逻辑。
- `prts cache` / `prts.cache`：查看 Koishi `baseDir`、实际缓存根目录、当前缓存日与最近缓存状态。
- `prts r [d|s|all]` / `prts.r [d|s|all]` / `prts -r [d|s|all]`：无视缓存强制刷新今日信息；`s` 只发送刷新后的摘要文本，默认 `all` 等同于刷新 `d`。
- `prts h` / `prts.h`：查看命令帮助。
- 支持 cron 表达式配置后台定时刷新与定时推送，频道白名单用于控制推送群聊。
- 支持自定义发送开场白和结束语，手动命令与定时推送都会使用。
- 支持摘要去重、时钟噪声清理、数字序号、语义续行、规范日期预演、剩余时间估算，以及亮点干员类别过滤。
- 摘要会专门整理资源收集文本，将物资筹备分区与芯片搜索分区拆成独立续行。
- 摘要展示项可通过表格配置自由开关，默认不输出近期新增关卡文本。
- 亮点干员摘要优先从 PRTS `.mp-operators a[title]` 读取干员名，避免头像文本或重复文字污染。
- 支持配置截图设备像素比、输出格式和 JPEG 质量，在清晰度与图片体积之间取舍。
- 支持卡片字体与主题色配置。
- 支持缓存自动维护：默认保留最近 7 个日期目录，旧目录按月写入 `json.gz` 归档后删除。
- 支持 Koishi 控制台插件详情概览面板，快速查看截图、摘要、缓存与推送配置状态。
- 支持插件日志等级配置，便于观察定时任务是否触发、跳过或失败。
- 刷新失败时可回退到上一份可用缓存。

图片底部会标注：信息源 `prts.wiki`，生成者 `miyako-intel`，开发者 `miyako`。

## 截图策略

- 访问 `https://prts.wiki/w/%E9%A6%96%E9%A1%B5`。
- 提取并整合 `今日信息 / 亮点干员 / 近期新增` 三个区块。
- 自动展开白名单区块内的折叠内容，突出采购凭证等临近刷新提示。
- 由 Koishi `puppeteer` 服务在浏览器中完成 DOM 重排与截图，不依赖 `sharp`。

## 配置示例

```yaml
plugins:
  miyako-intel:
    baseUrl: https://prts.wiki
    homepagePath: /w/%E9%A6%96%E9%A1%B5
    cacheDirectory: data/miyako-intel/cache
    timezone: Asia/Shanghai
    dailyRefreshHour: 4
    refreshCron: 5 4 * * *
    logLevel: info
    navigationTimeoutMs: 45000
    renderDelayMs: 1000
    viewportWidth: 1366
    viewportHeight: 900
    deviceScaleFactor: 1
    imageFormat: png
    jpegQuality: 85
    staleFallback: true
    messagePrefix: 博士，今日 PRTS 情报已整理：
    messageSuffix: 以上，祝作战顺利。
    summaryMaxItems: 8
    summaryDatePreview: true
    summaryDisplayItems:
      - key: resource
        enabled: true
      - key: annihilation
        enabled: true
      - key: event
        enabled: true
      - key: voucher
        enabled: true
      - key: operator-birthday
        enabled: true
      - key: operator-recent
        enabled: true
      - key: operator-voucher
        enabled: true
      - key: operator-kernel-headhunting
        enabled: true
      - key: operator-outfit
        enabled: true
      - key: operator-new-module
        enabled: true
      - key: operator-headhunting
        enabled: true
      - key: operator-event
        enabled: true
      - key: recent-stage
        enabled: false
      - key: recent-furniture
        enabled: true
      - key: recent-other
        enabled: true
    cardTheme:
      fontFamily: ""
      backgroundColor: ""
      primaryColor: ""
      warningColor: ""
      dangerColor: ""
      textColor: ""
    cacheMaintenance:
      enabled: true
      keepRecentDays: 7
      archiveEnabled: true
      archiveDirectory: archives
      archiveCron: 30 4 * * *
      deleteAfterArchive: true
    scheduledPush:
      enabled: false
      channels:
        - onebot:11111111
      cron: 10 4 * * *
```

cron 使用 5 段格式：`分钟 小时 日期 月份 星期`，并按 `timezone` 生效。  
例如 `5 4 * * *` 表示每天 04:05 刷新缓存，`10 4 * * *` 表示每天 04:10 推送，`0 8 * * 1` 表示每周一 08:00。
OneBot / NapCat 群推送目标通常写成 `onebot:群号`，例如 `onebot:11111111`。

`deviceScaleFactor` 调高后截图会更清晰，但图片体积也会增加。`imageFormat` 可选 `png` 或 `jpeg`；当 PNG 超过 QQ 常见体积限制时，插件也会自动降级为 JPEG。

缓存目录相对 Koishi `baseDir`，不是一定相对代码仓库。使用 `prts cache` 可以直接确认实际缓存根目录、当前日切 key、今日缓存是否存在以及最近缓存日期。缓存维护默认每天 04:30 检查一次，保留最近 7 个日期目录，较旧目录按月份归档为 `archives/miyako-intel-cache-YYYY-MM.json.gz`。

控制台面板会以右侧悬浮导航形式出现在 Koishi 插件详情页，支持拖动、折叠、滚动定位和当前配置区块高亮。该面板通过 Koishi `console` 服务加载；未启用控制台时不会影响命令功能。

## 许可证

1.2.0 起本插件使用 `AGPL-3.0-only`。允许第三方发布修改版，但发布或提供网络服务时需要按 AGPL 要求公开对应源码，并保留原作者版权声明。

## 从旧包迁移

- npm 包名从 `koishi-plugin-prts-search` 迁移为 `koishi-plugin-miyako-intel`。
- Koishi 运行时插件名从 `prts-search` / `arknights-intel` 迁移为 `miyako-intel`。
- 默认缓存目录从 `data/prts-search/cache` 或 `data/arknights-intel/cache` 调整为 `data/miyako-intel/cache`。如需沿用旧缓存，可手动迁移目录或在配置中继续指定旧路径。
- `prts.e`、`prts -e`、`pushEvents` 与 `eventMaxHeight` 已移除。

## 发包前置步骤

1. 在 npm 上创建或准备 `koishi-plugin-miyako-intel`。
2. 在 npm 包设置中配置 Trusted Publishing：
   - Owner: `yabo083`
   - Repository: `koishi-plugin-miyako-intel`
   - Workflow: `publish.yml`
   - Environment: 留空，除非你显式启用了 GitHub environment。
3. 确认 npm trusted publisher 配好后，再推送 `v*` tag 触发发布。
4. 旧包 `koishi-plugin-prts-search` 建议使用 `npm deprecate` 指向新包，不建议 unpublish。

## 运行要求

- 需要启用 Koishi `puppeteer` 服务。
- Linux / Docker 环境建议安装中文字体，例如 Noto Sans CJK，避免截图出现方框字。

## 开发

```bash
npm install
npm run build
npm test
```

构建会先把服务端 TypeScript 编译到 `lib/`，再把 Koishi 控制台客户端构建到 `dist/`。
