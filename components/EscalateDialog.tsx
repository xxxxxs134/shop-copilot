'use client';

import { useEffect, useState } from 'react';

import { Button } from './ui/Button';

/**
 * 生成处理方案确认对话框（运营助手入口）
 *
 * 填写补充说明（选填）→ 确认后由 ChatWindow 调 /api/v1/escalate 生成情况摘要/建议动作/可复制话术。
 * 生成期间按钮显示「生成中…」并禁用（与 RefundDialog 加载态一致）。
 */
export function EscalateDialog({
  pending,
  onSubmit,
  onClose,
}: {
  /** 请求进行中：禁用按钮并显示加载文案 */
  pending: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  // 弹窗打开期间锁定背景滚动，卸载时还原
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Esc 关闭
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="escalate-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 id="escalate-dialog-title" className="text-lg font-semibold text-ink">生成处理方案</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-ink-subtle transition hover:bg-surface-subtle hover:text-ink-muted"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 pb-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            系统将汇总当前会话上下文，生成情况摘要、建议动作与可复制话术，辅助你快速制定处理方案。
          </p>

          <div>
            <label htmlFor="escalate-reason" className="mb-1 block text-sm text-ink-muted">
              补充说明（选填）
            </label>
            <textarea
              id="escalate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="如：客户情绪激动 / 退款争议 / 需要重点跟进…"
              className="w-full resize-none rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-brand-400"
            />
          </div>
        </div>

        {/* 底部操作：右对齐 */}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>取消</Button>
          <Button onClick={() => onSubmit(reason)} disabled={pending}>
            {pending ? '生成中…' : '生成处理方案'}
          </Button>
        </div>
      </div>
    </div>
  );
}
