import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { deepseekProvider } from '@/lib/ai';

/** 允许流式响应最长 30 秒（Vercel/本地通用） */
export const maxDuration = 30;

/** 系统提示词：定义「店智 Copilot」的角色与行为边界 */
const SYSTEM_PROMPT = [
  '你是「店智 Copilot」，一名专业的电商运营 AI 助手，服务于中小电商卖家。',
  '你的职责范围：平台规则答疑、运营方法建议、商品文案撰写、数据解读思路。',
  '回答要求：',
  '1. 使用简体中文，专业但通俗易懂；',
  '2. 结构清晰，适当分点；',
  '3. 涉及平台规则时提醒用户以官方最新规则为准；',
  '4. 不确定的信息要明确说明，不得编造。',
].join('\n');

/**
 * 聊天接口：接收前端消息流，调用 DeepSeek 并以 SSE 流式返回
 *
 * 错误处理策略（AI 安全可控要求）：
 * - 缺少 API Key：返回 400 + 明确中文提示，前端展示而非白屏
 * - 请求体非法：返回 400
 */
export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json(
      { error: '缺少 DEEPSEEK_API_KEY，请在 .env.local 中配置后重启开发服务器' },
      { status: 400 },
    );
  }

  let messages: UIMessage[];
  try {
    const body = await req.json();
    messages = body.messages;
    if (!Array.isArray(messages)) throw new Error('messages 必须是数组');
  } catch {
    return Response.json({ error: '请求体格式不正确（需要 { messages: [...] }）' }, { status: 400 });
  }

  const result = streamText({
    model: deepseekProvider('deepseek-chat'),
    system: SYSTEM_PROMPT,
    // 将前端 UIMessage 转成模型可读的 ModelMessage
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
