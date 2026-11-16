'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { AgentSteps } from './AgentSteps';
import { ThoughtChain } from './ThoughtChain';
import { Sidebar } from './Sidebar';
import { DemoGuide } from './DemoGuide';
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
import type { IntentInfo } from '@/lib/intentClient';
import type { RouterInfo } from '@/lib/agentClient';
import { parseProblem, problemMessage } from '@/lib/errors';
import { cn } from '@/lib/cn';

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

/**
 * 聊天主窗口（客户视角，多 Agent 客服）
 *
 * - 多 Agent：runAgentStream + /api/agent（LangGraph 编排，Router→Specialist→Review）
 * - 会话：useSessions 状态机（列表/切换/改名/删除/debounce 保存）
 * - 思考链：ThoughtChain 面板展示 router→specialist→review 每步留痕
 * - 引用：[n] 角标点击 → ragSearch（同序来源）→ CitationCard 溯源
 * - 意图分流：发送时并行识别意图 → 气泡上方 chip
 * - 处理方案生成：汇总上下文 → /api/v1/escalate → 摘要/建议/话术卡片
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

  // ── Agent 模式 ──
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentStreaming, setAgentStreaming] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── 订单号检测（useMemo 派生，不触发 setState-in-effect）──
  const [dismissedOrder, setDismissedOrder] = useState<string | null>(null);
  const [refundOrder, setRefundOrder] = useState<{ order_id: string; product: string; buyer: string; amount: number; status: string; date: string } | null>(null);
  const rawDetectedOrder = useMemo(() => {
    const allText = agentMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join(" ");
    return allText.match(/SO\d{11}/)?.[0] ?? null;
  }, [agentMessages]);
  const detectedOrder = rawDetectedOrder !== dismissedOrder ? rawDetectedOrder : null;

  // ── 会话状态机 ──
  const sessions = useSessions({
    getPayload: () => agentMessages,
    onSessionLoaded: (sess) => {
      stickRef.current = true;
      // 旧 RAG 会话消息是 UIMessage(parts) 格式，抽纯文本转 AgentMessage，避免装载后白屏
      const normalized: AgentMessage[] = sess.messages.map((raw) => {
        const m = raw as Record<string, unknown>;
        const content =
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.parts)
              ? m.parts
                  .map((p) =>
                    (p as { type?: string }).type === 'text'
                      ? String((p as { text?: string }).text ?? '')
                      : '',
                  )
                  .join('')
              : '';
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content,
          ...(typeof m.intent === 'object' && m.intent !== null
            ? { intent: m.intent as AgentMessage['intent'] }
            : {}),
        };
      });
      setAgentMessages(normalized);
    },
    onSessionClosed: () => {
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
  }, [agentMessages, notifyChanged]);

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
  }, [agentMessages, agentStreaming, escalation]);

  // 空会话 / 切换会话 → 不要沿用上一会话的滚动位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTop = agentMessages.length === 0 ? 0 : el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.activeId]);

  // 消息被清空（新建会话）→ 回到顶部，露出演示导览
  useEffect(() => {
    if (agentMessages.length !== 0) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [agentMessages.length]);
  // ── 引用溯源（P4）：按「本轮 user 消息」懒加载 ragSearch，会话内缓存 ──
  const [citation, setCitation] = useState<{ n: number; sources: CitationSource[] | null } | null>(
    null,
  );
  const [citeLoading, setCiteLoading] = useState(false);
  const citeCacheRef = useRef(new Map<string, CitationSource[]>());

  function lastUserText(): string | null {
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const m = agentMessages[i];
      if (m.role !== 'user') continue;
      const trimmed = m.content.trim();
      return trimmed || null;
    }
    return null;
  }

  async function handleCite(n: number) {
    // 优先使用当前消息存储的知识库命中（agent 路径 [n] 引用溯源）
    const lastMsg = agentMessages[agentMessages.length - 1];
    if (lastMsg?.kbHits && lastMsg.kbHits.length > 0) {
      setCitation({ n, sources: lastMsg.kbHits });
      return;
    }

    // 回退：调用 ragSearch（兼容旧 RAG 路径 / 无 kbHits 时）
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

  const generating = agentStreaming;
  const busy = generating || visionLoading || sessions.busy;

  // ── Agent 单轮执行（handleSubmit / regenerateAgent 共用）──
  async function runAgentTurn(
    text: string,
    history: Array<{ role: string; content: string }>,
    threadId?: string,
  ) {
    setAgentError(null);
    setAgentStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;
    setAgentMessages((prev) => [...prev, { role: 'assistant', content: '', steps: [], thoughtChain: [], kbHits: [] }]);
    try {
      await runAgentStream(
        text,
        history,
        (st) =>
          setAgentMessages((prev) => {
            const next = [...prev];
            // 路由意图回填到本轮 user 消息（done 时随 routerInfo 到达）
            if (st.routerInfo) {
              for (let i = next.length - 1; i >= 0; i--) {
                const m = next[i];
                if (m.role === 'user' && !m.intent) {
                  next[i] = { ...m, intent: buildIntentInfo(st.routerInfo, m.content) };
                  break;
                }
              }
            }
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              role: 'assistant',
              content: st.text,
              steps: st.steps,
              thoughtChain: st.thoughtChain,
              kbHits: st.kbHits,
            };
            return next;
          }),
        (msg) => setAgentError(msg),
        abort.signal,
        threadId ?? sessions.activeId ?? undefined,
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

  // ── 意图回填（chip）：来自 router 节点，与实际分流同源，杜绝标签打架 ──

  /** router 意图 → IntentInfo（chip 用）；order_id 用正则补实体标签 */
  function buildIntentInfo(router: RouterInfo, text: string): IntentInfo {
    const m = text.match(/SO\d{11}/);
    return {
      intent: router.intent,
      target: 'agent',
      reason: `路由置信度 ${(router.confidence ?? 0).toFixed(2)}`,
      sentiment: router.sentiment ?? undefined,
      ...(m ? { entities: { order_id: m[0] } } : {}),
    };
  }

  /** 发送一段文本：输入框提交与演示向导「开始」共用同一条路径 */
  async function submitText(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');

    let threadId = sessions.activeId ?? undefined;
    if (sessions.activeId === null) {
      const created = await sessions.newSession('agent');
      if (!created) return;
      threadId = created.id;
    }
    const history = agentMessages.map((m) => ({ role: m.role, content: m.content }));
    setAgentMessages((prev) => [...prev, { role: 'user', content: text }]);
    await runAgentTurn(text, history, threadId);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitText(input);
  }

  /** 演示向导：一键发送预设问题（忙碌时忽略，避免并发轮次） */
  function runDemo(question: string) {
    if (busy) return;
    setInput('');
    void submitText(question);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
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
        throw new Error(problemMessage(parseProblem(data)));
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
  const displayError = agentError || sessions.error;
  function retryError() {
    if (agentError) {
      setAgentError(null);
      return;
    }
    sessions.clearError();
  }

  // ── 处理方案生成：收集当前会话消息 ──
  /** 会话消息拍平为 {role, content}（供 escalate 用） */
  function collectTranscript(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of agentMessages) {
      if (!m.content.trim()) continue;
      out.push({ role: m.role, content: m.content });
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

  const conversationEmpty = agentMessages.length === 0;
  /** 只有本轮出现过投诉工单，才显示「投诉处理方案」，避免客户看不懂这个按钮 */
  const hasEscalation = agentMessages.some((m) =>
    m.thoughtChain?.some((s) => s.agent === 'escalation'),
  );

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
        onQuickStart={runDemo}
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
                <p className="mt-0.5 truncate text-xs text-ink-subtle">LangGraph 多 Agent 客服</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* 新建会话（空状态隐藏：会话侧栏已有入口） */}
                {!conversationEmpty && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void sessions.newSession()}
                    disabled={sessions.busy}
                    title="新建会话"
                  >
                    新建会话
                  </Button>
                )}
                {/* 投诉处理方案：仅在出现投诉工单后显示，客户不会困惑 */}
                {!conversationEmpty && hasEscalation && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEscalateOpen(true)}
                    disabled={escalating}
                    title="根据本轮投诉生成情况摘要、建议动作与可复制话术"
                    className="hidden sm:inline-flex"
                  >
                    {escalating ? '生成中…' : '投诉处理方案'}
                  </Button>
                )}
                <Badge tone="brand" className="hidden lg:inline-flex">
                  多 Agent · 8 工具
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
            <div
              className={cn(
                'mx-auto w-full space-y-4 break-words px-4 py-6',
                conversationEmpty ? 'max-w-5xl' : 'max-w-3xl',
              )}
            >
              {/* 空状态：演示向导（价值主张 + 3 分钟路线 + 能力卡片） */}
              {conversationEmpty && <DemoGuide onRun={runDemo} busy={busy} />}
              {/* 消息列表 */}
              {mode === 'agent' && (
                <>
                  {agentMessages.map((m, i) => (
                    <div key={i} className="space-y-2">
                      {m.steps && m.steps.length > 0 && (
                        <AgentSteps steps={m.steps} onOrderAction={setRefundOrder} />
                      )}
                      {m.thoughtChain && m.thoughtChain.length > 0 && (
                        <ThoughtChain steps={m.thoughtChain} />
                      )}
                      <MessageBubble
                        role={m.role}
                        text={m.content}
                        isLast={i === agentMessages.length - 1}
                        busy={generating}
                        onCite={(n) => void handleCite(n)}
                        onRegenerate={regenerateAgent}
                        intent={m.intent}
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
                        {agentError || sessions.error ? '重试' : '知道了'}
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
                  placeholder="试试：SO20261027009 到哪了 / 退我 80 块 / 我要投诉…"
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
                自动判断售前/售后 · 工具调用与引用全程可见
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
