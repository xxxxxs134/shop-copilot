import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * AI 提供方实例（默认指向本地 Python FastAPI 接入层）
 *
 * 架构：Next.js 不直连 DeepSeek —— 一切 AI 请求经 backend/ FastAPI 中转，
 * 密钥校验与注入都在 Python 层（符合比赛「后端仅作 AI 能力接入层」定位）。
 * 仅限调试时可用 AI_BASE_URL=https://api.deepseek.com 绕过后端直连。
 */
export const deepseekProvider = createOpenAICompatible({
  name: 'deepseek',
  baseURL: process.env.AI_BASE_URL ?? 'http://127.0.0.1:8000/v1',
  // 真实密钥在 FastAPI 层注入；占位值仅为满足 SDK 非空校验
  apiKey: process.env.DEEPSEEK_API_KEY ?? 'local-placeholder',
});
