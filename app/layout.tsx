import type { Metadata } from 'next';
import './globals.css';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { MobileNav } from '@/components/MobileNav';

export const metadata: Metadata = {
  title: '店智 Copilot - 电商智能客服',
  description: '面向客户的电商全链路智能客服 Agent：商品咨询、智能推荐、订单售后',
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
