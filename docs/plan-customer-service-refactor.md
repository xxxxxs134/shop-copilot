# 店智 Copilot — 客户服务 Agent 改造计划

> 方向变更：从「中小电商运营者的 AI 工作台」→「面向客户的电商全链路客服 Agent（售前+售后）」。
> 参考项目：[RTY798/ai-customer-service-agent](https://github.com/RTY798/ai-customer-service-agent)（LangGraph 多 Agent）+ 阿里云 LoongSuite 电商客服示例。
> 日期：2026-11-10 · 状态：待实施。

---

## 1. 背景与目标

**评审反馈 + 用户决策**：
1. 预赛 73 分，评委唯一扣分「错误处理可以再友好些」——已修完。
2. 用户决定改方向：**砍掉运营工作台，做成面对客户的客服 Agent**，售前要**智能推荐**。
3. 技术决策：**引入 LangGraph**（放弃手写 ReAct）——多 Agent 编排是 LangGraph 主场，工业级项目普遍采用。

**目标一句话**：客户进对话，Agent 判断售前/售后，调用对应工具（查商品/库存/推荐，或查订单/退款/退货），最后由终审节点审查防幻觉，投诉自动生成工单。

---

## 2. 参考项目架构

### RTY798/ai-customer-service-agent（6 agent）
```
graph.py（StateGraph 编排）
 ├── router_agent     意图分类
 ├── knowledge_agent  RAG 知识库检索
 ├── tool_agent       Function Calling 工具
 ├── summary_agent    终审汇总
 └── escalation_agent 工单升级
```

### LoongSuite 电商客服（5 节点，更清晰）
```
intent_router → presales | aftersales | clarify → response_review → 最终回复
```
| 节点 | 职责 | 工具（售前/售后完全隔离） |
|---|---|---|
| intent_router | LLM 识别售前/售后/意图不明 + 置信度 | — |
| presales | 商品咨询/推荐/库存 | search_product_catalog / query_product_knowledge / check_inventory |
| aftersales | 订单/售后政策/问题评估 | lookup_order_history / query_after_sales_policy / assess_issue |
| clarify | 置信度不足 → 追问 | — |
| response_review | **只保留有工具证据的话**，防幻觉 | — |

---

## 3. 目标架构

### 3.1 LangGraph StateGraph（后端 `backend/app/agent/`）

```
START
  → intent_router（LLM 结构化分类 + 置信度）
  → 条件边:
     ├─ clarify（置信度低）→ 生成追问 → END
     ├─ presales → presales_agent（ReAct + 售前工具）
     └─ aftersales → aftersales_agent（ReAct + 售后工具）
  → response_review（终审：过滤无证据内容 + 统一语气）
  → 条件边: 投诉/升级意图 → escalation_agent（生成工单）
  → END
```

### 3.2 State

```python
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]  # 对话历史
    intent: str          # presales / aftersales / clarify
    confidence: float    # 意图置信度
    draft: str           # specialist 草稿
    evidence: list       # 工具证据（传给终审）
    final: str           # 终审回复
    escalation: dict | None  # 工单
```

### 3.3 工具分配（售前/售后隔离，对齐 LoongSuite「职责边界」）

| Specialist | 工具 | 来源 |
|---|---|---|
| **售前** | search_product_catalog（商品目录检索） | 现有 product_lookup 改造 |
| | check_inventory（库存查询） | **新增** |
| | recommend_products（智能推荐） | **新增** |
| | query_product_knowledge（商品知识 RAG） | 现有 RAG + 商品知识库 |
| **售后** | lookup_order_history（订单历史） | 现有 order_lookup |
| | query_after_sales_policy（售后政策 RAG） | 现有 RAG |
| | assess_issue（问题评估） | 现有 escalation 改造 |
| | refund_flow（退款，HITL） | 现有，改 Checkpointer + interrupt() |
| | modify_address / intercept_logistics / return_exchange | 现有，保留 |

**砍掉的工具**（运营导向，客服用不到）：`data_query`（看 GMV/趋势）、`copywriting`（写文案）、`policy_check`（违规自查）——随工作台一起移除。

### 3.4 前端（2 入口，砍 2）

| 页面 | 处置 |
|---|---|
| `/chat` 对话 | **改造**：客户视角（去掉场景卡/模式切换，客户不知道 RAG/Agent 之分） |
| `/kb` 知识库 | **保留**：商家维护商品知识/售后政策，Agent 检索 |
| `/workspace` 工作台 | **砍** |
| `/data` 数据 | **砍**（商品/订单数据内化到 Agent 工具 + 知识库） |

### 3.5 智能推荐设计

- 数据：`products` 表现有字段 `sku/name/price/stock/status/category`（12 个商品）。
- 推荐逻辑：LLM 从客户需求抽取 `{预算, 品类, 场景, 关键词}` → 按 `category`/`price`/`name` 关键词过滤排序 → LLM 生成推荐理由。
- 若需要更强的推荐，扩 `products` 表加 `tags`（卖点标签）字段 + `seed_store.py` 补数据。

---

## 4. 现状 → 目标映射

| 现有 | 处置 |
|---|---|
| `agent/loop.py`（手写 ReAct） | **替换**为 `agent/graph.py`（LangGraph StateGraph） |
| `agent/intent.py` | 改为 `graph.py` 内 intent_router 节点（售前/售后/澄清） |
| `agent/tools/`（10 工具） | 拆分到售前/售后两个 specialist |
| `rag/`（BM25+向量 RRF） | **保留**，供商品知识 + 售后政策检索 |
| `data_provider.py` | **保留**，加商品目录/库存查询方法 |
| `errors.py` + 错误处理 | **保留**（刚做完的） |
| SSE 协议（step/delta/done/error） | **保留**，`astream_events` 映射到现有事件 |
| 前端 ChatWindow | 改造为客户视角 |
| `positioning.md` | **重写**：定位「电商客服 Agent」，删禁止词表 |

---

## 5. 分阶段任务

### P0 — 后端 LangGraph 骨架（最小可跑）
1. `pip install langgraph langchain-core`（进 `requirements.txt`）
2. 新建 `agent/graph.py`：`AgentState` + `intent_router` + `presales/aftersales` 占位节点 + `response_review` + 条件边
3. 新建 `agent/router.py`：售前/售后/澄清 结构化分类提示词
4. `main.py` `/v1/agent/chat` 改为调 graph（`astream_events` → 现有 SSE 事件）
5. 验收：问「你们有什么商品」「订单 SO... 到哪了」「能帮帮我吗」三条路都能路由 + 流式回复

### P1 — 售前工具（商品/库存/推荐）
1. `data_provider.py` 加 `get_products(keyword)` / `get_inventory(sku)` 方法
2. 新增 `search_product_catalog` / `check_inventory` / `recommend_products` 三个工具
3. 商品知识库（`data/raw` 补商品条目，或独立商品描述）
4. 验收：问「送妈妈 300 以内的鞋」能推荐 + 给理由 + 查库存

### P2 — 前端改客户视角
1. 砍 `app/workspace/`、`app/data/`
2. `app/chat/page.tsx` + `ChatWindow`：去场景卡/模式切换，客户视角
3. `lib/` 清理（intentClient/escalateClient 等按需保留）
4. 导航改 2 入口

### P3 — 定位与文档
1. `positioning.md` 重写 + 删禁止词表
2. README / tech-doc / 场景库 同步口径

---

## 6. 验证标准

- 门禁：`tsc` / `lint` / `smoke`（smoke 脚本需同步删 workspace/data 页检查）全绿
- 三条核心链路实测：
  1. 售前：「你们有什么适合送父母的鞋」→ 路由售前 → 推荐 + 库存
  2. 售后：「我的订单到哪了」→ 路由售后 → 查订单
  3. 澄清：「帮帮我」→ 置信度低 → 追问「您是要咨询商品还是查询订单」
- 退款 HITL：`interrupt()` 挂起 → 用户确认 → 继续执行

---

## 7. 关键风险

1. **LangGraph 是加依赖**——`requirements.txt` 新增 `langgraph` + `langchain-core`（约 20MB，纯 Python，无系统依赖）。
2. **SSE 事件兼容**——`astream_events` 的事件形态与现有手写 step/delta/done 不同，需映射层，前端 `agentRun.ts` 要跟着调。
3. **砍工作台是破坏性**——`smoke.mjs`、`positioning.md`、README 里的"四个入口"口径全要改，一次做干净，避免半吊子。
4. **未提交的既有改动**——错误处理那批（~15 文件）还没提交，建议先提交锁定，再动大改，否则 diff 爆炸。
