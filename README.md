# 店智 Copilot 🛒

> 面向中小电商运营者的 AI Agent 智能助手：对话式完成规则答疑、运营建议、商品文案与数据解读，支持流式对话（语音与多模态能力在后续里程碑加入）。

## 技术栈

- **框架**：Next.js 14+（App Router）+ TypeScript
- **AI**：Vercel AI SDK + DeepSeek API（OpenAI 兼容协议）
- **样式**：Tailwind CSS
- **工程质量**：ESLint + Prettier

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
copy .env.example .env.local   # macOS/Linux: cp .env.example .env.local
# 编辑 .env.local，填入 DEEPSEEK_API_KEY

# 3. 启动开发服务器
npm run dev
```

打开 http://localhost:3000 即可对话。

## 项目结构

```
app/
  api/chat/route.ts    # 聊天接口（streamText 流式响应）
  page.tsx             # 首页
components/
  ChatWindow.tsx       # 聊天主窗口（流式渲染/状态/错误处理）
  MessageBubble.tsx    # 消息气泡
lib/
  ai.ts                # DeepSeek provider 实例
```

## 开发计划

完整 30 天里程碑与验收标准见 [PLAN.md](./PLAN.md)。

## 团队信息

- 开发者：（待填：姓名 / 学校 / 专业）
