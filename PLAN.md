# 店智 Copilot — 30 天开发计划（含验收检查）

> 项目：电商运营 AI Agent 智能助手
> 目标：2026-12-27 前提交竞赛材料（代码仓库 / 演示视频 5-8min / 技术文档 PDF ≤30页 / 可选在线演示）
> 资源：单人，每天 2-4h，截止今天约 37 天（含 7 天缓冲）

---

## 0. 总纲：评分映射（每个里程碑对应哪得分点）

| 评分维度 | 权重 | 本项目靠什么拿 | 落在哪周 |
|---|---|---|---|
| AI 大模型集成 | 8% | DeepSeek 流式对话、精设 Prompt、结构化输出稳定可控 | W1 |
| Agent/工作流 | 8% | 多步工具循环：拆解→检索→查数→生成→反思 | W3 |
| RAG | 6% | 混合检索 + 重排 + 有/无 RAG 对比测试报告 | W2 |
| 多模态 | 5% | 语音输入/播报(Web Speech) + 图片识别(GLM-4V-Flash) | W3 |
| AI 安全可控 | 4% | 输入过滤、引用兜底拒答、免责声明、输出内容审查 | W3-W4 |
| MCP/工具集成 | 4% | 独立 MCP Server（kb_search / data_query 等工具） | W3 |
| 选题创新 | 10% | 中小电商运营一站式 AI 工作台（真实痛点） | 已定 |
| 技术方案创新 | 8% | 多模型路由（文本/视觉/向量分家）+ 混合检索 + 生成式图表 UI | W2-W3 |
| 交互创新 | 7% | 语音对话 + 传商品图出文案 + Agent 思考过程可视化 | W3-W4 |
| 前端工程 | 10% | TS + ESLint/Prettier + 组件化 + 懒加载/代码分割 | 全程 |
| 实用性/UX/社会商业 | 30% | 真实运营场景、UI 打磨、SaaS 商业叙事 | W4 |

---

## 1. 技术栈（已确认，锁定不再换）

| 层 | 选型 | 备注 |
|---|---|---|
| 前端 | Next.js 14+ (App Router) + TypeScript | 官方推荐首选；只做界面与协议转换 |
| UI | Tailwind CSS + shadcn/ui + Framer Motion | |
| 前端 AI SDK | Vercel AI SDK | 流式 + Tool Calling |
| **后端 AI 层** | **Python 3 + FastAPI（uvicorn）** | 比赛定位「后端仅作 AI 能力接入层」；RAG/Agent/MCP 全长在这层 |
| 后端对接 | FastAPI 暴露 OpenAI 兼容接口 `/v1/chat/completions` | Next.js provider baseURL 指向 FastAPI，协议边界不变 |
| 文本 LLM | DeepSeek API（OpenAI 兼容） | `https://api.deepseek.com` |
| 视觉 | 智谱 GLM-4V-Flash（免费） | DeepSeek 无视觉能力 |
| 向量 | 本地 fastembed BGE-small-zh（默认，零密钥）/ SiliconFlow BGE-M3（key 后补升级） | DeepSeek 无 embedding |
| 向量库 | LanceDB 嵌入式 | 零部署 |
| 语音 | Web Speech API（浏览器端，免费） | |
| 图表 | ECharts | Agent 生成式 UI |
| MCP | @modelcontextprotocol/sdk | 独立 server |
| 状态 | Zustand + TanStack Query | |
| 包管理 | npm（环境无 pnpm，用 npm 即可） | |
| 版本 | Git + GitHub/Gitee 公开仓库 | |

**API 成本预算**：≈0 元（DeepSeek 极低成本 + 其余全免费）。
**红线**：任何密钥只进 gitignored 的 env 文件（前端 `.env.local` / 后端 `backend/.env`），仓库只有 `.env.example`。
**架构原则**：前端 Next.js 不直接调用任何 AI API；一切 AI 能力经 Python FastAPI 接入层中转（对应比赛规则「后端服务仅作为AI能力的接入层」）。

---

## 2. 里程碑计划与验收检查

### M0 — Chat Demo（D1-D2，本次任务）

**做什么**
- [x] 写本计划文档
- [x] Next.js 脚手架：TypeScript + Tailwind + App Router + ESLint/Prettier
- [x] `git init` + 语义化提交
- [x] 聊天页面：消息列表 + 输入框 + 流式打字机渲染 + 加载/错误状态（代码完成）
- [x] `.env.example` + README 骨架
- [ ] **M0b-Python**：FastAPI 后端（OpenAI 兼容 `/v1/chat/completions` 流式中转 DeepSeek）
- [ ] 前端 provider baseURL 切换为 FastAPI（`AI_BASE_URL` 环境变量，默认 `http://127.0.0.1:8000/v1`）

**如何检查（逐条执行并记录结果）**
```bash
# C1 依赖安装成功
npm install                     # 退出码 0

# C2 类型检查通过（无 TS 错误）
npx tsc --noEmit                # 退出码 0，无输出

# C3 Lint 通过
npm run lint                    # 退出码 0

# C4 生产构建成功
npm run build                   # 退出码 0，无 error

# C5 开发服务器可启动，页面可访问
npm run dev                     # 另开窗口：
curl http://localhost:3000      # HTTP 200，返回 HTML

# C6 真实对话可用（需在 backend/.env 填入 DEEPSEEK_API_KEY）
# 先起后端：uvicorn backend.main:app --port 8000
# 再起前端：npm run dev
# 手动：浏览器打开 localhost:3000，发送"你好"，
# 期望：回答逐字流式出现（不是一次性蹦出）；断网/错 key 时报错提示优雅不白屏

# C6b Python 后端自检
curl http://127.0.0.1:8000/health                     # HTTP 200 {"status":"ok"}
curl -X POST http://127.0.0.1:8000/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"deepseek-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":true}"
# 无 key 时返回 400 中文提示；有 key 时返回 SSE 流

# C7 Git 规范
git log --oneline               # ≥3 条有语义的提交（脚手架/聊天API/聊天UI 分开）
git status                      # 干净，无待提交文件
# 密钥泄露检查：仓库内任何文件不得出现真实 sk- 开头 key
grep -r "sk-" --include="*.*" . --exclude-dir=node_modules # 只允许出现在 .env.local（已被忽略）
```

**通过标准**：C1-C7 全绿 = M0 完成，进入 M1。

---

### M1 — RAG 知识库（D3-D10，W2）

**做什么**
- [ ] 语料收集：M1 首批种子 40 篇（平台规则/方法论，`data/raw/*.md`），后续扩到 300-500 篇
- [ ] 处理管线（Python）：清洗 → 按标题+段落分块（≈512 token，128 overlap）
- [ ] 向量化：fastembed BGE-small-zh 本地默认（`EMBED_PROVIDER=siliconflow` 时切 BGE-M3）→ 写入 LanceDB（`data/index/`）
- [ ] 检索 API（Python）：向量检索 + BM25 关键词检索（RRF 融合）→ top-k
- [ ] 问答接入：FastAPI 检索结果注入 system prompt，回答带 `[1][2]` 引用角标（RAG 可开关）
- [ ] **对比测试**：固定 20 个问题，"开 RAG vs 关 RAG"自动打分，结果存 `docs/rag-eval.md`

**如何检查**
```bash
# C8 索引构建可复现（从零重建一次成功）
Remove-Item -Recurse -Force data\index; python -m backend.rag.pipeline build   # 退出码 0，index 文件数 > 0

# C9 检索质量：自测 10 条查询，top-3 相关率 ≥ 8/10
python -m backend.rag.selftest                          # 输出测试报告，无异常

# C10 RAG 效果可证明（评分关键证据）
python -m backend.rag.eval                              # 生成 docs/rag-eval.md：20 问题对比表，有 RAG 组显著高于无 RAG 组

# C11 引用可溯源：回答中的 [1] 角标能对应到知识库原文段落
# 手动：问"保证金规则"，回答带引用，可对照知识库原文片段

# C12 回归：M0 的 C1-C7 仍全绿（不破坏已有功能）
```

---

### M2 — Agent + MCP + 多模态（D11-D18，W3）

**做什么**
- [ ] Agent 内核：Vercel AI SDK 多步工具循环（maxSteps），工具前 4 个：
  - `kb_search`（M1 的 RAG 检索）
  - `data_query`（查预置店铺样例数据 → 返回结构化数据）
  - `copywriting`（商品文案生成）
  - `policy_check`（平台规则核查，内部走 kb_search）
- [ ] 生成式图表：`data_query` 结果 → 前端 ECharts 渲染
- [ ] MCP Server：独立包 `mcp-server/`，stdio/SSE 暴露 kb_search + data_query
- [ ] 语音：Web Speech API 输入（STT）+ 回答播报（TTS），开关按钮
- [ ] 图片识别：上传商品图 → GLM-4V-Flash → 识别描述 → 接入文案生成
- [ ] Agent 思考可视化：工具调用过程逐步展开（UI 动画）
- [ ] AI 安全：输入敏感词过滤、无检索依据时拒答话术、免责声明

**如何检查**
```bash
# C13 Agent 多步调用真实发生
# 手动问："帮我查一下上周店铺数据，再生成一份周报"
# 期望：界面依次显示 调用 data_query → 调用生成 → 输出含图表的周报

# C14 MCP Server 可独立启动并被调用
npx @modelcontextprotocol/inspector node mcp-server/index.js
# inspector 中调用 kb_search 返回检索结果

# C15 语音：麦克风按钮 → 说出问题 → 文本进输入框；回答可点击播报
# C16 图像：上传一张商品图 → 返回识别结果并生成卖点文案
# C17 安全：输入违规内容被拦截；知识库无覆盖的问题回复"未检索到依据"而非编造
# C18 回归：C1-C12 全部仍通过
# C19 build/lint/tsc 全绿（每次提交前跑）
```

---

### M3 — 打磨 + 材料（D19-D28，W4）

**做什么**
- [ ] UI/UX：设计系统统一、暗色适配、响应式、加载骨架屏、错误边界、过渡动画
- [ ] 性能：首屏 LCP < 2.5s、路由懒加载、图片优化
- [ ] README 完整版：项目介绍 / 架构图 / 快速开始 / 环境变量模板 / 团队信息
- [ ] 技术文档 PDF ≤30 页（按大赛 7 大章节）
- [ ] 演示视频 5-8min 脚本 + 录制（1080p 普通话+字幕）
- [ ] （可选）Vercel 部署 + 评审体验账号
- [ ] 最终 Git 整理：提交历史体现真实过程

**如何检查**
```bash
# C20 Lighthouse：Performance/Best Practices ≥ 85（localhost:3000 跑分截图存档）
# C21 全功能回归走查（用 docs/demo-script.md 的演示脚本完整走一遍）
# C22 README 审查：新用户按 README 能在 10 分钟内跑起来（让朋友试或隔天自己盲跑）
# C23 材料齐套检查：
ls docs/技术文档.pdf docs/演示视频.mp4 README.md .env.example  # 全部存在
# C24 视频规格：时长 5-8min、≥1080p、有字幕（播放器查看属性）
# C25 密钥终扫：grep -r "sk-" 全仓库（排除 .env.local/node_modules）无真实密钥
```

---

## 3. 风险与回退

| 风险 | 触发信号 | 回退方案 |
|---|---|---|
| DeepSeek 免费额度/网络不稳 | C6 连续失败 | 换智谱 GLM-4-Flash 免费档做备胎（代码里 provider 抽象，一行切换） |
| 语料收集超时 | D8 仍 <100 篇 | 砍到 150 篇精选，RAG 对比测试照做（质量>数量） |
| 语音浏览器兼容差 | Edge 正常 Chrome 异常 | 演示统一用 Edge（Win11 自带），文档注明 |
| 进度落后 ≥3 天 | W2 结束 M1 未完 | 砍 MCP（4%）保 RAG+Agent（14%），或砍图像识别保语音 |
| 视频录制返工 | 一次不过 | 逐段录制（每段 1min），脚本固定减少重来 |

**硬约束**：D28 后不再加新功能，只修 bug 和写材料。

---

## 4. 提交材料对照（D28 时逐项打勾）

- [ ] GitHub/Gitee Public 仓库，README 含项目介绍/架构/运行指南/团队信息
- [ ] `.env.example` + 依赖清单 + 完整 git 历史
- [ ] 演示视频 MP4 5-8min 1080p 普通话
- [ ] 技术文档 PDF ≤30 页（概述/需求/架构/AI方案/实现/测试部署/展望 + 创新点）
- [ ] （加分）公网演示地址 + 评审账号

---

## 5. 每日工作检查（当日完成判据）

每天收工前跑一遍：
```bash
npx tsc --noEmit && npm run lint && npm run build && git status
```
四者全绿 + 今日计划项完成 → `git commit` 写清楚做了什么 → 更新本文档勾选状态。
