"use client";

import { useEffect, useState } from "react";

import { Button } from "./ui/Button";

interface OrderInfo {
  order_id: string;
  product: string;
  buyer: string;
  amount: number;
  status: string;
  date: string;
}

interface ValidateResult {
  ok: boolean;
  token?: string;
  preview?: {
    order_id: string;
    amount: number;
    after_amount: number;
    item: string;
  };
  violations?: string[];
}

interface ExecuteResult {
  ok: boolean;
  receipt?: {
    order_id: string;
    refund_amount: number;
    after_amount: number;
    aftersales_id: number;
    status: string;
    executed_at: string;
  };
  idempotent?: boolean;
  message?: string;
  violations?: string[];
}

export function RefundDialog({ order, onClose }: { order: OrderInfo; onClose: () => void }) {
  const [amount, setAmount] = useState(String(order.amount));
  const [step, setStep] = useState<"input" | "validated" | "executed">("input");
  const [token, setToken] = useState("");
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [loading, setLoading] = useState(false);

  // 弹窗打开期间锁定背景滚动，卸载时还原
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Esc 关闭
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleValidate() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/refund/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.order_id, amount: parseFloat(amount) }),
      });
      const data: ValidateResult = await r.json();
      setValidateResult(data);
      if (data.ok && data.token) {
        setToken(data.token);
        setStep("validated");
      }
    } catch {
      setValidateResult({ ok: false, violations: ["网络异常，请重试"] });
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/refund/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.order_id, token }),
      });
      const data: ExecuteResult = await r.json();
      setExecuteResult(data);
      setStep("executed");
    } catch {
      setExecuteResult({ ok: false, violations: ["网络异常，请重试"] });
      setStep("executed");
    } finally {
      setLoading(false);
    }
  }

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
        aria-labelledby="refund-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface shadow-xl"
      >
        {/* 标题 */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 id="refund-dialog-title" className="text-lg font-semibold text-ink">
            {step === "executed" ? (executeResult?.ok ? "退款成功" : "退款未执行") : "退款确认"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-control p-1 text-ink-subtle transition hover:bg-surface-subtle hover:text-ink-muted"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 pb-4">
          {/* 订单详情 */}
          <div className="rounded-card border border-line bg-surface-muted p-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-ink-subtle">订单号：</span><span className="text-ink-muted">{order.order_id}</span></div>
              <div><span className="text-ink-subtle">商品：</span><span className="text-ink-muted">{order.product}</span></div>
              <div><span className="text-ink-subtle">买家：</span><span className="text-ink-muted">{order.buyer}</span></div>
              <div><span className="text-ink-subtle">实付：</span><span className="font-medium text-ink">¥{order.amount}</span></div>
            </div>
          </div>

          {/* Step 1: 输入金额 */}
          {step === "input" && (
            <>
              <div>
                <label htmlFor="refund-amount" className="mb-1 block text-sm text-ink-muted">退款金额</label>
                <input
                  id="refund-amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-brand-400"
                  min="0.01"
                  max={order.amount}
                  step="0.01"
                />
              </div>
              {validateResult && !validateResult.ok && (
                <div className="rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
                  {validateResult.violations?.map((v, i) => <p key={i}>• {v}</p>)}
                </div>
              )}
            </>
          )}

          {/* Step 2: 校验通过 → 预览 + 确认 */}
          {step === "validated" && validateResult?.ok && (
            <div className="rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-success">
              <p>✅ 校验通过</p>
              <p className="mt-1 text-xs text-success/80">退款 ¥{validateResult.preview?.amount}，剩余 ¥{validateResult.preview?.after_amount}，请确认后执行</p>
            </div>
          )}

          {/* Step 3: 执行结果 */}
          {step === "executed" && (
            <>
              {executeResult?.ok ? (
                <div className="rounded-card border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-success">
                  <p className="font-medium">
                    {executeResult.idempotent ? "已退款（幂等回执）" : "退款成功"}
                  </p>
                  {executeResult.receipt && (
                    <div className="mt-2 space-y-1 text-xs text-success/80">
                      <p>订单：{executeResult.receipt.order_id}</p>
                      <p>退款：¥{executeResult.receipt.refund_amount}，剩余 ¥{executeResult.receipt.after_amount}</p>
                      <p>售后单：#{executeResult.receipt.aftersales_id} · {executeResult.receipt.status}</p>
                      <p>时间：{executeResult.receipt.executed_at}</p>
                    </div>
                  )}
                  {executeResult.message && <p className="mt-1 text-xs">{executeResult.message}</p>}
                </div>
              ) : (
                <div className="rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
                  {executeResult?.violations?.map((v, i) => <p key={i}>• {v}</p>)}
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部操作：右对齐 */}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          {step === "input" && (
            <>
              <Button variant="secondary" onClick={onClose}>取消</Button>
              <Button onClick={handleValidate} disabled={loading}>
                {loading ? "校验中..." : "下一步：校验"}
              </Button>
            </>
          )}
          {step === "validated" && validateResult?.ok && (
            <>
              <Button
                variant="secondary"
                onClick={() => { setStep("input"); setValidateResult(null); }}
              >
                返回修改
              </Button>
              <Button variant="danger" onClick={handleExecute} disabled={loading}>
                {loading ? "执行中..." : "确认退款"}
              </Button>
            </>
          )}
          {step === "executed" && (
            <Button variant="secondary" onClick={onClose}>关闭</Button>
          )}
        </div>
      </div>
    </div>
  );
}
