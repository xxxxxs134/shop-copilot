'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * 知识库管理页（P5 §4.2）
 *
 * 契约（backend/app/api_kb.py，经 /api/v1/* 同源代理透传，前端不直连 8000）：
 *   GET  /v1/kb/docs          → [{id,title,category,source,chunk_count}]
 *   GET  /v1/kb/chunks?doc=   → [{id,doc_id,chunk_index,text}]
 *   PUT  /v1/kb/chunks/{id}   ← {text} → {ok:true}（保存即重嵌入 + 失效检索单例）
 *   POST /v1/kb/rebuild       → {ok,elapsed_seconds,chunk_count}
 *
 * 结构：文档表（标题/分类/切片数）→ 点击行展开切片 → 行内 textarea 编辑 → 保存（PUT）
 *       → 顶部「重建索引」按钮 + 成功 toast（耗时秒数 + 切片数）。
 * 容错：响应字段名做兼容读取（elapsed_seconds/elapsed 等），格式不符时降级为通用文案；
 *       加载/空/错误三态齐全，保存有 pending，PUT 失败在切片下方内联报错。
 */

// ── 类型 ──

/** 文档/切片 id 由后端字符串化（形如 "售后政策.md"、"xxx#3"），URL 中需 encodeURIComponent */
type KbId = string;

interface KbDoc {
  id: KbId;
  title: string;
  category: string;
  source?: string;
  chunk_count: number;
}

interface KbChunk {
  id: KbId;
  doc_id: KbId;
  chunk_index: number;
  text: string;
}

interface RebuildInfo {
  /** 耗时（秒）；后端字段缺失时为 null，UI 相应省略 */
  elapsedSeconds: number | null;
  chunkCount: number | null;
}

interface ToastState {
  kind: 'success' | 'error';
  title: string;
  detail?: string;
}

// ── 请求层（与 lib/sessionsClient.ts 同款：同源代理 + FastAPI 错误体解析） ──

interface ApiErrorBody {
  error?: { message?: string } | string;
  detail?: string | Array<{ msg: string }>;
  message?: string;
}

function parseError(body: ApiErrorBody | null, status: number): string {
  if (body) {
    if (typeof body.error === 'string') return body.error;
    if (body.error && typeof body.error.message === 'string') return body.error.message;
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]) return body.detail[0].msg;
    if (typeof body.message === 'string') return body.message;
  }
  return `请求失败（HTTP ${status}）`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络错误';
    throw new Error(`无法连接服务（请确认后端已启动）：${message}`);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 非 JSON 响应（如 502 HTML），走状态码兜底
  }
  if (!res.ok) {
    throw new Error(parseError((body ?? null) as ApiErrorBody | null, res.status));
  }
  return body as T;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : '未知错误';
}

// ── 响应解析（宽容：字段名轻微漂移时降级，不炸 UI） ──

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 数组本体或 {docs|items|data: [...]} 包装均可接受 */
function asList(v: unknown, ...keys: string[]): unknown[] | null {
  if (Array.isArray(v)) return v;
  const rec = asRecord(v);
  if (rec) {
    for (const k of keys) {
      const inner = rec[k];
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}

function asText(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

function asCount(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Math.trunc(Number(v));
  }
  return fallback;
}

function firstNumber(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function parseDocs(raw: unknown): KbDoc[] {
  const list = asList(raw, 'docs', 'items', 'data');
  if (!list) throw new Error('文档列表格式与预期不符');
  const docs: KbDoc[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const id = rec.id ?? rec.doc_id;
    if (id === undefined || id === null) continue;
    const docId = asText(id);
    docs.push({
      id: docId,
      title: asText(rec.title, docId),
      category: asText(rec.category, '未分类'),
      source: typeof rec.source === 'string' && rec.source ? rec.source : undefined,
      chunk_count: asCount(rec.chunk_count ?? rec.chunks ?? rec.count),
    });
  }
  return docs;
}

function parseChunks(raw: unknown): KbChunk[] {
  const list = asList(raw, 'chunks', 'items', 'data');
  if (!list) throw new Error('切片列表格式与预期不符');
  const chunks: KbChunk[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const id = rec.id ?? rec.chunk_id;
    if (id === undefined || id === null) continue;
    chunks.push({
      id: asText(id),
      doc_id: asText(rec.doc_id),
      chunk_index: asCount(rec.chunk_index ?? rec.index),
      text: asText(rec.text ?? rec.content),
    });
  }
  chunks.sort((a, b) => a.chunk_index - b.chunk_index);
  return chunks;
}

function parseRebuild(raw: unknown): RebuildInfo {
  const rec = asRecord(raw);
  if (!rec) return { elapsedSeconds: null, chunkCount: null };
  return {
    elapsedSeconds: firstNumber(rec, ['elapsed_seconds', 'elapsed', 'seconds', 'duration']),
    chunkCount: firstNumber(rec, ['chunk_count', 'chunks', 'total', 'count']),
  };
}

// ── 图标（内联 SVG，无 emoji 图标） ──

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m5 12 5 5L19 7" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.6v.01" />
    </svg>
  );
}

/** textarea 自动撑高（上限 320px，超出滚动） */
function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
}

// ── 页面 ──

export default function KbPage() {
  // 文档表
  const [docs, setDocs] = useState<KbDoc[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  // 展开的文档 + 切片
  const [openId, setOpenId] = useState<KbId | null>(null);
  const [chunks, setChunks] = useState<KbChunk[] | null>(null);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);
  const chunksSeqRef = useRef(0);

  // 编辑态：drafts[chunkId] = 未保存文本；saveErrors/savedId 为行内反馈
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 重建 + toast
  const [rebuilding, setRebuilding] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // 「已保存」闪烁自动清除 + 卸载清理
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const raw = await request<unknown>('/api/v1/kb/docs');
      setDocs(parseDocs(raw));
    } catch (err) {
      setDocs(null);
      setDocsError(errMsg(err));
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const loadChunks = useCallback(async (docId: KbId) => {
    const seq = ++chunksSeqRef.current;
    setChunksLoading(true);
    setChunksError(null);
    setChunks(null);
    try {
      const raw = await request<unknown>(
        `/api/v1/kb/chunks?doc=${encodeURIComponent(docId)}`,
      );
      if (seq !== chunksSeqRef.current) return; // 已切换到别的文档，丢弃过期响应
      setChunks(parseChunks(raw));
    } catch (err) {
      if (seq !== chunksSeqRef.current) return;
      setChunks(null);
      setChunksError(errMsg(err));
    } finally {
      if (seq === chunksSeqRef.current) setChunksLoading(false);
    }
  }, []);

  function toggleDoc(docId: KbId) {
    if (openId === docId) {
      chunksSeqRef.current += 1; // 作废在途请求
      setOpenId(null);
      setChunks(null);
      setChunksError(null);
      return;
    }
    setOpenId(docId);
    void loadChunks(docId);
  }

  function draftOf(chunk: KbChunk): string {
    return drafts[chunk.id] ?? chunk.text;
  }

  function revertChunk(chunk: KbChunk) {
    setDrafts((prev) => {
      if (!(chunk.id in prev)) return prev;
      const next = { ...prev };
      delete next[chunk.id];
      return next;
    });
    setSaveErrors((prev) => {
      if (!prev[chunk.id]) return prev;
      const next = { ...prev };
      delete next[chunk.id];
      return next;
    });
  }

  async function saveChunk(chunk: KbChunk) {
    const key = chunk.id;
    const text = draftOf(chunk).trim();
    if (!text) {
      setSaveErrors((prev) => ({ ...prev, [key]: '切片内容不能为空' }));
      return;
    }
    setSavingId(key);
    setSaveErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      await request<unknown>(`/api/v1/kb/chunks/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ text }),
      });
      // 保存成功：把草稿落为正文，清掉草稿并闪烁「已保存」
      setChunks((prev) =>
        prev ? prev.map((c) => (c.id === key ? { ...c, text } : c)) : prev,
      );
      setDrafts((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSavedId(key);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setSavedId((s) => (s === key ? null : s)), 2500);
    } catch (err) {
      setSaveErrors((prev) => ({ ...prev, [key]: errMsg(err) }));
    } finally {
      setSavingId(null);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    let info: RebuildInfo | null = null;
    try {
      const raw = await request<unknown>('/api/v1/kb/rebuild', { method: 'POST' });
      info = parseRebuild(raw);
    } catch (err) {
      setToast({ kind: 'error', title: '索引重建失败', detail: errMsg(err) });
      setRebuilding(false);
      return;
    }

    const parts: string[] = [];
    if (info.elapsedSeconds !== null) parts.push(`耗时 ${info.elapsedSeconds.toFixed(1)} 秒`);
    if (info.chunkCount !== null) parts.push(`${info.chunkCount} 个切片`);
    setToast({
      kind: 'success',
      title: '索引重建完成',
      detail: parts.length > 0 ? parts.join(' · ') : '检索已刷新，问答即刻生效',
    });

    // 最佳努力刷新列表（重建可能改变文档/切片集合）；失败不影响已成功的 toast
    try {
      const raw = await request<unknown>('/api/v1/kb/docs');
      const nextDocs = parseDocs(raw);
      setDocs(nextDocs);
      if (openId !== null) {
        if (nextDocs.some((d) => d.id === openId)) {
          void loadChunks(openId);
        } else {
          chunksSeqRef.current += 1;
          setOpenId(null);
          setChunks(null);
        }
      }
    } catch {
      // 静默：重建已成功，列表留待手动刷新
    } finally {
      setRebuilding(false);
    }
  }

  const totalChunks = docs ? docs.reduce((sum, d) => sum + d.chunk_count, 0) : 0;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        {/* 顶栏：返回 + 标题 + 重建索引 */}
        <header className="border-b border-slate-200 pb-4">
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1 text-xs text-slate-400 transition hover:text-brand-600"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            返回对话
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-brand-700">知识库</h1>
              <p className="text-xs text-slate-500">
                文档与切片管理 · 保存即重嵌入并失效检索，重建索引全量刷新
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleRebuild()}
              disabled={rebuilding}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshIcon className={`h-4 w-4 ${rebuilding ? 'animate-spin' : ''}`} />
              {rebuilding ? '重建中…' : '重建索引'}
            </button>
          </div>
        </header>

        {/* 文档表：错误 / 加载 / 空 / 正常 */}
        <div className="mt-5">
          {docsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">文档列表加载失败</p>
              <p className="mt-1 break-all">{docsError}</p>
              <button
                type="button"
                onClick={() => void loadDocs()}
                className="mt-2 text-red-600 underline underline-offset-2 hover:text-red-800"
              >
                重试
              </button>
            </div>
          )}

          {docsLoading && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0"
                >
                  <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-10 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          )}

          {!docsLoading && !docsError && docs !== null && docs.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
              <p className="text-sm text-slate-400">知识库暂无文档</p>
              <p className="mt-1 text-xs text-slate-300">
                先执行 python -m backend.app.rag.pipeline build 构建索引
              </p>
            </div>
          )}

          {!docsLoading && !docsError && docs !== null && docs.length > 0 && (
            <>
              <p className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>
                  共 {docs.length} 篇文档 · {totalChunks} 个切片
                </span>
                <span>点击文档行展开切片</span>
              </p>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs text-slate-400">
                      <th className="px-4 py-2.5 font-medium">标题</th>
                      <th className="w-36 px-4 py-2.5 font-medium">分类</th>
                      <th className="w-28 px-4 py-2.5 text-right font-medium">切片数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc) => {
                      const open = openId === doc.id;
                      return (
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          open={open}
                          onToggle={() => toggleDoc(doc.id)}
                        >
                          {open && (
                            <ChunkPanel
                              doc={doc}
                              chunks={chunks}
                              loading={chunksLoading}
                              error={chunksError}
                              drafts={drafts}
                              savingId={savingId}
                              saveErrors={saveErrors}
                              savedId={savedId}
                              onDraft={(chunkId, value) =>
                                setDrafts((prev) => ({ ...prev, [chunkId]: value }))
                              }
                              onSave={saveChunk}
                              onRevert={revertChunk}
                              onRetry={() => void loadChunks(doc.id)}
                            />
                          )}
                        </DocRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 成功/失败 toast（右下角，与 CitationCard 同位同款） */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 w-80 rounded-xl border bg-white p-4 shadow-xl ${
            toast.kind === 'success' ? 'border-emerald-200' : 'border-red-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${
                toast.kind === 'success' ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            >
              {toast.kind === 'success' ? (
                <CheckIcon className="h-3 w-3" />
              ) : (
                <AlertIcon className="h-3 w-3" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700">{toast.title}</p>
              {toast.detail && (
                <p className="mt-0.5 break-all text-xs text-slate-500">{toast.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="关闭提示"
              className="shrink-0 rounded p-0.5 text-slate-300 transition hover:text-slate-500"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ── 文档行（可展开） ──

function DocRow({
  doc,
  open,
  onToggle,
  children,
}: {
  doc: KbDoc;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition hover:bg-slate-50 ${open ? 'bg-brand-50/70' : ''}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-start gap-2">
            <ChevronRight
              className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                open ? 'rotate-90 text-brand-600' : ''
              }`}
            />
            <div className="min-w-0">
              <p className={`truncate font-medium ${open ? 'text-brand-800' : 'text-slate-700'}`}>
                {doc.title}
              </p>
              {doc.source && <p className="mt-0.5 truncate text-xs text-slate-400">{doc.source}</p>}
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {doc.category}
          </span>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-500">
          {doc.chunk_count}
          <span className="ml-0.5 text-xs text-slate-400">块</span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3} className="border-t border-slate-100 bg-slate-50/60 p-0">
            {children}
          </td>
        </tr>
      )}
    </>
  );
}

// ── 切片面板（加载 / 错误 / 空 / 列表） ──

function ChunkPanel({
  doc,
  chunks,
  loading,
  error,
  drafts,
  savingId,
  saveErrors,
  savedId,
  onDraft,
  onSave,
  onRevert,
  onRetry,
}: {
  doc: KbDoc;
  chunks: KbChunk[] | null;
  loading: boolean;
  error: string | null;
  drafts: Record<string, string>;
  savingId: string | null;
  saveErrors: Record<string, string>;
  savedId: string | null;
  onDraft: (chunkId: string, value: string) => void;
  onSave: (chunk: KbChunk) => void;
  onRevert: (chunk: KbChunk) => void;
  onRetry: () => void;
}) {
  return (
    <div className="px-4 py-4">
      <p className="mb-3 text-xs text-slate-400">
        《{doc.title}》的切片 · 修改文本后点「保存」即重嵌入并即时生效
      </p>

      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 h-3 w-24 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
              <div className="mt-1.5 h-3 w-4/5 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">切片加载失败</p>
          <p className="mt-1 break-all">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-red-600 underline underline-offset-2 hover:text-red-800"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && chunks !== null && chunks.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-400">
          该文档暂无切片
        </p>
      )}

      {!loading && !error && chunks !== null && chunks.length > 0 && (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {chunks.map((chunk) => {
            const key = chunk.id;
            const value = drafts[key] ?? chunk.text;
            const dirty = value !== chunk.text;
            const saving = savingId === key;
            const saveError = saveErrors[key];
            const justSaved = savedId === key;
            return (
              <div
                key={key}
                className={`rounded-lg border bg-white p-3 transition ${
                  saveError ? 'border-red-200' : dirty ? 'border-brand-200' : 'border-slate-200'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-400">
                    切片 #{chunk.chunk_index + 1}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-300">
                    {value.length} 字
                  </span>
                </div>

                <textarea
                  value={value}
                  onChange={(e) => onDraft(key, e.target.value)}
                  ref={autoGrow}
                  onInput={(e) => autoGrow(e.currentTarget)}
                  rows={2}
                  spellCheck={false}
                  aria-label={`切片 ${chunk.chunk_index + 1} 内容`}
                  className="w-full resize-none overflow-y-auto rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />

                {saveError && (
                  <p className="mt-1.5 text-xs text-red-600">
                    保存失败：{saveError}
                  </p>
                )}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs">
                    {justSaved ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                        <CheckIcon className="h-3 w-3" />
                        已保存
                      </span>
                    ) : dirty ? (
                      <span className="text-amber-600">有未保存的修改</span>
                    ) : (
                      <span className="text-slate-300">与索引一致</span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    {dirty && (
                      <button
                        type="button"
                        onClick={() => onRevert(chunk)}
                        disabled={saving}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                      >
                        还原
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSave(chunk)}
                      disabled={!dirty || saving}
                      className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
