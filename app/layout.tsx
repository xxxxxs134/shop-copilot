import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '店智 Copilot - 电商运营 AI 智能助手',
  description: '面向中小电商运营者的 AI Agent 工作台：对话问答、数据分析、商品文案',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
