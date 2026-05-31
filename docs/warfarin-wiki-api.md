# Warfarin Wiki — 引经据典检索系统 · 接口规范

> **文档性质**：服务端接口实现规范，供后端开发参考实现。
> **调用方**：Koishi 插件 `koishi-plugin-miyako-intel`（仅做 HTTP 请求，不参与检索逻辑）。
> **使用流程**：用户在群聊输入关键词 → 插件调锚定接口拿结果列表 → 用户选择编号 → 插件调上下文接口拿详情。

---

## 接口列表

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/search/anchor` | 关键词锚定搜索 |
| `POST` | `/api/v1/search/context` | 上下文溯源与摘要 |

## 通用约定

### 请求地址

服务部署后提供一个 Base URL，调用方通过配置项 `wiki.baseUrl` 指定。

### 请求头

| 字段 | 值 | 必选 |
| --- | --- | --- |
| `Content-Type` | `application/json` | 是 |

### 响应结构

所有接口使用统一外层包裹：

```json
{
  "code": 0,
  "message": "ok",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | integer | 业务状态码，`0` 为成功 |
| `message` | string | 人类可读的状态描述 |
| `data` | object / null | 业务数据，失败时为 `null` |

### 错误码

| code | message | 含义 |
| --- | --- | --- |
| `0` | ok | 成功 |
| `400` | bad request | 请求参数不合法 |
| `404` | not found | 指定的 `anchor_id` 不存在 |
| `500` | internal error | 服务端异常 |

**错误返回示例：**

```json
{
  "code": 400,
  "message": "keyword is required",
  "data": null
}
```

---

## 接口一：关键词锚定搜索

```
POST /api/v1/search/anchor
```

### 锚定搜索 — 功能描述

接收关键词，在游戏文本库中检索匹配项，按相关度降序返回结果列表。调用方拿到结果后展示给用户，由用户选择具体哪一条。

### 锚定搜索 — 请求参数（JSON Body）

| 参数 | 类型 | 必选 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `keyword` | `string` | 是 | — | 1–100 字符 | 搜索关键词 |
| `scope` | `string[]` | 否 | 全部范围 | 枚举见下 | 限定检索范围 |
| `limit` | `integer` | 否 | `5` | 1–20 | 返回条数上限 |

**scope 枚举值：**

| 值 | 含义 |
| --- | --- |
| `plot` | 剧情 |
| `archive` | 档案 |
| `weapon` | 武器 |
| `item` | 物品 |

**请求示例：**

```json
{
  "keyword": "息壤",
  "scope": ["plot", "archive"],
  "limit": 5
}
```

### 锚定搜索 — 成功返回

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `results` | `object[]` | 匹配结果列表，按相关度降序 |
| `results[].anchor_id` | `string` | 定位 ID，调用方据此调上下文接口 |
| `results[].content` | `string` | 匹配文本片段 |
| `results[].source` | `string` | 来源中文描述，如 `"档案-特殊物质篇"` |
| `results[].scope` | `string` | 来源分类，取值同 scope 枚举 |
| `results[].relevance` | `number` | 相关度分数 `[0, 1]`，客户端仅用于展示 |
| `total` | `integer` | 总匹配数（limit 前） |
| `took_ms` | `integer` | 查询耗时 ms，客户端仅用于调试 |

**返回示例：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "results": [
      {
        "anchor_id": "plot_ch03_042",
        "content": "...息壤是利用了代理人的力量，在极短时间内重构了物质形态...",
        "source": "档案-特殊物质篇",
        "scope": "archive",
        "relevance": 0.98
      },
      {
        "anchor_id": "plot_ch03_007",
        "content": "你听说过息壤吗？那是很久以前的技术了。",
        "source": "剧情-第三章",
        "scope": "plot",
        "relevance": 0.75
      }
    ],
    "total": 2,
    "took_ms": 12
  }
}
```

---

## 接口二：上下文溯源与摘要

```
POST /api/v1/search/context
```

### 上下文检索 — 功能描述

接收锚定 ID，返回该文本所属的完整对话回合。调用方在用户选定上一步结果后调用此接口。

### 上下文检索 — 请求参数（JSON Body）

| 参数 | 类型 | 必选 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `anchor_id` | `string` | 是 | — | 必填 | 锚定 ID |
| `need_summary` | `boolean` | 否 | `false` | — | 是否生成 AI 情境摘要 |
| `context_range` | `integer` | 否 | `3` | 0–10 | 锚定行上下扩展行数 |

**请求示例：**

```json
{
  "anchor_id": "plot_ch03_042",
  "need_summary": true,
  "context_range": 3
}
```

### 上下文检索 — 成功返回

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `anchor` | `object` | 锚定条目信息（结构同锚定搜索的 result） |
| `full_text` | `object[]` | 对话回合列表，按时序升序 |
| `full_text[].speaker` | `string` | 说话者名，空串为旁白 |
| `full_text[].text` | `string` | 台词 |
| `summary` | `string / null` | AI 摘要（仅 `need_summary=true` 时返回） |
| `source_ref` | `string` | 来源参考，如 `"第三章 · 剧情"` |

**返回示例：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "anchor": {
      "anchor_id": "plot_ch03_042",
      "content": "...息壤是利用了代理人的力量，在极短时间内重构了物质形态...",
      "source": "档案-特殊物质篇",
      "scope": "archive",
      "relevance": 0.98
    },
    "full_text": [
      { "speaker": "角色A", "text": "那件东西的本质是什么？" },
      { "speaker": "系统描述", "text": "息壤是利用了代理人的力量，在极短时间内重构了物质形态。" },
      { "speaker": "角色A", "text": "原来如此...难怪会有那样的效果。" }
    ],
    "summary": "此段出现在游戏第三章，解释了息壤的物理特性及其与代理人的关联。",
    "source_ref": "第三章 · 剧情"
  }
}
```

### 上下文检索 — 错误返回

```json
{
  "code": 404,
  "message": "anchor_id 'plot_ch03_999' not found",
  "data": null
}
```

---

## 备注

- 锚定搜索的 `scope` 如不传或传空数组，后端应视为检索全部范围。
- `relevance` 分数仅用于客户端排序展示，不需苛求绝对值语义（0.6 和 0.8 都能用，排序对即可）。
- `summary` 字段需后端集成 LLM 摘要能力时启用；如未集成，即使 `need_summary=true` 也返回 `null` 即可。
- 两段流程均无状态要求（stateless），后端不需维护会话上下文。

---

## 变更历史

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0.0 | 2026-05-14 | 初版 |
