"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  ],
  products: [],
  aftersales: [
    { value: "", label: "全部状态" },
    { value: "refunding", label: "退款中" },
    { value: "被拒", label: "被拒" },
    { value: "refunded", label: "已退款" },
  ],
};

interface Row {
  [key: string]: string | number;
}

export default function DataPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("orders");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/v1/data/${tab}`)
      .then((r) => r.json())
      .then((d: Row[]) => setRows(d))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
    setSearch("");
    setStatusFilter("");
  }, [tab]);

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-bold text-slate-800">业务数据</h1>
        <p className="text-xs text-slate-400">只读查看 · 点击对话按钮快速处理</p>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Tab 切换 */}
        <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                tab === t
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* 搜索 + 筛选 */}
        <div className="mb-4 flex gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-300"
          />
          {STATUS_OPTIONS[tab].length > 0 && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
            >
              {STATUS_OPTIONS[tab].map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 数据表格 */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">加载中...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">暂无数据</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs text-slate-400">
                  {columns[tab].map((c) => (
                    <th key={c.key} className="px-4 py-3 font-medium">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    {columns[tab].map((c) => (
                      <td key={c.key} className="px-4 py-3 text-sm text-slate-700">
                        {c.key === "amount" || c.key === "price"
                          ? `¥${row[c.key]}`
                          : String(row[c.key] ?? "")}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleChat(row)}
                        className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700"
                      >
                        对话
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filtered.length > 0 && (
          <p className="mt-3 text-xs text-slate-400">显示 {filtered.length} / {rows.length} 条</p>
        )}
      </main>
    </div>
  );
}
