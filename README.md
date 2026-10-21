# 店智 Copilot 🛒

> 面向中小电商运营者的 AI Agent 智能助手：对话式完成规则答疑、运营建议、商品文案与数据解读，支持流式对话（语音与多模态能力在后续里程碑加入）。

## 技术栈

- **前端**：Next.js 14+（App Router）+ TypeScript + Tailwind CSS + Vercel AI SDK
- **后端 AI 接入层**：Python 3 + FastAPI（OpenAI 兼容接口，流式中转 DeepSeek）
- **工程质量**：ESLint + Prettier

## 快速开始

需要两个终端分别启动前端与 Python AI 层：

```bash
# ── 终端 1：Python AI 接入层 ──
cd backend
pip install -r requirements.txt
copy .env.example .env        # 编辑 .env，填入 DEEPSEEK_API_KEY
uvicorn main:app --port 8000  # http://127.0.0.1:8000

# ── 终端 2：Next.js 前端（项目根目录）──
npm install
npm run dev                   # http://localhost:3000
```

打开 http://localhost:3000 即可对话。

## 项目结构

```
backend/
  main.py               # FastAPI：/v1/chat/completions 流式中转 DeepSeek
  requirements.txt      # Python 依赖
  .env.example          # 密钥模板（真实 .env 不入库）
app/
  api/chat/route.ts     # 聊天接口（streamText，指向 FastAPI）
  page.tsx              # 首页
components/
  ChatWindow.tsx        # 聊天主窗口（流式渲染/状态/错误处理）
  MessageBubble.tsx     # 消息气泡
lib/
  ai.ts                 # AI provider（baseURL 可配置，默认本地 FastAPI）
```

## 开发计划

完整 30 天里程碑与验收标准见 [PLAN.md](./PLAN.md)。

## 团队信息

- 开发者：（待填：姓名 / 学校 / 专业）
