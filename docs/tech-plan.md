# 店智 Copilot — 技术对比与架构计划书

> 2026-10-22 | 基于 9 个开源电商 AI Agent/RAG 项目调研 | 决策后执行，架构清晰优先

## 1. 结论先行（6 个架构决策）

| # | 决策 | 一句话 | 主要参考 |
|---|------|--------|----------|
| D1 | Agent 内核用 **Python 手写 ReAct 循环**（DeepSeek function calling），不引 LangChain/LangGraph | 工具只有 4-5 个，框架是负资产；手写循环比赛里讲得清、简历上是亮点 | ecom-service-agent(145★)、mini-agent |
| D2 | 后端按 **分层包结构** 重构：`backend/app/{config,prompts,agent/{loop,tools},rag,services}` + `mcp_server/` | 现在 main.py + rag/ 太平，M2 加工具后会乱 | ecom-service-agent 目录法 |
| D3 | RAG 增强：**chunk 元数据(heading_path) + 低相关拒答 + 前端引用角标渲染 + Hit@k/MRR 检索指标** | 我们的混合检索方向已被多个项目验证（BM25+向量+RRF 是共识），缺的是工程细节 | talon1126/agent、OmniMerchant、mini-agent |
| D4 | MCP 独立 **FastMCP server** 暴露 kb_search + data_query | 比赛评分项(4%)，标准做法就是独立进程 + stdio/HTTP | ecom-service-agent/mcp_server、ecommerce-retail-rag-mcp |
| D5 | **Agent 过程可视化**：每次请求生成 tool_call trace，前端渲染为步骤卡片 | 评分的"用户体验"差异化点；实现只是 trace JSON → UI | OmniMerchant(轨迹回放)、merchant-agent(进度回调) |
| D6 | 评测 v2：**golden set + 引用有据评分**（回答必须能对上 [n] 原文才算满分） | C10 初测发现 DeepSeek 裸模型常识题已很强，RAG 优势要在"有据性"上评 | talon1126(指标体系)、ecommerce-retail-rag-mcp(RRF 对比实验) |

## 2. 开源项目对比（调研原始材料）

| 项目 | ★ | 技术栈 | 对我们的启发 | 不采纳的部分 |
|------|---|--------|--------------|--------------|
| [HuaiNan54321/ecom-service-agent](https://github.com/HuaiNan54321/ecom-service-agent) | 145 | Python, 手写 ReAct, MCP, 可插拔 RAG 后端 | **目录分层法**（config/prompts/schemas/agent/tools/rag/evaluation）；工具注册表模式；MCP client/server 分离 | Memory/Skill/Multi-Agent（超范围） |
| [yyf2002-oos/merchant-agent](https://github.com/yyf2002-oos/merchant-agent) | 78 | DeepSeek+Ollama 路由, ReAct, MySQL+Milvus | 降级容错（主模型挂了自动切）；对话分阶段检索（售前/售后…）可做 M3 亮点 | Gradio UI（我们要自研前端拿工程分）；重依赖栈 |
| [RyanCoreAI/OmniMerchant](https://github.com/RyanCoreAI/spring-ai-crossborder-customer-service) | 12 | Spring AI, Evidence-Grade RAG | **RAG 链路全景**：BM25+Vector+RRF+邻居窗+rerank 兜底+context pack+证据分级+引用；高危操作人工审批（我们 M3 可加"执行类工具先确认"）；200 条确定性评测 | Java 全家桶；多租户/渠道连接器（远超范围） |
| [talon1126/agent](https://github.com/talon1126/agent) | 1 | LangChain/LangGraph, CrossEncoder, Self-RAG | 按标题层级分块保留 section path；Hit@k/MRR/NDCG 检索评估；RAG trace 计时 | LangGraph 依赖；LoRA 微调（无 GPU） |
| [sxt12356/mini-agent](https://github.com/sxt12356/mini-agent) | 0 | 手写 agent loop, pgvector, pytest | 手写循环的**清晰范式**（tool schema 管理 + router + human-in-the-loop）；低相关度拒答 | Postgres/pgvector（我们 LanceDB 嵌入式已够） |
| [upsidelab/enthusiast](https://github.com/upsidelab/enthusiast) | 176 | Django/PG/React, MIT | 商业框架的定位参考（我们是比赛 demo，不走平台化） | Django 重栈 |
| [RTY798/ai-customer-service-agent](https://github.com/RTY798/ai-customer-service-agent) | 2 | LangGraph 多 Agent | Router→Specialist 分流思路（M3 可选"售前/售后路由"） | 5-Agent 编排（单人一月做不透） |
| [Vanity-1/ecommerce-retail-rag-mcp](https://github.com/Vanity-1/ecommerce-retail-rag-mcp) | — | Google ADK, 自研 RRF | **RRF 对比实验报告格式**（直接拼接 vs RRF 的命中率表）→ 我们的 C10 报告可以照此做检索层对比 | Google ADK；Ollama 本地模型 |
| [whichmen/dxl-commerce-agent](https://github.com/whichmen/dxl-commerce-agent) | — | 多平台自动回复, Playwright/RPA | 生产级自动回复的边界意识（串行会话、去重、人工接管）——写进"扩展方向"即可 | 浏览器/RPA 自动化（合规风险，比赛不做） |

**未列入对比但重要的背景项目**：RAGFlow（文档解析重，我们文档是纯 md，不需要）、Dify/FastGPT（低代码平台，用它们 = 放弃"自研 Agent"这个最大加分项）、QAnything（重排思路已吸收到 D3）。

## 3. 目标架构（重构后，清晰分层）

```
浏览器 (Next.js)
 │  聊天流式渲染 + Agent 步骤卡片(trace) + 引用角标[1]点击查看原文
 ▼
FastAPI  backend/app/
 ├── api/routes          # /v1/chat/completions（OpenAI兼容）/health /v1/agent/* 
 ├── agent/
 │   ├── loop            # D1: 手写 ReAct（工具调用循环 + trace 采集）
 │   └── tools           # 注册表 + kb_search / data_query / copywriting / policy_check
 ├── rag                 # D3: pipeline(分块/嵌入/索引) + retrieve(混合检索) + 拒答判定
 ├── services            # DeepSeek/GLM-4V 客户端封装、样例店铺数据
 ├── prompts             # 系统提示词集中管理
 └── config              # 环境变量/开关统一入口
 ▼
外部: DeepSeek API · GLM-4V · (可选)SiliconFlow
mcp_server/ (独立进程, FastMCP) ── 复用 app/agent/tools ── MCP Inspector 可测
```

不变式：**前端永远不直连任何模型 API**；一切 AI 能力走 FastAPI（比赛规则：后端仅作 AI 接入层）。

## 4. 执行计划（按周，对齐 PLAN.md M2/M3）

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0 架构整理**（半天） | main.py/rag → app/ 包结构平移，行为零变化；PLAN.md M2 同步改口径 | health/chat/C9/C11 全绿 + lint/build 绿 + 提交 |
| **P1 Agent 内核**（1-2 天） | 手写 ReAct + 工具注册表 + kb_search（复用 retrieve）+ data_query（预置店铺样例数据）+ trace 透传；前端最小步骤卡片 | 提问"查店铺数据并给建议"能多步调用工具并逐步显示 |
| **P2 MCP + 多模态**（2-3 天） | FastMCP server（kb_search/data_query）；商品图上传→GLM-4V→文案；Web Speech 语音输入（前端原生） | MCP Inspector 调通；图生文案可用；语音可用 |
| **P3 打磨+材料**（1 周） | 评测 v2（引用有据评分 + 检索指标）；UI/UX 打磨；README/架构图/演示视频/技术文档 PDF | C1-C25 终验 + 提交材料齐 |

## 5. 明确不采纳清单（防止范围蔓延）

- ❌ LangChain/LangGraph/Dify/FastGPT：依赖重、黑盒，削弱自研叙事
- ❌ 多 Agent 编排 / 长期记忆 / LoRA 微调：投入产出比不匹配剩余工期
- ❌ Postgres/Milvus/Redis：LanceDB + 内存单例对 demo 规模足够
- ❌ 浏览器/RPA 自动回复：合规与稳定性风险
- ❌ 前端换 Vue/模板引擎：比赛评分明文偏好 React/Next + TypeScript

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| P1 Agent 循环把流式响应搞复杂 | trace 与文本分离：文本仍走 SSE text-delta，工具步骤走独立事件类型，前端分别渲染 |
| DeepSeek 限流打断评测（已发生，见 docs/rag-eval.md） | 重试已内置（指数退避）；评测 v2 增加题间隔 |
| 重构引入回归 | P0 是纯平移不改逻辑；每阶段跑 C8-C11 + tsc/lint/build |
