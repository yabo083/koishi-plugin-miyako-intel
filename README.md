# koishi-plugin-prts-search

Koishi 插件：在聊天中搜索 PRTS Wiki，按编号查看详情，并支持可选整页截图与 ChatLuna 工具调用。

## 功能

- `prts <关键词>`：搜索 PRTS Wiki，返回编号列表。
- `prts.view <编号>`：查看最近一次搜索中的指定结果。
- `prts.view <编号> -s`：查看详情并尝试截图。
- `prts.shot <页面标题>`：直接截图指定页面。
- 搜索后可直接回复数字（例如 `1`）查看详情；回复 `C` 取消当前会话上下文。
- 可选注册 ChatLuna 工具（默认工具名 `prts_search`）。

## 安装

```bash
npm i koishi-plugin-prts-search
```

如果需要截图，请确保 Koishi 已启用 `koishi-plugin-puppeteer`。

## 基础配置示例

```yaml
plugins:
  prts-search:
    baseUrl: https://prts.wiki
    maxResults: 5
    contextTtlSeconds: 300
    summaryLength: 1000
    defaultPermission: all
    enableRateLimit: true
    rateLimitPerMinute: 20
    enableScreenshot: true
    defaultViewport: desktop
    enableChatLunaTool: true
    chatLunaToolName: prts_search
```

## 本地开发

```bash
npm install
npm run build
```

## 发布（含 OIDC Trusted Publishing）

此仓库包含 `.github/workflows/publish.yml`，当推送 `v*` tag 时会：

1. 安装依赖并构建
2. `npm publish --access public --provenance`
3. 自动创建 GitHub Release

在 npm 后台需要提前完成一次 Trusted Publishing 绑定：

1. 打开 npm 包设置 `Package Settings -> Publishing access`
2. 添加 GitHub Actions 可信发布来源：
   - Owner: 你的 GitHub 用户名
   - Repository: 此插件仓库名
   - Workflow: `publish.yml`
   - Environment: 留空（或按需设置）

完成后推送 tag 即可自动发布：

```bash
git tag v0.1.0
git push origin v0.1.0
```
