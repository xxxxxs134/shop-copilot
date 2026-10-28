"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefundDialog } from "@/components/RefundDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { PageContainer } from "@/components/ui/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

type Tab = "orders" | "products" | "aftersales";

const TAB_LABELS: Record<Tab, string> = {
  orders: "订单",
  products: "商品",
  aftersales: "售后单",
};

const STATUS_OPTIONS: Record<Tab, Array<{ value: string; label: string }>> = {
  orders: [
    { value: "", label: "全部状态" },
    { value: "paid", label: "已付" },
    { value: "shipped", label: "已发" },
    { value: "refunding", label: "退款中" },
    { value: "refunded", label: "已退款" },
    { value: "rejected", label: "被拒" },
    { value: "unpaid", label: "未付" },
    { value: "intercepted", label: "已拦截" },
  ],
  products: [],
  aftersales: [
    { value: "", label: "全部状态" },
    { value: "退款中", label: "退款中" },
    { value: "待寄回", label: "待寄回" },
    { value: "被拒", label: "被拒" },
    { value: "已完成", label: "已完成" },
  ],
};

/** 可发起退款的状态（与后端 refund.validate 的前置校验保持一致） */
const REFUNDABLE_STATUSES = ["paid", "shipped", "received"];

const INPUT_CLASS =
  "rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

interface Row {
  [key: string]: string | number;
}

interface RefundOrder {
  order_id: string;
  product: string;
  buyer: string;
  amount: number;
  status: string;
  date: string;
}

export default function DataPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("orders");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [refundOrder, setRefundOrder] = useState<RefundOrder | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/v1/data/${tab}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Row[]) => {
        setRows(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        setRows([]);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, reloadKey]);

  // /data?focus=SO20261027001 → 预填搜索，只保留该行（静态预渲染安全：只在浏览器执行）
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus")?.trim();
    if (!focus) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(focus);
  }, []);

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setSearch("");
    setStatusFilter("");
  };

  const filtered = rows.filter((row) => {
    if (search) {
      const s = search.toLowerCase();
      const match = Object.values(row).some((v) => String(v).toLowerCase().includes(s));
      if (!match) return false;
    }
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });

  const handleChat = (row: Row) => {
    const id = row.order_id || row.sku || row.id;
    sessionStorage.setItem("prefill_query", `帮我查看 ${id} 的详情`);
    router.push("/chat");
  };

  const handleRefund = (row: Row) => {
    setRefundOrder({
      order_id: String(row.order_id),
      product: String(row.product ?? ""),
      buyer: String(row.buyer ?? ""),
      amount: Number(row.amount),
      status: String(row.status ?? ""),
      date: String(row.date ?? ""),
    });
  };

  const canRefund = (row: Row) =>
    REFUNDABLE_STATUSES.includes(String(row.status)) && Number(row.amount) > 0;

  const columns: Record<Tab, Array<{ key: string; label: string }>> = {
    orders: [
      { key: "order_id", label: "订单号" },
      { key: "product", label: "商品" },
      { key: "buyer", label: "买家" },
      { key: "amount", label: "金额" },
      { key: "status", label: "状态" },
      { key: "date", label: "日期" },
    ],
    products: [
      { key: "sku", label: "SKU" },
      { key: "name", label: "名称" },
      { key: "price", label: "价格" },
      { key: "stock", label: "库存" },
      { key: "category", label: "分类" },
    ],
    aftersales: [
      { key: "order_id", label: "订单号" },
      { key: "type", label: "类型" },
      { key: "amount", label: "金额" },
      { key: "status", label: "状态" },
      { key: "date", label: "日期" },
    ],
  };

  const hasFilter = Boolean(search || statusFilter);

  return (
    <PageContainer>
      <PageHeader
        title="业务数据"
        description="只读查看 · 点击对话快速处理"
        className="mb-5"
      />

      {/* Tab：分段控件 */}
      <div
        role="tablist"
        aria-label="数据类型"
        className="inline-flex rounded-control border border-line bg-surface p-1"
      >
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => selectTab(t)}
            className={cn(
              "rounded-control px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t
                ? "bg-brand-50 text-brand-700"
                : "text-ink-muted hover:bg-surface-muted",
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* 工具栏：搜索 + 状态 + 结果计数 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索订单号 / 商品 / 买家"
          aria-label="搜索"
          className={cn(INPUT_CLASS, "min-w-0 flex-1 sm:max-w-xs")}
        />
        {STATUS_OPTIONS[tab].length > 0 && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="状态筛选"
            className={INPUT_CLASS}
          >
            {STATUS_OPTIONS[tab].map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs text-ink-subtle">
          显示 {filtered.length} / {rows.length} 条
        </span>
      </div>

      {/* 数据表格 */}
      <Card className="mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              title="数据加载失败"
              hint="请确认数据服务可用后重试"
              action={
                <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                  重试
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={hasFilter ? "没有匹配的数据" : "暂无数据"}
              hint={hasFilter ? "换个关键词或状态试试" : "该分类下还没有记录"}
              action={
                hasFilter ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("");
                    }}
                  >
                    清空筛选
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  {columns[tab].map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="sticky top-0 z-10 bg-surface-muted px-4 py-2.5 font-medium"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="sticky top-0 z-10 bg-surface-muted px-4 py-2.5 text-right font-medium"
                  >
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr
                    key={i}
                    className="border-t border-line transition-colors hover:bg-surface-muted"
                  >
                    {columns[tab].map((c) => (
                      <td key={c.key} className="px-4 py-3 text-sm text-ink">
                        {c.key === "amount" || c.key === "price" ? (
                          `¥${row[c.key]}`
                        ) : c.key === "status" ? (
                          <StatusBadge status={String(row[c.key] ?? "")} />
                        ) : c.key === "stock" ? (
                          <span
                            className={cn(
                              Number(row[c.key]) <= 20 && "font-medium text-danger",
                            )}
                          >
                            {String(row[c.key])}
                            {Number(row[c.key]) <= 20 && (
                              <span className="ml-1 text-xs">· 低</span>
                            )}
                          </span>
                        ) : c.key === "category" ? (
                          <span className="inline-flex rounded-control bg-surface-subtle px-2 py-0.5 text-xs text-ink-muted">
                            {String(row[c.key] ?? "")}
                          </span>
                        ) : c.key === "date" ? (
                          <span className="text-xs text-ink-subtle">
                            {String(row[c.key] ?? "")}
                          </span>
                        ) : (
                          String(row[c.key] ?? "")
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {tab === "orders" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!canRefund(row)}
                            title={canRefund(row) ? "发起退款" : "当前状态不可退款"}
                            onClick={() => handleRefund(row)}
                          >
                            退款
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => handleChat(row)}>
                          对话
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {refundOrder && (
        <RefundDialog order={refundOrder} onClose={() => setRefundOrder(null)} />
      )}
    </PageContainer>
  );
}
