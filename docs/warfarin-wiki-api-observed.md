# Warfarin Wiki API 实测记录

本文记录 `miyako-intel` 目前依赖的 Warfarin Wiki API 实际行为。若本文与早期草稿不一致，以本文为准。

## 官方搜索 API

官方 API 根地址示例：

```text
https://api.warfarin.wiki/v1
```

语言代码由插件配置 `wiki.language` 决定。中文官方搜索实际请求为：

```http
GET /cn/search?q=息壤
```

旧式根地址 `https://api.warfarin.wiki/v1/cn` 仍可兼容；插件会按 `wiki.language` 重新规整语言段。

实测响应结构：

```json
{
  "query": "息壤",
  "results": [
    {
      "slug": "text_v0d8_24",
      "name": "息壤",
      "type": "lore",
      "category": "中枢档案",
      "snippet": "息壤是一种用于遏制侵蚀的新材料...",
      "score": 56.02606222480768
    }
  ]
}
```

字段说明：

- `slug`：源站条目 ID，可与 `type` 组合为详情页直链。
- `name`：页面或条目标题。
- `type`：技术分类，例如 `lore`、`items`、`operators`、`weapons`。
- `category`：面向读者的分类名。展示时应原样保留，不要替换成插件自造标签。
- `snippet`：包含关键词的摘要片段。
- `score`：排序分数。

官方详情页直链格式：

```text
https://warfarin.wiki/<language>/<type>/<slug>
```

示例：

```text
https://warfarin.wiki/cn/lore/text_v0d8_24
```

实测到的 `type/category` 组合：

| type | category |
| --- | --- |
| gear | 装备 |
| items | 材料 |
| items | 弹性需求物资 |
| items | 帝江号陈列品 |
| items | 功能设备 |
| items | 理智药剂 |
| items | 任务物品 |
| items | 武器培养素材 |
| items | 物资箱 |
| items | 珍贵培养素材 |
| lore | 藏品 |
| lore | 电子档案 |
| lore | 调查报告 |
| lore | 多媒体 |
| lore | 纸质记录 |
| lore | 中枢档案 |
| operators | 近卫 |
| operators | 术师 |
| operators | 突击 |
| operators | 先锋 |
| operators | 重装 |
| weapons | 施术单元 |
| weapons | 手铳 |
| weapons | 双手剑 |
| weapons | 长柄武器 |

该列表来自抽样，不保证完整。插件应把 `category` 当作开放文本处理。

## 第三方 Anchor API

第三方部署地址示例：

```text
http://38.246.245.216:3000
```

开源 EF-TextSearcher 后端经过本地改造后，还提供官方搜索风格接口：

```http
GET /api/v1/cn/search?q=再引春来&scope=missions&offset=0
```

该接口返回字段贴近官方搜索：

```json
{
  "query": "再引春来",
  "results": [
    {
      "slug": "sm2l5m2_0",
      "name": "再引春来·其二",
      "type": "missions",
      "category": "任务剧情",
      "snippet": "再引春来·其二 丙型天师桩出现了异状...",
      "score": 100
    }
  ],
  "total": 3,
  "limit": 20,
  "offset": 0,
  "took_ms": 2
}
```

其中 `slug` 是本后端的 anchor id，可继续传给 `/api/v1/search/context`。

搜索请求：

```http
POST /api/v1/search/anchor
Content-Type: application/json

{"keyword":"息壤"}
```

实测响应结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "results": [
      {
        "anchor_id": "item_xiranite_powder_0",
        "content": "息壤\n通过特殊设备获得的材料...",
        "source": "物品信息：息壤",
        "scope": "items",
        "relevance": 1
      }
    ],
    "total": 20,
    "took_ms": 20
  }
}
```

字段说明：

- `anchor_id`：上下文接口接受的 ID。
- `content`：搜索命中的正文。剧情/任务全文搜索结果也会放在这里。
- `source`：面向读者的来源名。展示时应原样保留，不要替换成插件自造标签。
- `scope`：技术分类，例如 `items`、`lore`、`missions`、`tutorials`。它不完全等同于早期草稿枚举。
- `relevance`：实测很多结果为 `1`，不应当作严格置信度。
- `limit`：兼容接口历史上支持过 `1-20`，插件侧不再传该字段；默认返回量由后端控制。

上下文请求：

```http
POST /api/v1/search/context
Content-Type: application/json

{"anchor_id":"item_xiranite_powder_0","need_summary":false,"context_range":3}
```

实测响应结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "anchor": {
      "anchor_id": "item_xiranite_powder_0",
      "content": "息壤\n通过特殊设备获得的材料...",
      "source": "物品信息：息壤",
      "scope": "items",
      "relevance": 1
    },
    "full_text": [],
    "summary": null,
    "source_ref": "物品信息：息壤"
  }
}
```

`full_text` 可能为空。插件应优先展示 `full_text`；为空时回退展示 `anchor.content`。

本地改造后的 EF-TextSearcher 会从任务原始 JSON 的 `dialog[].actorName/dialogText` 与 `radios[].messages[].actorName/radioText` 生成 `full_text`。例如 `src/data/warfarin/missions/sm2l5m2.json` 中存在：

```json
{
  "actorName": "陆令香",
  "dialogText": "我、我在生物图鉴上见过它，名字我记得是……“天鼓”，一种很凶恶的动物。"
}
```

重新运行 `node src/commands/parse-anchors.js` 后，对应 anchor 会写出：

```json
{
  "full_text": [
    { "speaker": "陈千语", "text": "嘘，好像是只咆兽。" },
    { "speaker": "陆令香", "text": "我、我在生物图鉴上见过它，名字我记得是……“天鼓”，一种很凶恶的动物。" }
  ]
}
```

因此，之前剧情详情没有说话人不是插件显示层问题，也不是源站原始数据缺失；原因是第三方后端早期 `parseMissions()` 只拼接了纯文本，没有把说话人写入 `full_text`。

任务中的 `radios` 原始数据也包含 `actorName`。早期 parser 曾把所有 `radioText` 统一标为 `通讯`；现在会优先使用具体 `actorName`，并额外写出 `scene: "通讯中"`。只有缺失 `actorName` 时才 fallback 为 `通讯`。

## 剧情与任务文本搜索实测

官方 API 不覆盖部分剧情/任务上下文全文检索；第三方 anchor API 能命中这些文本。

| 关键词 | 官方搜索 | 第三方 anchor 搜索 | 备注 |
| --- | ---: | ---: | --- |
| 小毛贼 | 0 条 | 1 条 | 命中 `任务剧情：谷地重启`，`scope: missions`，`anchor_id: e1m2_0`。 |
| 再引春来 | 0 条 | 3 条 | 命中 `任务剧情：再引春来·其二`、`任务剧情：再引春来·其三`、`任务剧情：再引春来·其一`，均为 `scope: missions`。 |

`小毛贼` 第三方命中文本片段：

```text
谢谢你们……真丢脸……竟然被这些小毛贼抓起来羞辱……
小毛贼……裂地者对于普通人而言，还是挺危险的一群人吧……
```

`再引春来` 第三方命中结果：

```text
任务剧情：再引春来·其二  anchor_id: sm2l5m2_0
任务剧情：再引春来·其三  anchor_id: sm2l5m3_0
任务剧情：再引春来·其一  anchor_id: sm2l5m1_0
```

对上述任务剧情结果调用未改造的 `/api/v1/search/context` 时，实测 `full_text` 为空，`summary` 为 `null`，但 `anchor.content` 包含完整可展示文本。改造并重新生成 anchors 后，任务剧情 `full_text` 会包含 `{ speaker, text }` 对话数组；radio 通讯还会包含可选 `scene` 字段。插件详情展示应一视同仁地优先使用 `full_text`，并保留 `anchor.content` fallback。

## 插件展示规则

搜索结果标题必须保留 API 原始来源名：

- 官方模式：展示 `category：name`。
- Anchor 模式：展示 `source`。

不要前置 `[档案]`、`[物品]` 等插件自造标签；这些标签会扭曲用户对原始来源和分类的理解。

模式选择建议：

- `official`：适合词条、物品、档案、角色、武器等结构化页面搜索，并可生成源站详情页直链。
- `anchor`：适合剧情、任务、教程等全文检索；目前没有可靠的官方详情页直链，正文主要来自 `anchor.content`。
