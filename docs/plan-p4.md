# P4 计划 — 真实落地改造（对标 GitHub 成熟项目）

> 触发：对标调研（2026-10-24，三路并行：电商 AI 客服项目 × 界面布局最佳实践 × 中文开源客服项目）。
> 结论：技术骨架（RAG/Agent/SSE/MCP）已达比赛要求，但 6 处「玩具信号」会拉低真实落地感。

## 一、差距对比（成熟项目 vs 我们）

| # | 差距 | 对标项目与做法 | 我们现状 |
|---|------|--------------|---------|
| 1 | 会话零持久化 | Cognify / open-webui / 晨星客服：侧边栏会话列表，建/删/改名，DB 持久化 | 刷新全丢 |
| 2 | 纯文本渲染 | LobeChat / Cognify：markdown 代码块/表格/列表全渲染 | whitespace-pre-wrap 死文本 |
| 3 | 引用角标不可点 | OmniMerchant Evidence-Grade RAG：引用可溯源核对 | [1] 是死文字 |
| 4 | data_query 硬编码 dict | RTY798/ai-customer-service-agent：ECommerceDataProvider 接口 + `.env` 换数据源；知微客服：工具直连 MySQL 真实 SQL | 写死样例 dict，note 自嘲"样例数据" |
| 5 | 消息无操作条 | Cognify / open-webui：hover 复制 / 重新生成 / 点赞 | 无 |
| 6 | 无设置面板 | EcomChatBot LLM Playground：RAG 开关 / token 统计 | 无 |

已有且不差：空状态引导、停止生成、错误重试、多轮上下文、SSE 流式、Agent 步骤卡片、语音/图片。

## 二、范围（做 5 项，明确不做）

**做**：① 会话持久化+侧边栏 ② Markdown 渲染 ③ 引用角标点击溯源 ④ 数据源 Provider 插件化（SQLite 30 天种子库 + 真实 SQL）⑤ 消息 hover 操作条（复制/重新生成）。

**不做**（边际低或超出单人周期）：登录/多用户、管理后台、点赞点踩持久化、对话导出、暗色主题、设置面板（RAG 开关已有 body.rag 通道，UI 化推迟）。

## 三、API 契约（前后端并行开发基准）

### 3.1 会话存储（SQLite stdlib，`data/app.db`，gitignore）

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/v1/sessions` | - | `[{id,title,mode,updated_at}]` 降序 |
| POST | `/v1/sessions` | `{title?,mode}` | `{id,title,mode,messages,created_at,updated_at}` |
| GET | `/v1/sessions/{id}` | - | 同上（messages 为 JSON 数组原样回放） |
| PATCH | `/v1/sessions/{id}` | `{title?, mode?}` | `{ok:true}`（mode 用于空会话原地切换 RAG/Agent；两字段至少一个） |
| DELETE | `/v1/sessions/{id}` | - | `{ok:true}` |
| PUT | `/v1/sessions/{id}/messages` | `{messages:[...],title?}` | `{ok:true}` 全量覆盖（存前端消息原结构：RAG=UIMessage[]，Agent={role,content,steps?}[]） |

- `mode ∈ {rag, agent}`；首条 user 消息自动截 20 字作 title（前端在 PUT 时带上，后端不理解语义）。
- 前端保存时机：消息数变化后 debounce 1.5s + 切会话前强制 flush。

### 3.2 引用溯源

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/v1/rag/search` | `?q=...&k=4` | `[{title,category,source,text,url}]` |

- 与生成端 `_build_rag_system` 同一 `retrieve()`、同编号顺序 → 角标 [n] 即返回体第 n 项。
- 前端：点角标 → 用「该轮 user 消息」为 q 拉取（会话内缓存）→ 弹卡片显示 title/category/text[0:300]。

### 3.3 数据源 Provider 插件化（对标 RTY798 三步接入法）

```
backend/app/agent/data_provider.py
├── class DataProvider(Protocol):  get_snapshot(date) -> dict  # 唯一契约
├── class SqliteStoreProvider       # 默认：SELECT 真查 data/store.db
├── class MockProvider              # 兜底：现 _MOCK_SHOP_DATA（索引缺失时）
└── DATA_PROVIDER=sqlite|mock 环境变量切换（.env.example 注释说明）
```

- `data/store.db`：30 天日粒度经营数据（gmv/orders/visitors/conversion/refund_rate + 商品销量 + 流量来源），`python -m backend.app.agent.seed_store` 生成（幂等）。
- data_query 工具改调 provider，返回体带 `{"source":"sqlite"}` 可见字段——演示时可展示「真实 SQL 查询」叙事。
- 接入真实店铺 = 实现同一 Protocol（README 写清三步）。

## 四、前端改造

```
app/api/v1/[...path]/route.ts  同源 catch-all 代理 → BACKEND_URL（会话/溯源 API 不直连 8000）
app/page.tsx           flex 布局：ChatWindow 内含 Sidebar(左 260px, 可折叠) + 聊天列
components/Sidebar.tsx 新建会话按钮 + 会话列表(mode 徽标/改名/删除两步确认)
components/MarkdownText.tsx  react-markdown+remark-gfm；fence-aware 预处理；[n]→#cite-n 可点角标
components/CitationCard.tsx  右下溯源卡片（title/category/text[0:300] + 遮罩关闭）
components/MessageActions.tsx hover 显示：复制 / 重新生成（仅最后一条 assistant）
components/MessageBubble.tsx 统一 {role,text} 入口，双模式共用（assistant 走 MarkdownText）
components/ChatWindow.tsx  接 useSessions/agentRun；引用缓存懒加载；贴底自动滚动；Sidebar 布局
lib/sessionsClient.ts  会话 CRUD + ragSearch 类型化 fetch（id=uuid 字符串，时间=epoch 秒）
lib/useSessions.ts      会话状态机 hook：debounce 1.5s + 签名守卫 + 切前 flush + 模式切换
lib/agentRun.ts         Agent 单轮执行器（SSE→步骤/文本回调，ChatWindow 拆分保持 <250 LOC）
```

- 恢复：RAG → `setMessages(UIMessage[])`；Agent → `setAgentMessages(...)`。
- RAG 重新生成 = `regenerate()`；Agent 重新生成 = 剥掉末条 assistant 用该轮 user 消息重跑。
- 引用溯源 = 按「最后一条 user 消息」调 `/v1/rag/search`（会话内 Map 缓存），Agent 模式为近似匹配。
- 依赖：`react-markdown` `remark-gfm`（唯二新增）。

## 五、验收

1. `curl` 六会话端点 + `/v1/rag/search?q=DSR` 全通。
2. 刷新页面会话与消息完整恢复（双模式各验一次）。
3. 回答中的 [1] 点击弹出来源卡片，内容与生成时检索一致。
4. `data_query` 返回 `source:"sqlite"`，Agent 步骤卡片照常。
5. markdown 加粗/列表/表格渲染正常；消息 hover 复制/重新生成可用。
6. `npx tsc --noEmit && npm run lint && npm run build` 全绿。
7. 全部提交 git。
