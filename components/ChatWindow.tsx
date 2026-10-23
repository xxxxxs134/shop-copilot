'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { AgentSteps, type AgentStep } from './AgentSteps';
import { streamAgent } from '@/lib/agentClient';

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
 * 聊天主窗口（客户端组件）
 *
 * 双模式：
 * - RAG 问答：现有 useChat + /api/chat（流式文本，FastAPI 注入 RAG 上下文）
 * - Agent 模式：streamAgent + /api/agent（ReAct 循环，工具步骤卡片 + 流式文本）
 */
export function ChatWindow() {
  const [mode, setMode] = useState<'rag' | 'agent'>('rag');
  const [input, setInput] = useState('');

  // RAG 模式（useChat）
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const { messages, sendMessage, status, error, stop, regenerate } = useChat({ transport });
  const ragBusy = status === 'submitted' || status === 'streaming';

  // Agent 模式（手写状态机）
  const [agentMessages, setAgentMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string; steps?: AgentStep[] }>
  >([]);
  const [agentStreaming, setAgentStreaming] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 多模态：语音输入 + 图片上传
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

  const busy = mode === 'rag' ? ragBusy : agentStreaming || visionLoading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');

    if (mode === 'rag') {
      await sendMessage({ text });
      return;
    }

    // Agent 模式
    setAgentError(null);
    setAgentStreaming(true);
    // 追加 user 消息
    setAgentMessages((prev) => [...prev, { role: 'user', content: text }]);
    // 当前 assistant 消息索引（用闭包变量跟踪）
    let assistantText = '';
    let steps: AgentStep[] = [];
    let stepCounter = 0;

    // 追加空 assistant 占位
    setAgentMessages((prev) => [...prev, { role: 'assistant', content: '', steps: [] }]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const history = agentMessages.map((m) => ({ role: m.role, content: m.content }));
      for await (const evt of streamAgent(text, history, abort.signal)) {
        if (evt.type === 'step') {
          steps = [
            ...steps,
            {
              id: `step-${stepCounter++}`,
              tool: evt.tool,
              args: evt.args,
              done: false,
            },
          ];
          setAgentMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, steps: [...steps] };
            return next;
          });
        } else if (evt.type === 'step_result') {
          // 找到对应 tool 的最后一步，填充 summary 并标 done
          for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].tool === evt.tool) {
              steps[i] = { ...steps[i], summary: evt.summary, done: true };
              break;
            }
          }
          setAgentMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, steps: [...steps] };
            return next;
          });
        } else if (evt.type === 'delta') {
          assistantText += evt.text;
          setAgentMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: assistantText, steps: [...steps] };
            return next;
          });
        } else if (evt.type === 'error') {
          setAgentError(evt.message);
          break;
        }
        // done 事件：结束循环
        if (evt.type === 'done') break;
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setAgentError(err.message);
      }
    } finally {
      setAgentStreaming(false);
      abortRef.current = null;
    }
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
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('当前浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
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
      // 把生成的标题填入输入框（用户可编辑后发送）
      if (data.title) setInput(data.title);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : '图片识别失败');
    } finally {
      setVisionLoading(false);
      // 清空 file input 允许重复上传同一文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col px-4">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-slate-200 py-4">
        <div>
          <h1 className="text-lg font-bold text-brand-700">店智 Copilot</h1>
          <p className="text-xs text-slate-500">电商运营 AI 智能助手 · M1+ P1+P2</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 模式切换 */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('rag')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                mode === 'rag' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              RAG 问答
            </button>
            <button
              type="button"
              onClick={() => setMode('agent')}
              className={`rounded-md px-3 py-1 font-medium transition ${
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
      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {/* RAG 模式 */}
        {mode === 'rag' && (
          <>
            {messages.length === 0 && (
              <div className="mt-20 text-center text-slate-400">
                <p className="text-4xl">🛒</p>
                <p className="mt-3 text-sm">试着问我：如何写出高点击率的商品标题？</p>
              </div>
            )}
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
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
            {agentMessages.length === 0 && (
              <div className="mt-20 text-center text-slate-400">
                <p className="text-4xl">🤖</p>
                <p className="mt-3 text-sm">试着问我：查店铺今日数据并给建议</p>
                <p className="mt-1 text-xs text-slate-300">Agent 会自动调用工具：数据查询 / 知识库检索 / 文案生成 / 合规检查</p>
              </div>
            )}
            {agentMessages.map((msg, i) => (
              <div key={i} className="space-y-2">
                {/* 工具步骤卡片 */}
                {msg.steps && msg.steps.length > 0 && <AgentSteps steps={msg.steps} />}
                {/* 消息气泡（简化版，不用 MessageBubble 以避免依赖 UIMessage 类型） */}
                <div
                  className={`rounded-xl px-4 py-3 text-sm ${
                    msg.role === 'user'
                      ? 'ml-12 bg-brand-600 text-white'
                      : 'mr-12 bg-white text-slate-800 shadow-sm border border-slate-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
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

      {/* 错误内联提示（双模式） */}
      {(error || agentError) && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">出错了</p>
          <p className="mt-1 break-all">{(agentError || error?.message) || '请求失败，请稍后重试'}</p>
          <button
            type="button"
            onClick={() => {
              if (mode === 'rag') void regenerate();
              else setAgentError(null);
            }}
            className="mt-2 text-red-600 underline underline-offset-2 hover:text-red-800"
          >
            重试
          </button>
        </div>
      )}

      {/* 输入区 */}
      <form onSubmit={handleSubmit} className="border-t border-slate-200 py-4">
        {/* 视觉识别结果预览 */}
        {visionResult && (
          <div className="mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
            <p className="font-medium text-brand-700">🖼️ 图片识别结果</p>
            {visionResult.title && <p className="mt-1 text-slate-700">标题：{visionResult.title}</p>}
            {visionResult.selling_points && (
              <ul className="mt-1 list-inside list-disc text-slate-600">
                {visionResult.selling_points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {visionResult.description && <p className="mt-1 text-slate-600">描述：{visionResult.description}</p>}
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
              listening ? 'bg-red-100 text-red-600 animate-pulse' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
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
          {busy ? (
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
              disabled={!input.trim()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {mode === 'rag'
            ? 'RAG 模式：知识库增强问答，回答带 [1][2] 引用角标'
            : 'Agent 模式：自动调用工具（数据/知识库/文案/合规），可多步推理'}
        </p>
      </form>
    </div>
  );
}
