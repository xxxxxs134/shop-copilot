# 店智 Copilot 🛒

> 面向中小电商运营者的 AI Agent 智能助手：对话式完成规则答疑、运营建议、商品文案与数据解读。支持 RAG 知识库问答、多步 Agent 工具调用、商品图识别生成文案、语音输入。

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

- **RAG 问答模式**：知识库增强问答，回答带 `[1][2]` 引用角标
- **Agent 模式**：多步推理，自动调用工具（数据查询/知识库/文案/合规），界面显示步骤卡片
- **多模态**：输入框旁 🖼️ 上传商品图 → GLM-4V 生成标题/卖点/描述；🎤 语音输入（浏览器 Web Speech API）

## 项目结构

```
backend/
  app/
    main.py             # FastAPI 入口：三个 AI 端点
    agent/
      loop.py           # 手写 ReAct 循环（step/delta/done/error SSE 事件）
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
app/
  api/chat/route.ts     # RAG 问答代理（AI SDK streamText）
  api/agent/route.ts    # Agent SSE 透传代理
  api/vision/route.ts   # 图生文案代理
  page.tsx              # 首页
components/
  ChatWindow.tsx        # 双模式聊天主窗口（RAG/Agent + 语音/图片）
  AgentSteps.tsx        # Agent 工具步骤卡片
  MessageBubble.tsx     # 消息气泡
lib/
  ai.ts                 # AI provider（指向本地 FastAPI）
  agentClient.ts        # Agent SSE 解析器
docs/
  tech-plan.md          # 技术对比与架构计划书（9 个开源项目调研）
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
