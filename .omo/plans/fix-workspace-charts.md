# 紧急修复：WorkspaceCharts 补 TrendChart + DonutChart

## 背景
app/workspace/page.tsx 已引用 `TrendChart` 和 `DonutChart`，但 components/WorkspaceCharts.tsx 里不存在这两个导出 → build 报 `Export DonutChart doesn't exist in target module`。

## 修复内容
在 components/WorkspaceCharts.tsx 中 `export function IntentDist` 之前插入两个组件：

### TrendChart
- props: `{ data: Array<{date, gmv, orders}> }`
- SVG 折线图（viewBox 600x120），GMV 蓝色实线 + 订单数绿色虚线
- 首尾日期标注 + 图例
- 空数据显示"暂无数据"

### DonutChart
- props: `{ data: Array<{label, value, color}> }`
- conic-gradient 圆环 + 中心总计数字 + 右侧图例
- 空数据显示"暂无数据"

## 后端
backend/app/api_workspace.py 需补 `daily_trend` 和 `order_status_dist` 字段（子代理 bg_d65e0865 在做）。

## 验收
- npx tsc --noEmit 0 错
- npm run build 0 错
- 浏览器 /workspace 显示趋势图 + 环形图
