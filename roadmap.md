# Roadmap

未排期但已确认要做的方向。每条写清「为什么」与「判定完成的标准」。

## 采集源：评估切换到 PRTS 新版主题

- **现状**：解析器针对 prts.wiki 经典首页 DOM（`.mp-today` / `.mp-extranav` / `.mp-operators-content`；注意 MediaWiki 已把标题包进 `div.mw-heading`，见 [[PRTS mw-heading Wrapper Breaks Sibling Section Parsing]]）。
- **为什么**：PRTS 已上新版主题；**目前新版的数据更新还不如旧版及时**，所以暂不切换采集源。先记差别，不现在做。
- **做什么**：等新版数据追平后，评估把首页抓取切到新版，或做双源比对取更新更全的一侧。
- **完成标准**：同一时刻两版首页的「今日信息 / 近期新增」逐字段比对一致（或新版更全），且切换后 e2e 能出正确卡片。

## 工具：`scripts/e2e-letter-card.js` 的 Chrome 路径

- 脚本硬编码 `C:/Users/yabo/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe`，该路径在本机不存在，脚本原样跑必失败（2026-10-09 实测）。
- 改法：优先读 `PUPPETEER_EXECUTABLE_PATH`，否则探测系统 Chrome。
