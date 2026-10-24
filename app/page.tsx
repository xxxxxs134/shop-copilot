import { ChatWindow } from '@/components/ChatWindow';

/**
 * 首页：P4 起为「侧边栏 + 聊天窗口」双栏布局
 * （Sidebar 由 ChatWindow 内部渲染，会话状态机同管）
 */
export default function HomePage() {
  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <ChatWindow />
    </main>
  );
}
