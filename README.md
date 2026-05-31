# koishi-plugin-miyako-intel

Miyako 游戏情报插件。当前版本提供 PRTS Wiki 首页「今日信息」整合图，并接入 Warfarin Wiki API 用于明日方舟：终末地资料检索。

## 定位

`miyako-intel` 是一个以 Miyako 为主品牌的游戏资料搜集与资讯日报入口，而不是绑定到某一个游戏或某一个资料站的单点工具。当前能力来自 PRTS Wiki；后续可以继续接入其他游戏、其他资料源或日报工作流。

PRTS Wiki 的页面排版、媒体资料与站内结构本身有很高的信息密度，插件保留低成本、有推送价值的 `prts.d`，作为资料搜集与资讯日报体系中的 PRTS 今日信息入口。终末地文本资料检索统一使用 `w 关键词` 搜索，`w 编号` 查看详情；官方资料与剧情/任务全文搜索会自动合并。

## 功能

- `prts d` / `prts.d` / `prts -d`：发送 PRTS 今日信息整合图。
- `prts s` / `prts.s` / `prts.summary`：发送 PRTS 今日信息规则摘要文本，复用每日缓存逻辑。
- `prts cache` / `prts.cache`：查看 Koishi `baseDir`、实际缓存根目录、当前缓存日与最近缓存状态。
- `w <关键词>`：检索明日方舟：终末地资料，自动合并 Warfarin Wiki 官方搜索与本地剧情/任务文本缓存，每页展示 5 条。
- `w <编号>`：查看上一轮检索结果详情，例如 `w 1`。
- `w+` / `w-`：查看下一页 / 上一页搜索结果；`w+2` 可跳转到第 2 页。
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
- 预留 ChatLuna 工具接口定义：`warfarin_wiki_search` 与 `warfarin_wiki_context`，第一阶段不依赖 AI 运行时。

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
    wiki:
      language: cn
      storySearchEnabled: true
      storyUpdateCron: 20 4 * * *
      storyUpdateOnStart: false
      storyBundleManifestUrl: https://github.com/yabo083/koishi-plugin-miyako-intel/releases/download/warfarin-story-latest/warfarin-story-cn.manifest.json
      timeoutMs: 10000
      searchCacheTtlMs: 600000
      searchCacheMaxEntries: 100
      pageSize: 5
      selectionTtlMs: 300000
```

cron 使用 5 段格式：`分钟 小时 日期 月份 星期`，并按 `timezone` 生效。  
例如 `5 4 * * *` 表示每天 04:05 刷新缓存，`10 4 * * *` 表示每天 04:10 推送，`0 8 * * 1` 表示每周一 08:00。
OneBot / NapCat 群推送目标通常写成 `onebot:群号`，例如 `onebot:11111111`。

`deviceScaleFactor` 调高后截图会更清晰，但图片体积也会增加。`imageFormat` 可选 `png` 或 `jpeg`；当 PNG 超过 QQ 常见体积限制时，插件也会自动降级为 JPEG。

缓存目录相对 Koishi `baseDir`，不是一定相对代码仓库。使用 `prts cache` 可以直接确认实际缓存根目录、当前日切 key、今日缓存是否存在以及最近缓存日期。缓存维护默认每天 04:30 检查一次，保留最近 7 个日期目录，较旧目录按月份归档为 `archives/miyako-intel-cache-YYYY-MM.json.gz`。

Warfarin Wiki 检索默认内置官方 API 地址，并启用本地剧情/任务文本缓存。`language` 决定官方 API、详情直链和剧情数据语言，例如 `cn`、`en`。检索结果编号按用户和频道临时保存，默认 5 分钟过期；过期后可以重新执行 `w <关键词>`。

剧情/任务全文搜索对用户无感：仍然使用 `w <关键词>`。插件随包内置一份压缩的中文剧情/任务文本种子数据；首次没有本地缓存时会先展开到 Koishi `baseDir/data/miyako-intel/warfarin-story`，不会让每个安装者都从源站全量拉取。后续更新只读取 `storyBundleManifestUrl` 指向的 GitHub Release manifest，只有远程 `sha256` 变化时才下载 `warfarin-story-cn.json.gz`，校验通过后解压为本地剧情文本缓存。远程合集不可用时，插件继续使用已有本地缓存或随包种子，不会自行访问 Warfarin 源站。

仓库内置 `.github/workflows/warfarin-story-bundle.yml`，默认每周运行一次，也支持手动触发。脚本会先读取 Warfarin 首页左下角“最后更新”日期，并与现有 release manifest 的 `sourceUpdatedAt` 比对；日期未变则直接跳过。日期变化时才集中从 Warfarin Wiki 源站生成 `warfarin-story-cn.json.gz` 和 `warfarin-story-cn.manifest.json`，再上传到 `warfarin-story-latest` release。普通部署者只请求 GitHub 上的 manifest 和压缩合集，不再各自全量拉取源站剧情文本。

插件会按关键词缓存完整响应，默认 10 分钟、最多 100 组；群聊翻页 `w+` / `w-` / `w+2` 和快捷详情 `w 息壤 2` 都读取本地缓存，不会重复请求官方 API。官方详情会在末尾追加源站直链，格式为 `https://warfarin.wiki/<language>/<type>/<slug>`。

控制台面板会以右侧悬浮导航形式出现在 Koishi 插件详情页，支持拖动、折叠、滚动定位和当前配置区块高亮。配置导航按“基础设置 / PRTS 今日情报 / 消息输出 / 外观 / 定时任务 / 缓存维护 / Warfarin 资料检索 / 调试与高级”组织；状态区显示定时推送、PRTS 站点、官方 API、本地剧情文本、PRTS 补缓存、缓存维护和资料搜索缓存占用。该面板通过 Koishi `console` 服务加载；未启用控制台时不会影响命令功能。

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

- `prts d` / `prts s` 需要启用 Koishi `puppeteer` 服务。
- `w` 官方资料检索需要能访问 Warfarin Wiki 官方搜索 API；剧情全文检索优先使用本地剧情文本缓存，自动更新默认访问 GitHub Release 压缩合集。运行中的插件不会自行访问 Warfarin Wiki 任务剧情接口。
- Linux / Docker 环境建议安装中文字体，例如 Noto Sans CJK，避免截图出现方框字。

## 开发

```bash
npm install
npm run build
npm test
```

构建会先把服务端 TypeScript 编译到 `lib/`，再把 Koishi 控制台客户端构建到 `dist/`。
