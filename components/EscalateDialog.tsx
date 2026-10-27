'use client';

import { useState } from 'react';

/**
 * 转人工确认对话框（人机协同增强入口）
 *
 * 填写转人工原因（选填）→ 确认后由 ChatWindow 调 /api/v1/escalate 生成摘要/建议/话术。
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">转人工</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <p className="text-sm leading-relaxed text-slate-600">
          人机协同增强：系统将汇总当前会话上下文，生成转人工摘要、下一步建议与话术辅助，供人工客服接手。
        </p>

        <div className="mt-4">
          <label htmlFor="escalate-reason" className="mb-1 block text-sm text-slate-500">
            转人工原因（选填）
          </label>
          <textarea
            id="escalate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="如：客户情绪激动 / 需要主管介入 / 退款争议…"
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-emerald-400"
          />
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSubmit(reason)}
            disabled={pending}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? '生成中…' : '确认转人工'}
          </button>
        </div>
      </div>
    </div>
  );
}
