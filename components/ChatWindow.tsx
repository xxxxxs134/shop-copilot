'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { AgentSteps } from './AgentSteps';
import { Sidebar } from './Sidebar';
import { CitationCard } from './CitationCard';
import { runAgentStream } from '@/lib/agentRun';
import { useSessions } from '@/lib/useSessions';
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
  return m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
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

  // 消息变化 → debounce 保存（hook 内部 1.5s + 签名守卫）
  useEffect(() => {
    notifyChanged();
  }, [messages, agentMessages, notifyChanged]);

  // 自动滚动（新内容且用户贴底时）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, agentMessages, status, agentStreaming]);

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
    void sessions.switchModeInPlace('agent');
    await runAgentTurn(text, history);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');

    // 尚无会话（首条消息）→ 先建再发，保证消息能落库
    if (sessions.activeId === null) {
      await sessions.newSession();
    }

    // §2.2：意图识别与回答并行发起（不 await 在 sendMessage 之前 → 不阻塞首 token）
    const intentP = fetchIntent(text);

    if (mode === 'rag') {
      const prior = messages;
      const sendP = sendMessage({ text });
      const intent = await intentP;
      if (intent && shouldAutoSwitch(intent.intent)) {
        // data/policy/copywriting → 自动切 Agent（中止 RAG 流，AbortError 不外抛）
        void sendP.catch(() => undefined);
        await routeToAgent(text, intent, prior);
        return;
      }
      // knowledge/general → 留在 RAG，仅挂 chip
      if (intent) attachIntentToLastUser(text, intent);
      await sendP;
      return;
    }

    // Agent 模式：不回切，意图异步回填 chip，回答立即开跑
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

  const ragEmpty = messages.length === 0;
  const agentEmpty = agentMessages.length === 0;

  return (
    <div className="flex h-screen w-full overflow-hidden">
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
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-4">
          {/* 顶栏 */}
          <header className="flex items-center justify-between border-b border-slate-200 py-4">
            <div>
              <h1 className="text-lg font-bold text-brand-700">店智 Copilot</h1>
              <p className="text-xs text-slate-500">电商运营 AI 智能助手 · 会话持久化 + 可溯源问答</p>
            </div>
            <div className="flex items-center gap-2">
              {/* 模式切换（空会话原地切，有内容自动新建） */}
              <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => void sessions.toggleMode('rag')}
                  disabled={busy}
                  className={`rounded-md px-3 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    mode === 'rag' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  RAG 问答
                </button>
                <button
                  type="button"
                  onClick={() => void sessions.toggleMode('agent')}
                  disabled={busy}
                  className={`rounded-md px-3 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    mode === 'agent' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Agent 模式
                </button>
              </div>
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">DeepSeek</span>
            </div>
          </header>

          {/* 消息列表 */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 space-y-4 overflow-y-auto py-6"
          >
            {/* RAG 模式 */}
            {mode === 'rag' && (
              <>
                {ragEmpty && (
                  <div className="mt-20 text-center text-slate-400">
                    <p className="text-4xl">🛒</p>
                    <p className="mt-3 text-sm">试着问我：如何写出高点击率的商品标题？</p>
                  </div>
                )}
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
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                    店智思考中…
                  </div>
                )}
              </>
            )}

            {/* Agent 模式 */}
            {mode === 'agent' && (
              <>
                {agentEmpty && (
                  <div className="mt-20 text-center text-slate-400">
                    <p className="text-4xl">🤖</p>
                    <p className="mt-3 text-sm">试着问我：查店铺今日数据并给建议</p>
                    <p className="mt-1 text-xs text-slate-300">
                      Agent 会自动调用工具：数据查询 / 知识库检索 / 文案生成 / 合规检查
                    </p>
                  </div>
                )}
                {agentMessages.map((m, i) => (
                  <div key={i} className="space-y-2">
                    {m.steps && m.steps.length > 0 && <AgentSteps steps={m.steps} />}
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
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                    Agent 思考中…
                  </div>
                )}
              </>
            )}
          </div>

          {/* 错误内联提示（生成错误 / 会话错误合并） */}
          {displayError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">出错了</p>
              <p className="mt-1 break-all">{displayError}</p>
              <button
                type="button"
                onClick={retryError}
                className="mt-2 text-red-600 underline underline-offset-2 hover:text-red-800"
              >
                {agentError || error ? '重试' : '知道了'}
              </button>
            </div>
          )}

          {/* 输入区 */}
          <form onSubmit={handleSubmit} className="border-t border-slate-200 py-4">
            {/* 视觉识别结果预览 */}
            {visionResult && (
              <div className="mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
                <p className="font-medium text-brand-700">🖼️ 图片识别结果</p>
                {visionResult.title && (
                  <p className="mt-1 text-slate-700">标题：{visionResult.title}</p>
                )}
                {visionResult.selling_points && (
                  <ul className="mt-1 list-inside list-disc text-slate-600">
                    {visionResult.selling_points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
                {visionResult.description && (
                  <p className="mt-1 text-slate-600">描述：{visionResult.description}</p>
                )}
                {visionResult.raw && <p className="mt-1 text-slate-500">{visionResult.raw}</p>}
                <button
                  type="button"
                  onClick={() => setVisionResult(null)}
                  className="mt-1 text-brand-600 underline underline-offset-2 hover:text-brand-800"
                >
                  关闭
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-brand-500">
              {/* 图片上传按钮 */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={visionLoading}
                title="上传商品图，AI 生成文案"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
              >
                {visionLoading ? '⏳' : '🖼️'}
              </button>
              {/* 语音输入按钮 */}
              <button
                type="button"
                onClick={toggleVoice}
                title={listening ? '停止录音' : '语音输入'}
                className={`rounded-lg p-2 ${
                  listening
                    ? 'animate-pulse bg-red-100 text-red-600'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                }`}
              >
                {listening ? '🔴' : '🎤'}
              </button>
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
                className="flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-400"
              />
              {busy && generating ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
                >
                  停止
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || busy}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  发送
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {mode === 'rag'
                ? 'RAG 模式：知识库增强问答，回答带 [1][2] 角标，点击可查来源'
                : 'Agent 模式：自动调用工具（数据/知识库/文案/合规），可多步推理'}
            </p>
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
    </div>
  );
}
