import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * DeepSeek 模型提供方实例
 *
 * DeepSeek 官方 API 与 OpenAI 协议兼容，因此使用 @ai-sdk/openai-compatible 接入：
 * - baseURL 固定为 https://api.deepseek.com（国内可直连，无需代理）
 * - 密钥从环境变量读取，绝不硬编码（比赛仓库须公开，密钥只放 .env.local）
 */
export const deepseekProvider = createOpenAICompatible({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
});
