# 店智 Copilot — PDF 技术文档大纲

> 用途：转 PDF 提交（可用 Typora / VS Code Markdown PDF 导出，或 pandoc）。预计 8-12 页。

## 1. 项目概述（1 页）

- 问题：中小电商卖家规则查询难、数据解读门槛高、文案工作重复
- 方案：对话式 AI Agent 助手——RAG 问答 + 多步工具调用 + 多模态
- 与普通聊天机器人的区别：可溯源引用、工具调用可视化、过程透明

## 2. 系统架构（1-2 页）

- 架构图（README 中的 ASCII 图可重绘为分层图）
- 关键决策（引用 docs/tech-plan.md D1-D6 精简版）：
  - D1：手写 ReAct 循环（对比 LangChain/LangGraph 的取舍）
  - D2：backend/app/ 分层包结构
  - D4：MCP 独立进程
- 数据流：一次 Agent 请求的完整时序（前端 → Next.js 代理 → FastAPI → DeepSeek → 工具 → SSE 回传）

## 3. RAG 知识库（2 页）

- 语料：43 篇种子文档，10 类，YAML frontmatter
- 管线：清洗 → 分块（800 字符/200 overlap）→ fastembed BGE-small-zh（512 维）→ LanceDB
- 检索：jieba BM25 + 向量余弦，RRF 融合（k=4）
- 评测数据表：
  - v1（20 问通用对比）：26 vs 23/40 — docs/rag-eval.md
  - v2（15 问引用有据性）：27 vs 30/30 + 结论分析 — docs/rag-eval-v2.md
  - 诚实呈现"裸模型常识强"的发现，论证 RAG 价值在私有数据/防编造/可溯源

## 4. Agent 内核（2 页）

- ReAct 循环流程图（用户输入 → DeepSeek function calling → 工具执行 → 回填 → 最终回答）
- 10 个工具规格表（name / description / 参数 / 返回）：
  kb_search、data_query、copywriting、policy_check、product_lookup、order_lookup、refund_flow、modify_address、intercept_logistics、return_exchange
- SSE 事件协议（step / step_result / delta / done / error）
- 实测案例：「查店铺今日数据并给建议」→ 2 次 data_query → 138 段流式输出
- 安全边界：MAX_STEPS=5、工具异常兜底、密钥仅存 Python 层

## 5. 多模态与 MCP（1-2 页）

- GLM-4V 图生文案：请求格式、JSON 解析兜底、降级策略（无 key 返回 400）
- Web Speech API 语音输入
- MCP：FastMCP stdio、与 agent 工具注册表复用同一实现、Inspector 验证方法

## 6. 工程质量（1 页）

- 验收清单勾选表：

| 验收项 | 状态 | 证据 |
|--------|------|------|
| tsc / eslint / next build | ✅ | 退出码 0 |
| 索引构建可复现 C8 | ✅ | pipeline build |
| 检索质量 C9 ≥80% | ✅ | selftest 90% |
| RAG 评测 C10 | ✅ | rag-eval.md / v2 |
| 引用可溯源 C11 | ✅ | [1] 角标实测 |
| Agent 多步 C13 | ✅ | 2 steps + 138 deltas |
| MCP 可独立调用 C14 | ✅ | FastMCP 4 tools |

- 目录结构、密钥管理（.env gitignore）、错误处理策略

## 7. 演示与复现（1 页）

- 双服务启动命令（README 快速开始摘录）
- MCP Inspector 测试命令
- 演示建议脚本（对应视频分镜）
- 已知边界与后续方向：语料扩充优先规则原文、ECharts 图表、TTS、敏感词过滤

---

## 导出 PDF 步骤（任选其一）

1. **VS Code**：装 Markdown PDF 扩展 → 打开本文档 → Export (PDF)
2. **Typora**：文件 → 导出 → PDF
3. **pandoc**：`pandoc docs/tech-doc.md -o tech-doc.pdf --pdf-engine=xelatex -V CJKmainfont="Microsoft YaHei"`

导出前：把大纲标题改为正式标题，各节填入正文细节（从 README / tech-plan / 评测报告摘录）。
