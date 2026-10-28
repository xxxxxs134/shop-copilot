export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export const ORDER_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  paid: { label: '已付', tone: 'info' },
  shipped: { label: '已发', tone: 'brand' },
  received: { label: '已收', tone: 'success' },
  refunding: { label: '退款中', tone: 'warning' },
  refunded: { label: '已退款', tone: 'neutral' },
  rejected: { label: '被拒', tone: 'danger' },
  unpaid: { label: '未付', tone: 'neutral' },
  intercepted: { label: '已拦截', tone: 'neutral' },
  // 售后单接口返回中文状态，保留同义映射，避免徽章语气回退
  退款中: { label: '退款中', tone: 'warning' },
  被拒: { label: '被拒', tone: 'danger' },
  已完成: { label: '已完成', tone: 'success' },
  待寄回: { label: '待寄回', tone: 'info' },
};

export function statusMeta(status: string): { label: string; tone: Tone } {
  return ORDER_STATUS_META[status] ?? { label: status || '未知', tone: 'neutral' };
}

/** 图表色板：仅图表库需要具体色值时使用，业务组件统一走 tone。 */
export const TONE_HEX: Record<Tone, string> = {
  neutral: '#94a3b8',
  brand: '#3b82f6',
  info: '#0ea5e9',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
};
