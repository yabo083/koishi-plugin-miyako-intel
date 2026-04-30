# koishi-plugin-miyako-intel

Miyako 游戏情报插件。当前版本先聚焦 PRTS Wiki 首页「今日信息」整合图：将今日状态、核心动态、亮点干员与近期新增内容整理成适合 QQ 群查看的黑蓝终端风格图片，并按明日方舟日切缓存。

## 定位

`miyako-intel` 是一个以 Miyako 为主品牌的游戏资料搜集与资讯日报入口，而不是绑定到某一个游戏或某一个资料站的单点工具。当前能力来自 PRTS Wiki；后续可以继续接入其他游戏、其他资料源或日报工作流。

PRTS Wiki 的页面排版、媒体资料与站内结构本身有很高的信息密度，普通资料查询更适合用户直接打开 PRTS 查看；插件保留低成本、有推送价值的 `prts.d`，作为资料搜集与资讯日报体系中的 PRTS 今日信息入口。

后续资料搜索能力预留给更合适的数据源或专用 API，例如 warfarin.wiki 未来的官方搜索 API。

## 功能

- `prts d` / `prts.d` / `prts -d`：发送 PRTS 今日信息整合图。
- `prts r [d|all]` / `prts.r [d|all]` / `prts -r [d|all]`：无视缓存强制刷新今日信息；默认 `all` 等同于刷新 `d`。
- `prts h` / `prts.h`：查看命令帮助。
- 支持 cron 表达式配置后台定时刷新与定时推送，频道白名单用于控制推送群聊。
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
    staleFallback: true
    scheduledPush:
      enabled: false
      channels:
        - sandbox:group-1
        - sandbox:group-2
      cron: 10 4 * * *
```

cron 使用 5 段格式：`分钟 小时 日期 月份 星期`，并按 `timezone` 生效。  
例如 `5 4 * * *` 表示每天 04:05 刷新缓存，`10 4 * * *` 表示每天 04:10 推送，`0 8 * * 1` 表示每周一 08:00。

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
