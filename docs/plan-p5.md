# P5 计划 — 意图分流 + 业务查询增强 + 轻量知识库管理

> 触发：外部客服系统视频脚本的取舍讨论（2026-10-25）。
> 结论：**赛道定位不变**（电商运营 AI 助手），从参考脚本只拿三样——三段式视频结构、意图分流、业务查询增强；
> 明确不做运营后台 CRUD、转人工接待、完整知识库 CMS（AI 含量为零，冲淡已有差异化）。
> GitHub 对标调研：三路并行（意图路由 × 轻量 KB 管理 × 电商工具确认流）——结果见「六、对标参考」。

## 一、范围

**做 4 项**：

| # | 项 | 一句话 |
|---|-----|--------|
| A | 意图分流 | 回答前先分类（知识/数据/合规/文案），UI 显示路由 chip，数据类意图在 RAG 模式自动切换 Agent |
| B | 业务查询扩展 | 商品价格/库存、订单状态、售后状态查询；退款操作 = 业务校验 + 确认令牌两段式 |
| C | 轻量知识库管理 | 文档/切片查看与编辑、单块重嵌入、一键重建索引；不做版本/生效时间/回滚 |
| D | 视频脚本三段式重写 | `docs/video-script.md` 改为：效果演示 → 功能细节 → 技术架构 |

**不做**：运营后台 10 类 CRUD、转人工/客服接管、知识库版本发布与回滚、登录多用户、rerank（列入后续可选）。

## 二、A 意图分流

### 2.1 契约

```
POST /v1/intent   {"q": "用户问题"}
→ {"intent": "knowledge|data|policy|copywriting|general",
   "target": "rag|agent",
   "reason": "一句话理由（供 chip 展示）"}
```

- 实现：单次 DeepSeek 调用，system 提示词约束只输出 JSON；解析失败 → 关键词启发式兜底（查/库存/订单→data，退款/违规→policy，标题/文案→copywriting，其余→knowledge），**永不 500**。
- 延迟目标 <1.5s（temperature=0，max_tokens 小）。新文件 `backend/app/agent/intent.py`。

### 2.2 路由规则（非对称，防误伤）

| 当前模式 | intent → target | 行为 |
|----------|-----------------|------|
| rag | data / policy / copywriting → agent | **自动切到 Agent**（PATCH mode + 走 agent 端点），chip 注明「已按意图切换」 |
| rag | knowledge / general → rag | 原样 RAG，chip 注明「知识问答 → 检索」 |
| agent | 任意 | 不回切（用户显式选了 Agent），仅显示 chip；knowledge 类注明「RAG 模式可溯源」 |

- 调用时机：前端发送时与回答**并行**发起 `/v1/intent`，不阻塞首 token。
- chip 渲染：消息气泡上方小徽章 `意图：数据查询 · 路由 → Agent 工具`，数据来自 intent 响应。
- 会话消息结构加可选字段 `intent?: {intent, target, reason}`，随 PUT 持久化（老数据无此字段 = 不渲染，向后兼容）。

## 三、B 业务查询扩展

### 3.1 数据层（`seed_store.py` 扩表，幂等重建）

| 表 | 字段要点 | 种子规模 |
|----|---------|---------|
| products | sku, name, price, stock, status | ~12 个商品（含 1-2 个低库存） |
| orders | order_id, buyer(脱敏), items_json, amount, status, created_at | ~20 单，状态覆盖 paid/shipped/received/refunding/refunded |
| aftersales | id, order_id, type, status, amount, created_at | ~6 条（退款中/已完成/被拒） |

规则：**不在 git 内**（store.db 已 gitignore），`python -m backend.app.agent.seed_store` 一键重建，今日数据与 30 天指标兼容。

### 3.2 Provider 扩展（保持 P4 三步接入叙事）

`DataProvider` Protocol 新增（Mock 同步实现，缺数据时优雅降级）：

```
get_products(keyword) -> list     # 价格/库存
get_orders(order_id|status) -> list
get_aftersales(order_id) -> list
validate_refund(order_id, amount) -> dict   # 业务校验
execute_refund(order_id, token) -> dict     # 凭令牌执行
```

- `get_snapshot` 契约不动，老代码零破坏；README「三步接入」段落补一行说明新方法可选实现。

### 3.3 工具与确认流（两段式，跨轮令牌）

```
① 模型调 refund_flow(action="validate", order_id, amount)
   → 后端校验：订单存在 / 已付款 / 未退过 / 金额 ≤ 实付 / 在售后期
   → 通过：生成 token（内存 dict，TTL 10 分钟）+ 返回确认预览
        {ok:true, needs_confirm:true, token, preview:{order_id, amount, item, after_amount}}
   → 不通过：{ok:false, violations:[...]}（模型转述给用户）
② 模型向用户复述预览并问「确认退款吗？」（此轮结束）
③ 用户说确认 → 模型调 refund_flow(action="execute", order_id, token)
   → token 校验（存在/未过期/订单匹配）→ 更新 aftersales+orders 状态 → 返回回执
   → token 一次性消费（执行即删），重复执行返回「已退款」幂等回执
```

- 新工具 `product_lookup`（价格/库存）、`order_lookup`（订单/售后状态）、`refund_flow`（校验+执行二合一）；`data_query` 保持日看板职责不动。工具总数 4→7。
- 校验规则全部在**后端**，不信任模型传参；模型只负责转述与征求确认。

## 四、C 轻量知识库管理

### 4.1 API（新文件 `backend/app/api_kb.py`，APIRouter）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/kb/docs` | 文档列表：`[{id,title,category,source,chunk_count}]`（从索引聚合） |
| GET | `/v1/kb/chunks?doc=` | 切片：`[{id,doc_id,chunk_index,text}]` |
| PUT | `/v1/kb/chunks/{id}` | `{text}` → 重嵌入该块 → 更新 LanceDB 行 → **失效检索单例** |
| POST | `/v1/kb/rebuild` | 全量重建（复用 `pipeline.build()`），返回耗时与块数 |

- 检索失效：`retrieve.py` 的 `_retriever` 单例在 PUT/rebuild 后置 None，下次 `get_retriever()` 重建（BM25 内存索引随之刷新）。
- LanceDB 行更新：优先 `table.update()`；若 API 不便 → 全表读出改写 overwrite（40 文档规模可接受，作为兜底实现路径）。
- **集成协议**：本文件不改 main.py——由整合者统一加 `include_router`，避免并行冲突。

### 4.2 前端 `/kb` 页面

- 路由 `app/kb/page.tsx`，Sidebar 底部加「知识库」入口（现有 Sidebar 加一行链接）。
- 结构：文档表（标题/分类/切片数）→ 点开展开切片列表 → 行内编辑 textarea → 保存（PUT）→ 顶部「重建索引」按钮 + 成功 toast。
- 纯 Tailwind，风格对齐现有页面；无鉴权（本地演示工具，与 / 同信任级）。

## 五、D 视频脚本（三段式重写）

`docs/video-script.md` 重写为三部分（对应最终视频）：

1. **效果演示（~3min）**：RAG 问答带 [1] 溯源 → 意图分流 chip 实拍（问「查订单」自动切 Agent）→ Agent 查数给建议 → 退款两段式确认 → 图生文案/语音速过
2. **功能细节（~2.5min）**：知识库管理页（编辑切片→重建→立即生效于问答）→ 会话持久化/模式徽章 → 步骤卡片 → 引用点开溯源
3. **技术架构（~1.5min）**：分层图 + 关键决策（手写 ReAct/混合检索/Provider 插件化/同源代理）+ 质量验收数字（90% 检索、27/30 评测、12/12 e2e）
   - **如实标注**：本地模拟数据，未接平台真实授权（诚实原则）

分镜脚本保留 6 镜头编号习惯，每镜：画面 / 台词 / 时长 / 对应文件。

## 六、对标参考（GitHub 调研，2026-10-25 websearch 直查）

> 调研方式说明：librarian 后台任务因本机 GitHub 直连不通（代理未开）全部卡死，已取消，改 websearch 直查。

### 6.1 意图路由

| 项目 | 做法 | 我们采纳 |
|------|------|---------|
| [NVIDIA-AI-Blueprints/llm-router](https://github.com/nvidia-ai-blueprints/llm-router) | 路由定义 = `[{name, description}]` 配置 + `intent→target` 映射表；小 LLM 做分类 | ✅ 我们的 5 类 intent + target 映射即此结构 |
| [HadeedTariq-475/RAG-Orchestration](https://github.com/HadeedTariq-475/RAG-Orchestration) | **规则关键词优先、zero-shot LLM 兜底**；intent → 选择检索路径；UI 显示 detected intent | ✅ 验证「LLM 分类 + 关键词兜底 + UI 展示路由」三件套是成熟套路 |
| [naokishibuya/llm-rag-mcp-orchestrator](https://github.com/naokishibuya/llm-rag-mcp-orchestrator) | FastAPI + Router=LLM 意图分类选 agent + SSE 编排；agent 白名单工具 | 架构最接近我们，chip 展示思路同源 |
| [aurelio-labs/semantic-router](https://github.com/aurelio-labs/semantic-router) | 向量空间毫秒级路由 + 置信度阈值，免 LLM 调用 | 备选：若 /v1/intent 延迟超标可演进为本地嵌入路由 |

### 6.2 轻量知识库管理

| 项目 | 做法 | 我们采纳 |
|------|------|---------|
| [eosphoros-ai/DB-GPT knowledge/api.py](https://github.com/eosphoros-ai/DB-GPT/blob/03e5811d/packages/dbgpt-app/src/dbgpt_app/knowledge/api.py) | `chunk/list` + `chunk/edit` 端点，分页查切片、按 chunk_id 改 | ✅ 正是我们的 GET chunks / PUT chunk 形态 |
| [paganini2008/fastrag](https://github.com/paganini2008/fastrag) | `POST /knowledge-bases/{id}/rebuild/` 重建；单文档 reindex；FAQ CRUD 自动重嵌入 | ✅ rebuild 端点 + 保存即重嵌入 |
| [gosha70/document-assistant](https://github.com/gosha70/document-assistant) | Admin 端点：collection 列表 / chunk 抽样 / `POST reindex` + 后台 job 状态 | 简化参考：我们无 job 系统，同步重建（40 文档秒级） |

### 6.3 退款确认流（HITL）

| 项目 | 做法 | 我们采纳 |
|------|------|---------|
| [nitin27may/e-commerce-agents hitl.py](https://github.com/nitin27may/e-commerce-agents/blob/main/agents/python/shared/hitl.py) | **电商场景直接对标**：`process_refund`/`cancel_order` 拦截 → 建 pending 记录 → 审批后执行 | ✅ 校验/执行分离 + pending 状态；我们用内存 token 替代 DB 表（演示规模） |
| [google/adk-python tool_confirmation](https://github.com/google/adk-python/tree/main/contributing/samples/hitl/tool_confirmation) | 工具内 `request_confirmation()` → 用户同意后**二次调用**携带 confirmed 标志 | ✅ 验证「validate → 用户确认 → 二次调用 execute」与官方模式一致 |
| [openai/openai-agents-python HITL](https://github.com/openai/openai-agents-python/blob/main/docs/human_in_the_loop.md) | `needs_approval` → run 暂停出 interruptions → approve/reject → resume | 概念同源；我们的跨轮对话即「自然的 resume」 |
| [mistralai/cookbook connectors](https://github.com/mistralai/cookbook/blob/main/mistral/connectors/04-human-in-the-loop-confirmation.md) | `requires_confirmation` 声明 + 序列化/恢复（stateless API 友好） | 拒绝不中断对话：拒绝也作为 tool result 回给模型继续答 ✅ |

## 七、执行拆解（并行批次）

```
批次 1（并行 ×4，互不碰同一文件）
  T1 backend-intent   agent/intent.py + api_intent.py（新文件）
  T2 backend-data     seed_store 扩表 + data_provider 扩展 + 3 新工具（agent/ 内）
  T3 backend-kb       api_kb.py + retrieve 单例失效钩子（新文件 + retrieve.py 小改）
  T4 video-script     docs/video-script.md 重写（纯写作）

批次 2（依赖批次 1 的契约，可与之并行）
  T5 frontend-intent  lib/intentClient.ts + chip 组件 + 自动路由（ChatWindow 发送路径）
  T6 frontend-kb      app/kb/page.tsx + Sidebar 入口

整合（我做）
  main.py include_router ×2 + 联调 + p5_api_test.py 全链路脚本
  tsc / lint / build / curl 验收 → git commit
```

**冲突避免**：各 T 只碰自己文件；`main.py` 只由整合者改；`ChatWindow.tsx` 只有 T5 碰；`Sidebar.tsx` 只有 T6 碰。

## 八、验收（Definition of Done）

1. `curl POST /v1/intent` 五类问题分类正确，坏 JSON 输入走兜底不 500。
2. RAG 模式问「查订单退款进度」→ 自动切 Agent + chip 显示；问「DSR 是什么」→ 留在 RAG + chip 显示。
3. `refund_flow` validate → execute 全链路：错金额被拒、过期 token 被拒、二次执行幂等。
4. `/kb` 编辑某切片文本 → 保存 → 重建/失效后，相关查询命中新文本。
5. 新增会话消息含 `intent` 字段持久化恢复正常，老会话无字段不报错。
6. `python` API 测试脚本（仿 p4_api_test）≥12 断言全过；`tsc && lint && build` 全绿。
7. 视频脚本三段结构完整、镜头时长合计 5-8 分钟、与实际 UI 行为一致。
8. git 提交（分 T 粒度）。
