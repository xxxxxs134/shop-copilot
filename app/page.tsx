import { ChatWindow } from '@/components/ChatWindow';

/**
 * 首页：M0 阶段只承载一个全屏聊天窗口
 * 后续里程碑会在此加入侧边栏（数据看板 / 知识库管理等入口）
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <ChatWindow />
    </main>
  );
}
