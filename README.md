# koishi-plugin-miyako-intel

Miyako 游戏情报插件。当前提供 PRTS Wiki 今日信息卡片、今日信息摘要，以及 Warfarin Wiki 资料与剧情全文检索。

## 功能

- `prts d` / `prts.d` / `prts -d`：发送 PRTS 今日信息整合图。
- `prts s` / `prts.s` / `prts.summary`：发送 PRTS 今日信息摘要文本。
- `prts r [d|s|all]` / `prts.r [d|s|all]`：强制刷新今日信息缓存。
- `prts cache` / `prts.cache`：查看缓存根目录、当前缓存日和最近缓存状态。
- `w <关键词>`：检索 Warfarin Wiki 官方资料和本地全文缓存。
- `w <编号>`：查看上一轮检索结果详情，例如 `w 1`。
- `w+` / `w-` / `w+2`：翻页或跳转到指定页。
- `w <关键词> <编号>`：搜索后直接查看指定结果，例如 `w 息壤 2`。

## 运行要求

- `prts d` / `prts s` 需要 Koishi `puppeteer` 服务。
- `w` 官方资料检索需要能访问 Warfarin Wiki API。
- Warfarin 全文检索使用本地缓存和远程压缩包更新；运行中的插件不会自行全量爬取 Warfarin 源站文本接口。
- Linux / Docker 环境建议安装中文字体，例如 Noto Sans CJK，避免截图缺字。

## 配置示例

```yaml
plugins:
  miyako-intel:
    timezone: Asia/Shanghai
    logLevel: info

    # PRTS 今日信息
    baseUrl: https://prts.wiki
    homepagePath: /w/%E9%A6%96%E9%A1%B5
    cacheDirectory: data/miyako-intel/cache
    refreshCron: 5 4 * * *
    staleFallback: true

    # 消息输出
    messagePrefix: 博士，今日 PRTS 情报已整理：
    messageSuffix: 以上，祝作战顺利。
    scheduledPush:
      enabled: false
      channels:
        - onebot:123456789
      cron: 10 4 * * *

    # Warfarin Wiki
    wiki:
      language: cn
      storySearchEnabled: true
      storyUpdateCron: 20 4 * * *
      storyUpdateOnStart: false
      pageSize: 5
```

cron 使用 5 段格式：`分钟 小时 日期 月份 星期`，并按 `timezone` 生效。缓存目录相对 Koishi `baseDir`；使用 `prts cache` 可以确认实际位置。

## 缓存与更新

PRTS 今日信息会写入本地缓存。刷新失败时，如果启用了 `staleFallback`，插件会回退到上一份可用缓存。

Warfarin 全文数据随包带一份中文种子；后续更新只读取远程 manifest 和压缩包。下载后会校验 `sha256`，通过后再替换本地全文缓存。

## 开发

```bash
npm install
npm run build
npm test
```

服务端 TypeScript 会编译到 `lib/`，Koishi 控制台客户端会构建到 `dist/`。

## 许可证

本插件使用 `AGPL-3.0-only`。发布修改版或作为网络服务提供时，请按 AGPL 要求公开对应源码，并保留版权声明。
