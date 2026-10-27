/**
 * 处理方案生成（运营助手）客户端
 *
 * 契约：
 *   POST /api/v1/escalate
 *   body: { session_id: string; reason: string; messages: [{role: 'user'|'assistant', content: string}] }
 *   → { summary: string,
 *       suggestions: [{icon: string, text: string}],
 *       scripts: [{scenario: string, text: string}] }
 *
 * 走既有 /api/v1/* 同源代理（app/api/v1/[...path]/route.ts 透传 → FastAPI /v1/escalate）。
 *
 * 降级语义：网络错误 / 非 2xx / 响应结构不符 → 一律回落本地 mock。
 * 处理方案是运营助手信息，后端未就绪时 UI 也必须可用，绝不阻断主链路。
 */

/** 建议条目：icon 为 emoji 前缀，text 为操作建议 */
export interface EscalationSuggestion {
  icon: string;
  text: string;
}

/** 话术条目：scenario 为场景标签，text 为可复制话术正文 */
export interface EscalationScript {
  scenario: string;
  text: string;
}

/** /v1/escalate 响应体（处理方案卡片数据源） */
export interface EscalationData {
  summary: string;
  suggestions: EscalationSuggestion[];
  scripts: EscalationScript[];
}

/** /v1/escalate 请求体 */
export interface EscalateRequest {
  session_id: string;
  /** 用户填写的补充说明；留空时由前端填 'auto' */
  reason: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** 响应体边界解析：结构不符返回 null（调用方按 mock 降级） */
function parseEscalation(data: unknown): EscalationData | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.summary !== 'string') return null;
  if (!Array.isArray(d.suggestions) || !Array.isArray(d.scripts)) return null;

  const suggestions: EscalationSuggestion[] = [];
  for (const item of d.suggestions) {
    if (typeof item !== 'object' || item === null) return null;
    const s = item as Record<string, unknown>;
    if (typeof s.icon !== 'string' || typeof s.text !== 'string') return null;
    suggestions.push({ icon: s.icon, text: s.text });
  }

  const scripts: EscalationScript[] = [];
  for (const item of d.scripts) {
    if (typeof item !== 'object' || item === null) return null;
    const s = item as Record<string, unknown>;
    if (typeof s.scenario !== 'string' || typeof s.text !== 'string') return null;
    scripts.push({ scenario: s.scenario, text: s.text });
  }

  return { summary: d.summary, suggestions, scripts };
}

/** 后端未就绪时的兜底卡片内容（结合当前会话上下文生成，保证 UI 可用） */
function buildMockEscalation(req: EscalateRequest): EscalationData {
  const allText = req.messages.map((m) => m.content).join(' ');
  const orderId = allText.match(/SO\d{12}/)?.[0] ?? null;
  const lastUser =
    [...req.messages].reverse().find((m) => m.role === 'user')?.content.trim() ?? '';
  const topic = lastUser.slice(0, 40) || '当前对话';

  const summary = orderId
    ? `客户咨询订单 ${orderId} 的处理进度，最近一轮诉求：「${topic}」。已沟通 ${req.messages.length} 轮，建议核对处理节点并同步进展。`
    : `客户咨询：「${topic}」。已沟通 ${req.messages.length} 轮，建议核实细节后拟定回复。`;

  return {
    summary,
    suggestions: [
      {
        icon: '🔍',
        text: orderId
          ? `查询订单 ${orderId} / 售后单的具体处理节点，确认当前进度`
          : '查询订单与售后单的具体处理节点，确认当前进度',
      },
      { icon: '💬', text: '安抚客户情绪，说明处理进度与时效，避免差评升级' },
      { icon: '📞', text: '如客户仍不满意，可升级至主管或电话回访跟进' },
    ],
    scripts: [
      {
        scenario: '安抚客户',
        text: '非常抱歉给您带来不好的体验，您的问题我们已经记录，正在为您加急处理，有进展会第一时间同步给您。',
      },
      {
        scenario: '解释时效',
        text: '退款到账时间取决于银行处理时效，一般 1-3 个工作日原路退回，请您耐心等待；如有异常我们会主动联系您。',
      },
    ],
  };
}

/** 超时兜底：处理方案生成目标 <5s，10s 仍未返回按失败处理（走 mock） */
const ESCALATE_TIMEOUT_MS = 10000;

/**
 * 发起处理方案生成请求。**永不抛出**：任何失败路径都回落 mock 卡片。
 */
export async function requestEscalation(req: EscalateRequest): Promise<EscalationData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESCALATE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/v1/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.ok) {
      const parsed = parseEscalation(await res.json());
      if (parsed) return parsed;
    }
  } catch {
    // 后端未就绪 / 网络失败 / 超时 → mock 兜底
  } finally {
    clearTimeout(timer);
  }
  return buildMockEscalation(req);
}
