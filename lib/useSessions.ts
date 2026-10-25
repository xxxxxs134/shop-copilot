'use client';

/**
 * 会话状态机（从 ChatWindow 抽取，保持组件 <250 LOC）
 *
 * 契约：docs/plan-p4.md §3.1
 * - 列表/打开/新建/改名/删除 → /api/v1/sessions（同源代理 → FastAPI）
 * - 保存：消息变化 debounce 1.5s PUT 全量覆盖；切会话/新建前强制 flush
 * - 签名守卫：`id|JSON(payload)` 与上次已存一致则跳过，避免加载回放触发回写
 * - loadingRef：加载窗口内禁止 flush，防止「旧消息写进新会话」竞态
 * - 自动命名：现标题为「新对话」且有首条 user 消息 → 取前 20 字随 PUT 提交
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  patchSession,
  putMessages,
  type AgentMessage,
  type SessionFull,
  type SessionId,
  type SessionMeta,
  type SessionMode,
} from './sessionsClient';

/** 新会话默认标题（后端 POST 同款；首条消息保存时自动改名） */
export const DEFAULT_TITLE = '新对话';

const SAVE_DEBOUNCE_MS = 1500;

export interface UseSessionsOptions {
  /** 当前待保存消息（按 mode 取 RAG 或 Agent 队列）；hook 经 ref 每次渲染刷新 */
  getPayload: (mode: SessionMode) => UIMessage[] | AgentMessage[];
  /** 会话已打开/新建，调用方回放消息到界面（hook 已先设好 activeId/mode） */
  onSessionLoaded: (session: SessionFull) => void;
  /** 活跃会话被删除，调用方清空两套消息状态 */
  onSessionClosed: () => void;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : '会话操作失败';
}

function signature(id: SessionId, payload: unknown[]): string {
  return `${id}|${JSON.stringify(payload)}`;
}

/** 首条 user 消息文本 → 自动标题（截 20 字）；兼容 UIMessage.parts 与 AgentMessage.content */
function firstUserTitle(payload: unknown[]): string | null {
  for (const m of payload) {
    if (!m || typeof m !== 'object') continue;
    const mm = m as { role?: unknown; content?: unknown; parts?: unknown };
    if (mm.role !== 'user') continue;
    let text = '';
    if (typeof mm.content === 'string') {
      text = mm.content;
    } else if (Array.isArray(mm.parts)) {
      text = mm.parts
        .map((p) => {
          const part = p as { type?: unknown; text?: unknown };
          return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
        })
        .join('');
    }
    const trimmed = text.trim();
    return trimmed ? trimmed.slice(0, 20) : null;
  }
  return null;
}

export function useSessions(opts: UseSessionsOptions) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<SessionId | null>(null);
  const [mode, setMode] = useState<SessionMode>('rag');
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 渲染期同步的镜像 ref（flush/open 等回调需要读到最新值，不等 re-render）
  const modeRef = useRef(mode);
  const activeIdRef = useRef<SessionId | null>(null);
  const sessionsRef = useRef(sessions);
  const optsRef = useRef(opts);
  // 加载窗口标志：true 期间 flush 禁写
  const loadingRef = useRef(false);
  const savedSigRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 渲染期同步镜像 ref —— react-hooks/refs 禁止 render 期写 ref，
  // 故在 commit 后的 effect 里同步（用户交互/定时器回调都晚于它）。
  // 需要「立即」新值的路径（applyLoaded / toggleMode / removeSession）已在回调内手动写 ref。
  useEffect(() => {
    modeRef.current = mode;
    activeIdRef.current = activeId;
    sessionsRef.current = sessions;
    optsRef.current = opts;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 立即保存（无变更则跳过）。切会话/新建/删除活跃会话前必须先 await 它。 */
  const flush = useCallback(async (): Promise<void> => {
    clearTimer();
    const id = activeIdRef.current;
    if (!id || loadingRef.current) return;
    const payload = optsRef.current.getPayload(modeRef.current);
    const sig = signature(id, payload);
    if (sig === savedSigRef.current) return;

    const meta = sessionsRef.current.find((x) => x.id === id);
    let title: string | undefined;
    if (meta && meta.title === DEFAULT_TITLE) {
      const t = firstUserTitle(payload);
      if (t) title = t;
    }

    try {
      await putMessages(id, payload, title);
      savedSigRef.current = sig;
      const now = Math.floor(Date.now() / 1000);
      setSessions((prev) =>
        prev.map((x) => (x.id === id ? { ...x, updated_at: now, title: title ?? x.title } : x)),
      );
      setError(null);
    } catch (err) {
      setError(errText(err));
    }
  }, [clearTimer]);

  /** 消息变化时由 ChatWindow 调用 → debounce 保存 */
  const notifyChanged = useCallback(() => {
    if (activeIdRef.current === null || loadingRef.current) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [clearTimer, flush]);

  /** 装载会话到界面（设置 activeId/mode/savedSig，回调调用方回放消息） */
  const applyLoaded = useCallback((sess: SessionFull) => {
    savedSigRef.current = signature(sess.id, sess.messages);
    loadingRef.current = true;
    activeIdRef.current = sess.id;
    setActiveId(sess.id);
    setMode(sess.mode);
    modeRef.current = sess.mode;
    optsRef.current.onSessionLoaded(sess);
    // 渲染（回放消息）完成后解除禁写窗口
    setTimeout(() => {
      loadingRef.current = false;
    }, 0);
  }, []);

  /** 打开会话：先 flush 旧的，再拉取全量 */
  const openSession = useCallback(
    async (id: SessionId): Promise<void> => {
      if (activeIdRef.current === id && !loadingRef.current) return;
      await flush();
      setBusy(true);
      try {
        const sess = await getSession(id);
        applyLoaded(sess);
        setError(null);
      } catch (err) {
        setError(errText(err));
      } finally {
        setBusy(false);
      }
    },
    [flush, applyLoaded],
  );

  /** 新建会话（可指定 mode，缺省沿用当前），并设为活跃 */
  const newSession = useCallback(
    async (nextMode?: SessionMode): Promise<void> => {
      await flush();
      setBusy(true);
      try {
        const sess = await createSession(nextMode ?? modeRef.current);
        setSessions((prev) => [
          { id: sess.id, title: sess.title, mode: sess.mode, updated_at: sess.updated_at },
          ...prev,
        ]);
        applyLoaded(sess);
        setError(null);
      } catch (err) {
        setError(errText(err));
      } finally {
        setBusy(false);
      }
    },
    [flush, applyLoaded],
  );

  const renameSession = useCallback(async (id: SessionId, title: string): Promise<void> => {
    try {
      await patchSession(id, { title });
      setSessions((prev) => prev.map((x) => (x.id === id ? { ...x, title } : x)));
      setError(null);
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  /** 删除会话；若删的是活跃会话 → 清空界面并切到剩余最近会话（如有） */
  const removeSession = useCallback(
    async (id: SessionId): Promise<void> => {
      setBusy(true);
      try {
        await deleteSession(id);
        const remaining = sessionsRef.current.filter((x) => x.id !== id);
        setSessions(remaining);
        if (activeIdRef.current === id) {
          clearTimer();
          savedSigRef.current = '';
          activeIdRef.current = null;
          setActiveId(null);
          optsRef.current.onSessionClosed();
          if (remaining[0]) await openSession(remaining[0].id);
        }
        setError(null);
      } catch (err) {
        setError(errText(err));
      } finally {
        setBusy(false);
      }
    },
    [clearTimer, openSession],
  );

  /**
   * 切换模式：
   * - 无活跃会话或加载中 → 直接改本地 mode
   * - 活跃会话为空 → PATCH 原地切（后端 §3.1 mode 字段）
   * - 活跃会话有消息 → 新建会话（保内容不丢）
   */
  const toggleMode = useCallback(
    async (next: SessionMode): Promise<void> => {
      if (next === modeRef.current) return;
      const id = activeIdRef.current;
      if (id && !loadingRef.current) {
        try {
          await patchSession(id, { mode: next });
          setSessions((prev) => prev.map((x) => (x.id === id ? { ...x, mode: next } : x)));
          setMode(next);
          modeRef.current = next;
          setError(null);
          return;
        } catch (err) {
          setError(errText(err));
          return;
        }
      }
      setMode(next);
      modeRef.current = next;
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  /**
   * 意图自动路由专用（P5 §2.2）：原地 PATCH 模式，**不新建会话**。
   *
   * 与 toggleMode 的区别：toggleMode 在「有消息」时会新建会话保内容，
   * 而自动路由要求同会话内切模式 —— 消息迁移由调用方（ChatWindow）负责。
   * 本地 mode 先行同步（含 modeRef，保证 debounce flush 取到新队列），
   * PATCH 失败只报错不回滚，避免会话存储卡住发送链路。
   */
  const switchModeInPlace = useCallback(async (next: SessionMode): Promise<void> => {
    setMode(next);
    modeRef.current = next;
    const id = activeIdRef.current;
    if (id && !loadingRef.current) {
      try {
        await patchSession(id, { mode: next });
        setSessions((prev) => prev.map((x) => (x.id === id ? { ...x, mode: next } : x)));
        setError(null);
      } catch (err) {
        setError(errText(err));
      }
    }
  }, []);

  // 启动：拉列表 → 自动打开最近会话
  const openRef = useRef(openSession);
  useEffect(() => {
    openRef.current = openSession;
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listSessions();
        if (cancelled) return;
        setSessions(list);
        sessionsRef.current = list;
        if (list[0]) await openRef.current(list[0].id);
      } catch (err) {
        if (!cancelled) setError(errText(err));
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    sessions,
    activeId,
    mode,
    collapsed,
    busy,
    error,
    setCollapsed,
    clearError,
    notifyChanged,
    openSession,
    newSession,
    renameSession,
    removeSession,
    toggleMode,
    switchModeInPlace,
  };
}
