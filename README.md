# 店智 Copilot 🛒

> 面向中小电商运营者的 AI Agent 智能助手：对话式完成规则答疑、运营建议、商品文案与数据解读。支持 RAG 知识库问答、多步 Agent 工具调用、商品图识别生成文案、语音输入、**会话持久化与引用溯源**（P4）。

> **店智 Copilot：电商智能客服 Agent**——客户咨询、查单退款、政策答疑、转人工协同，咨询即办理。

## 🤖 Agent 能做什么

| 场景 | 客户说 | Agent 做 | 你得到 |
|---|---|---|---|
| 📦 查订单 | "SO20261025010 到哪了" | 调 order_lookup 查状态+物流 | 订单详情+预计到达 |
| 💰 退款 | "帮我退 80 块" | validate→预览→令牌→等确认 | 执行回执+售后单号 |
| 📬 改地址 | "帮我改收货地址" | 校验→预览→执行 | 地址修改确认 |
| 🚚 拦截物流 | "别发货了" | 校验→拦截→执行 | 拦截成功回执 |
| 📦 退换货 | "我要退货" | 校验→生成单据 | 退货单号+寄回地址 |
| 📚 规则 | "退货政策是什么" | RAG 检索 43 篇文档 | 有据回答+[1][2]溯源 |
| 🤝 转人工 | "我要投诉" | 生成上下文摘要+建议 | 人工坐席接手指引 |

## 💡 与同类方案对比

| 维度 | 传统客服系统 | 通用 AI 客服 | 店智 Copilot |
|---|---|---|---|
| 咨询方式 | 人工排队 | 纯问答机器人 | **咨询即办理（对话内完成操作）** |
| 敏感操作 | 人工执行 | 不碰操作 | **两段式门控（validate→confirm→audit）** |
| 转人工 | 直接排队 | 不支持 | **上下文摘要+建议+话术辅助** |
| 知识库 | 静态 FAQ | 不可编辑 | **编辑即生效** |
| AI 深度 | 无 | 纯聊天 | **RAG+Agent+多模态+MCP** |

## 🤝 人机协同

Agent 处理不了的复杂投诉，一键转人工：
- **上下文摘要**：自动整理对话关键信息
- **下一步建议**：为人工坐席提供处理建议
- **话术辅助**：生成安抚/解释/解决方案话术

## 架构

```
浏览器 (Next.js)
 │  流式对话 + Agent 步骤卡片 + 引用角标[1] + 语音/图片
 ▼
FastAPI  backend/app/          ← AI 能力唯一接入层（比赛规则要求）
 ├── api/routes                # /v1/chat/completions（RAG问答）
 │                             # /v1/agent/chat（Agent SSE）
 │                             # /v1/vision/caption（GLM-4V 图生文案）
 ├── agent/                    # 手写 ReAct 循环 + 工具注册表
 │   ├── loop                  #   DeepSeek function calling，最多 5 步
 │   └── tools                 #   kb_search / data_query / copywriting / policy_check
 ├── rag/                      # 混合检索（jieba BM25 + 向量 RRF 融合）
 │   ├── pipeline              #   分块 → fastembed 嵌入 → LanceDB
 │   ├── retrieve              #   检索 API
 │   ├── selftest              #   C9 检索质量自测
 │   └── eval                  #   C10 开/关 RAG 对比评测
 └── mcp_server/               # 独立 MCP 进程（stdio），复用 agent 工具
 ▼
外部: DeepSeek API · GLM-4V（可选）
```

**前端永远不直连任何模型 API**——一切 AI 请求走 FastAPI（密钥校验与注入都在 Python 层）。

## 技术栈

- **前端**：Next.js 16（App Router）+ TypeScript（strict）+ Tailwind CSS + Vercel AI SDK
- **后端**：Python 3.12 + FastAPI + httpx；RAG：fastembed（BGE-small-zh 本地）+ LanceDB + jieba
- **Agent**：手写 ReAct 循环（DeepSeek function calling），无 LangChain/LangGraph 依赖
- **MCP**：`mcp`（FastMCP，stdio 传输）
- **工程质量**：ESLint 9（native flat config）+ Pytest 风格自测脚本

## 快速开始

需要两个终端：

```bash
# ── 终端 1：Python AI 接入层（项目根目录执行）──
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env    # 编辑 .env，填入 DEEPSEEK_API_KEY
python -m backend.app.rag.pipeline build  # 首次：构建知识库索引
uvicorn backend.app.main:app --port 8000  # http://127.0.0.1:8000

# ── 终端 2：Next.js 前端（项目根目录）──
npm install
npm run dev                             # http://localhost:3000
```

打开 http://localhost:3000：

- **会话历史（左栏）**：刷新不丢；新建/改名/删除会话，RAG 与 Agent 徽章区分（SQLite `data/app.db` 持久化）
- **RAG 问答模式**：知识库增强问答，回答带 `[1][2]` 角标，**点击弹出来源卡片可溯源核对**
- **Agent 模式**：多步推理，自动调用工具（数据查询/知识库/文案/合规），界面显示步骤卡片
- **Markdown 渲染**：代码块/表格/列表/加粗全渲染；消息 hover 可复制、重新生成
- **多模态**：输入框旁 🖼️ 上传商品图 → GLM-4V 生成标题/卖点/描述；🎤 语音输入（浏览器 Web Speech API）

### 三步接入真实店铺数据（P4 Provider 插件化）

`data_query` 工具不再写死样例 dict，改为 `DataProvider` Protocol + `.env` 切换：

1. **看契约**：打开 `backend/app/agent/data_provider.py`，实现 `DataProvider.get_snapshot(date) -> dict`（唯一契约，返回体与现有样例同结构：gmv/orders/visitors/conversion/refund_rate + 商品销量 + 流量来源）。
2. **接数据源**：新建 `class MyShopProvider`（直连 MySQL/ERP API/CSV 均可），在 `get_provider()` 工厂里注册你的分支。
3. **切环境变量**：`backend/.env` 设 `DATA_PROVIDER=mys`（默认 `sqlite` 真查 30 天种子库，`mock` 为兜底样例；种子库用 `python -m backend.app.agent.seed_store` 重建）。

Agent 回答会带上 `source` 字段标明数据来自 sqlite / mock / 你的实现，步骤卡片照常展示。

## 项目结构

```
backend/
  app/
    main.py             # FastAPI 入口：AI 端点 + 会话持久化 + 引用溯源（/v1/sessions、/v1/rag/search）
    store.py            # SQLite 会话存储（stdlib autocommit，data/app.db 不入库）
    agent/
      loop.py           # 手写 ReAct 循环（step/delta/done/error SSE 事件）
      data_provider.py  # DataProvider Protocol（sqlite 真查 / mock 兜底，.env 切换）
      seed_store.py     # 30 天经营种子库生成器（幂等，data/store.db 不入库）
      tools/__init__.py # Tool dataclass + 注册表
      __init__.py       # 4 个工具实现（kb_search/data_query/copywriting/policy_check）
    rag/
      pipeline.py       # 语料清洗/分块/嵌入/LanceDB 索引
      retrieve.py       # BM25+向量 RRF 融合检索
      selftest.py       # 检索质量自测（C9）
      eval.py           # 开/关 RAG 对比评测（C10）
    mcp_server/__init__.py  # MCP 独立进程（FastMCP，4 tools）
  requirements.txt
  .env.example          # 密钥模板（真实 .env 不入库）
data/
  raw/                  # 40 篇种子语料（10 类 × 4 篇）
  index/                # LanceDB 索引（构建产物，不入库）
  app.db                # 会话库（构建产物，不入库）
  store.db              # 30 天经营数据（构建产物，不入库）
app/
  api/chat/route.ts     # RAG 问答代理（AI SDK streamText）
  api/agent/route.ts    # Agent SSE 透传代理
  api/vision/route.ts   # 图生文案代理
  api/v1/[...path]/route.ts  # /api/v1/* 同源代理 → FastAPI（会话/溯源，避免浏览器直连 8000）
  page.tsx              # 首页（侧边栏 + 聊天双栏）
components/
  ChatWindow.tsx        # 聊天主窗口（会话状态机接入 + 引用溯源 + 语音/图片）
  Sidebar.tsx           # 会话侧边栏（新建/改名/删除两步确认/mode 徽章）
  MarkdownText.tsx      # Markdown 渲染（fence-aware 预处理 + [n]→可点角标）
  CitationCard.tsx      # 引用来源溯源卡片（右下弹出）
  MessageActions.tsx    # 消息 hover 操作条（复制/重新生成）
  MessageBubble.tsx     # 统一消息气泡（双模式共用）
  AgentSteps.tsx        # Agent 工具步骤卡片
lib/
  ai.ts                 # AI provider（指向本地 FastAPI）
  agentClient.ts        # Agent SSE 解析器
  agentRun.ts           # Agent 单轮执行器（SSE→回调，组件瘦身）
  sessionsClient.ts     # 会话 CRUD + ragSearch 类型化 fetch
  useSessions.ts        # 会话状态机 hook（debounce 保存/签名守卫/模式切换）
docs/
  tech-plan.md          # 技术对比与架构计划书（9 个开源项目调研）
  plan-p4.md            # P4 真实落地计划书（差距对比/API 契约/验收）
  PLAN.md               # 30 天里程碑（见根目录）
  rag-eval.md           # RAG 评测报告
```

## 质量验收

```bash
python -m backend.app.rag.pipeline build   # 索引构建（C8）
python -m backend.app.rag.selftest         # 检索质量 ≥80%（C9，当前 90%）
python -m backend.app.rag.eval             # 开/关 RAG 对比（C10）
npx tsc --noEmit && npm run lint && npm run build  # 前端全绿
```

MCP Inspector 测试：

```bash
npx @modelcontextprotocol/inspector python -m backend.mcp_server
```

## 开发计划

完整 30 天里程碑与验收标准见 [PLAN.md](./PLAN.md)；
技术选型对比与架构决策见 [docs/tech-plan.md](./docs/tech-plan.md)。

## 团队信息

- 开发者：（待填：姓名 / 学校 / 专业）
