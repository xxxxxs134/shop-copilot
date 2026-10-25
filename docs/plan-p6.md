# P6 计划书：运营工作台 + 业务数据页 + 对话增强

> **动机**：评审标准「实用性 10% + 创新性 25%」直接考察真实场景感。对标同类系统，我们 AI 能力不缺，缺的是**"运营每天上班会用的工具"感**——数据看不到、待办看不到、上下文看不到。
> **目标**：把首页从"聊天框"升级为"运营工作台"，让评审一看就知道谁在用、什么时候用、解决什么问题。

---

## 一、GitHub 参考项目与可借鉴模式

| 项目 | 核心借鉴 | 对应我们的改造 |
|---|---|---|
| **MetaboCommand** (Next.js 16) | 运营 Dashboard 5 卡 KPI bar + agent 面板 + Approval Queue + Agent Action Log | 工作台首页 KPI 卡 + 待处理事项 + 操作日志 |
| **Diudiu AI 客服工作台** | 「把 AI 放进真实工作流」：工作台首页(KPI+告警+任务) → 对话中心(队列+AI建议) → AI 配置台 → 设置 | 工作台布局 + 对话侧边上下文 |
| **ecommerce-command-center** | 订单搜索/状态筛选/一键更新 + 低库存告警 + 商品列表 | /data 页设计 |
| **nitinkumar-patel/refund-agent** | Chat 左 + ReasoningLog 右（实时工具调用/结果） + RefundBadge 状态标 | 对话侧边挂订单详情 + 步骤卡片强化 |
| **Retail Dashboard** | Dashboard Overview(KPI cards + charts + top products + alerts) + Products/Orders/Customers 子页 | 工作台信息架构 |
| **NexaShoppify** | Dashboard(live metrics + revenue chart + recent orders + inventory alerts) + CSR(Tickets + AI Suggested Reply) + AI Assistant(quick actions) | 首页 quick actions 设计 |
| **Avant-Garde-AI/marketing-os UI Spec** | Dashboard 布局：Welcome Card → Metrics Row(3-4 MetricCard) → Recent Activity + Quick Skills | 组件级设计参考 |

**共性模式总结**：
1. **KPI 卡片条**（4-5 个数字卡）放页面顶部
2. **待处理事项列表**（带状态标签 + 快捷操作按钮）放右侧或下方
3. **数据表格**（搜索 + 状态筛选 + 行操作按钮）独立成页
4. **对话侧边上下文面板**（当前讨论的业务实体详情）
5. **操作日志/时间线**（可展开查看详细信息）

---

## 二、三块改造详细设计

### 改造 1：首页 → 运营工作台（/workspace）

**布局**（参考 MetaboCommand + marketing-os UI Spec）：

```
┌─────────────────────────────────────────────────────┐
│  欢迎栏：「早上好，今日经营概览」         [快速提问]  │
├──────────────┬──────────────────────────────────────┤
│  KPI 卡片条（4 张）                                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │今日GMV │ │订单数  │ │退款率  │ │转化率  │       │
│  │ ¥12,580│ │   42   │ │  3.2%  │ │  2.8%  │       │
│  │ ↑12%   │ │ ↑8%    │ │ ↓0.5%  │ │ ↑0.3%  │       │
│  └────────┘ └────────┘ └────────┘ └────────┘       │
├──────────────┴──────────────────────────────────────┤
│  待处理事项（3 条）              │  快捷操作          │
│  ┌────────────────────────┐     │  ┌──────────────┐ │
│  │ 🔴 SO20261025016 退款中 │     │  │ 💬 问 AI 助手 │ │
│  │    金额 ¥80 · 2天前     │     │  │ 📊 看经营数据 │ │
│  │    [处理]              │     │  │ 📦 管理知识库 │ │
│  ├────────────────────────┤     │  │ 📋 查看订单   │ │
│  │ 🟡 SO20261025017 退货中 │     │  └──────────────┘ │
│  │    金额 ¥129 · 3天前    │     │                   │
│  │    [处理]              │     │  今日活跃会话      │
│  ├────────────────────────┤     │  ┌──────────────┐ │
│  │ 🟠 SO20261025011 被拒   │     │  │ RAG · 查退款 │ │
│  │    金额 ¥119 · 2天前    │     │  │ Agent · 退80 │ │
│  │    [复查]              │     │  └──────────────┘ │
│  └────────────────────────┘     │                   │
└─────────────────────────────────┴───────────────────┘
```

**数据来源**：
- KPI 卡：`get_snapshot()`（已有 30 天经营数据）→ 取今日指标
- 待处理事项：`aftersales` 表 WHERE status IN ('refunding','rejected')
- 快捷操作：导航入口（问 AI → 聊天页 / 看数据 → /data / 知识库 → /kb）
- 活跃会话：`app.db` 最近 5 条会话

**新增组件**：
- `components/MetricCard.tsx` — KPI 数字卡（值 + 趋势箭头 + 趋势色）
- `components/PendingItem.tsx` — 待处理事项行（状态标签 + 金额 + 操作按钮）
- `components/QuickAction.tsx` — 快捷操作卡（图标 + 文字 + 链接）
- `components/RecentSession.tsx` — 最近会话行（模式徽章 + 标题 + 时间）

**新增后端端点**：
- `GET /v1/workspace/summary` → `{kpis: {...}, pending: [...], recent_sessions: [...]}`
- 实现文件：`backend/app/api_workspace.py`（新），main.py 加 1 行 include_router

**路由**：`/workspace`（新页面），首页 `/` 改为 redirect 到 `/workspace`

---

### 改造 2：/data 业务数据只读页

**布局**（参考 ecommerce-command-center + Retail Dashboard）：

```
┌─────────────────────────────────────────────────────┐
│  业务数据                              [搜索_______] │
│  [订单] [商品] [售后单]                              │
├─────────────────────────────────────────────────────┤
│  筛选: [全部▾] [已付▾] [已发▾] [退款中▾] [被拒▾]    │
├─────────────────────────────────────────────────────┤
│  订单列表                                            │
│  订单号        商品        金额   状态    日期  操作 │
│  SO20261025010 连衣裙     ¥159  退款中  10-23 [对话]│
│  SO20261025011 手机壳     ¥119  被拒    10-23 [对话]│
│  SO20261025012 耳机       ¥199  已付    10-22 [对话]│
│  ...                                                │
├─────────────────────────────────────────────────────┤
│  显示 1-20 / 共 20 条          [< 1 2 3 >]          │
└─────────────────────────────────────────────────────┘
```

**三个 Tab**：
- **订单**：订单号 / 商品 / 买家 / 金额 / 状态 / 日期 / [开始对话]
- **商品**：SKU / 名称 / 价格 / 库存 / 分类 / [开始对话]
- **售后单**：售后单号 / 订单号 / 类型 / 金额 / 状态 / 日期 / [开始对话]

**「开始对话」按钮行为**：自动填入输入框「帮我处理 SO20261025016 的退款」并跳转到聊天页

**数据来源**：`get_provider().get_orders()` / `.get_products()` / `.get_aftersales()`（已有）

**新增组件**：
- `components/DataTable.tsx` — 通用数据表（搜索 + 筛选 + 分页 + 行操作）
- `components/StatusBadge.tsx` — 状态标签（不同状态不同颜色）
- `components/FilterBar.tsx` — 筛选栏（下拉选择器）

**路由**：`/data`（新页面）

---

### 改造 3：对话增强——侧边订单详情面板

**行为**：
- 当对话消息中检测到订单号（正则 `SO\d{12}`），右侧浮出订单详情卡
- 详情卡内容：订单号 / 商品 / 买家 / 金额 / 状态 / 时间线（下单→支付→发货→售后）
- 退款执行成功后，时间线新增「已退款」节点
- 手动关闭按钮

**布局**：
```
┌──────────────────────────────────────────────┬────────────┐
│  聊天主区域                                  │ 订单详情   │
│                                              │ ┌────────┐ │
│  [意图chip] 查订单退款进度…                  │ │SO..016 │ │
│                                              │ │无线蓝牙│ │
│  Agent 步骤卡片…                             │ │ ¥159   │ │
│  退款进度汇总表…                             │ │ 已退款 │ │
│                                              │ ├────────┤ │
│  「SO20261025016 退80元」                    │ │ 时间线 │ │
│                                              │ │ 10-23↓ │ │
│  ✅ 执行回执…                                │ │ 10-23支│ │
│                                              │ │ 10-23退│ │
│                                              │ └────────┘ │
│                                              │      [关闭]│
└──────────────────────────────────────────────┴────────────┘
```

**数据来源**：前端正则检测订单号 → 调 `GET /v1/data/order/{id}`（已有 product_lookup/order_lookup 改造）

**新增组件**：
- `components/OrderDetailCard.tsx` — 订单详情浮出卡（含时间线）
- `components/OrderTimeline.tsx` — 订单状态时间线

**修改文件**：
- `components/ChatWindow.tsx` — 增加订单号检测 + 侧边面板状态管理
- `components/MessageBubble.tsx` — 不改（订单号识别放 ChatWindow 层）

---

## 三、实施拆解

| 任务 | 范围 | 产出文件 | 依赖 |
|---|---|---|---|
| T1: 后端 /v1/workspace/summary | 新建 api_workspace.py + main.py include_router | api_workspace.py、main.py | 无 |
| T2: 前端 MetricCard/PendingItem/QuickAction/RecentSession | 4 个新组件 | components/*.tsx | T1 |
| T3: /workspace 页面 | 首页改造 + redirect | app/workspace/page.tsx、app/page.tsx | T2 |
| T4: /data 页面 + DataTable/StatusBadge/FilterBar | 3 个新组件 + 1 个页面 | components/DataTable.tsx 等、app/data/page.tsx | 无 |
| T5: OrderDetailCard/OrderTimeline | 2 个新组件 + ChatWindow 集成 | components/OrderDetailCard.tsx 等、ChatWindow.tsx | 无 |
| T6: 路由 + 导航更新 + Sidebar 入口 | 修改 Sidebar 加 /workspace、/data 链接 | components/Sidebar.tsx | T3/T4 |
| T7: 集成验收 | tsc + lint + build + 浏览器实测 | — | T1-T6 |

**并行策略**：
- T1（后端）∥ T4（/data 页）∥ T5（订单详情）
- T2 → T3 → T6（串行）
- T7 收尾

---

## 四、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 首页显示 4 张 KPI 卡 + 待处理事项 + 快捷操作 | 浏览器实测截图 |
| 2 | /data 页三 Tab 数据表可搜索/筛选/分页 | 浏览器实测截图 |
| 3 | 讨论订单号时侧边浮出订单详情卡 | 浏览器实测截图 |
| 4 | 待处理事项点「处理」→ 跳转聊天并预填问题 | 浏览器实测 |
| 5 | /data 行点「开始对话」→ 跳转聊天并预填订单号 | 浏览器实测 |
| 6 | tsc + lint + build 全绿 | 命令行 |
| 7 | /v1/workspace/summary 返回正确 JSON | API 测试 |

---

## 五、与评审标准对齐

| 评审维度 | 提升点 |
|---|---|
| **实用性 10%**（场景真实性+方案有效性） | 工作台/数据页/订单详情 = "运营每天用的工具"，不再是"聊天 demo" |
| **创新性 25%**（选题创新 10%） | "运营工作台"定位区别于通用聊天机器人/客服系统 |
| **用户体验 10%**（UI 4% + 交互 3%） | KPI 卡/数据表/侧边面板/状态标签 = 产品级 UI |
| **前端工程 10%** | 组件复用（DataTable/StatusBadge/MetricCard）、类型安全 |
| **AI 技术深度 35%** | 不降分：对话/意图/Agent/RAG 能力不变，展示窗口变大 |
