import type { Metadata } from 'next';
import './globals.css';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { MobileNav } from '@/components/MobileNav';

export const metadata: Metadata = {
  title: '店智 Copilot - 中小电商运营者的 AI 工作台',
  description: '面向中小电商运营者的 AI Agent 工作台：对话问答、数据分析、商品文案',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {/* 全局左导航：跨路由持久，点击导航仅切换右侧内容区 */}
        <div className="flex min-h-screen flex-col md:flex-row">
          <WorkspaceSidebar />
          <MobileNav />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
