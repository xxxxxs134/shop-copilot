/**
 * 意图信息类型（P5 §2.1 / §2.2 契约的类型层）。
 *
 * 历史：本文件曾含 fetchIntent() 并行调用 /api/v1/intent。
 * 意图二合一后，前端改从 agent SSE 的 done 事件 router 字段取意图
 * （见 components/ChatWindow.tsx buildIntentInfo），fetchIntent 已删除。
 * smoke.mjs 仍直测 POST /v1/intent（后端 api_intent.py 保留）。
 *
 * 这里只保留消息上持久化/展示所需的类型：
 *   IntentResponse —— /v1/intent 原始响应三字段契约
 *   IntentInfo     —— 消息意图字段（IntentResponse + switched 标记）
 *   Sentiment      —— 情绪识别结果
 *   EntityMap      —— 实体抽取结果
 */

/** /v1/intent 原始响应（三字段契约 + 可选增强字段） */
export interface IntentResponse {
  intent: string;
  target: string;
  reason: string;
  /** 实体抽取：类型 → 文本/数值（如 order_id → "SO2026…"）；老后端无此字段 */
  entities?: EntityMap;
  /** 情绪识别：标签 + 置信度 + 触发线索；老后端无此字段 */
  sentiment?: Sentiment;
}

/** 实体抽取结果：类型键（order_id/product/reason/amount/time_expr/action…）→ 文本或数值 */
export type EntityMap = Record<string, string | number>;

/** 情绪识别结果：label 为情绪标签（angry/anxious/frustrated/neutral/positive），cues 为触发线索 */
export interface Sentiment {
  label: string;
  score: number;
  cues: string[];
}

/**
 * 消息上持久化的意图字段 = 响应三字段 + 前端追加的 `switched` 标记。
 *
 * `switched` 仅在「RAG 模式按意图自动切到 Agent」时由前端写入，
 * 用于 chip 后缀「已按意图切换」；老数据无此字段 → 不渲染后缀（向后兼容）。
 */
export interface IntentInfo extends IntentResponse {
  switched?: boolean;
}
