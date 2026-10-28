'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { AgentSteps } from './AgentSteps';
import { Sidebar } from './Sidebar';
import { ScenarioCards } from './ScenarioCards';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { CitationCard } from './CitationCard';
import { OrderDetailCard } from './OrderDetailCard';
import { RefundDialog } from './RefundDialog';
import { EscalationCard } from './EscalationCard';
import { EscalateDialog } from './EscalateDialog';
import { runAgentStream } from '@/lib/agentRun';
import { requestEscalation, type EscalationData } from '@/lib/escalateClient';
import { useSessions, DEFAULT_TITLE } from '@/lib/useSessions';
import { ragSearch, type AgentMessage, type CitationSource } from '@/lib/sessionsClient';
import {
  fetchIntent,
  shouldAutoSwitch,
  type IntentInfo,
  type IntentUIMessage,
} from '@/lib/intentClient';

/** SpeechRecognition 最小接口（浏览器 API 无官方 TS 类型） */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: Array<Array<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
}

/** UIMessage → 纯文本（只取 text part） */
function uiText(m: UIMessage): string {
  return (m.parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/**
 * 聊天主窗口（客户端组件）
 *
 * 双模式 + 会话持久化（P4）：
 * - RAG 问答：useChat + /api/chat（流式，FastAPI 注入 RAG 上下文）
 * - Agent 模式：runAgentStream + /api/agent（ReAct 循环，步骤卡片）
 * - 会话：useSessions 状态机（列表/切换/改名/删除/debounce 保存）
 * - 引用：[n] 角标点击 → ragSearch（同序来源）→ CitationCard 溯源
 * - 意图分流（P5 §2.2）：发送时与回答并行识别意图 → 气泡上方 chip；
 *   RAG 模式遇 data/policy/copywriting 自动切 Agent，Agent 模式永不回切
 * - 处理方案生成（运营助手）：汇总上下文 → /api/v1/escalate → 摘要/建议/话术卡片（后端未就绪 mock 兜底）
 */
export function ChatWindow() {
  const [input, setInput] = useState('');

  // ── 滚动吸附（sticky）：仅当用户已在底部附近时自动跟随 ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // ── RAG 模式（useChat）──
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const { messages, sendMessage, status, error, stop, regenerate, setMessages } = useChat({
    transport,
  });
  const ragBusy = status === 'submitted' || status === 'streaming';

  // ── Agent 模式（手写状态机）──
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentStreaming, setAgentStreaming] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── 订单号检测（useMemo 派生，不触发 setState-in-effect）──
  const [dismissedOrder, setDismissedOrder] = useState<string | null>(null);
  const [refundOrder, setRefundOrder] = useState<{ order_id: string; product: string; buyer: string; amount: number; status: string; date: string } | null>(null);
  const rawDetectedOrder = useMemo(() => {
    const allText = [
      ...messages.map((m) => uiText(m)),
      ...agentMessages.map((m) => (typeof m.content === "string" ? m.content : "")),
    ].join(" ");
    return allText.match(/SO\d{11}/)?.[0] ?? null;
  }, [messages, agentMessages]);
  const detectedOrder = rawDetectedOrder !== dismissedOrder ? rawDetectedOrder : null;

  // ── 会话状态机（P4）──
  const sessions = useSessions({
    getPayload: (m) => (m === 'rag' ? messages : agentMessages),
    onSessionLoaded: (sess) => {
      stickRef.current = true;
      if (sess.mode === 'rag') {
        setMessages(sess.messages as UIMessage[]);
        setAgentMessages([]);
      } else {
        setAgentMessages(sess.messages as AgentMessage[]);
        setMessages([]);
      }
    },
    onSessionClosed: () => {
      setMessages([]);
      setAgentMessages([]);
    },
  });
  const { mode, notifyChanged } = sessions;

  /** 页头标题：当前会话标题；无会话或仍是默认标题时显示「新会话」 */
  const activeSession = sessions.sessions.find((s) => s.id === sessions.activeId);
  const headerTitle =
    activeSession && activeSession.title !== DEFAULT_TITLE ? activeSession.title : '新会话';

  // <lg 默认收起会话栏（展开时 Sidebar 以抽屉覆盖，点遮罩关闭）
  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      sessions.setCollapsed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 消息变化 → debounce 保存（hook 内部 1.5s + 签名守卫）
  useEffect(() => {
    notifyChanged();
  }, [messages, agentMessages, notifyChanged]);

  // ── 预填查询（从工作台/数据页跳转时，一次性）──
  const prefillDone = useRef(false);
  useEffect(() => {
    if (prefillDone.current) return;
    prefillDone.current = true;
    const prefill = sessionStorage.getItem("prefill_query");
    if (prefill) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInput(prefill);
      sessionStorage.removeItem("prefill_query");
    }
    const sessionId = sessionStorage.getItem("active_session_id");
    if (sessionId) {
      sessionStorage.removeItem("active_session_id");
      void sessions.openSession(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 处理方案生成（运营助手）：汇总当前会话 → /api/v1/escalate → 结果卡片 ──
  const [escalation, setEscalation] = useState<EscalationData | null>(null);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalating, setEscalating] = useState(false);

  // 自动滚动（新内容且用户贴底时）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, agentMessages, status, agentStreaming, escalation]);
  // ── 引用溯源（P4）：按「本轮 user 消息」懒加载 ragSearch，会话内缓存 ──
  const [citation, setCitation] = useState<{ n: number; sources: CitationSource[] | null } | null>(
    null,
  );
  const [citeLoading, setCiteLoading] = useState(false);
  const citeCacheRef = useRef(new Map<string, CitationSource[]>());

  function lastUserText(): string | null {
    const payload: Array<UIMessage | AgentMessage> = mode === 'rag' ? messages : agentMessages;
    for (let i = payload.length - 1; i >= 0; i--) {
      const m = payload[i];
      if (m.role !== 'user') continue;
      const text = 'parts' in m ? uiText(m) : m.content;
      const trimmed = text.trim();
      return trimmed || null;
    }
    return null;
  }

  async function handleCite(n: number) {
    const q = lastUserText();
    if (!q) return;
    const cached = citeCacheRef.current.get(q);
    if (cached) {
      setCitation({ n, sources: cached });
      return;
    }
    setCitation({ n, sources: null });
    setCiteLoading(true);
    try {
      const sources = await ragSearch(q, 4);
      citeCacheRef.current.set(q, sources);
      setCitation({ n, sources });
    } catch {
      // 检索失败：卡片显示「未找到」兜底文案
      setCitation({ n, sources: null });
    } finally {
      setCiteLoading(false);
    }
  }

  // ── 多模态：语音输入 + 图片上传 ──
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionResult, setVisionResult] = useState<{
    title?: string;
    selling_points?: string[];
    description?: string;
    raw?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generating = mode === 'rag' ? ragBusy : agentStreaming;
  const busy = generating || visionLoading || sessions.busy;

  // ── Agent 单轮执行（handleSubmit / regenerateAgent 共用）──
  async function runAgentTurn(text: string, history: Array<{ role: string; content: string }>) {
    setAgentError(null);
    setAgentStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;
    setAgentMessages((prev) => [...prev, { role: 'assistant', content: '', steps: [] }]);
    try {
      await runAgentStream(
        text,
        history,
        (st) =>
          setAgentMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              role: 'assistant',
              content: st.text,
              steps: st.steps,
            };
            return next;
          }),
        (msg) => setAgentError(msg),
        abort.signal,
      );
    } finally {
      setAgentStreaming(false);
      abortRef.current = null;
    }
  }

  /** Agent 重新生成：剥掉最后一条 assistant，用该轮 user 消息重跑 */
  function regenerateAgent() {
    if (agentStreaming) return;
    const last = agentMessages[agentMessages.length - 1];
    if (!last || last.role !== 'assistant') return;
    const without = agentMessages.slice(0, -1);
    const lastUser = without[without.length - 1];
    if (!lastUser || lastUser.role !== 'user') return;
    const history = without.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    setAgentMessages(without);
    void runAgentTurn(lastUser.content, history);
  }

  // ── 意图分流（P5 §2.2）：chip 回填 + RAG→Agent 非对称自动路由 ──

  /** 把意图结果回填到本轮 user 消息（按文本从尾部匹配，跳过已带 intent 的历史消息） */
  function attachIntentToLastUser(text: string, intent: IntentInfo): void {
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m.role !== 'user' || uiText(m) !== text) continue;
        if ((m as IntentUIMessage).intent) continue;
        const next = [...prev];
        const updated: IntentUIMessage = { ...m, intent };
        next[i] = updated;
        return next;
      }
      return prev;
    });
  }

  /** Agent 模式：意图只挂 chip，永不回切（§2.2 路由表第三行） */
  function attachAgentIntent(text: string, intent: IntentInfo): void {
    setAgentMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m.role !== 'user' || m.content !== text || m.intent) continue;
        const next = [...prev];
        next[i] = { ...m, intent };
        return next;
      }
      return prev;
    });
  }

  /**
   * RAG → Agent 自动路由（§2.2 路由表第一行）：
   * 中止并行中的 RAG 流 → 已有消息迁成 Agent 队列 → 原地 PATCH mode → 走 agent 端点重答本轮。
   * RAG 队列不清空：Agent 模式下既不渲染也不保存它（装载/切模式时由 onSessionLoaded 覆盖）。
   */
  async function routeToAgent(text: string, intent: IntentInfo, prior: UIMessage[]): Promise<void> {
    void stop().catch(() => undefined);
    // 自动切换时若尚无会话，直接建 Agent 模式会话（避免 toggleMode 的"有内容建新会话"路径）
    if (sessions.activeId === null) {
      await sessions.newSession('agent');
    }
    const converted: AgentMessage[] = [];
    for (const m of prior) {
      const content = uiText(m);
      if (!content.trim()) continue;
      converted.push({ role: m.role === 'user' ? 'user' : 'assistant', content });
    }
    const history = converted.map((m) => ({ role: m.role, content: m.content }));
    setAgentMessages([
      ...converted,
      { role: 'user', content: text, intent: { ...intent, switched: true } },
    ]);
    setMessages([]); // 清空 RAG 队列，避免 debounce 保存时双队列冲突
    void sessions.switchModeInPlace('agent');
    await runAgentTurn(text, history);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');

    // §2.2：意图识别与回答并行发起
    const intentP = fetchIntent(text);

    if (mode === 'rag') {
      const prior = messages;
      // 先检查意图，自动切换时不建 RAG 会话（由 routeToAgent 建 Agent 会话）
      const intent = await intentP;
      if (intent && shouldAutoSwitch(intent.intent)) {
        await routeToAgent(text, intent, prior);
        return;
      }
      // knowledge/general → 留在 RAG，建会话 + 发消息
      if (sessions.activeId === null) {
        await sessions.newSession();
      }
      const sendP = sendMessage({ text });
      if (intent) attachIntentToLastUser(text, intent);
      await sendP;
      return;
    }

    // Agent 模式：建会话 + 发消息
    if (sessions.activeId === null) {
      await sessions.newSession('agent');
    }
    const history = agentMessages.map((m) => ({ role: m.role, content: m.content }));
    setAgentMessages((prev) => [...prev, { role: 'user', content: text }]);
    void intentP.then((intent) => {
      if (intent) attachAgentIntent(text, intent);
    });
    await runAgentTurn(text, history);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  function handleStop() {
    if (mode === 'agent') {
      abortRef.current?.abort();
    } else {
      stop();
    }
  }

  // ── 语音输入（Web Speech API）──
  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition =
      (window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('当前浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript;
      setInput((prev) => (prev ? prev + transcript : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  // ── 图片上传 → GLM-4V 文案 ──
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setVisionLoading(true);
    setVisionResult(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(',')[1] ?? '');
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: b64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || `视觉模型返回 ${res.status}`);
      }
      setVisionResult(data);
      if (data.title) setInput(data.title);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : '图片识别失败');
    } finally {
      setVisionLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── 错误展示（三来源合并）──
  const displayError = agentError || error?.message || sessions.error;
  function retryError() {
    if (agentError) {
      setAgentError(null);
      return;
    }
    if (error) {
      if (mode === 'rag') void regenerate();
      return;
    }
    sessions.clearError();
  }

  // ── 处理方案生成（运营助手）：状态见上，此处为收集与提交逻辑 ──
  /** 当前模式的消息拍平为 {role, content}（与 routeToAgent 转换口径一致） */
  function collectTranscript(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const payload: Array<UIMessage | AgentMessage> = mode === 'rag' ? messages : agentMessages;
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of payload) {
      const content = 'parts' in m ? uiText(m) : m.content;
      if (!content.trim()) continue;
      out.push({ role: m.role === 'user' ? 'user' : 'assistant', content });
    }
    return out;
  }

  /** 生成处理方案：调 escalate（后端未就绪自动 mock 兜底）→ 消息区渲染结果卡片 */
  async function handleEscalate(reason: string) {
    setEscalating(true);
    try {
      const data = await requestEscalation({
        session_id: sessions.activeId ?? 'local-session',
        reason: reason.trim() || 'auto',
        messages: collectTranscript(),
      });
      setEscalation(data);
      setEscalateOpen(false);
      stickRef.current = true;
    } finally {
      setEscalating(false);
    }
  }

  const conversationEmpty = mode === 'rag' ? messages.length === 0 : agentMessages.length === 0;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* 会话侧边栏 */}
      <Sidebar
        sessions={sessions.sessions}
        activeId={sessions.activeId}
        mode={mode}
        collapsed={sessions.collapsed}
        busy={sessions.busy}
        onToggle={() => sessions.setCollapsed(!sessions.collapsed)}
        onSelect={(id) => void sessions.openSession(id)}
        onCreate={() => void sessions.newSession()}
        onRename={(id, title) => void sessions.renameSession(id, title)}
        onDelete={(id) => void sessions.removeSession(id)}
      />

      {/* 主聊天列 */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {detectedOrder && (
          <OrderDetailCard orderId={detectedOrder} onClose={() => setDismissedOrder(detectedOrder)} />
        )}
        {refundOrder && (
          <RefundDialog order={refundOrder} onClose={() => setRefundOrder(null)} />
        )}
        <div className="flex h-full w-full flex-1 flex-col">
          {/* 顶栏：当前会话标题 + 模式切换 + 新建会话 */}
          <header className="sticky top-0 z-10 shrink-0 border-b border-line bg-surface/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold text-ink">{headerTitle}</h1>
                <p className="mt-0.5 truncate text-xs text-ink-subtle">中小电商运营者的 AI 工作台</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* 模式切换（空会话原地切，有内容自动新建） */}
                <div className="inline-flex items-center gap-1 rounded-control border border-line bg-surface-muted p-1">
                  <Button
                    variant={mode === 'rag' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => void sessions.toggleMode('rag')}
                    disabled={busy}
                  >
                    RAG 问答
                  </Button>
                  <Button
                    variant={mode === 'agent' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => void sessions.toggleMode('agent')}
                    disabled={busy}
                  >
                    Agent 模式
                  </Button>
                </div>
                {/* 新建会话 */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void sessions.newSession()}
                  disabled={sessions.busy}
                  title="新建会话"
                >
                  新建会话
                </Button>
                {/* 生成处理方案（运营助手） */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEscalateOpen(true)}
                  disabled={escalating}
                  title="运营助手：生成情况摘要、建议动作与可复制话术"
                  className="hidden sm:inline-flex"
                >
                  {escalating ? '生成中…' : '生成处理方案'}
                </Button>
                <Badge tone="brand" className="hidden lg:inline-flex">
                  DeepSeek
                </Badge>
              </div>
            </div>
          </header>

          {/* 消息列表 */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto w-full max-w-3xl space-y-4 break-words px-4 py-6">
              {/* 空状态：品牌一句话 + 场景卡片 + 操作提示 */}
              {conversationEmpty && (
                <div className="flex flex-col items-center justify-center gap-6 py-10 text-center">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-[0.18em] text-brand-600">
                      店智 Copilot
                    </p>
                    <h2 className="text-xl font-semibold text-ink">中小电商运营者的 AI 工作台</h2>
                    <p className="text-sm text-ink-muted">
                      看数据、查问题、处理售后、写文案，一个对话框全搞定。
                    </p>
                  </div>
                  <ScenarioCards onSelect={setInput} />
                  <p className="text-xs text-ink-subtle">点击卡片预填，Enter 发送</p>
                </div>
              )}
              {/* RAG 模式 */}
              {mode === 'rag' && (
                <>
                  {messages.map((m, i) => (
                    <MessageBubble
                      key={m.id}
                      role={m.role === 'user' ? 'user' : 'assistant'}
                      text={uiText(m)}
                      isLast={i === messages.length - 1}
                      busy={generating}
                      onCite={(n) => void handleCite(n)}
                      onRegenerate={() => void regenerate()}
                      intent={(m as IntentUIMessage).intent}
                      mode={mode}
                    />
                  ))}
                  {status === 'submitted' && (
                    <div className="flex items-center gap-2 text-sm text-ink-subtle">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-ink-subtle" />
                      店智思考中…
                    </div>
                  )}
                </>
              )}

              {/* Agent 模式 */}
              {mode === 'agent' && (
                <>
                  {agentMessages.map((m, i) => (
                    <div key={i} className="space-y-2">
                      {m.steps && m.steps.length > 0 && (
                        <AgentSteps steps={m.steps} onOrderAction={setRefundOrder} />
                      )}
                      <MessageBubble
                        role={m.role}
                        text={m.content}
                        isLast={i === agentMessages.length - 1}
                        busy={generating}
                        onCite={(n) => void handleCite(n)}
                        onRegenerate={regenerateAgent}
                        intent={m.intent}
                        mode={mode}
                      />
                    </div>
                  ))}
                  {agentStreaming && !agentMessages[agentMessages.length - 1]?.content && (
                    <div className="flex items-center gap-2 text-sm text-ink-subtle">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-ink-subtle" />
                      Agent 思考中…
                    </div>
                  )}
                </>
              )}

              {/* 处理方案卡片（系统消息式，✕ 关闭） */}
              {escalation && (
                <EscalationCard data={escalation} onClose={() => setEscalation(null)} />
              )}
            </div>
          </div>


          {/* 错误内联提示（生成错误 / 会话错误合并） */}
          {displayError && (
            <div className="mx-auto w-full max-w-3xl px-4 pb-2">
              <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">
                <p className="font-medium">出错了</p>
                <p className="mt-1 break-words">{displayError}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={retryError}
                  className="mt-2 px-0 text-danger hover:bg-transparent hover:text-red-700"
                >
                  {agentError || error ? '重试' : '知道了'}
                </Button>
              </div>
            </div>
          )}

          {/* 输入区 */}
          <form
            onSubmit={handleSubmit}
            className="sticky bottom-0 shrink-0 border-t border-line bg-surface/95 backdrop-blur"
          >
            <div className="mx-auto w-full max-w-3xl px-4 py-3">
              {/* 视觉识别结果预览 */}
              {visionResult && (
                <div className="mb-2 rounded-card border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
                  <p className="font-medium text-brand-700">图片识别结果</p>
                  {visionResult.title && (
                    <p className="mt-1 text-ink">标题：{visionResult.title}</p>
                  )}
                  {visionResult.selling_points && (
                    <ul className="mt-1 list-inside list-disc text-ink-muted">
                      {visionResult.selling_points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  )}
                  {visionResult.description && (
                    <p className="mt-1 text-ink-muted">描述：{visionResult.description}</p>
                  )}
                  {visionResult.raw && <p className="mt-1 text-ink-subtle">{visionResult.raw}</p>}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisionResult(null)}
                    className="mt-1 px-0 text-brand-600 hover:bg-transparent hover:text-brand-700"
                  >
                    关闭
                  </Button>
                </div>
              )}
              <div className="flex items-end gap-2 rounded-control border border-line bg-surface p-2 shadow-card focus-within:border-brand-500">
                {/* 图片上传按钮 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={visionLoading}
                  title="上传商品图，AI 生成文案"
                  aria-label="上传商品图"
                  className="px-2 py-2 text-base"
                >
                  {visionLoading ? '⏳' : '🖼️'}
                </Button>
                {/* 语音输入按钮 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleVoice}
                  title={listening ? '停止录音' : '语音输入'}
                  aria-label={listening ? '停止录音' : '语音输入'}
                  className={`px-2 py-2 text-base ${listening ? 'bg-red-100 text-danger' : ''}`}
                >
                  {listening ? '🔴' : '🎤'}
                </Button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    mode === 'rag'
                      ? '输入你的电商运营问题，Enter 发送…'
                      : '描述任务（如：查店铺数据并给建议），Enter 发送…'
                  }
                  rows={2}
                  className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-subtle"
                />
                {busy && generating ? (
                  <Button variant="secondary" size="md" onClick={handleStop}>
                    停止
                  </Button>
                ) : (
                  <Button type="submit" variant="primary" size="md" disabled={!input.trim() || busy}>
                    发送
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                {mode === 'rag'
                  ? 'RAG 模式：知识库增强问答，回答带 [1][2] 角标，点击可查来源'
                  : 'Agent 模式：自动调用工具（数据/知识库/文案/合规），可多步推理'}
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* 引用溯源卡片 */}
      {citation && (
        <CitationCard
          index={citation.n}
          source={citation.sources ? citation.sources[citation.n - 1] ?? null : null}
          loading={citeLoading}
          onClose={() => setCitation(null)}
        />
      )}

      {/* 生成处理方案确认对话框 */}
      {escalateOpen && (
        <EscalateDialog
          pending={escalating}
          onSubmit={(reason) => void handleEscalate(reason)}
          onClose={() => setEscalateOpen(false)}
        />
      )}
    </div>
  );
}
