"use client";

import { useState } from "react";

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
    refund_amount: number;
    after_amount: number;
    product: string;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">
            {step === "executed" ? (executeResult?.ok ? "退款成功" : "退款未执行") : "退款确认"}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            ✕
          </button>
        </div>

        {/* 订单详情 */}
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-400">订单号：</span><span className="text-slate-700">{order.order_id}</span></div>
            <div><span className="text-slate-400">商品：</span><span className="text-slate-700">{order.product}</span></div>
            <div><span className="text-slate-400">买家：</span><span className="text-slate-700">{order.buyer}</span></div>
            <div><span className="text-slate-400">实付：</span><span className="font-medium text-slate-800">¥{order.amount}</span></div>
          </div>
        </div>

        {/* Step 1: 输入金额 */}
        {step === "input" && (
          <>
            <div className="mb-4">
              <label className="mb-1 block text-sm text-slate-500">退款金额</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                min="0.01"
                max={order.amount}
                step="0.01"
              />
            </div>
            {validateResult && !validateResult.ok && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {validateResult.violations?.map((v, i) => <p key={i}>• {v}</p>)}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                取消
              </button>
              <button
                onClick={handleValidate}
                disabled={loading}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              >
                {loading ? "校验中..." : "下一步：校验"}
              </button>
            </div>
          </>
        )}

        {/* Step 2: 校验通过 → 预览 + 确认 */}
        {step === "validated" && validateResult?.ok && (
          <>
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <p>✅ 校验通过</p>
              <p className="mt-1 text-xs text-emerald-600">退款 ¥{validateResult.preview?.refund_amount}，剩余 ¥{validateResult.preview?.after_amount}，请确认后执行</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setStep("input"); setValidateResult(null); }}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                返回修改
              </button>
              <button
                onClick={handleExecute}
                disabled={loading}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
              >
                {loading ? "执行中..." : "确认退款"}
              </button>
            </div>
          </>
        )}

        {/* Step 3: 执行结果 */}
        {step === "executed" && (
          <>
            {executeResult?.ok ? (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                <p className="font-medium">
                  {executeResult.idempotent ? "已退款（幂等回执）" : "退款成功"}
                </p>
                {executeResult.receipt && (
                  <div className="mt-2 space-y-1 text-xs text-emerald-600">
                    <p>订单：{executeResult.receipt.order_id}</p>
                    <p>退款：¥{executeResult.receipt.refund_amount}，剩余 ¥{executeResult.receipt.after_amount}</p>
                    <p>售后单：#{executeResult.receipt.aftersales_id} · {executeResult.receipt.status}</p>
                    <p>时间：{executeResult.receipt.executed_at}</p>
                  </div>
                )}
                {executeResult.message && <p className="mt-1 text-xs">{executeResult.message}</p>}
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {executeResult?.violations?.map((v, i) => <p key={i}>• {v}</p>)}
              </div>
            )}
            <button onClick={onClose} className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              关闭
            </button>
          </>
        )}
      </div>
    </div>
  );
}
