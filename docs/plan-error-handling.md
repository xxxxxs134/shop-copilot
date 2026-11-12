# 错误处理友好化 改进计划

> 触发：传智杯预赛评委评语「内容组织有条理，**错误处理可以再友好些**」（唯一扣分点，总分 73）。
> 依据：① 本地错误处理实勘（逐文件）；② 三份开源调研（Agent 框架错误架构 / SSE 错误协议 / AI 产品错误文案 UX）。
> 日期：2026-11-10 · 状态：待实施。

---

## 1. 背景与目标

**目标一句话**：让用户在出错时看到「发生了什么 + 能不能重试 + 该怎么办」，而不是 `DeepSeek 返回 503: {原始 JSON}` 或 `请启动 uvicorn backend.app.main:app --port 8000`。

**评审视角**：错误处理属于「实用性/UX 30%」权重，是唯一被官方点名的改进项。

---

## 2. 现状问题清单（本地实勘）

| # | 问题 | 位置 | 用户看到 |
|---|---|---|---|
| 1 | 原始上游错误泄漏 | `backend/app/agent/loop.py:111`、`backend/app/main.py:264` | `DeepSeek 返回 503: {"error":...}`（英文+JSON+技术细节） |
| 2 | 内部命令泄漏 | `app/api/chat/route.ts:43` | `无法连接 Python AI 层…请启动 uvicorn backend.app.main:app --port 8000` |
| 3 | 四种错误结构混用 | 后端 4 处 | `{"error":{"message"}}` / `{"error":"字符串"}` / `{"ok":false,"error"}` / SSE `{"type":"error"}` |
| 4 | 静默降级无解释 | `backend/app/api_workspace.py` except 分支 | 工作台空白，无原因无重试 |
| 5 | 前端解析四处猜格式 | `app/kb/page.tsx:73-81` 等 | `parseError` 到处写 |

**好消息**：骨架已具备——`ChatWindow.tsx:689` 已有错误横幅+重试按钮，`api_kb.py:31` 已有 `_err()` helper。**病根是「文案原始 + 结构不统一」**，不是从零做。

---

## 3. 调研结论（可借鉴模式，浓缩）

### 3.1 Agent 框架错误架构（bg_bb25586e）
- **LangChain**：`ModelError` 带 `is_retryable` 标志；错误分类是「可重试 vs 不可重试」一等公民。
- **LangGraph**：`ErrorCode` 枚举 + `create_error_message()` 自动追加文档链接；`RetryPolicy(retry_on, max_attempts, initial_interval, backoff_factor, jitter)`。
- **OpenHands**：`error_classification.py` 用**封闭词表** `{kind, retryable, user_action, error_id}`，注释明写「detail 只本地检查，绝不透传/上报」——隐私安全的用户可见层。
- **AutoGPT**：`BlockError` 的 docstring：「把底层信息当 str 原样暴露，让 `yield "error", str(exc)` 把真实原因呈现给用户」。

### 3.2 SSE 错误协议（bg_7eeb7e76）
- **RFC 9457**（problem+json）：`type/title/status/detail/instance` + 可扩展字段，是 REST 错误体的通行标准。
- **OpenAI**：`{"error":{message,type,param,code}}`；Responses 流式用 `error` 事件 + `response.failed`（失败）/`response.incomplete`（**部分成功**）。
- **Anthropic**：流式 `event: error`，payload `{"type":"error","error":{type,message}}`。
- **Vercel AI SDK**：流协议 `data:{"type":"error","errorText":"..."}`，配合 `[DONE]` 终结。
- **统一结论**：REST 用 RFC 9457 一个体；SSE 用命名 `event: error`，**恰好一个终结事件，error 后不再发 done**。

### 3.3 AI 产品错误文案 UX（bg_69cb55cd）
- **LibreChat**：100+ 条生产级模板，两条直接命中本项目痛点：
  - `com_error_model_stream_closed`：连接在完成前被关闭，**已收到的内容保留**，请重试。
  - `com_error_upstream_model_status`：模型服务商无法完成请求（状态 {{0}}）——**只暴露状态码，不暴露 body**。
  - `ErrorWithDetail`：provider 原始返回放**可折叠详情**，不当标题。
- **LobeChat**（中文文案金矿，`locales/zh-CN/error.json` + `chat.json`）：
  - `response.429` = 「请求过于频繁，请稍后再试」；5xx 一组友好文案。
  - `cliOverloadedGuide.autoRetry`：**自动重试倒计时**「{{seconds}} 秒后重试（第 {{attempt}}/{{max}} 次）」+ 停止/立即重试。
  - `ErrorContent.tsx`：重试按钮**自持 pending 态**；关闭错误**保留已流式内容**（内容为空才删消息）。
  - `SendErrorAlert.tsx`：注释明写「**绝不回显原始数据库 dump**」；并发超限有专门 title+description。
  - `isMachineErrorMessage`：一个「机器输出 vs 人类句子」分类器，决定是否回显原文。
- **Open WebUI**：`{#if hasResponseContent && message.error !== true}` 注释「**出错也始终显示已生成内容**」+ 独立 Error 气泡 + 重新生成。
- **Dify**：出错保留部分内容，`role=alert` 显示「操作失败」；`errorBoundary.details` = 「错误详情（**仅开发模式**）」。
- **FastGPT**：结构化「运行错误 - {{module}}」卡片 + HTTP 状态码 → 中文文案映射表（`error_code.503` 等）。
- **RAGFlow**：状态码 → 文案映射；知识库未命中 = 「在知识库中未找到您要寻找的答案！」（业务话术，非错误）。
- **Continue**：`ToggleDiv "View error output"` 详情折叠 + Copy + View Logs；只把 provider/model 名给用户。
- **Vercel AI SDK 文档**：**明确建议「给通用错误文案 + 重试/重新生成」**，并指出部分流式输出可保留或剥离。

### 3.4 可以给用户看 vs 必须隐藏（综合判据）

| 可以给用户看 | 必须隐藏 |
|---|---|
| HTTP 状态码、重试倒计时/第几次 | API key/凭证原文 |
| provider/模型名（可选，Continue 只给这个） | 堆栈、SQL、绑定参数 |
| 「已保留部分内容」这类状态 | 内部端口/命令、上游原始 JSON body |
| 请求 ID（trace） | `Failed query:` / `\n at ` 这类机器错误串（LobeChat `isMachineErrorMessage` 判定） |

**原则**：原始 provider 文本只进「可折叠详情」，绝不当标题；文案里不出现 `DeepSeek`、`uvicorn`、端口号。

---

## 4. 目标错误协议（本项目的统一 schema）

### 4.1 REST：RFC 9457 problem+json

```json
{
  "type": "about:blank",
  "title": "AI 服务暂时繁忙",
  "status": 429,
  "detail": "请求过于频繁，请稍后重试",
  "code": "UPSTREAM_RATE_LIMITED",
  "retryable": true,
  "retry_after_ms": 1500,
  "request_id": "req_xxxx"
}
```

- `type` = URI（默认 `about:blank`）；`status` = HTTP 状态；`title` 稳定、`detail` 具体、`code` 机器码（UPPER_SNAKE）、`retryable`/`retry_after_ms` 扩展。
- Content-Type：`application/problem+json`。

### 4.2 SSE：命名 `event: error`

```
event: error
data: { "type":"about:blank", "title":"...", "status":429, "code":"...", "retryable":true, ... }
```

- **恰好一个终结事件**：`error` 或 `done`，二选一；`error` 后不再发 `done`。
- 已发出的 `delta` 内容保留（对齐 Open WebUI / LibreChat「已收到的内容保留」）。
- 「部分成功」不是错误，是 `done` 的 `status:"incomplete"`（对齐 OpenAI `response.incomplete`）。

### 4.3 错误分类（三类）

| 类别 | code 前缀 | retryable | 用户话术 |
|---|---|---|---|
| 可重试（网络/超时/429/5xx） | `UPSTREAM_*` | true | 「AI 服务暂时繁忙，请稍后重试」 |
| 需配置（缺 key） | `CONFIG_*` | false | 「AI 服务未配置，请联系管理员」 |
| 业务拒绝（退款超期等） | 业务自带 | false | 「该订单已超过 7 天售后期，无法退款」 |

---

## 5. 分阶段任务

### P0 — 后端统一（影响面最大，先做）

1. **新增 `backend/app/errors.py`**：`Problem` Pydantic 模型 + `ProblemException` + 三个分类工厂函数（`upstream_error()` / `config_error()` / 复用业务）。
2. **注册 FastAPI 异常处理器**（`main.py`）：`ProblemException`、`RequestValidationError`(422→字段级 errors[])、`StarletteHTTPException`、兜底 `Exception`(500 通用，不泄堆栈)。
3. **`loop.py` / `main.py` 去技术化**：把 `DeepSeek 返回 {status}: {body[:300/500]}` 换成 `UPSTREAM_*` 分类 + 友好文案；原始 body 只进日志。
4. **`api_workspace.py` 降级给解释**：except 分支不再静默返回全零，返回带 `code`/`detail` 的错误体（或至少带 request_id）。
5. **`data_provider.py` 错误 JSON 归一**：`{"ok":false,"error"}` → 对齐 Problem（或标为内部、不直出）。
6. **SSE 统一**：Agent 流改发命名 `event: error` + Problem；`error` 后强制不发 `done`。

### P1 — 前端统一（随后）

1. **新增 `lib/errors.ts`**：一个 `parseProblem()`（兼容旧四种格式的迁移期转换）+ `problemMessage()` + `isRetryable()`。
2. **`ChatWindow` 错误卡片**：用 `parseProblem` 渲染「标题 + 可操作按钮（可重试才显示『重试』，否则『知道了』）+ 折叠详情」。
3. **工作台/数据/知识库空态**：加载失败给 EmptyState + 重试（对齐 data/kb 已有样式），带友好文案。
4. **删掉四处 `parseError` 猜格式**，统一走 `lib/errors.ts`。

### P2 — 细节打磨（可选）

1. 自动重试 + 倒计时提示（对齐 LobeChat `autoRetry`），仅对 `retryable:true`。
2. 部分流式输出保留策略确认（对齐 Open WebUI 注释）。
3. provider 原始返回 → 折叠详情（对齐 LibreChat `ErrorWithDetail`）。

---

## 6. 验证标准

- **门禁**：`npx tsc --noEmit` / `npm run lint` / `node scripts/smoke.mjs` 全绿（错误结构变化不能破坏 smoke 的 11 项）。
- **人工验收**（模拟三类错误，看前端渲染）：
  1. 停掉 DeepSeek key → 应显示「AI 服务未配置」，而非 `DeepSeek 返回 401...`。
  2. 拔网/断 8000 → 应显示「无法连接服务，请稍后重试」+ 重试按钮，而非 uvicorn 启动命令。
  3. 退款超期订单 → 应显示业务话术「超过 7 天售后期」，不带任何技术字眼。
- **回归**：`/v1/chat/completions` 旧格式消息仍 200；`/v1/workspace/summary` 仍 200。

---

## 7. 不改的东西

- 不碰 `positioning.md`（唯一真源）、不加新页面/依赖。
- 不改 Agent/RAG 业务逻辑、不改数据。
- 不动视频、不重录。
