'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

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

// ── 常量 ──

/** C9 检索自测得分（backend/.../selftest.py 最近一次结果，用于统计卡展示） */
const RETRIEVAL_SCORE = 90;

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

function XIcon({ className }: { className?: string }) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** 统计卡：值 text-2xl / 标签 text-xs，与 /workspace 的 KPI 同族 */
function StatCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string | number;
  suffix?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">
        {value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-ink-subtle">{suffix}</span>}
      </p>
    </Card>
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
      const raw = await request<unknown>(`/api/v1/kb/chunks?doc=${encodeURIComponent(docId)}`);
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
      setChunks((prev) => (prev ? prev.map((c) => (c.id === key ? { ...c, text } : c)) : prev));
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
      <PageContainer>
        <div className="mx-auto w-full max-w-4xl space-y-5">
          {/* 顶栏：返回 + 页头 + 重建索引 */}
          <div>
            <Link
              href="/"
              className="mb-2 inline-flex items-center gap-1 text-xs text-ink-subtle transition-colors hover:text-brand-600"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              返回工作台
            </Link>
            <PageHeader
              title="知识库"
              description="编辑切片，保存即生效"
              actions={
                <Button
                  variant="secondary"
                  onClick={() => void handleRebuild()}
                  disabled={rebuilding}
                >
                  <RefreshIcon className={cn('h-4 w-4', rebuilding && 'animate-spin')} />
                  {rebuilding ? '重建中…' : '重建索引'}
                </Button>
              }
            />
          </div>

          {/* 统计：文档数 / 切片数 / 检索得分 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="文档数" value={docs === null ? '—' : docs.length} />
            <StatCard label="切片数" value={docs === null ? '—' : totalChunks} />
            <StatCard label="检索得分" value={RETRIEVAL_SCORE} suffix="%" />
          </div>

          {/* 文档列表：错误 / 加载 / 空 / 正常 */}
          {docsError && (
            <Card>
              <CardBody>
                <p className="text-sm font-medium text-ink">文档列表加载失败</p>
                <p className="mt-1 break-all text-xs text-ink-subtle">{docsError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => void loadDocs()}
                >
                  重试
                </Button>
              </CardBody>
            </Card>
          )}

          {docsLoading && (
            <Card>
              <CardBody className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-4 py-2">
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {!docsLoading && !docsError && docs !== null && docs.length === 0 && (
            <Card>
              <CardBody>
                <EmptyState
                  title="知识库暂无文档"
                  hint="先执行 python -m backend.app.rag.pipeline build 构建索引"
                />
              </CardBody>
            </Card>
          )}

          {!docsLoading && !docsError && docs !== null && docs.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
                <p className="text-sm font-semibold text-ink">文档与切片</p>
                <p className="text-xs text-ink-subtle">
                  共 {docs.length} 篇文档 · {totalChunks} 个切片
                </p>
              </div>
              <div>
                {docs.map((doc) => {
                  const open = openId === doc.id;
                  return (
                    <DocRow key={doc.id} doc={doc} open={open} onToggle={() => toggleDoc(doc.id)}>
                      {open && (
                        <CardBody className="border-t border-line bg-surface-muted">
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
                        </CardBody>
                      )}
                    </DocRow>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </PageContainer>

      {/* 成功/失败 toast（右上角，Card 承载） */}
      {toast && (
        <Card role="status" className="fixed right-6 top-6 z-50 w-80 shadow-xl">
          <CardBody className="flex items-start gap-2.5 p-4">
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white',
                toast.kind === 'success' ? 'bg-success' : 'bg-danger',
              )}
            >
              {toast.kind === 'success' ? (
                <CheckIcon className="h-3 w-3" />
              ) : (
                <AlertIcon className="h-3 w-3" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{toast.title}</p>
              {toast.detail && (
                <p className="mt-0.5 break-all text-xs text-ink-subtle">{toast.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="关闭提示"
              className="shrink-0 rounded-control p-0.5 text-ink-subtle transition-colors hover:text-ink"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </CardBody>
        </Card>
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
    <div className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-muted',
          open && 'bg-surface-muted',
        )}
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-ink-subtle transition-transform',
            open && 'rotate-90 text-brand-600',
          )}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-sm font-medium',
              open ? 'text-brand-700' : 'text-ink',
            )}
          >
            {doc.title}
          </span>
          {doc.source && (
            <span className="mt-0.5 block truncate text-xs text-ink-subtle">{doc.source}</span>
          )}
        </span>
        <span className="inline-flex shrink-0 rounded-control bg-surface-subtle px-2 py-0.5 text-xs text-ink-muted">
          {doc.category}
        </span>
        <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink-muted">
          {doc.chunk_count}
          <span className="ml-0.5 text-xs text-ink-subtle">块</span>
        </span>
      </button>
      {children}
    </div>
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
    <div className="space-y-3">
      <p className="text-xs text-ink-subtle">
        《{doc.title}》的切片 · 修改文本后点「保存」即重嵌入并即时生效
      </p>

      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-control border border-line bg-surface p-3">
              <Skeleton className="mb-2 h-3 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-4/5" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-control border border-line bg-surface px-4 py-3">
          <p className="text-sm font-medium text-ink">切片加载失败</p>
          <p className="mt-1 break-all text-xs text-ink-subtle">{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            重试
          </Button>
        </div>
      )}

      {!loading && !error && chunks !== null && chunks.length === 0 && (
        <p className="rounded-control border border-dashed border-line bg-surface px-4 py-6 text-center text-xs text-ink-subtle">
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
                className={cn(
                  'rounded-control border bg-surface p-3 transition-colors',
                  saveError ? 'border-danger' : dirty ? 'border-brand-200' : 'border-line',
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink-muted">
                    切片 #{chunk.chunk_index + 1}
                  </span>
                  <span className="text-xs tabular-nums text-ink-subtle">{value.length} 字</span>
                </div>

                <textarea
                  value={value}
                  onChange={(e) => onDraft(key, e.target.value)}
                  ref={autoGrow}
                  onInput={(e) => autoGrow(e.currentTarget)}
                  rows={2}
                  spellCheck={false}
                  aria-label={`切片 ${chunk.chunk_index + 1} 内容`}
                  className="w-full resize-none overflow-y-auto rounded-control border border-line bg-surface p-3 text-sm leading-relaxed text-ink outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />

                {saveError && <p className="mt-1.5 text-xs text-danger">保存失败：{saveError}</p>}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs">
                    {justSaved ? (
                      <span className="inline-flex items-center gap-1 font-medium text-success">
                        <CheckIcon className="h-3 w-3" />
                        已保存
                      </span>
                    ) : dirty ? (
                      <span className="text-warning">有未保存的修改</span>
                    ) : (
                      <span className="text-ink-subtle">与索引一致</span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    {dirty && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onRevert(chunk)}
                        disabled={saving}
                      >
                        还原
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onSave(chunk)}
                      disabled={!dirty || saving}
                    >
                      {saving ? '保存中…' : '保存'}
                    </Button>
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
