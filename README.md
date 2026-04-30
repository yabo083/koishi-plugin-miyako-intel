# koishi-plugin-prts-search

明日方舟情报截图插件。当前版本聚焦 PRTS Wiki 首页「今日信息」整合图：将今日状态、核心动态、亮点干员与近期新增内容整理成适合 QQ 群查看的黑蓝终端风格图片，并按明日方舟日切缓存。

## 定位

这个插件不再承担通用 PRTS 资料搜索职责。PRTS Wiki 的页面排版、媒体资料与站内结构本身有很高的信息密度，普通资料查询更适合用户直接打开 PRTS 查看；插件保留低成本、有推送价值的 `prts.d`，作为资料搜集与资讯日报体系中的 PRTS 今日信息入口。

后续资料搜索能力预留给更合适的数据源或专用 API，例如 warfarin.wiki 未来的官方搜索 API。

## 功能

- `prts d` / `prts.d` / `prts -d`：发送 PRTS 今日信息整合图。
- `prts r [d|all]` / `prts.r [d|all]` / `prts -r [d|all]`：无视缓存强制刷新今日信息；默认 `all` 等同于刷新 `d`。
- `prts h` / `prts.h`：查看命令帮助。
- 支持后台定时刷新与定时推送，频道白名单用于控制推送群聊。
- 刷新失败时可回退到上一份可用缓存。

图片底部会标注：信息源 `prts.wiki`，生成者 `arknights-intel`，开发者 `miyako`。

## 截图策略

- 访问 `https://prts.wiki/w/%E9%A6%96%E9%A1%B5`。
- 提取并整合 `今日信息 / 亮点干员 / 近期新增` 三个区块。
- 自动展开白名单区块内的折叠内容，突出采购凭证等临近刷新提示。
- 由 Koishi `puppeteer` 服务在浏览器中完成 DOM 重排与截图，不依赖 `sharp`。

## 配置示例

```yaml
plugins:
  arknights-intel:
    baseUrl: https://prts.wiki
    homepagePath: /w/%E9%A6%96%E9%A1%B5
    cacheDirectory: data/arknights-intel/cache
    timezone: Asia/Shanghai
    dailyRefreshHour: 4
    scheduledRefreshMinute: 5
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
      hour: 4
      minute: 10
```

## 迁移提示

- npm 包仍沿用 `koishi-plugin-prts-search`，以复用现有 npm trusted publishing 绑定。
- Koishi 运行时插件名从 `prts-search` 调整为 `arknights-intel`。
- 默认缓存目录从 `data/prts-search/cache` 调整为 `data/arknights-intel/cache`。如需沿用旧缓存，可手动迁移目录或在配置中继续指定旧路径。
- `prts.e`、`prts -e`、`pushEvents` 与 `eventMaxHeight` 已移除。

## 运行要求

- 需要启用 Koishi `puppeteer` 服务。
- Linux / Docker 环境建议安装中文字体，例如 Noto Sans CJK，避免截图出现方框字。

## 开发

```bash
npm install
npm run build
npm test
```
